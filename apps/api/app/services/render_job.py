"""
Render-job orchestrator.

Implements the render pipeline for a single candidate clip with the
following stages:

  1. vod_range_fetching  - if source is twitch_vod, fetch the time range
  2. ass_generation      - generate the ASS file from in-range chat
  3. ffmpeg_rendering    - hard-burn ASS into MP4 via ffmpeg (libx264)
  4. metadata_generation - write YouTube title/description/tags JSON

The output is always an MP4 with hard-burned ASS danmaku (or just the
extracted clip if `with_danmaku=False`). -c:v copy is never used.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.job_state import (
    JobStage,
    JobState,
    compute_stage_progress,
    mark_failed,
    update_stage,
)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


# ─── Range fetch (Twitch VOD via yt-dlp) ────────────────────────────────────

def _seconds_to_hhmmss(seconds: float) -> str:
    safe = max(0.0, seconds)
    h = int(safe // 3600)
    m = int((safe % 3600) // 60)
    s = safe - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ":")


def _fetch_twitch_range(
    vod_url: str,
    video_id: str,
    start: float,
    end: float,
    output_dir: Path,
) -> Dict[str, Any]:
    """
    Use yt-dlp --download-sections to fetch a Twitch VOD time range.
    Returns a dict with ok, output_path, etc.
    """
    if end <= start:
        return {"ok": False, "error_code": "INVALID_RANGE", "message": "end <= start"}
    if (end - start) > 30 * 60:
        return {"ok": False, "error_code": "RANGE_TOO_LARGE", "message": "Twitch range fetch limited to 30 min"}

    output_dir.mkdir(parents=True, exist_ok=True)
    safe_id = (video_id or "video").replace("/", "_")
    out_path = output_dir / f"v{safe_id}_{int(start)}_{int(end)}_{uuid.uuid4().hex[:6]}.mp4"

    start_str = _seconds_to_hhmmss(start)
    end_str = _seconds_to_hhmmss(end)
    args = [
        "yt-dlp",
        "--no-playlist",
        "--restrict-filenames",
        "--no-mtime",
        "-N", "4",
        "--buffer-size", "32K",
        "--merge-output-format", "mp4",
        "-f", "bv*[height<=1080]+ba/best",
        "-o", str(out_path),
        "--download-sections", f"*{start_str}-{end_str}",
        "--force-keyframes-at-cuts",
        vod_url,
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=15 * 60)
    except FileNotFoundError:
        return {"ok": False, "error_code": "YT_DLP_NOT_FOUND", "message": "yt-dlp not installed"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error_code": "YT_DLP_TIMEOUT", "message": "yt-dlp timed out"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error_code": "YT_DLP_FAILED",
            "message": (proc.stderr or "").strip()[-500:],
        }
    if not out_path.is_file() or out_path.stat().st_size == 0:
        return {"ok": False, "error_code": "OUTPUT_MISSING", "message": f"missing: {out_path}"}
    return {"ok": True, "output_path": str(out_path)}


# ─── ASS generation ────────────────────────────────────────────────────────

def _generate_ass(
    chat_messages: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    output_path: Path,
    danmaku_options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Generate an ASS subtitle file containing all in-range chat messages
    as right-to-left scrolling comments (NicoNico style).
    """
    try:
        from app.services.danmaku_ass import (
            DanmakuOptions,
            NormalizedChatMessage,
            generate_danmaku_ass,
        )
    except Exception as e:
        return {"ok": False, "error_code": "DANMAKU_IMPORT_FAILED", "message": str(e)}

    options = danmaku_options or {}
    opts = DanmakuOptions(
        play_res_x=int(options.get("play_res_x", 1920)),
        play_res_y=int(options.get("play_res_y", 1080)),
        font_name=options.get("font_name", "Noto Sans CJK JP"),
        font_size=int(options.get("font_size", 32)),
        comment_duration=float(options.get("comment_duration", 4.0)),
        opacity=float(options.get("opacity", 0.9)),
        density=options.get("density", "medium"),
        min_message_length=int(options.get("min_message_length", 1)),
        deduplicate_consecutive=bool(options.get("deduplicate_consecutive", True)),
        safety_comment_limit=int(options["safety_comment_limit"]) if options.get("safety_comment_limit") is not None else None,
    )

    normalized = []
    for m in chat_messages:
        if not isinstance(m, dict):
            continue
        ts = m.get("time_sec", m.get("timestamp"))
        if not isinstance(ts, (int, float)):
            continue
        msg = m.get("message", "")
        if not isinstance(msg, str):
            continue
        author = m.get("author")
        normalized.append(NormalizedChatMessage(
            timestamp=float(ts),
            time_sec=float(ts),
            message=msg,
            author=author if isinstance(author, str) else None,
        ))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = generate_danmaku_ass(
        chat_messages=normalized,
        clip_start=clip_start,
        clip_end=clip_end,
        output_path=str(output_path),
        options=opts,
    )
    return {
        "ok": True,
        "ass_path": str(output_path),
        "in_range_count": result.stats.in_range_count,
        "used_count": result.stats.used_count,
        "skipped_ng": result.stats.skipped_ng,
        "skipped_too_short": result.stats.skipped_too_short,
        "skipped_duplicate": result.stats.skipped_duplicate,
    }


