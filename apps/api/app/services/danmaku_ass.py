"""
Danmaku ASS subtitle generator.

Generates NicoNico-style right-to-left scrolling comment overlays for MP4 export.
Comments are placed in horizontal lanes (rows) to avoid overlap.

MVP scope:
- 1920x1080 baseline resolution (overridable via play_res)
- Right-to-left scrolling using ASS `\\move` override tag
- Lane assignment via greedy per-row "next free time" tracking
- Comment density filtering (low / medium / high)
- Basic escape for ASS control characters

Future improvements:
- Detect video resolution via ffprobe
- Prioritize comments by keyword hits / chat velocity
- Support for top/bottom static comments (in addition to scrolling)
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple


# ─── Default constants ───────────────────────────────────────────────────────

DEFAULT_PLAY_RES_X = 1920
DEFAULT_PLAY_RES_Y = 1080
DEFAULT_FONT_NAME = "Noto Sans CJK JP"
DEFAULT_FONT_SIZE = 32
DEFAULT_COMMENT_DURATION = 4.0  # seconds the comment is visible on screen
DEFAULT_OPACITY = 0.9
DEFAULT_LINE_HEIGHT = 48  # pixels between comment rows

# Density presets (max comments to emit)
DENSITY_PRESETS = {
    "low": 50,
    "medium": 120,
    "high": 250,
}

# Priority keywords (used when filtering/picking top comments)
PRIORITY_KEYWORDS = (
    "草", "ｗ", "w", "www", "笑", "爆笑", "腹痛い", "おもろ",
    "やばい", "やば", "lol", "lmao", "神", "最高", "天才",
    "きた", "来た", "ｷﾀ", "キタ", "助けて", "たすけて",
)


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
    comment_duration: float = DEFAULT_COMMENT_DURATION
    opacity: float = DEFAULT_OPACITY
    max_comments: int = 120
    density: str = "medium"  # "low" | "medium" | "high"
    ng_words: Sequence[str] = field(default_factory=tuple)
    min_message_length: int = 1  # exclude comments with fewer than this many chars
    deduplicate_consecutive: bool = True


@dataclass
class DanmakuStats:
    in_range_count: int
    used_count: int
    skipped_ng: int
    skipped_too_short: int
    skipped_duplicate: int


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
    # ASS uses centiseconds (two digits after the dot)
    centis = int(round((secs - int(secs)) * 100))
    if centis == 100:
        # Rounding edge case
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


def priority_score(text: str) -> int:
    """Higher score = more likely to be shown when comments overflow."""
    score = 0
    lowered = text.lower()
    for kw in PRIORITY_KEYWORDS:
        if kw in lowered:
            score += 1
    # Slight preference for moderately long comments
    length = len(text.strip())
    if 4 <= length <= 30:
        score += 1
    return score


# ─── Lane assignment ──────────────────────────────────────────────────────────

def assign_lanes(
    comments: List[NormalizedChatMessage],
    clip_start: float,
    clip_end: float,
    play_res_y: int,
    font_size: int,
    comment_duration: float,
) -> List[Tuple[NormalizedChatMessage, int]]:
    """
    Greedy lane assignment.

    Returns a list of (comment, lane_index) pairs in input order.
    Comments are assigned to the lowest lane that is free for the
    full visibility window of the comment.

    lane_index ranges 0..num_lanes-1 (top to bottom).
    """
    line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    # Reserve ~10% top + bottom for safety
    usable = int(play_res_y * 0.8)
    num_lanes = max(1, usable // line_height)

    # next_free_at[lane] = the absolute clip-relative time at which the lane
    # becomes free again. Initialize all lanes to 0.
    next_free_at = [0.0] * num_lanes

    result: List[Tuple[NormalizedChatMessage, int]] = []
    for c in comments:
        rel_start = max(0.0, c.time_sec - clip_start)
        rel_end = rel_start + comment_duration
        if rel_start >= (clip_end - clip_start):
            # Comment is at/past the clip end (shouldn't happen, but guard)
            continue

        # Find the lowest lane that's free at rel_start
        chosen = None
        for lane_idx in range(num_lanes):
            if next_free_at[lane_idx] <= rel_start:
                chosen = lane_idx
                break

        if chosen is None:
            # All lanes are busy at this moment — overwrite the lane that
            # frees up earliest. This degrades gracefully under heavy load.
            chosen = next_free_at.index(min(next_free_at))
            # Re-anchor so the comment still starts at rel_start
            next_free_at[chosen] = rel_start + comment_duration
        else:
            next_free_at[chosen] = rel_end

        result.append((c, chosen))
    return result


# ─── ASS text escape ──────────────────────────────────────────────────────────

def escape_ass_text(text: str, max_length: int = 80) -> str:
    """
    Escape characters that would break ASS parsing.

    - Strip control characters
    - Replace newlines with spaces
    - Remove ASS override tag braces to avoid clashes
    - Truncate overly long messages
    """
    cleaned = text.replace("\r", " ").replace("\n", " ")
    # ASS treats { ... } as override tags. Strip them to keep the text
    # from being interpreted as a tag. We also escape any literal braces.
    cleaned = cleaned.replace("{", "(").replace("}", ")")
    # Strip other non-printable / control characters
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", cleaned)
    # Truncate
    if len(cleaned) > max_length:
        cleaned = cleaned[: max_length - 1] + "…"
    return cleaned.strip()


# ─── ASS file generation ─────────────────────────────────────────────────────

def build_ass_header(opts: DanmakuOptions) -> str:
    """Build the [Script Info] / [V4+ Styles] sections of the ASS file."""
    # ASS uses &HAABBGGRR for colors (alpha-blue-green-red, little-endian).
    # We pick white text, black outline, semi-transparent black shadow.
    # Alpha is two hex digits where 00 = opaque, FF = transparent.
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

    # y-coordinate: top of screen is y=0. We want a small top margin so
    # comments don't bump against the video border.
    line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    margin_top = int(play_res_y * 0.05)
    y = margin_top + lane * line_height
    # Clamp y so the comment fits
    y = min(y, play_res_y - line_height)

    # x: start at right edge + text width buffer, end off-screen on the left
    # ASS \\move(x1,y1,x2,y2) — use 1.5x PlayResX to be safe with long text
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

    Args:
        chat_messages: All normalized chat messages (will be filtered by range)
        clip_start: Absolute start time of the clip in seconds
        clip_end:   Absolute end time of the clip in seconds
        output_path: Filesystem path to write the .ass file to
        options:     DanmakuOptions (defaults are used when None)

    Returns:
        DanmakuResult with path and filtering stats
    """
    opts = options or DanmakuOptions()
    if opts.density in DENSITY_PRESETS and opts.max_comments == DanmakuOptions().max_comments:
        # Density preset overrides max_comments if user didn't override
        opts.max_comments = DENSITY_PRESETS[opts.density]

    # ── Step 1: Filter by range ──────────────────────────────────────────────
    in_range: List[NormalizedChatMessage] = []
    for msg in chat_messages:
        ts = msg.time_sec
        if ts < clip_start or ts > clip_end:
            continue
        in_range.append(msg)

    # ── Step 2: Apply message-level filters ──────────────────────────────────
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

    # ── Step 5: Cap to max_comments, prioritizing interesting ones ───────────
    capped = deduped
    if len(deduped) > opts.max_comments:
        # Score-based selection: keep the highest-priority comments, then
        # spread across the clip so we don't drop the start or end entirely.
        scored = [(priority_score(m.message), i, m) for i, m in enumerate(deduped)]
        scored.sort(key=lambda t: (-t[0], t[1]))
        chosen = sorted(scored[: opts.max_comments], key=lambda t: t[1])
        capped = [m for _, _, m in chosen]

    # ── Step 6: Assign lanes ─────────────────────────────────────────────────
    lane_pairs = assign_lanes(
        capped,
        clip_start=clip_start,
        clip_end=clip_end,
        play_res_y=opts.play_res_y,
        font_size=opts.font_size,
        comment_duration=opts.comment_duration,
    )

    # ── Step 7: Build ASS ────────────────────────────────────────────────────
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
