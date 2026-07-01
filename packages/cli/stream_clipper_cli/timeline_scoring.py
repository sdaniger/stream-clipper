"""
Timeline scoring for the Stream Clipper auto-clip pipeline.

Produces a list of "windows" (one per `step` seconds, sliding by `step`
across a `window` span) annotated with multiple sub-scores that downstream
candidate generators consume:

  - chat_count:        raw message count in the window
  - unique_author_count: distinct authors in the window
  - keyword_hits:      count of reaction/keyword occurrences
  - burst_score:       log-scaled local burst vs. surrounding windows
  - laugh_score:       weighted count of "laugh" keywords
  - surprise_score:    weighted count of "surprise" keywords
  - clip_worthy_score: weighted count of "clip-worthy" keywords
  - reaction_score:    weighted count of "reaction" keywords
  - total_score:       weighted combination used for ranking

The module is shared between the Python core (apps/api, packages/cli) and is
the single source of truth for window-level signals.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Sequence, Set, Tuple


# ─── Keyword groups ──────────────────────────────────────────────────────────
# Each group is matched as a regex. Weights are applied in score_window().

LAUGH_KEYWORDS: List[str] = [
    "草", "ｗ", "www", "笑", "爆笑", "腹痛い", "おもろ", "lol", "lmao",
    "haha", "hh", "kusa", "笑う", "笑える", "草生える", "ワロタ", "wktk",
    "しぬ", "死ぬ", "腹筋", "草すぎ", "おもろすぎ", "ワロ", "草ァ",
]

SURPRISE_KEYWORDS: List[str] = [
    "え", "まじ", "マジ", "うそ", "嘘", "うそでしょ", "えっ", "え！？",
    "やば", "ヤバ", "やばい", "ヤバい", "びっくり", "驚",
    "wow", "woah", "omg", "OMG", "wtf", "WTF", "no way", "信じられ",
    "は？", "えぐ", "エグ", "まって", "待って", "こわ", "怖", "なんで",
]

CLIP_WORTHY_KEYWORDS: List[str] = [
    "神", "最高", "天才", "上手い", "上手すぎ", "すご", "すごい", "凄すぎ",
    "やばすぎ", "やばい", "ヤバい", "きた", "来た", "ｷﾀ", "キタ",
    "伝説", "神回", "ハイライト", "名場面",
    "神展開", "撮れ高", "切り抜き", "ここ切り抜き", "ここ好き",
    "事故", "放送事故", "かわいい", "可愛い", "尊い", "助かる", "鳥肌", "8888",
]

REACTION_KEYWORDS: List[str] = [
    "草", "ｗ", "www", "笑", "爆笑",
    "え", "まじ", "マジ", "うそ", "嘘",
    "lol", "lmao", "haha", "w", "ｗ",
    "神", "最高", "天才", "上手い", "すご",
    "きた", "来た", "ｷﾀ", "キタ",
    "やばい", "やば", "ヤバ",
    "しぬ", "死ぬ", "腹筋", "えぐ", "エグ", "待って", "神展開", "撮れ高",
    "切り抜き", "ここ好き", "事故", "放送事故", "かわいい", "可愛い", "尊い", "助かる",
]

ALL_KEYWORD_GROUPS: Dict[str, List[str]] = {
    "laugh": LAUGH_KEYWORDS,
    "surprise": SURPRISE_KEYWORDS,
    "clip_worthy": CLIP_WORTHY_KEYWORDS,
    "reaction": REACTION_KEYWORDS,
}


# ─── Data classes ────────────────────────────────────────────────────────────

@dataclass
class ChatMessage:
    """A single chat message. Compatible with stream_clipper_cli.ChatEntry."""
    timestamp: float  # VOD-relative seconds
    author: str
    message: str


@dataclass
class TimelineWindow:
    """A single time-window bucket with all sub-scores."""
    start: float
    end: float
    center: float
    chat_count: int = 0
    unique_author_count: int = 0
    keyword_hits: int = 0
    laugh_score: float = 0.0
    surprise_score: float = 0.0
    clip_worthy_score: float = 0.0
    reaction_score: float = 0.0
    burst_score: float = 0.0
    burst_ratio: float = 1.0
    author_diversity_score: float = 0.0
    reaction_density_score: float = 0.0
    total_score: float = 0.0
    normalized_score: float = 0.0
    dominant_signal: str = "general"
    representative_comments: List[dict] = field(default_factory=list)
    matched_keywords: List[str] = field(default_factory=list)
    matched_laughs: List[str] = field(default_factory=list)
    matched_surprises: List[str] = field(default_factory=list)
    matched_clip_worthy: List[str] = field(default_factory=list)
    matched_reactions: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["score"] = d["total_score"]
        return d


# ─── Scoring weights ─────────────────────────────────────────────────────────

DEFAULT_WEIGHTS: Dict[str, float] = {
    "chat": 1.0,
    "unique_author": 0.5,
    "keyword": 2.0,
    "laugh": 1.2,
    "surprise": 1.5,
    "clip_worthy": 1.8,
    "reaction": 1.3,
    "burst": 1.5,
    "author_diversity": 2.0,
    "reaction_density": 1.7,
}


# ─── Keyword matching helpers ────────────────────────────────────────────────

def _compile_group(keywords: Sequence[str]) -> Tuple[str, ...]:
    """Lowercase the keywords; the scorer matches against lowercased messages."""
    return tuple(k.lower() for k in keywords if k.strip())


def _count_group_hits(message: str, lowered_group: Sequence[str]) -> Tuple[int, List[str]]:
    if not message or not lowered_group:
        return 0, []
    msg = message.lower()
    hits = 0
    matched: List[str] = []
    for kw in lowered_group:
        if not kw:
            continue
        occ = msg.count(kw)
        if occ:
            hits += occ
            matched.append(kw)
    return hits, matched


def _message_signal_score(message: str, groups: Dict[str, Sequence[str]]) -> float:
    laugh, _ = _count_group_hits(message, groups["laugh"])
    surprise, _ = _count_group_hits(message, groups["surprise"])
    clip, _ = _count_group_hits(message, groups["clip_worthy"])
    reaction, _ = _count_group_hits(message, groups["reaction"])
    return laugh * 1.2 + surprise * 1.5 + clip * 1.8 + reaction * 0.8


def _representative_comments(msgs: Sequence[ChatMessage], groups: Dict[str, Sequence[str]], limit: int = 4) -> List[dict]:
    scored = sorted(
        ((m, _message_signal_score(m.message, groups)) for m in msgs),
        key=lambda item: (-item[1], item[0].timestamp),
    )
    out: List[dict] = []
    seen: Set[str] = set()
    for m, score in scored:
        text = " ".join(m.message.strip().split())
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append({
            "time_sec": round(float(m.timestamp), 3),
            "author": m.author,
            "message": text,
            "signal_score": round(float(score), 3),
        })
        if len(out) >= limit:
            break
    return out


def _dominant_signal(laugh: float, surprise: float, clip_worthy: float, reaction: float, burst: float) -> str:
    scores = {
        "laugh": laugh,
        "surprise": surprise,
        "clip_worthy": clip_worthy,
        "reaction": reaction,
        "burst": burst,
    }
    return max(scores, key=scores.get) if any(v > 0 for v in scores.values()) else "general"


# ─── Core scoring ────────────────────────────────────────────────────────────

def _burst_score_local(chat_count: int, neighbors: Sequence[int]) -> float:
    """
    Log-scaled local burst: returns log1p(chat_count) * (1 + max(0, ratio_vs_neighbors)).
    `neighbors` is a list of chat counts in surrounding windows.
    """
    if chat_count <= 0:
        return 0.0
    base = math.log1p(chat_count)
    if not neighbors:
        return base
    avg = sum(neighbors) / max(1, len(neighbors))
    if avg <= 0:
        return base
    ratio = chat_count / avg
    return base * (1.0 + max(0.0, ratio - 1.0))


def build_timeline(
    messages: Sequence[ChatMessage],
    window: int = 30,
    step: int = 10,
    weights: Optional[Dict[str, float]] = None,
    custom_keywords: Optional[Sequence[str]] = None,
) -> List[TimelineWindow]:
    """
    Build a sliding-window timeline from a list of chat messages.

    The first window starts at t=0 and slides by `step` seconds; each window
    spans `window` seconds. We always start at t=0 to keep clip ranges stable.

    Sub-scores are computed per window. burst_score uses a neighbor window
    of +/- 1 step on either side.
    """
    if window <= 0 or step <= 0:
        raise ValueError("window and step must be > 0")

    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)
    custom_kw = list(custom_keywords or [])

    # Pre-lowercase keyword groups. Custom keywords are added only to the
    # catch-all "reaction" group so a single custom keyword cannot inflate
    # all four sub-scores (previously they were appended to every group).
    groups = {
        "laugh": _compile_group(LAUGH_KEYWORDS),
        "surprise": _compile_group(SURPRISE_KEYWORDS),
        "clip_worthy": _compile_group(CLIP_WORTHY_KEYWORDS),
        "reaction": _compile_group(REACTION_KEYWORDS + custom_kw),
    }

    # Group messages by their starting window index (each message goes into
    # every window whose [start, end) range it falls in).
    # Since windows slide by `step` and span `window`, a message can be in
    # multiple windows. We compute, for each step index i, the window
    # [i*step, i*step + window) (clipped at the final partial window).
    by_window: Dict[int, List[ChatMessage]] = {}
    max_t = 0.0
    for m in messages:
        ts = float(m.timestamp)
        if ts < 0:
            continue
        max_t = max(max_t, ts)
        # Window starts: i*step where i*step <= ts < i*step + window
        # i_min = floor((ts - window) / step) + 1   (smallest i with i*step + window > ts)
        # i_max = floor(ts / step)                   (largest i with i*step <= ts)
        if ts < window:
            i_min = 0
        else:
            i_min = int(math.floor((ts - window) / step)) + 1
        i_max = int(ts / step)
        for i in range(max(0, i_min), i_max + 1):
            by_window.setdefault(i, []).append(m)

    if max_t <= 0:
        return []

    max_index = int(max_t / step) + 1
    raw_windows: List[TimelineWindow] = []
    for i in range(max_index + 1):
        start = i * step
        end = start + window
        msgs = by_window.get(i, [])
        authors: Set[str] = set()
        laugh_h = 0; laugh_m: List[str] = []
        surprise_h = 0; surprise_m: List[str] = []
        clip_worthy_h = 0; clip_worthy_m: List[str] = []
        reaction_h = 0; reaction_m: List[str] = []
        kw_hits_total = 0
        for m in msgs:
            if m.author:
                authors.add(m.author)
            l_h, l_m = _count_group_hits(m.message, groups["laugh"])
            laugh_h += l_h
            laugh_m.extend(l_m)
            s_h, s_m = _count_group_hits(m.message, groups["surprise"])
            surprise_h += s_h
            surprise_m.extend(s_m)
            c_h, c_m = _count_group_hits(m.message, groups["clip_worthy"])
            clip_worthy_h += c_h
            clip_worthy_m.extend(c_m)
            r_h, r_m = _count_group_hits(m.message, groups["reaction"])
            reaction_h += r_h
            reaction_m.extend(r_m)
            kw_hits_total += l_h + s_h + c_h + r_h

        raw_windows.append(TimelineWindow(
            start=start,
            end=end,
            center=start + window / 2.0,
            chat_count=len(msgs),
            unique_author_count=len(authors),
            keyword_hits=kw_hits_total,
            laugh_score=float(laugh_h),
            surprise_score=float(surprise_h),
            clip_worthy_score=float(clip_worthy_h),
            reaction_score=float(reaction_h),
            matched_laughs=sorted(set(laugh_m)),
            matched_surprises=sorted(set(surprise_m)),
            matched_clip_worthy=sorted(set(clip_worthy_m)),
            matched_reactions=sorted(set(reaction_m)),
        ))

    counts = [w.chat_count for w in raw_windows]
    positive_counts = sorted(c for c in counts if c > 0)
    median_chat = positive_counts[len(positive_counts) // 2] if positive_counts else 0

    # burst_score: log1p(chat) * (1 + max(0, chat/avg(neighbors) - 1))
    for i, win in enumerate(raw_windows):
        neighbor_idxs = [j for j in range(max(0, i - 6), min(len(raw_windows), i + 7)) if j != i]
        neighbors = [raw_windows[j].chat_count for j in neighbor_idxs]
        win.burst_score = round(_burst_score_local(win.chat_count, neighbors), 3)
        neighbor_avg = sum(neighbors) / max(1, len(neighbors)) if neighbors else float(median_chat or 1)
        win.burst_ratio = round(win.chat_count / max(1.0, neighbor_avg), 3)
        win.author_diversity_score = round(win.unique_author_count / max(1.0, win.chat_count), 3)
        win.reaction_density_score = round(win.keyword_hits / max(1.0, win.chat_count), 3)
        win.dominant_signal = _dominant_signal(
            win.laugh_score, win.surprise_score, win.clip_worthy_score,
            win.reaction_score, win.burst_score,
        )
        win.representative_comments = _representative_comments(by_window.get(i, []), groups)

    # total_score: weighted combination
    for win in raw_windows:
        total = (
            win.chat_count * w["chat"]
            + win.unique_author_count * w["unique_author"]
            + win.keyword_hits * w["keyword"]
            + win.laugh_score * w["laugh"]
            + win.surprise_score * w["surprise"]
            + win.clip_worthy_score * w["clip_worthy"]
            + win.reaction_score * w["reaction"]
            + win.burst_score * w["burst"]
            + win.author_diversity_score * w["author_diversity"]
            + win.reaction_density_score * w["reaction_density"]
        )
        if median_chat > 0:
            total *= 1.0 + min(1.25, max(0.0, (win.chat_count - median_chat) / max(1.0, median_chat)) * 0.25)
        win.total_score = round(total, 3)

    max_score = max((w.total_score for w in raw_windows), default=0.0)
    for win in raw_windows:
        win.normalized_score = round(win.total_score / max_score, 3) if max_score > 0 else 0.0

    # Filter zero-chat windows but keep the surrounding context for burst.
    # The candidate generators operate on this timeline directly.
    return raw_windows


# ─── Convenience: alias for ChatEntry-like inputs ────────────────────────────

def build_timeline_from_dicts(
    raw: Sequence[dict],
    window: int = 30,
    step: int = 10,
    weights: Optional[Dict[str, float]] = None,
    custom_keywords: Optional[Sequence[str]] = None,
) -> List[TimelineWindow]:
    """
    Build a timeline from a sequence of dicts with at least
    `timestamp`/`time` and `message`/`text` fields.
    """
    msgs: List[ChatMessage] = []
    for entry in raw:
        ts = entry.get("timestamp")
        if ts is None:
            ts = entry.get("time") or entry.get("time_sec") or entry.get("timestamp_seconds")
        try:
            ts = float(ts)
        except (TypeError, ValueError):
            continue
        if ts < 0:
            continue
        author = str(entry.get("author") or entry.get("user") or entry.get("username") or entry.get("author_name") or "")
        message = str(entry.get("message") or entry.get("text") or entry.get("body") or "")
        msgs.append(ChatMessage(timestamp=ts, author=author, message=message))
    return build_timeline(msgs, window=window, step=step, weights=weights, custom_keywords=custom_keywords)
