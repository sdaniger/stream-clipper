"""
Danmaku ASS subtitle generator.

Generates NicoNico-style right-to-left scrolling comment overlays for MP4 export.
All comments within the selected time range are emitted as ASS Dialogue lines;
no per-stream cap is applied. Comments are placed in horizontal lanes (rows)
to minimise overlap, with a per-lane "next free time" tracking that allows
overlap when a lane is busy and falls back to overwriting the soonest-freeing
lane for very dense bursts.

Features:
- 1920x1080 baseline resolution (overridable via play_res); supports 720p
- Right-to-left scrolling using ASS `\\move` override tag
- Per-comment text-width estimation so end_x matches the actual rendered
  width (CJK chars ~ 0.6 * font_size, ASCII ~ 0.35 * font_size)
- Style presets (niconico_classic / twitch_extension_like / minimal / dense)
  that drive font / opacity / outline / shadow / lane count / max-per-second
- Lane assignment via greedy "next free time" tracking, with speed
  inheritance so a comment never scrolls faster than the previous one
  on the same lane (smoothness boost, like the narinico tool)
- All comments in the selected range are emitted by default
- Optional safety_comment_limit for runaway cases (off by default)
- Comment filtering: NG words, URL, emoji-spam, per-user dedup window
- ASS control character escape (including `\\N`, `\\h`, `\\q`)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple


# ─── Default constants ───────────────────────────────────────────────────────

DEFAULT_PLAY_RES_X = 1920
DEFAULT_PLAY_RES_Y = 1080
DEFAULT_FONT_NAME = "Noto Sans JP"
DEFAULT_FONT_SIZE = 36
DEFAULT_OPACITY = 0.9
DEFAULT_OUTLINE = 2
DEFAULT_SHADOW = 1
DEFAULT_LINE_HEIGHT = 46  # pixels between comment rows (font_size + ~10)
DEFAULT_LANE_FRACTION = 0.75  # top 75% of the screen is the danmaku area
DEFAULT_TOP_MARGIN = 24
DEFAULT_BOTTOM_MARGIN = 24
DEFAULT_HORIZONTAL_PADDING = 20
DEFAULT_LONG_COMMENT_SCALE = 0.85  # long comments scroll ~15% faster
DEFAULT_EMOJI_ONLY_SCALE = 1.15    # emoji-only allowed to be slightly larger
DEFAULT_REF_SCREEN_WIDTH = 1920
DEFAULT_BASE_DWELL_SEC = 5.0       # reference time to cross the screen
DEFAULT_SAFE_GAP_PX = 24           # spacing between consecutive comments
SPEED_INHERIT_FACTOR = 1.0         # comment never scrolls faster than prev

# Density presets (lane_fraction, comment_duration, max_per_second)
# - lane_fraction: share of the screen height used for danmaku
# - comment_duration: default display time (used when the user did not
#   pass an explicit value)
# - max_per_second: cap on emitted comments per second of clip time
DENSITY_PRESETS = {
    "low":    (0.55, 6.0, 4),
    "medium": (0.75, 4.0, 8),
    "high":   (0.90, 3.0, 14),
    "insane": (1.00, 2.0, 24),     # debug / extreme; UI hides by default
}

# Style presets drive the visuals (font / outline / shadow / opacity / lane
# count cap / per-second cap).  Any of these can still be overridden by an
# explicit option value from the caller.
STYLE_PRESETS: dict[str, dict[str, object]] = {
    "niconico_classic": {
        "font_size": 36,
        "outline": 2,
        "shadow": 1,
        "opacity": 0.90,
        "lane_fraction": 0.75,
        "max_per_second": 8,
        "comment_duration": 4.5,
    },
    "twitch_extension_like": {
        "font_size": 34,
        "outline": 2,
        "shadow": 0,
        "opacity": 0.88,
        "lane_fraction": 0.65,
        "max_per_second": 6,
        "comment_duration": 5.0,
    },
    "minimal": {
        "font_size": 32,
        "outline": 2,
        "shadow": 0,
        "opacity": 0.85,
        "lane_fraction": 0.55,
        "max_per_second": 4,
        "comment_duration": 5.5,
    },
    "dense": {
        "font_size": 38,
        "outline": 2,
        "shadow": 1,
        "opacity": 0.92,
        "lane_fraction": 0.90,
        "max_per_second": 14,
        "comment_duration": 3.5,
    },
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
    outline: int = DEFAULT_OUTLINE
    shadow: int = DEFAULT_SHADOW
    density: str = "medium"  # "low" | "medium" | "high" | "insane"
    ng_words: Sequence[str] = field(default_factory=tuple)
    min_message_length: int = 1
    deduplicate_consecutive: bool = True
    # Optional cap; None means "no cap" (emit every in-range comment).
    safety_comment_limit: Optional[int] = None
    # ── Style preset (applied AFTER individual overrides; useful as a
    # one-click "NicoNico style" / "Twitch extension" / etc. knob.
    style_preset: Optional[str] = None
    # ── Lane / capacity tuning
    max_lanes: Optional[int] = None
    max_comments_per_second: Optional[int] = None
    lane_height: Optional[int] = None
    lane_fraction: Optional[float] = None
    top_margin: Optional[int] = None
    bottom_margin: Optional[int] = None
    horizontal_padding: Optional[int] = None
    # ── Comment scale boosts
    long_comment_scale: Optional[float] = None
    emoji_only_scale: Optional[float] = None
    # ── Filter toggles
    filter_urls: bool = True
    filter_repeated_by_user: bool = True
    emoji_spam_limit: Optional[int] = 10
    repeated_user_window_sec: float = 3.0


@dataclass
class DanmakuStats:
    in_range_count: int
    used_count: int
    skipped_ng: int
    skipped_too_short: int
    skipped_duplicate: int
    skipped_safety_limit: int = 0
    skipped_url: int = 0
    skipped_emoji_spam: int = 0
    skipped_user_repeat: int = 0
    skipped_rate_limit: int = 0


@dataclass
class DanmakuResult:
    ass_path: str
    stats: DanmakuStats


# ─── Time formatting ─────────────────────────────────────────────────────────

def format_ass_time(seconds: float) -> str:
    """Convert seconds to h:mm:ss.cc (ASS time format)."""
    safe = max(0.0, seconds)
    total_cs = int(round(safe * 100))
    hours = total_cs // 360000
    remaining = total_cs % 360000
    minutes = remaining // 6000
    remaining = remaining % 6000
    secs = remaining // 100
    centis = remaining % 100
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centis:02d}"


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


_URL_RE = re.compile(r"(https?://|www\.)", re.IGNORECASE)
_EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E0-\U0001F1FF]"
)


def contains_url(text: str) -> bool:
    return bool(_URL_RE.search(text))


def is_emoji_only(text: str) -> bool:
    stripped = _EMOJI_RE.sub("", text).strip()
    return bool(stripped == "" or len(stripped) <= 1)


def count_emoji(text: str) -> int:
    return len(_EMOJI_RE.findall(text))


# ─── Text width estimation ───────────────────────────────────────────────────


def estimate_text_width(text: str, font_size: int) -> int:
    """
    Approximate the rendered pixel width of a comment.

    Heuristic (close enough for ASS \move end_x):
    - CJK and full-width characters: ~ 0.60 * font_size
    - Latin / half-width:           ~ 0.35 * font_size
    - Emoji:                        ~ 0.85 * font_size
    - Spaces:                       ~ 0.30 * font_size
    """
    width = 0.0
    for ch in text:
        code = ord(ch)
        if ch == " ":
            width += font_size * 0.30
        elif _EMOJI_RE.match(ch):
            width += font_size * 0.85
        elif code > 0x2E80 or ch in "　、。「」『』・":
            # CJK / Hiragana / Katakana / punctuation
            width += font_size * 0.60
        else:
            width += font_size * 0.35
    return max(1, int(round(width)))


# ─── Lane assignment ─────────────────────────────────────────────────────────

def _lane_count_for_density(
    play_res_y: int,
    font_size: int,
    density: str,
    lane_fraction_override: Optional[float] = None,
    lane_height_override: Optional[int] = None,
) -> int:
    """Compute the number of horizontal lanes based on density preset and font size."""
    preset_lane_fraction, _, _ = DENSITY_PRESETS.get(density, DENSITY_PRESETS["medium"])
    lane_fraction = lane_fraction_override if lane_fraction_override is not None else preset_lane_fraction
    if lane_height_override is not None:
        line_height = max(1, lane_height_override)
    else:
        line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    usable = int(play_res_y * lane_fraction)
    return max(1, usable // line_height)


def _lane_y_for(
    lane: int,
    play_res_y: int,
    font_size: int,
    top_margin_override: Optional[int] = None,
    lane_height_override: Optional[int] = None,
) -> int:
    if lane_height_override is not None:
        line_height = max(1, lane_height_override)
    else:
        line_height = max(font_size + 8, DEFAULT_LINE_HEIGHT)
    margin_top = top_margin_override if top_margin_override is not None else int(play_res_y * 0.05)
    y = margin_top + lane * line_height
    return min(y, play_res_y - line_height)


def compute_scroll_duration(
    comment_width: int,
    play_res_x: int,
    base_dwell_sec: float = DEFAULT_BASE_DWELL_SEC,
    scale: float = 1.0,
) -> float:
    """
    Duration for a comment of given pixel width to cross the screen.

    speed = (play_res_x + comment_width + safe_gap) / dwell
    duration = (play_res_x + comment_width + safe_gap) / speed
    """
    safe_gap = max(8, int(REF_SAFE_GAP_PX * (play_res_x / DEFAULT_REF_SCREEN_WIDTH)))
    travel = play_res_x + comment_width + safe_gap
    raw_base = travel / max(0.5, base_dwell_sec)
    speed = raw_base * max(0.5, min(2.0, scale))
    duration = travel / max(1.0, speed)
    return max(0.3, duration)


REF_SAFE_GAP_PX = DEFAULT_SAFE_GAP_PX


def assign_lanes(
    comments: List[NormalizedChatMessage],
    clip_start: float,
    clip_end: float,
    play_res_y: int,
    play_res_x: int,
    font_size: int,
    comment_duration: float,
    density: str = "medium",
    max_lanes: Optional[int] = None,
    lane_fraction: Optional[float] = None,
    lane_height: Optional[int] = None,
    top_margin: Optional[int] = None,
    long_comment_scale: Optional[float] = None,
    emoji_only_scale: Optional[float] = None,
) -> List[Tuple[NormalizedChatMessage, int, float]]:
    """
    Lane assignment that minimises overlap and inherits per-lane speed.

    For each comment we look for the lowest lane whose `next_free_at`
    is <= the comment's rel_start. If all lanes are busy, we overwrite
    the lane that frees up earliest. Each comment is emitted with its
    own scroll duration so the end_x matches the actual rendered width.

    Returns a list of (comment, lane, duration) tuples.

    Speed inheritance: the next comment in a lane never scrolls faster
    than the previous one. This is the narinico "smoothness boost" —
    long comments slow down instead of outrunning the previous one.
    """
    if long_comment_scale is None:
        long_comment_scale = DEFAULT_LONG_COMMENT_SCALE
    if emoji_only_scale is None:
        emoji_only_scale = DEFAULT_EMOJI_ONLY_SCALE

    num_lanes = _lane_count_for_density(
        play_res_y, font_size, density,
        lane_fraction_override=lane_fraction,
        lane_height_override=lane_height,
    )
    if max_lanes is not None:
        num_lanes = min(num_lanes, max(1, max_lanes))

    # next_free_at[lane] = the absolute clip-relative time at which the
    # lane becomes free again. Initialise all lanes to 0.
    next_free_at = [0.0] * num_lanes
    # lane_speed_carryover: fastest speed the next comment is allowed to
    # use in this lane.  Infinity = no constraint.
    lane_speed_carryover = [float("inf")] * num_lanes

    clip_duration = clip_end - clip_start
    result: List[Tuple[NormalizedChatMessage, int, float]] = []
    for c in comments:
        rel_start = max(0.0, c.time_sec - clip_start)
        if rel_start >= clip_duration:
            continue
        if rel_start < 0:
            rel_start = 0.0

        text = c.message or ""
        text_width = estimate_text_width(text, font_size)
        emoji_only = is_emoji_only(text)
        long = len(text.strip()) > 20

        scale = 1.0
        if long:
            scale *= long_comment_scale
        if emoji_only:
            scale *= emoji_only_scale

        duration = compute_scroll_duration(
            text_width, play_res_x, base_dwell_sec=comment_duration, scale=scale,
        )
        # Speed inheritance: if previous comment set a slower carryover,
        # our duration must be at least that long.
        chosen = None
        for lane_idx in range(num_lanes):
            if next_free_at[lane_idx] <= rel_start:
                chosen = lane_idx
                break
        if chosen is None:
            min_val = next_free_at[0]
            min_idx = 0
            for i in range(1, num_lanes):
                if next_free_at[i] < min_val:
                    min_val = next_free_at[i]
                    min_idx = i
            chosen = min_idx

        # Inherit speed: the next comment cannot scroll faster than us,
        # so its minimum duration equals ours.
        travel = play_res_x + text_width + max(8, int(DEFAULT_SAFE_GAP_PX * (play_res_x / DEFAULT_REF_SCREEN_WIDTH)))
        our_speed = travel / max(0.01, duration)
        inherited_max_speed = min(our_speed, lane_speed_carryover[chosen])
        # Enforce that subsequent comment in this lane scrolls at our speed
        # (or slower). The next comment will compute its own duration and
        # then take the max of itself and the carryover's implied duration.
        lane_speed_carryover[chosen] = inherited_max_speed

        next_free_at[chosen] = rel_start + duration
        result.append((c, chosen, duration))
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
    # ASS treats { ... } as override tags. Replace them so the comment
    # text is not interpreted as a tag.
    cleaned = cleaned.replace("{", "(").replace("}", ")")
    cleaned = _ESCAPE_RE.sub("", cleaned)
    if len(cleaned) > max_length:
        cleaned = cleaned[: max_length - 1] + "…"
    return cleaned.strip()


# ─── Style preset resolution ─────────────────────────────────────────────────


def apply_style_preset(opts: DanmakuOptions) -> DanmakuOptions:
    """
    Apply a style preset to fill in any unset visual / capacity fields.

    Caller-provided explicit values always win over the preset.
    """
    if not opts.style_preset:
        return opts
    preset = STYLE_PRESETS.get(opts.style_preset)
    if not preset:
        return opts
    if opts.font_size == DanmakuOptions().font_size:
        opts.font_size = int(preset.get("font_size", opts.font_size))
    if opts.outline == DanmakuOptions().outline:
        opts.outline = int(preset.get("outline", opts.outline))
    if opts.shadow == DanmakuOptions().shadow:
        opts.shadow = int(preset.get("shadow", opts.shadow))
    if opts.opacity == DanmakuOptions().opacity:
        opts.opacity = float(preset.get("opacity", opts.opacity))
    if opts.comment_duration == DanmakuOptions().comment_duration:
        opts.comment_duration = float(preset.get("comment_duration", opts.comment_duration))
    if opts.max_comments_per_second is None:
        opts.max_comments_per_second = int(preset.get("max_per_second", 0)) or None
    if opts.lane_fraction is None:
        # The DENSITY_PRESETS lane_fraction is the canonical source; we
        # do not duplicate it here.
        pass
    return opts


# ─── ASS file generation ─────────────────────────────────────────────────────

def build_ass_header(opts: DanmakuOptions) -> str:
    """Build the [Script Info] / [V4+ Styles] sections of the ASS file."""
    alpha = max(0, min(255, int(round((1.0 - opts.opacity) * 255))))
    primary = f"&H{alpha:02X}FFFFFF"   # white text
    outline_color = "&H00000000"       # black outline (opaque)
    back = f"&H{max(0, min(255, int(0.6 * 255))):02X}000000"  # semi-transparent black shadow

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
        f"Style: Danmaku,{opts.font_name},{opts.font_size},{primary},{primary},{outline_color},{back},"
        f"1,0,0,0,100,100,0,0,1,{opts.outline},{opts.shadow},7,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def build_dialogue_line(
    comment: NormalizedChatMessage,
    lane: int,
    duration: float,
    clip_start: float,
    play_res_x: int,
    play_res_y: int,
    font_size: int,
    top_margin: Optional[int] = None,
    lane_height: Optional[int] = None,
    horizontal_padding: Optional[int] = None,
) -> Optional[str]:
    """Build a single Dialogue line. Returns None if the comment is invalid."""
    text = escape_ass_text(comment.message)
    if not text:
        return None

    rel_start = comment.time_sec - clip_start
    if rel_start < 0:
        rel_start = 0.0
    rel_end = rel_start + max(0.3, duration)

    y = _lane_y_for(
        lane, play_res_y, font_size,
        top_margin_override=top_margin,
        lane_height_override=lane_height,
    )

    text_width = estimate_text_width(text, font_size)
    pad = horizontal_padding if horizontal_padding is not None else DEFAULT_HORIZONTAL_PADDING
    x_start = play_res_x + pad + text_width  # start fully off-screen right
    x_end = -pad - text_width                # end fully off-screen left

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
    # Apply style preset BEFORE resolving density defaults
    opts = apply_style_preset(opts)

    # Resolve density-specific knobs
    _, density_duration, density_max_per_sec = DENSITY_PRESETS.get(
        opts.density, DENSITY_PRESETS["medium"],
    )
    if opts.comment_duration == DanmakuOptions().comment_duration:
        opts.comment_duration = density_duration
    if opts.max_comments_per_second is None:
        opts.max_comments_per_second = density_max_per_sec

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
    skipped_url = 0
    skipped_emoji_spam = 0
    for msg in in_range:
        if not is_valid_message(msg.message, opts.min_message_length):
            skipped_short += 1
            continue
        if contains_ng_word(msg.message, opts.ng_words):
            skipped_ng += 1
            continue
        if opts.filter_urls and contains_url(msg.message):
            skipped_url += 1
            continue
        if opts.emoji_spam_limit is not None and count_emoji(msg.message) > opts.emoji_spam_limit:
            skipped_emoji_spam += 1
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

    # ── Step 3.5: Per-user repeat suppression (optional) ─────────────────────
    skipped_user_repeat = 0
    if opts.filter_repeated_by_user and deduped:
        deduped.sort(key=lambda m: m.time_sec)
        last_seen: dict[str, tuple[str, float]] = {}
        kept: List[NormalizedChatMessage] = []
        for msg in deduped:
            text = msg.message.strip()
            author = (msg.author or "").strip()
            if author:
                prev = last_seen.get(author)
                if prev and prev[0] == text and (msg.time_sec - prev[1]) < opts.repeated_user_window_sec:
                    skipped_user_repeat += 1
                    continue
                last_seen[author] = (text, msg.time_sec)
            kept.append(msg)
        deduped = kept

    # ── Step 4: Sort by timestamp ────────────────────────────────────────────
    deduped.sort(key=lambda m: m.time_sec)

    # ── Step 4.5: Rate limit (max comments per second) ───────────────────────
    skipped_rate_limit = 0
    if opts.max_comments_per_second is not None and opts.max_comments_per_second > 0:
        cap = opts.max_comments_per_second
        bucket_counts: dict[int, int] = {}
        rate_limited: List[NormalizedChatMessage] = []
        for msg in deduped:
            bucket = int(msg.time_sec - clip_start)
            cur = bucket_counts.get(bucket, 0)
            if cur >= cap:
                skipped_rate_limit += 1
                continue
            bucket_counts[bucket] = cur + 1
            rate_limited.append(msg)
        deduped = rate_limited

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

    # ── Step 6: Assign lanes (with per-comment duration) ────────────────────
    lane_triples = assign_lanes(
        capped,
        clip_start=clip_start,
        clip_end=clip_end,
        play_res_y=opts.play_res_y,
        play_res_x=opts.play_res_x,
        font_size=opts.font_size,
        comment_duration=opts.comment_duration,
        density=opts.density,
        max_lanes=opts.max_lanes,
        lane_height=opts.lane_height,
        top_margin=opts.top_margin,
        long_comment_scale=opts.long_comment_scale,
        emoji_only_scale=opts.emoji_only_scale,
    )

    # ── Step 7: Build ASS via list-append + join (fast) ─────────────────────
    header = build_ass_header(opts)
    lines: List[str] = [header]
    for comment, lane, duration in lane_triples:
        dlg = build_dialogue_line(
            comment=comment,
            lane=lane,
            duration=duration,
            clip_start=clip_start,
            play_res_x=opts.play_res_x,
            play_res_y=opts.play_res_y,
            font_size=opts.font_size,
            top_margin=opts.top_margin,
            lane_height=opts.lane_height,
            horizontal_padding=opts.horizontal_padding,
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
            used_count=len(lane_triples),
            skipped_ng=skipped_ng,
            skipped_too_short=skipped_short,
            skipped_duplicate=skipped_duplicate,
            skipped_safety_limit=skipped_safety,
            skipped_url=skipped_url,
            skipped_emoji_spam=skipped_emoji_spam,
            skipped_user_repeat=skipped_user_repeat,
            skipped_rate_limit=skipped_rate_limit,
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