# ─── FFmpeg render (hard-burn ASS) ─────────────────────────────────────────

def _ffmpeg_burn_ass(
    input_path: Path,
    output_path: Path,
    ass_path: Optional[Path],
    start: float,
    duration: float,
    preset: str = "veryfast",
    crf: int = 23,
    with_danmaku: bool = True,
    target_aspect: str = "16:9",  # "16:9" | "9:16"
) -> Dict[str, Any]:
    """
    Run FFmpeg to extract the time range and (optionally) hard-burn the ASS.
    libx264 is always used for the video encoder. -c:v copy is never used.
    """
    if not input_path.is_file():
        return {"ok": False, "error_code": "INPUT_MISSING", "message": f"missing: {input_path}"}
    duration = max(0.1, duration)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if target_aspect == "9:16":
        # Shorts: 9:16 (608x1080) with crop
        vf_parts = ["crop=ih*9/16:ih:(in_w-ih*9/16)/2:0"]
    else:
        # 16:9 - no transform
        vf_parts = []

    if with_danmaku and ass_path is not None:
        ass_filter_value = str(ass_path).replace("\\", "/").replace(":", "\\:")
        vf_parts.append(f"ass={ass_filter_value}")
        # When we have a separate (already extracted) range, the start is 0
        # and the full duration is in scope. The caller is expected to pass
        # start=0 in that case.
        args = [
            "ffmpeg", "-y",
            "-i", str(input_path),
        ]
        if start > 0:
            args += ["-ss", f"{start:.3f}"]
        args += ["-t", f"{duration:.3f}"]
        if vf_parts:
            args += ["-vf", ",".join(vf_parts)]
        args += [
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path),
        ]
    else:
        # No danmaku: reencode to MP4
        args = [
            "ffmpeg", "-y",
            "-ss", f"{start:.3f}",
            "-i", str(input_path),
            "-t", f"{duration:.3f}",
        ]
        if vf_parts:
            args += ["-vf", ",".join(vf_parts)]
        args += [
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path),
        ]

    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=1800)
    except FileNotFoundError:
        return {"ok": False, "error_code": "FFMPEG_NOT_FOUND", "message": "ffmpeg not on PATH"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error_code": "FFMPEG_TIMEOUT", "message": "ffmpeg timed out"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error_code": "FFMPEG_FAILED",
            "message": (proc.stderr or "").strip()[-800:],
        }
    if not output_path.is_file() or output_path.stat().st_size == 0:
        return {"ok": False, "error_code": "OUTPUT_MISSING", "message": f"missing: {output_path}"}
    return {"ok": True, "output_path": str(output_path)}


# ─── Local video resolver ───────────────────────────────────────────────────

