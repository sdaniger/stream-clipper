"""
YouTube metadata generator.

Produces title, description, and tags for short / medium / long highlight
clips based on a Candidate and the original VOD title.

The output is intentionally human-editable: short titles with emoji are
heuristic, but the user is expected to tweak them in the Studio.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from stream_clipper_cli.candidate_pipeline import Candidate


# ─── Keyword categorization ─────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    "funny": ["草", "笑", "爆笑", "lol", "lmao", "haha", "腹痛い", "おもろ", "ｗ", "w"],
    "epic": ["神", "天才", "上手い", "上手すぎ", "すごい", "凄すぎ", "やば", "やばい", "ヤバ", "最高", "伝説", "神回"],
    "shock": ["え", "まじ", "マジ", "うそ", "嘘", "びっくり", "驚", "wow", "omg", "wtf", "信じられ"],
    "highlight": ["ハイライト", "名場面", "神回", "きた", "来た", "ｷﾀ", "キタ"],
}


def _categorize(matched: Sequence[str]) -> List[str]:
    """
    Decide the candidate's content category by looking at which keyword
    groups appear most often in `matched` (which contains the actual matched
    substrings, not counts).
    """
    counts = {k: 0 for k in CATEGORY_KEYWORDS}
    joined = " ".join(matched).lower()
    for cat, words in CATEGORY_KEYWORDS.items():
        for w in words:
            if w and w.lower() in joined:
                counts[cat] += 1
    cats = [c for c, n in counts.items() if n > 0]
    return cats or ["highlight"]


def _category_emoji(cat: str) -> str:
    return {
        "funny": "😂",
        "epic": "🔥",
        "shock": "😱",
        "highlight": "✨",
    }.get(cat, "🎬")


def _category_label(cat: str) -> str:
    return {
        "funny": "爆笑シーン",
        "epic": "神プレイ",
        "shock": "衝撃シーン",
        "highlight": "ハイライト",
    }.get(cat, "ハイライト")


# ─── Clock formatting ────────────────────────────────────────────────────────

def _format_clock(seconds: float) -> str:
    s = max(0, int(seconds))
    h = s // 3600
    m = (s % 3600) // 60
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"


# ─── Title generators ────────────────────────────────────────────────────────

SHORT_TITLE_TEMPLATES = [
    "{emoji} {label}【{clock}】",
    "{emoji} {label}ハイライト {clock}",
    "{emoji} {label} / {clock}",
]

MEDIUM_TITLE_TEMPLATES = [
    "{emoji} {label}まとめ【{clock}〜】",
    "{emoji} {label}ハイライト {clock}",
    "{emoji} {label} / {clock}",
]

LONG_TITLE_TEMPLATES = [
    "{emoji} 【{label}】{vod_title} ハイライト",
    "{emoji} {label}ハイライト / {vod_title}",
    "{emoji} {label} {vod_title}",
]


def _first_nonempty(*values: str) -> str:
    for v in values:
        if v:
            return v
    return ""


def _truncate(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    return text[: n - 1] + "…"


# ─── Public API ──────────────────────────────────────────────────────────────

@dataclass
class YouTubeMetadata:
    title: str
    description: str
    tags: List[str]

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "description": self.description,
            "tags": self.tags,
        }


def build_youtube_metadata(
    candidate: Candidate,
    vod_title: Optional[str] = None,
    streamer_name: Optional[str] = None,
    extra_tags: Optional[Iterable[str]] = None,
    language: str = "ja",
) -> YouTubeMetadata:
    """
    Produce a YouTube-style title / description / tags for a single candidate.

    Title is intentionally short (under 100 chars). Description is multi-line
    and includes the clip range, peak time, and matched keywords.
    """
    cats = _categorize(candidate.matched_keywords)
    primary_cat = cats[0]
    emoji = _category_emoji(primary_cat)
    label = _category_label(primary_cat)
    streamer = _first_nonempty(streamer_name or "", "VTuber", "").strip()

    clock_peak = _format_clock(candidate.peak_time)
    clock_range = f"{_format_clock(candidate.clip_start)}–{_format_clock(candidate.clip_end)}"

    if candidate.kind == "short":
        title_templates = SHORT_TITLE_TEMPLATES
        title = _truncate(
            title_templates[0].format(
                emoji=emoji, label=label, clock=clock_peak,
            ), 95
        )
    elif candidate.kind == "medium":
        title_templates = MEDIUM_TITLE_TEMPLATES
        title = _truncate(
            title_templates[0].format(
                emoji=emoji, label=label, clock=clock_range,
            ), 95
        )
    else:  # long
        title_templates = LONG_TITLE_TEMPLATES
        title = _truncate(
            title_templates[0].format(
                emoji=emoji,
                label=label,
                vod_title=(vod_title or "配信アーカイブ").strip(),
            ), 95
        )

    # Description
    desc_lines: List[str] = []
    if vod_title:
        desc_lines.append(f"📺 元配信: {vod_title}")
    if streamer:
        desc_lines.append(f"🎤 配信者: {streamer}")
    desc_lines.append("")
    desc_lines.append(f"⏱ 切り抜き範囲: {clock_range} ({candidate.clip_duration:.0f}秒)")
    if candidate.peak_count > 1:
        desc_lines.append(f"⭐ ピーク: {candidate.peak_count}箇所")
    if candidate.matched_keywords:
        top_kw = ", ".join(sorted(set(candidate.matched_keywords))[:12])
        desc_lines.append(f"💬 盛り上がったコメント: {top_kw}")
    desc_lines.append("")
    desc_lines.append("🔥 この切り抜きは自動生成されたものです。")
    if candidate.kind == "long":
        desc_lines.append("📝 複数の盛り上がりポイントをまとめて1本の動画にしています。")
    desc_lines.append("")
    desc_lines.append("#切り抜き #VTuber #shorts")

    description = "\n".join(desc_lines)

    # Tags
    tags: List[str] = []
    if streamer and streamer != "VTuber":
        tags.append(streamer)
    for c in cats:
        tags.append(_category_label(c))
    tags.extend([
        "切り抜き", "クリップ", "ハイライト", "配信", "アーカイブ",
        "Twitch", "YouTube", "自動生成",
    ])
    if vod_title:
        # add a couple of distinctive words from vod_title as tags
        words = re.findall(r"[\wぁ-んァ-ヶ一-龯]{2,}", vod_title)
        for w in words[:3]:
            if w.lower() not in {t.lower() for t in tags}:
                tags.append(w)
    if candidate.kind == "short":
        tags.extend(["Shorts", "ショート", "縦型"])
    elif candidate.kind == "long":
        tags.extend(["長尺", "まとめ"])
    if extra_tags:
        for t in extra_tags:
            if t and t not in tags:
                tags.append(t)

    # Dedup preserving order
    seen = set()
    deduped: List[str] = []
    for t in tags:
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        deduped.append(t)

    return YouTubeMetadata(
        title=title,
        description=description,
        tags=deduped,
    )
