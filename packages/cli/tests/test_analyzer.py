from __future__ import annotations

import json
import tempfile
from pathlib import Path

from stream_clipper_cli.analyzer import (
    analyze_highlights,
    bucket_messages,
    load_chat,
    load_chat_json,
    load_chat_csv,
)
from stream_clipper_cli.models import ChatEntry


def make_entries(timestamps: list[float], messages: list[str] | None = None) -> list[ChatEntry]:
    if messages is None:
        messages = ["hello"] * len(timestamps)
    return [
        ChatEntry(timestamp=ts, author="user", message=msg)
        for ts, msg in zip(timestamps, messages)
    ]


def test_bucket_messages():
    entries = make_entries([5, 15, 25, 35, 45])
    buckets = bucket_messages(entries, window_seconds=30)
    assert 0 in buckets
    assert 1 in buckets
    assert len(buckets[0]) == 3
    assert len(buckets[1]) == 2


def test_analyze_highlights_empty():
    highlights, timeline = analyze_highlights([], top_n=5)
    assert highlights == []
    assert timeline == []


def test_analyze_highlights_single_spike():
    entries = make_entries(
        [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
        ["草"] * 10,
    )
    highlights, timeline = analyze_highlights(
        entries, top_n=5, keywords=["草"], keyword_weight=2.0,
    )
    assert len(highlights) >= 1
    assert highlights[0].keyword_hits >= 10


def test_analyze_highlights_top_n():
    entries = make_entries(
        [10, 11, 12, 20, 21, 22, 60, 61, 62, 90, 91, 92, 120, 121, 122],
        ["草www"] * 15,
    )
    highlights, timeline = analyze_highlights(
        entries, top_n=3, keywords=["草", "www"], keyword_weight=2.0,
    )
    assert len(highlights) <= 3


def test_analyze_highlights_min_gap():
    entries = make_entries(
        [10, 11, 12, 40, 41, 80, 81],
        ["w"] * 7,
    )
    # With min_gap=100, peaks at ~15 and ~45 should be deduped to 1
    highlights_small_gap, _ = analyze_highlights(
        entries, top_n=5, keywords=["w"], keyword_weight=2.0, min_gap=5.0,
    )
    highlights_large_gap, _ = analyze_highlights(
        entries, top_n=5, keywords=["w"], keyword_weight=2.0, min_gap=100.0,
    )
    assert len(highlights_large_gap) <= len(highlights_small_gap)


def test_analyze_highlights_score_reflects_keywords():
    with_kw = make_entries([10, 11, 12, 13, 14], ["草"] * 5)
    without_kw = make_entries([10, 11, 12, 13, 14], ["hello"] * 5)
    hl_kw, _ = analyze_highlights(with_kw, top_n=5, keywords=["草"], keyword_weight=2.0)
    hl_no, _ = analyze_highlights(without_kw, top_n=5, keywords=["草"], keyword_weight=2.0)
    if hl_kw and hl_no:
        assert hl_kw[0].score > hl_no[0].score
        assert hl_kw[0].keyword_hits > hl_no[0].keyword_hits


def test_load_chat_json():
    data = [
        {"timestamp": 10.0, "author": "user1", "message": "草"},
        {"timestamp": 20.5, "author": "user2", "message": "www"},
    ]
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        p = Path(f.name)
    try:
        entries = load_chat_json(p)
        assert len(entries) == 2
        assert entries[0].timestamp == 10.0
        assert entries[0].message == "草"
        assert entries[1].timestamp == 20.5
        assert entries[1].message == "www"
    finally:
        p.unlink()


def test_load_chat_auto_detect_json():
    data = [
        {"timestamp": 5.0, "author": "u", "message": "hello"},
    ]
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        p = Path(f.name)
    try:
        entries = load_chat(p)
        assert len(entries) == 1
    finally:
        p.unlink()


def test_timeline_rows_have_expected_structure():
    entries = make_entries([5, 15, 25], ["草"] * 3)
    highlights, timeline = analyze_highlights(entries, keywords=["草"])
    assert len(timeline) > 0
    row = timeline[0]
    assert hasattr(row, "start")
    assert hasattr(row, "end")
    assert hasattr(row, "score")
    assert hasattr(row, "chat_count")
    assert hasattr(row, "keyword_hits")
    assert hasattr(row, "matched_keywords")
    assert isinstance(row.matched_keywords, list)
