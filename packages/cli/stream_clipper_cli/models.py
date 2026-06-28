from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List, Optional


@dataclass
class ChatEntry:
    """A single chat message with timestamp."""
    timestamp: float
    author: str
    message: str


@dataclass
class HighlightCandidate:
    """A detected highlight window."""
    rank: int
    start: float
    end: float
    peak_time: float
    score: float
    chat_count: int
    keyword_hits: int
    matched_keywords: List[str]
    clip_start: float
    clip_duration: float
    output_file: Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    def to_json_line(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


@dataclass
class TimelineRow:
    """A single time-bucket row for CSV output."""
    start: float
    end: float
    score: float
    chat_count: int
    keyword_hits: int
    matched_keywords: List[str]

    def to_csv_row(self) -> List[str]:
        return [
            f"{self.start:.1f}",
            f"{self.end:.1f}",
            f"{self.score:.1f}",
            str(self.chat_count),
            str(self.keyword_hits),
            ",".join(self.matched_keywords),
        ]

    @staticmethod
    def csv_header() -> List[str]:
        return ["start", "end", "score", "chat_count", "keyword_hits", "matched_keywords"]
