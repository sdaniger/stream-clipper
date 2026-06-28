from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

DEFAULT_KEYWORDS: List[str] = [
    "草", "ｗ", "www", "笑", "爆笑", "腹痛い", "おもろ", "やばい",
    "lol", "lmao", "haha", "omg", "w",
]

DEFAULT_KEYWORD_WEIGHT: float = 2.0


def compile_keyword_patterns(keywords: List[str]) -> re.Pattern:
    escaped = [re.escape(kw) for kw in keywords if kw.strip()]
    if not escaped:
        pattern = r"(?!)"
    else:
        pattern = "|".join(escaped)
    return re.compile(pattern, re.IGNORECASE)


def count_keyword_hits(message: str, pattern: re.Pattern) -> int:
    if not message or not pattern:
        return 0
    return len(pattern.findall(message))


def extract_matched_keywords(message: str, keywords: List[str]) -> List[str]:
    if not message:
        return []
    lower_msg = message.lower()
    found: List[str] = []
    for kw in keywords:
        if kw.lower() in lower_msg:
            found.append(kw)
    return found


def count_and_extract_keywords(
    message: str, pattern: re.Pattern, keywords: List[str]
) -> Tuple[int, List[str]]:
    """Single-pass keyword counting and extraction (avoids O(2n) overhead)."""
    if not message:
        return 0, []
    hits = 0
    matched_set: Set[str] = set()
    for m in pattern.finditer(message):
        hits += 1
        matched_set.add(m.group())
    # If pattern matched, we still need original keywords for display names
    if not matched_set:
        return 0, []
    lower_msg = message.lower()
    found = [kw for kw in keywords if kw.lower() in lower_msg]
    return hits, found


def compute_scores(
    chat_counts: Dict[int, int],
    keyword_hits_dict: Dict[int, int],
    keyword_weight: float = DEFAULT_KEYWORD_WEIGHT,
) -> Dict[int, float]:
    scores: Dict[int, float] = {}
    all_buckets = set(chat_counts.keys()) | set(keyword_hits_dict.keys())
    for bucket in all_buckets:
        count = chat_counts.get(bucket, 0)
        hits = keyword_hits_dict.get(bucket, 0)
        scores[bucket] = count + hits * keyword_weight
    return scores