def _resolve_local_video(video_path: str) -> Path:
    p = Path(video_path)
    if p.is_file():
        return p.resolve()
    candidate = _project_root() / "media" / video_path
    if candidate.is_file():
        return candidate.resolve()
    candidate = _project_root() / video_path
    if candidate.is_file():
        return candidate.resolve()
    raise FileNotFoundError(f"Video not found: {video_path}")


# ─── Public entry point ──────────────────────────────────────────────────────

@dataclass
class RenderRequest:
    candidate: Dict[str, Any]
    source: str  # "twitch_vod" | "local_file" | "ass_only"
    vod_url: Optional[str] = None
    video_id: Optional[str] = None
    video_path: Optional[str] = None
    chat_messages: Optional[List[Dict[str, Any]]] = None
    options: Optional[Dict[str, Any]] = None
    output_dir: str = "output/clips"
    with_danmaku: bool = True
    ffmpeg_preset: str = "veryfast"
    ffmpeg_crf: int = 23
    target_aspect: str = "16:9"  # "16:9" | "9:16"
    streamer_name: Optional[str] = None
    vod_title: Optional[str] = None


def run_render_job(job: JobState, req: RenderRequest) -> None:
    try:
        # Lazy import
        from stream_clipper_cli.youtube_metadata import build_youtube_metadata
    except Exception as e:
        mark_failed(job, "CLI_IMPORT_FAILED", f"stream_clipper_cli import failed: {e}")
        return

    options = req.options or {}
    output_dir = _project_root() / req.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    candidate = req.candidate
    candidate_id = candidate.get("candidate_id") or candidate.get("id") or f"rank-{candidate.get('rank', 0)}"
    rank = int(candidate.get("rank", 0) or 0)
    kind = candidate.get("kind", "short")
    clip_start = float(candidate.get("clip_start", candidate.get("start", 0)))
    clip_end = float(candidate.get("clip_end", candidate.get("end", clip_start + 60)))
    if clip_end <= clip_start:
        mark_failed(job, "INVALID_RANGE", "clip_end <= clip_start")
        return

    # ── 1. VOD range fetch ────────────────────────────────────────────
    source_video: Optional[Path] = None
    range_fetch_duration = clip_end - clip_start
    if req.source == "twitch_vod":
        update_stage(
            job, JobStage.VOD_RANGE_FETCHING, "Twitch VOD の範囲を取得中...",
            compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 0.05),
        )
        if not req.vod_url:
            mark_failed(job, "VOD_URL_REQUIRED", "Twitch VOD URL が必要です")
            return
        # Twitch VOD range fetch is limited to 30 minutes; for longer ranges
        # we use the local source if available, otherwise we cap and warn.
        if range_fetch_duration > 30 * 60:
            if req.video_path:
                # Fall through to local file branch below.
                pass
            else:
                mark_failed(
                    job, "RANGE_TOO_LARGE",
                    f"Twitch VOD range fetch is limited to 30 minutes. "
                    f"Requested {range_fetch_duration/60:.1f} min. "
                    f"Provide a local file in Advanced settings.",
                )
                return
        else:
            tmp_dir = output_dir / "tmp"
            fetch = _fetch_twitch_range(
                req.vod_url, req.video_id or "", clip_start, clip_end, tmp_dir,
            )
            if not fetch.get("ok"):
                # If a local file is available, fall back to it.
                if req.video_path:
                    pass
                else:
                    mark_failed(
                        job, fetch.get("error_code", "RANGE_FETCH_FAILED"),
                        fetch.get("message", "range fetch failed"),
                    )
                    return
            else:
                source_video = Path(fetch["output_path"])
                update_stage(
                    job, JobStage.VOD_RANGE_FETCHING, f"Range fetched: {source_video.name}",
                    compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0),
                    result_patch={"temp_video_path": str(source_video.relative_to(_project_root()))},
                )
                # Since the fetched file is already the exact range, the
                # in-FFmpeg seek becomes 0 with full duration.
                clip_start = 0.0
                clip_end = range_fetch_duration
    if job.cancelled:
        return

    # Local file fallback
    if source_video is None and req.source in ("twitch_vod", "local_file"):
        if not req.video_path:
            mark_failed(job, "LOCAL_VIDEO_REQUIRED", "ローカル動画ファイルが必要です")
            return
        try:
            source_video = _resolve_local_video(req.video_path)
        except FileNotFoundError as e:
            mark_failed(job, "LOCAL_VIDEO_NOT_FOUND", str(e))
            return
        update_stage(
            job, JobStage.VOD_RANGE_FETCHING,
            f"Local video: {source_video.name}",
            compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0),
            result_patch={"source_video": str(source_video.relative_to(_project_root()))},
        )
    elif req.source == "ass_only":
        update_stage(
            job, JobStage.VOD_RANGE_FETCHING,
            "Skipped (ASS only)",
            compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0),
        )

    if job.cancelled:
        return

    # ── 2. ASS generation ─────────────────────────────────────────────
    rank_part = f"clip_{rank:03d}" if rank else f"clip_{uuid.uuid4().hex[:6]}"
    suffix = "_danmaku" if req.with_danmaku else "_clip"
    final_path = output_dir / f"{rank_part}_{kind}{suffix}.mp4"
    ass_path: Optional[Path] = None
    ass_info: Dict[str, Any] = {}
    if req.with_danmaku:
        update_stage(
            job, JobStage.ASS_GENERATION, "ASS を生成中...",
            compute_stage_progress(JobStage.ASS_GENERATION, 0.1),
        )
        ass_path = output_dir / f"{rank_part}_{kind}.ass"
        if req.source == "ass_only":
            chat_in_range = list(req.chat_messages or [])
        else:
            # Filter to in-range
            chat_in_range = []
            for m in (req.chat_messages or []):
                ts = m.get("time_sec", m.get("timestamp"))
                if isinstance(ts, (int, float)) and clip_start <= float(ts) <= clip_end + (clip_start if source_video and req.source == "twitch_vod" else 0):
                    chat_in_range.append(m)
        ass_info = _generate_ass(
            chat_in_range,
            clip_start=0.0 if (source_video and req.source == "twitch_vod") else clip_start,
            clip_end=clip_end,
            output_path=ass_path,
            danmaku_options=options,
        )
        if not ass_info.get("ok"):
            mark_failed(
                job, ass_info.get("error_code", "ASS_FAILED"),
                ass_info.get("message", "ASS generation failed"),
            )
            return
        update_stage(
            job, JobStage.ASS_GENERATION,
            f"ASS done: {ass_info.get('used_count', 0)} comments",
            compute_stage_progress(JobStage.ASS_GENERATION, 1.0),
            result_patch={"ass_path": str(ass_path.relative_to(_project_root())), **ass_info},
        )
    else:
        update_stage(
            job, JobStage.ASS_GENERATION,
            "Skipped (no danmaku)",
            compute_stage_progress(JobStage.ASS_GENERATION, 1.0),
        )

    if job.cancelled:
        return

    # ── 3. ffmpeg_rendering ──────────────────────────────────────────
    if req.source != "ass_only":
        update_stage(
            job, JobStage.FFMPEG_RENDERING, "FFmpeg でレンダリング中...",
            compute_stage_progress(JobStage.FFMPEG_RENDERING, 0.1),
        )
        if source_video is None:
            mark_failed(job, "NO_SOURCE_VIDEO", "source video not available")
            return
        render = _ffmpeg_burn_ass(
            input_path=source_video,
            output_path=final_path,
            ass_path=ass_path,
            start=clip_start,
            duration=(clip_end - clip_start),
            preset=req.ffmpeg_preset,
            crf=req.ffmpeg_crf,
            with_danmaku=req.with_danmaku,
            target_aspect=req.target_aspect,
        )
        if not render.get("ok"):
            mark_failed(
                job, render.get("error_code", "RENDER_FAILED"),
                render.get("message", "render failed"),
            )
            return
        update_stage(
            job, JobStage.FFMPEG_RENDERING,
            f"レンダリング完了: {final_path.name}",
            compute_stage_progress(JobStage.FFMPEG_RENDERING, 1.0),
            result_patch={"output_path": str(final_path.relative_to(_project_root())), "size_bytes": final_path.stat().st_size},
        )
    else:
        update_stage(
            job, JobStage.FFMPEG_RENDERING,
            "Skipped (ASS only)",
            compute_stage_progress(JobStage.FFMPEG_RENDERING, 1.0),
        )

    if job.cancelled:
        return

    # ── 4. metadata_generation ────────────────────────────────────────
    update_stage(
        job, JobStage.METADATA_GENERATION, "YouTube メタデータを生成中...",
        compute_stage_progress(JobStage.METADATA_GENERATION, 0.2),
    )
    try:
        # Re-hydrate a Candidate from dict if available
        from stream_clipper_cli.candidate_pipeline import Candidate
        cand_obj = Candidate(
            candidate_id=candidate_id,
            kind=kind,
            rank=rank,
            start=float(candidate.get("start", clip_start)),
            end=float(candidate.get("end", clip_end)),
            peak_time=float(candidate.get("peak_time", (clip_start + clip_end) / 2)),
            peak_window_index=int(candidate.get("peak_window_index", 0) or 0),
            clip_start=float(candidate.get("clip_start", clip_start)),
            clip_end=float(candidate.get("clip_end", clip_end)),
            clip_duration=float(candidate.get("clip_duration", clip_end - clip_start)),
            score=float(candidate.get("score", candidate.get("long_score", 0)) or 0),
            chat_count=int(candidate.get("chat_count", 0) or 0),
            unique_author_count=int(candidate.get("unique_author_count", 0) or 0),
            keyword_hits=int(candidate.get("keyword_hits", 0) or 0),
            laugh_score=float(candidate.get("laugh_score", 0) or 0),
            surprise_score=float(candidate.get("surprise_score", 0) or 0),
            clip_worthy_score=float(candidate.get("clip_worthy_score", 0) or 0),
            reaction_score=float(candidate.get("reaction_score", 0) or 0),
            burst_score=float(candidate.get("burst_score", 0) or 0),
            total_score=float(candidate.get("total_score", candidate.get("score", 0)) or 0),
            peak_count=int(candidate.get("peak_count", 1) or 1),
            peak_centers=list(candidate.get("peak_centers", [])),
            matched_keywords=list(candidate.get("matched_keywords", [])),
            reasons=list(candidate.get("reasons", [])),
        )
        meta = build_youtube_metadata(
            cand_obj,
            vod_title=req.vod_title,
            streamer_name=req.streamer_name,
        )
    except Exception as e:
        mark_failed(job, "METADATA_FAILED", f"YouTube metadata failed: {e}")
        return
    metadata_path = output_dir / f"{rank_part}_{kind}.json"
    payload = {
        "candidate_id": candidate_id,
        "kind": kind,
        "rank": rank,
        "clip_start": candidate.get("clip_start"),
        "clip_end": candidate.get("clip_end"),
        "clip_duration": candidate.get("clip_duration"),
        "vod_title": req.vod_title,
        "streamer": req.streamer_name,
        "youtube": meta.to_dict(),
        "render": {
            "output_path": str(final_path.relative_to(_project_root())),
            "ass_path": str(ass_path.relative_to(_project_root())) if ass_path else None,
            "with_danmaku": req.with_danmaku,
            "ffmpeg_preset": req.ffmpeg_preset,
            "ffmpeg_crf": req.ffmpeg_crf,
            "size_bytes": final_path.stat().st_size if final_path.is_file() else None,
        },
    }
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    update_stage(
        job, JobStage.METADATA_GENERATION,
        f"Metadata saved: {metadata_path.name}",
        compute_stage_progress(JobStage.METADATA_GENERATION, 1.0),
        result_patch={
            "metadata_path": str(metadata_path.relative_to(_project_root())),
            "youtube": meta.to_dict(),
        },
    )

    update_stage(
        job, JobStage.COMPLETED,
        f"レンダリング完了: {final_path.name}",
        100.0,
    )


async def run_render_job_async(job: JobState, req: RenderRequest) -> None:
    await asyncio.to_thread(run_render_job, job, req)
