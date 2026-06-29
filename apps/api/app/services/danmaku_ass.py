"""
Danmaku ASS subtitle generator.

Generates NicoNico-style right-to-left scrolling comment overlays for MP4 export.
All comments within the selected time range are emitted as ASS Dialogue lines;
no per-stream cap is applied. Comments are placed in horizontal lanes (rows)
to minimise overlap, with a per-lane "next free time" tracking that allows
overlap when a lane is busy and falls back to overwriting the soonest-freeing
lane for very dense bursts.

MVP scope:
- 1920x1080 baseline resolution (overridable via play_res)
- Right-to-left scrolling using ASS `\\move` override tag
- Lane assignment via greedy "next free time" tracking (with density
  controlling lane count and per-comment display time)
- All comments in the selected range are emitted by default
- Optional safety_comment_limit for runaway cases (off by default)
- Basic escape for ASS control characters

Future improvements:
- Detect video resolution via ffprobe
- Support for top/bottom static comments (in addition to scrolling)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple


# ─── Default constants ───────────────────────────────────────────────────────

DEFAULT_PLAY_RES_X = 1920
DEFAULT_PLAY_RES_Y = 1080
DEFAULT_FONT_NAME = "Noto Sans CJK JP"
DEFAULT_FONT_SIZE = 32
DEFAULT_OPACITY = 0.9
DEFAULT_LINE_HEIGHT = 48  # pixels between comment rows
DEFAULT_LANE_FRACTION = 0.75  # top 75% of the screen is the danmaku area

# Density presets control lane count and per-comment display time
# (not the number of comments emitted — all comments are emitted by default)
DENSITY_PRESETS = {
    # name: (lane_fraction, comment_duration)
    "low":    (0.55, 6.0),    # sparser, longer display
    "medium": (0.75, 4.0),    # standard
    "high":   (0.90, 3.0),    # busy stream, faster scroll, more lanes
}


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class NormalizedChatMessage:
    """Same shape as the TypeScript NormalizedChatMessage used in studio analysis."""
    timestamp: float
    time_sec: float
    message: str
    author: Optional[str] = None


@dataclass
class DanmakuOptions:
    play_res_x: int = DEFAULT_PLAY_RES_X
    play_res_y: int = DEFAULT_PLAY_RES_Y
    font_name: str = DEFAULT_FONT_NAME
    font_size: int = DEFAULT_FONT_SIZE
    comment_duration: float = 4.0
    opacity: float = DEFAULT_OPACITY
    density: str = "medium"  # "low" | "medium" | "high"
    ng_words: Sequence[str] = field(default_factory=tuple)
    min_message_length: int = 1
    deduplicate_consecutive: bool = True
    # Optional cap; None means "no cap" (emit every in-range comment).
    safety_comment_limit: Optional[int] = None


@dataclass
class DanmakuStats:
    in_range_count: int
    used_count: int
    skipped_ng: int
    skipped_too_short: int
    skipped_duplicate: int
    skipped_safety_limit: int = 0


@dataclass
class DanmakuResult:
    ass_path: str
    stats: DanmakuStats


# ─── Time formatting ─────────────────────────────────────────────────────────

def format_ass_time(seconds: float) -> str:
    """Convert seconds to h:mm:ss.cc (ASS time format)."""
    safe = max(0.0, seconds)
    hours = int(safe // 3600)
    minutes = int((safe % 3600) // 60)
    secs = safe - (hours * 3600) - (minutes * 60)
    centis = int(round((secs - int(secs)) * 100))
    if centis == 100:
        centis = 0
        secs += 1
    return f"{hours:d}:{minutes:02d}:{int(secs):02d}.{centis:02d}"


# ─── Comment filtering ───────────────────────────────────────────────────────

def is_valid_message(text: str, min_length: int = 1) -> bool:
    """Empty / whitespace-only / too-short comments are excluded."""
    stripped = text.strip()
    if not stripped:
        return False
    if len(stripped) < min_length:
        return False
    return True


def contains_ng_word(text: str, ng_words: Iterable[str]) -> bool:
    lowered = text.lower()
    for word in ng_words:
        if not word:
            continue
        if word.lower() in lowered:
            return True
    return False


# ─── Lane assignment ─────────────────────────────────────────────────────────

def _lane_count_for_density(play_res_y: int, font_size: int, density: str) -> int:
    """Compute the number of horizontal lanes based on density preset and font size."""
    lane_fraction, _ = DENSITY_PRESETS.get(density, DENSITY_PRESETS["medium"])
    line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    usable = int(play_res_y * lane_fraction)
    return max(1, usable // line_height)


def _lane_y_for(lane: int, play_res_y: int, font_size: int) -> int:
    line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    margin_top = int(play_res_y * 0.05)
    y = margin_top + lane * line_height
    return min(y, play_res_y - line_height)


def assign_lanes(
    comments: List[NormalizedChatMessage],
    clip_start: float,
    clip_end: float,
    play_res_y: int,
    font_size: int,
    comment_duration: float,
    density: str = "medium",
) -> List[Tuple[NormalizedChatMessage, int]]:
    """
    Lane assignment that minimises overlap.

    For each comment (already sorted by timestamp) we look for the lowest
    lane whose `next_free_at` is <= the comment's rel_start. If all lanes
    are busy, we overwrite the lane that frees up earliest.

    Lane count is derived from the density preset's lane_fraction so the
    total rendered surface scales with the resolution.
    """
    num_lanes = _lane_count_for_density(play_res_y, font_size, density)

    # next_free_at[lane] = the absolute clip-relative time at which the
    # lane becomes free again. Initialise all lanes to 0.
    next_free_at = [0.0] * num_lanes

    result: List[Tuple[NormalizedChatMessage, int]] = []
    for c in comments:
        rel_start = max(0.0, c.time_sec - clip_start)
        rel_end = rel_start + comment_duration
        if rel_start >= (clip_end - clip_start):
            continue

        chosen = None
        for lane_idx in range(num_lanes):
            if next_free_at[lane_idx] <= rel_start:
                chosen = lane_idx
                break

        if chosen is None:
            # All lanes busy — overwrite the soonest-freeing one.
            min_val = next_free_at[0]
            min_idx = 0
            for i in range(1, num_lanes):
                if next_free_at[i] < min_val:
                    min_val = next_free_at[i]
                    min_idx = i
            chosen = min_idx
            # Re-anchor so the comment starts at rel_start (overlap is
            # acceptable for very dense bursts — the alternative is to
            # drop comments, which we want to avoid).
            next_free_at[chosen] = rel_start + comment_duration
        else:
            next_free_at[chosen] = rel_end

        result.append((c, chosen))
    return result


# ─── ASS text escape ──────────────────────────────────────────────────────────

_ESCAPE_RE = re.compile(r"[\x00-\x1f\x7f]")

def escape_ass_text(text: str, max_length: int = 80) -> str:
    """
    Escape characters that would break ASS parsing.

    Note: this only sanitises the *text content*; it never reduces the
    number of comments emitted. The `max_length` cap is purely cosmetic
    (to keep on-screen text from wrapping off the right edge).
    """
    cleaned = text.replace("\r", " ").replace("\n", " ")
    # ASS treats { ... } as override tags. Strip them so the comment
    # text is not interpreted as a tag.
    cleaned = cleaned.replace("{", "(").replace("}", ")")
    cleaned = _ESCAPE_RE.sub("", cleaned)
    if len(cleaned) > max_length:
        cleaned = cleaned[: max_length - 1] + "…"
    return cleaned.strip()


# ─── ASS file generation ─────────────────────────────────────────────────────

def build_ass_header(opts: DanmakuOptions) -> str:
    """Build the [Script Info] / [V4+ Styles] sections of the ASS file."""
    alpha = max(0, min(255, int(round((1.0 - opts.opacity) * 255))))
    primary = f"&H{alpha:02X}FFFFFF"   # white text
    outline = "&H00000000"             # black outline (opaque)
    back = "&H80000000"                # semi-transparent black shadow

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {opts.play_res_x}\n"
        f"PlayResY: {opts.play_res_y}\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n"
        "YCbCr Matrix: TV.709\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Danmaku,{opts.font_name},{opts.font_size},{primary},{primary},{outline},{back},"
        "1,0,0,0,100,100,0,0,1,2,1,7,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def build_dialogue_line(
    comment: NormalizedChatMessage,
    lane: int,
    clip_start: float,
    play_res_x: int,
    play_res_y: int,
    font_size: int,
    comment_duration: float,
) -> Optional[str]:
    """Build a single Dialogue line. Returns None if the comment is invalid."""
    text = escape_ass_text(comment.message)
    if not text:
        return None

    rel_start = comment.time_sec - clip_start
    if rel_start < 0:
        rel_start = 0.0
    rel_end = rel_start + comment_duration

    y = _lane_y_for(lane, play_res_y, font_size)

    x_start = play_res_x + 200
    x_end = -int(play_res_x * 0.5)

    start_ts = format_ass_time(rel_start)
    end_ts = format_ass_time(rel_end)

    return (
        f"Dialogue: 0,{start_ts},{end_ts},Danmaku,,0,0,0,,"
        f"{{\\move({x_start},{y},{x_end},{y})}}{text}"
    )


def generate_danmaku_ass(
    chat_messages: Sequence[NormalizedChatMessage],
    clip_start: float,
    clip_end: float,
    output_path: str,
    options: Optional[DanmakuOptions] = None,
) -> DanmakuResult:
    """
    Generate an ASS file with right-to-left scrolling comments.

    By default every in-range comment is emitted. To cap the total
    number of comments (for runaway cases), set
    `options.safety_comment_limit` to a positive integer.
    """
    opts = options or DanmakuOptions()
    # Resolve density-specific knobs
    _, density_duration = DENSITY_PRESETS.get(opts.density, DENSITY_PRESETS["medium"])
    # If the user didn't explicitly set comment_duration, use the density default
    if opts.comment_duration == DanmakuOptions().comment_duration:
        opts.comment_duration = density_duration

    # ── Step 1: Filter by range ──────────────────────────────────────────────
    in_range: List[NormalizedChatMessage] = []
    for msg in chat_messages:
        ts = msg.time_sec
        if ts < clip_start or ts > clip_end:
            continue
        in_range.append(msg)

    # ── Step 2: Apply message-level filters (never reduce chat scope) ───────
    filtered: List[NormalizedChatMessage] = []
    skipped_ng = 0
    skipped_short = 0
    for msg in in_range:
        if not is_valid_message(msg.message, opts.min_message_length):
            skipped_short += 1
            continue
        if contains_ng_word(msg.message, opts.ng_words):
            skipped_ng += 1
            continue
        filtered.append(msg)

    # ── Step 3: Deduplicate consecutive identical comments ───────────────────
    deduped: List[NormalizedChatMessage] = []
    skipped_duplicate = 0
    if opts.deduplicate_consecutive:
        last_text = None
        for msg in filtered:
            if msg.message.strip() == last_text:
                skipped_duplicate += 1
                continue
            last_text = msg.message.strip()
            deduped.append(msg)
    else:
        deduped = filtered

    # ── Step 4: Sort by timestamp ────────────────────────────────────────────
    deduped.sort(key=lambda m: m.time_sec)

    # ── Step 5: Optional safety cap (off by default) ─────────────────────────
    skipped_safety = 0
    capped = deduped
    if opts.safety_comment_limit is not None and len(deduped) > opts.safety_comment_limit:
        # Score-based selection: keep the highest-priority comments, then
        # spread them across the clip so the start/end aren't dropped.
        def _score(m: NormalizedChatMessage, idx: int) -> Tuple[int, int]:
            score = 0
            lowered = m.message.lower()
            for kw in ("草", "www", "笑", "やばい", "神", "最高", "lol", "lmao", "ｗ"):
                if kw in lowered:
                    score += 1
            # Prefer moderately long comments
            length = len(m.message.strip())
            if 4 <= length <= 30:
                score += 1
            return (-score, idx)
        scored = sorted(
            ((_score(m, i), i, m) for i, m in enumerate(deduped)),
            key=lambda t: t[0],
        )
        chosen = sorted(scored[: opts.safety_comment_limit], key=lambda t: t[1])
        capped = [m for _, _, m in chosen]
        skipped_safety = len(deduped) - len(capped)

    # ── Step 6: Assign lanes ─────────────────────────────────────────────────
    lane_pairs = assign_lanes(
        capped,
        clip_start=clip_start,
        clip_end=clip_end,
        play_res_y=opts.play_res_y,
        font_size=opts.font_size,
        comment_duration=opts.comment_duration,
        density=opts.density,
    )

    # ── Step 7: Build ASS via list-append + join (fast) ─────────────────────
    header = build_ass_header(opts)
    lines: List[str] = [header]
    for comment, lane in lane_pairs:
        dlg = build_dialogue_line(
            comment=comment,
            lane=lane,
            clip_start=clip_start,
            play_res_x=opts.play_res_x,
            play_res_y=opts.play_res_y,
            font_size=opts.font_size,
            comment_duration=opts.comment_duration,
        )
        if dlg:
            lines.append(dlg)

    ass_content = "\n".join(lines) + "\n"

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(ass_content, encoding="utf-8")

    return DanmakuResult(
        ass_path=str(out),
        stats=DanmakuStats(
            in_range_count=len(in_range),
            used_count=len(lane_pairs),
            skipped_ng=skipped_ng,
            skipped_too_short=skipped_short,
            skipped_duplicate=skipped_duplicate,
            skipped_safety_limit=skipped_safety,
        ),
    )


# ─── CLI helper ──────────────────────────────────────────────────────────────

def main() -> int:  # pragma: no cover - manual CLI helper
    """Run as: python -m app.services.danmaku_ass <chat.json> <start> <end> <out.ass>"""
    import sys
    if len(sys.argv) < 5:
        print("Usage: danmaku_ass.py <chat.json> <start_sec> <end_sec> <out.ass>")
        return 1
    chat_path = Path(sys.argv[1])
    start = float(sys.argv[2])
    end = float(sys.argv[3])
    out_path = sys.argv[4]

    raw = json.loads(chat_path.read_text(encoding="utf-8"))
    messages = [NormalizedChatMessage(**m) for m in raw]
    result = generate_danmaku_ass(messages, start, end, out_path)
    print(f"Wrote {result.ass_path}")
    print(f"  in-range: {result.stats.in_range_count}")
    print(f"  used:     {result.stats.used_count}")
    print(f"  ng skip:  {result.stats.skipped_ng}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    import json
    sys.exit(main())
