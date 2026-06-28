from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import List, Optional

from stream_clipper_cli.models import HighlightCandidate, TimelineRow


def write_json(highlights: List[HighlightCandidate], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = [h.to_dict() for h in highlights]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def write_csv(timeline: List[TimelineRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        if timeline:
            writer.writerow(TimelineRow.csv_header())
            for row in timeline:
                writer.writerow(row.to_csv_row())
        else:
            writer.writerow(TimelineRow.csv_header())


def print_summary(highlights: List[HighlightCandidate]) -> None:
    print(f"\nFound {len(highlights)} highlight(s):\n")
    for h in highlights:
        kw_str = ", ".join(h.matched_keywords[:5])
        if len(h.matched_keywords) > 5:
            kw_str += f" ... (+{len(h.matched_keywords) - 5} more)"
        print(f"  #{h.rank}  {_fmt_time(h.start)} - {_fmt_time(h.end)}  "
              f"score={h.score:.1f}  chat={h.chat_count}  "
              f"kw_hits={h.keyword_hits}  [{kw_str}]")
        if h.output_file:
            print(f"       → {h.output_file}")
    print()


def _fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"
