from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Optional, Tuple

# Add the CLI package to sys.path so we can reuse its modules
_cli_path = Path(__file__).resolve().parents[4] / "packages" / "cli"
if str(_cli_path) not in sys.path:
    sys.path.insert(0, str(_cli_path))

from stream_clipper_cli.analyzer import analyze_highlights as _analyze, load_chat, bucket_messages
from stream_clipper_cli.models import ChatEntry, HighlightCandidate, TimelineRow
from stream_clipper_cli.scorer import (
    DEFAULT_KEYWORDS,
    compile_keyword_patterns,
    count_keyword_hits,
    extract_matched_keywords,
    compute_scores,
)
from stream_clipper_cli.video import generate_clip as _generate_clip


def analyze(
    video_path: str,
    log_path: str,
    window: int = 30,
    top: int = 5,
    min_gap: float = 30.0,
    keywords: Optional[str] = None,
    keyword_weight: float = 2.0,
    clip_duration: float = 30.0,
    clip_padding: float = 5.0,
) -> Tuple[List[dict], List[dict], dict]:
    log_file = Path(log_path)
    if not log_file.exists():
        raise FileNotFoundError(f"Chat log not found: {log_path}")

    video_file = Path(video_path)
    video_exists = video_file.exists()

    kw_list = [k.strip() for k in keywords.split(",") if k.strip()] if keywords else DEFAULT_KEYWORDS

    chat_entries = load_chat(log_file)
    if not chat_entries:
        raise ValueError("Chat log is empty")

    highlights_raw, timeline = _analyze(
        chat_entries,
        top_n=top,
        keywords=kw_list,
        keyword_weight=keyword_weight,
        min_gap=min_gap,
        window_seconds=window,
        clip_duration=clip_duration,
        clip_padding=clip_padding,
    )

    highlight_dicts = [_candidate_to_dict(h) for h in highlights_raw]
    timeline_dicts = [_timeline_to_dict(r) for r in timeline]

    metadata = {
        "video_path": str(video_file.resolve()) if video_exists else "",
        "video_exists": video_exists,
        "log_path": str(log_file.resolve()),
        "chat_count": len(chat_entries),
        "window": window,
        "top": top,
        "min_gap": min_gap,
        "keyword_weight": keyword_weight,
        "clip_duration": clip_duration,
        "clip_padding": clip_padding,
    }

    return highlight_dicts, timeline_dicts, metadata


def generate_clip(video_path: str, start: float, duration: float, output_dir: str, rank: int = 1) -> str:
    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / f"clip_{rank:03d}.mp4"

    from stream_clipper_cli.video import generate_clip as _gen

    success = _gen(video_file, output_path, start, duration)
    if not success:
        raise RuntimeError(f"Failed to generate clip: {output_path}")

    return str(output_path)


def batch_generate_clips(video_path: str, highlights: List[dict], output_dir: str) -> List[dict]:
    results = []
    for h in highlights:
        try:
            out = generate_clip(
                video_path=video_path,
                start=h.get("clip_start", h.get("start", 0)),
                duration=h.get("clip_duration", 30),
                output_dir=output_dir,
                rank=h.get("rank", 1),
            )
            results.append({"output_file": out, "success": True})
        except Exception as e:
            results.append({"output_file": "", "success": False})
    return results


def _candidate_to_dict(h: HighlightCandidate) -> dict:
    reasons = []
    if h.keyword_hits > 0:
        reasons.append(f"笑い語・キーワードが集中 ({h.keyword_hits} hits)")
    if h.chat_count >= 5:
        reasons.append(f"コメント密度が高い ({h.chat_count} messages)")
    if h.score >= 20:
        reasons.append("総合スコアが高い")
    if len(h.matched_keywords) >= 3:
        reasons.append("複数のキーワードに一致")

    return {
        "rank": h.rank,
        "start": h.start,
        "end": h.end,
        "peak_time": h.peak_time,
        "score": round(h.score, 1),
        "chat_count": h.chat_count,
        "keyword_hits": h.keyword_hits,
        "matched_keywords": h.matched_keywords,
        "reasons": reasons,
        "clip_start": h.clip_start,
        "clip_duration": h.clip_duration,
        "output_file": h.output_file,
    }


def _timeline_to_dict(r: TimelineRow) -> dict:
    return {
        "start": r.start,
        "end": r.end,
        "score": round(r.score, 1),
        "chat_count": r.chat_count,
        "keyword_hits": r.keyword_hits,
        "matched_keywords": r.matched_keywords,
    }
