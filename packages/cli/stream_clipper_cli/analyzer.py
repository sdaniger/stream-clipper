from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from statistics import median
from typing import Dict, List, Optional, Set, Tuple

from stream_clipper_cli.models import ChatEntry, HighlightCandidate, TimelineRow
from stream_clipper_cli.scorer import (
    DEFAULT_KEYWORDS,
    DEFAULT_KEYWORD_WEIGHT,
    compile_keyword_patterns,
    compute_scores,
    count_and_extract_keywords,
)


def load_chat_json(path: Path) -> List[ChatEntry]:
    entries: List[ChatEntry] = []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("Chat JSON must be a list of objects with 'timestamp' field")
    for item in data:
        ts: Optional[float] = item.get("timestamp")
        if ts is None:
            ts = item.get("time")
        if ts is None:
            ts = item.get("createdAt")
        if ts is None:
            ts = 0.0
        try:
            ts = float(ts)
        except (ValueError, TypeError):
            continue
        author: str = str(item.get("author") or item.get("user") or item.get("username") or item.get("name") or "")
        message: str = str(item.get("message") or item.get("text") or item.get("body") or "")
        entries.append(ChatEntry(timestamp=ts, author=author, message=message))
    return entries


def load_chat_csv(path: Path) -> List[ChatEntry]:
    entries: List[ChatEntry] = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ts = float(row.get("timestamp", row.get("time", row.get("start", 0))))
            author = row.get("author", row.get("user", row.get("username", "")))
            message = row.get("message", row.get("text", row.get("body", "")))
            entries.append(ChatEntry(timestamp=ts, author=author, message=message))
    return entries


def load_chat(path: Path) -> List[ChatEntry]:
    ext = path.suffix.lower()
    if ext == ".json":
        return load_chat_json(path)
    elif ext == ".csv":
        return load_chat_csv(path)
    else:
        raise ValueError(f"Unsupported chat file format: {ext} (use .json or .csv)")


def bucket_messages(
    entries: List[ChatEntry],
    window_seconds: int = 30,
) -> Dict[int, List[ChatEntry]]:
    buckets: Dict[int, List[ChatEntry]] = {}
    for entry in entries:
        bucket_id = int(entry.timestamp // window_seconds)
        if bucket_id not in buckets:
            buckets[bucket_id] = []
        buckets[bucket_id].append(entry)
    return buckets


def analyze_highlights(
    chat_entries: List[ChatEntry],
    top_n: int = 5,
    keywords: Optional[List[str]] = None,
    keyword_weight: float = DEFAULT_KEYWORD_WEIGHT,
    min_gap: float = 30.0,
    window_seconds: int = 30,
    clip_duration: float = 30.0,
    clip_padding: float = 5.0,
) -> Tuple[List[HighlightCandidate], List[TimelineRow]]:
    if keywords is None:
        keywords = DEFAULT_KEYWORDS
    pattern = compile_keyword_patterns(keywords)

    buckets = bucket_messages(chat_entries, window_seconds)

    chat_counts: Dict[int, int] = {}
    keyword_hits_dict: Dict[int, int] = {}
    matched_keywords_dict: Dict[int, List[str]] = {}

    for bucket_id, entries in buckets.items():
        count = len(entries)
        chat_counts[bucket_id] = count
        total_hits = 0
        all_matched: List[str] = []
        for entry in entries:
            hits, matched = count_and_extract_keywords(entry.message, pattern, keywords)
            total_hits += hits
            all_matched.extend(matched)
        keyword_hits_dict[bucket_id] = total_hits
        matched_keywords_dict[bucket_id] = list(set(all_matched))

    scores = compute_scores(chat_counts, keyword_hits_dict, keyword_weight)

    if not scores:
        return [], []

    score_values = list(scores.values())
    threshold = max(
        _compute_percentile(score_values, 85),
        4.0,
    )
    if threshold < 1:
        threshold = max(score_values) * 0.4 if score_values else 4.0

    sorted_buckets = sorted(scores.keys())
    highlight_buckets: List[int] = []
    for bucket_id in sorted_buckets:
        if scores[bucket_id] >= threshold:
            highlight_buckets.append(bucket_id)

    clusters: List[List[int]] = []
    current_cluster: List[int] = []
    for bucket_id in highlight_buckets:
        if not current_cluster:
            current_cluster = [bucket_id]
        elif bucket_id - current_cluster[-1] <= 2:
            current_cluster.append(bucket_id)
        else:
            clusters.append(current_cluster)
            current_cluster = [bucket_id]
    if current_cluster:
        clusters.append(current_cluster)

    candidates_raw: List[dict] = []
    for cluster in clusters:
        peak_bucket = max(cluster, key=lambda b: scores[b])
        peak_time = (peak_bucket * window_seconds) + (window_seconds / 2)
        cluster_start = cluster[0] * window_seconds
        cluster_end = (cluster[-1] + 1) * window_seconds
        total_chat = sum(chat_counts.get(b, 0) for b in cluster)
        total_hits = sum(keyword_hits_dict.get(b, 0) for b in cluster)
        all_matched: List[str] = []
        for b in cluster:
            all_matched.extend(matched_keywords_dict.get(b, []))
        all_matched = list(set(all_matched))
        total_score = sum(scores.get(b, 0) for b in cluster)

        candidates_raw.append({
            "start": cluster_start,
            "end": cluster_end,
            "peak_time": peak_time,
            "score": total_score,
            "chat_count": total_chat,
            "keyword_hits": total_hits,
            "matched_keywords": all_matched,
        })

    candidates_raw.sort(key=lambda c: c["score"], reverse=True)

    deduped: List[dict] = []
    for c in candidates_raw:
        too_close = False
        peak = c["peak_time"]
        for existing in deduped:
            if abs(peak - existing["peak_time"]) < min_gap:
                too_close = True
                break
        if not too_close:
            deduped.append(c)

    top_candidates = deduped[:top_n]
    top_candidates.sort(key=lambda c: c["start"])

    timeline_rows: List[TimelineRow] = []
    for bucket_id in sorted_buckets:
        row = TimelineRow(
            start=bucket_id * window_seconds,
            end=(bucket_id + 1) * window_seconds,
            score=scores.get(bucket_id, 0),
            chat_count=chat_counts.get(bucket_id, 0),
            keyword_hits=keyword_hits_dict.get(bucket_id, 0),
            matched_keywords=matched_keywords_dict.get(bucket_id, []),
        )
        timeline_rows.append(row)

    highlights: List[HighlightCandidate] = []
    for rank, c in enumerate(top_candidates, 1):
        clip_start = max(0, c["start"] - clip_padding)
        clip_dur = min(clip_duration, c["end"] - c["start"] + 2 * clip_padding)
        highlights.append(HighlightCandidate(
            rank=rank,
            start=c["start"],
            end=c["end"],
            peak_time=c["peak_time"],
            score=c["score"],
            chat_count=c["chat_count"],
            keyword_hits=c["keyword_hits"],
            matched_keywords=c["matched_keywords"],
            clip_start=clip_start,
            clip_duration=clip_dur,
        ))

    return highlights, timeline_rows


def _compute_percentile(values: List[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = max(0, min(len(sorted_vals) - 1, int(len(sorted_vals) * percentile / 100)))
    return sorted_vals[idx]
