from __future__ import annotations

import csv
import json
import tempfile
from pathlib import Path

from stream_clipper_cli.exporter import write_json, write_csv, print_summary
from stream_clipper_cli.models import HighlightCandidate, TimelineRow


def make_highlights() -> list[HighlightCandidate]:
    return [
        HighlightCandidate(
            rank=1,
            start=120.0,
            end=150.0,
            peak_time=135.0,
            score=82.5,
            chat_count=45,
            keyword_hits=21,
            matched_keywords=["草", "www"],
            clip_start=125.0,
            clip_duration=15.0,
            output_file="output/clip_001.mp4",
        ),
        HighlightCandidate(
            rank=2,
            start=300.0,
            end=330.0,
            peak_time=315.0,
            score=55.0,
            chat_count=30,
            keyword_hits=10,
            matched_keywords=["lol"],
            clip_start=305.0,
            clip_duration=15.0,
        ),
    ]


def make_timeline() -> list[TimelineRow]:
    return [
        TimelineRow(start=0, end=30, score=5.2, chat_count=3, keyword_hits=0, matched_keywords=[]),
        TimelineRow(start=120, end=150, score=82.5, chat_count=45, keyword_hits=21, matched_keywords=["草", "www"]),
    ]


def test_write_json(tmp_path: Path):
    highlights = make_highlights()
    out = tmp_path / "highlights.json"
    write_json(highlights, out)
    assert out.exists()
    with open(out, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert len(data) == 2
    assert data[0]["rank"] == 1
    assert data[0]["matched_keywords"] == ["草", "www"]
    assert data[0]["score"] == 82.5


def test_write_csv(tmp_path: Path):
    timeline = make_timeline()
    out = tmp_path / "timeline.csv"
    write_csv(timeline, out)
    assert out.exists()
    with open(out, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    assert len(rows) == 2
    assert rows[1]["chat_count"] == "45"
    assert rows[1]["matched_keywords"] == "草,www"


def test_write_csv_empty(tmp_path: Path):
    out = tmp_path / "empty.csv"
    write_csv([], out)
    assert out.exists()
    with open(out, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    assert rows == []


def test_write_json_empty(tmp_path: Path):
    out = tmp_path / "empty.json"
    write_json([], out)
    assert out.exists()
    with open(out, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data == []


def test_print_summary_does_not_crash(capsys):
    highlights = make_highlights()
    print_summary(highlights)
    captured = capsys.readouterr()
    assert "Found 2 highlight(s)" in captured.out
    assert "clip_001.mp4" in captured.out
    assert "草, www" in captured.out or "草, www" in captured.out
