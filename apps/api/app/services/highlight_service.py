from __future__ import annotations

import concurrent.futures
import json
from pathlib import Path
from typing import List, Optional, Tuple

# The CLI package is added to sys.path once in app.main. We rely on that
# to import the modules below.

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


def generate_clip(video_path: str, start: float, duration: float,
                  output_dir: str, rank: int = 1,
                  encoder: str = "auto", mode: str = "reencode") -> str:
    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / f"clip_{rank:03d}.mp4"

    from stream_clipper_cli.video import generate_clip as _gen

    success = _gen(video_file, output_path, start, duration,
                   encoder=encoder, mode=mode)
    if not success:
        raise RuntimeError(f"Failed to generate clip: {output_path}")

    return str(output_path)


def batch_generate_clips(video_path: str, highlights: List[dict],
                         output_dir: str,
                         encoder: str = "auto",
                         mode: str = "reencode",
                         max_workers: int = 8) -> List[dict]:
    results: List[dict] = [None] * len(highlights)

    def _gen_one(index: int, h: dict) -> tuple[int, dict]:
        try:
            out = generate_clip(
                video_path=video_path,
                start=h.get("clip_start", h.get("start", 0)),
                duration=h.get("clip_duration", 30),
                output_dir=output_dir,
                rank=h.get("rank", 1),
                encoder=encoder,
                mode=mode,
            )
            return index, {"output_file": out, "success": True}
        except Exception:
            return index, {"output_file": "", "success": False}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(_gen_one, i, h) for i, h in enumerate(highlights)]
        for future in concurrent.futures.as_completed(futures):
            idx, result = future.result()
            results[idx] = result

    return results


def generate_short_video(
    video_path: str,
    start: float,
    duration: float,
    output_dir: str,
    rank: int = 1,
    subtitle_text: str | None = None,
    target_width: int = 608,
    target_height: int = 1080,
    encoder: str = "auto",
) -> str:
    import subprocess

    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    from stream_clipper_cli.video import _detect_nvenc
    if encoder == "auto":
        encoder = "h264_nvenc" if _detect_nvenc() else "libx264"

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / f"short_{rank:03d}.mp4"

    filter_parts = [f"crop={target_width}:{target_height}:(in_w-{target_width})/2:0"]

    if subtitle_text:
        safe_text = subtitle_text.replace("'", "\\'").replace("\"", "\\\"")
        filter_parts.append(
            f"drawtext=text='{safe_text}':fontsize=28:fontcolor=white:"
            f"box=1:boxcolor=black@0.5:boxborderw=8:x=(w-text_w)/2:y=h-th-40"
        )

    vf = ",".join(filter_parts)

    args = [
        "ffmpeg", "-hide_banner", "-y",
        "-ss", str(start),
        "-i", str(video_file),
        "-t", str(duration),
        "-vf", vf,
    ]
    if encoder == "h264_nvenc":
        args += ["-c:v", "h264_nvenc", "-preset", "p7", "-cq", "23", "-b:v", "0"]
    else:
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]
    args += [
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(output_path),
    ]

    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr.strip()}")
    except FileNotFoundError:
        raise RuntimeError("ffmpeg not found on PATH")

    return str(output_path)


def _candidate_to_dict(h: HighlightCandidate) -> dict:
    reasons = []
    if h.keyword_hits > 0:
        reasons.append(f"キーワードが集中 ({h.keyword_hits} hits)")
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
