from __future__ import annotations

import re
import tempfile
from pathlib import Path

from stream_clipper_cli.scorer import (
    DEFAULT_KEYWORDS,
    compile_keyword_patterns,
    count_keyword_hits,
    extract_matched_keywords,
    compute_scores,
)


def test_default_keywords_include_japanese():
    assert "草" in DEFAULT_KEYWORDS
    assert "www" in DEFAULT_KEYWORDS
    assert "爆笑" in DEFAULT_KEYWORDS
    assert "lol" in DEFAULT_KEYWORDS


def test_count_keyword_hits_basic():
    pattern = compile_keyword_patterns(["草", "www", "lol"])
    assert count_keyword_hits("草草草", pattern) == 3
    assert count_keyword_hits("www", pattern) == 1
    assert count_keyword_hits("lol", pattern) == 1
    assert count_keyword_hits("hello world", pattern) == 0


def test_count_keyword_hits_multiple():
    pattern = compile_keyword_patterns(["草", "www", "lol"])
    assert count_keyword_hits("草 www lol", pattern) == 3
    assert count_keyword_hits("草草 www", pattern) == 3


def test_count_keyword_hits_case_insensitive():
    pattern = compile_keyword_patterns(["lol", "haha"])
    assert count_keyword_hits("LOL", pattern) == 1
    assert count_keyword_hits("HaHa", pattern) == 1
    assert count_keyword_hits("LOLLOL", pattern) == 2


def test_count_keyword_hits_empty():
    pattern = compile_keyword_patterns(["草"])
    assert count_keyword_hits("", pattern) == 0
    assert count_keyword_hits(None, pattern) == 0  # type: ignore[arg-type]


def test_extract_matched_keywords():
    found = extract_matched_keywords("草www爆笑", ["草", "www", "爆笑", "lol"])
    assert sorted(found) == sorted(["草", "www", "爆笑"])


def test_extract_matched_keywords_case_insensitive():
    found = extract_matched_keywords("LOL LOL", ["lol"])
    assert found == ["lol"]


def test_extract_matched_keywords_empty():
    assert extract_matched_keywords("", ["草"]) == []
    assert extract_matched_keywords("hello", ["草"]) == []


def test_compute_scores():
    chat_counts = {0: 10, 1: 5}
    keyword_hits = {0: 3, 1: 1}
    scores = compute_scores(chat_counts, keyword_hits, keyword_weight=2.0)
    assert scores[0] == 10 + 3 * 2.0  # 16
    assert scores[1] == 5 + 1 * 2.0   # 7


def test_compute_scores_default_weight():
    chat_counts = {0: 10}
    keyword_hits = {0: 3}
    scores = compute_scores(chat_counts, keyword_hits)
    assert scores[0] == 10 + 3 * 2.0  # default weight 2.0


def test_compute_scores_missing_buckets():
    chat_counts = {0: 10}
    keyword_hits = {1: 3}
    scores = compute_scores(chat_counts, keyword_hits)
    assert scores[0] == 10
    assert scores[1] == 3 * 2.0


def test_compile_keyword_patterns_empty():
    pattern = compile_keyword_patterns([])
    # Should match nothing
    assert pattern.search("anything") is None


def test_compile_keyword_patterns_special_chars():
    pattern = compile_keyword_patterns(["w", "W"])
    assert pattern.search("w") is not None
    assert pattern.search("W") is not None
