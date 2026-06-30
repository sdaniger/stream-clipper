"""
Preview-render orchestrator.

Renders a SHORT, LOW-RESOLUTION clip with ASS comments hard-burned
via FFmpeg.  This is used to give the user a true preview of what
the final MP4 will look like before committing to the full render
(which can take many minutes for long candidates).

Stages (in order):

  1. vod_range_fetching  - if source is twitch_vod, fetch a short range
  2. comment_filtering   - (no-op here; filtering lives inside ASS gen)
  3. ass_generation      - generate the .ass file with the same logic
                           the full render will use
  4. preview_rendering   - FFmpeg + libx264 + ass= filter; 720p,
                           preset=ultrafast, crf=28; capped at 30s

Output: a single MP4 stored under output/preview/{job_id}.mp4.  On
failure the job is marked failed and the frontend falls back to the
lightweight Canvas overlay.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.job_state import (
    PREVIEW_STAGE_WEIGHTS,
    JobStage,
    JobState,
    compute_stage_progress,
    mark_failed,
    update_stage,
)
from app.services.platform_utils import is_android


# ─── defaults ────────────────────────────────────────────────────────────────

# Output resolution for the preview. 720p is the sweet spot:
# - readable on phones and desktops
# - encodes in seconds, not minutes
DEFAULT_PREVIEW_WIDTH = 1280
DEFAULT_PREVIEW_HEIGHT = 720

# Cap on preview duration. Android overrides this to 15s.
DEFAULT_PREVIEW_MAX_DURATION_SEC = 30.0
ANDROID_PREVIEW_MAX_DURATION_SEC = 15.0

# FFmpeg settings for the preview render.
PREVIEW_PRESET = "ultrafast"
PREVIEW_CRF = 28


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _project_fonts_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "assets" / "fonts"


# ─── range fetch (Twitch VOD) ────────────────────────────────────────────────


def _fetch_twitch_range(
    vod_url: str,
    video_id: str,
    start: float,
    end: float,
    output_dir: Path,
) -> Dict[str, Any]:
    from app.services.twitch_range_fetcher import (
        TwitchRangeFetchRequest,
        fetch_twitch_range,
    )

    req = TwitchRangeFetchRequest(
        vod_url=vod_url,
        video_id=video_id or None,
        start_seconds=start,
        end_seconds=end,
        output_dir=str(output_dir),
        format="bv*[height<=720]+ba/best",
    )
    result = fetch_twitch_range(req)
    if result.ok:
        return {
            "ok": True,
            "output_path": str(_project_root() / result.output_path) if result.output_path else "",
        }
    return {
        "ok": False,
        "error_code": result.error_code or "RANGE_FETCH_FAILED",
        "message": result.message or "range fetch failed",
    }


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


# ─── public request type ─────────────────────────────────────────────────────


@dataclass
class PreviewRequest:
    candidate: Dict[str, Any]
    source: str  # "twitch_vod" | "local_file" | "ass_only"
    vod_url: Optional[str] = None
    video_id: Optional[str] = None
    video_path: Optional[str] = None
    chat_messages: Optional[List[Dict[str, Any]]] = None
    options: Optional[Dict[str, Any]] = None
    output_dir: str = "output/preview"
    danmaku_style_preset: Optional[str] = None
    max_duration_sec: Optional[float] = None
    preview_width: Optional[int] = None
    preview_height: Optional[int] = None


# ─── main entry point ────────────────────────────────────────────────────────


def run_preview_job(job: JobState, req: PreviewRequest) -> None:
    """
    Synchronous preview renderer. Runs in a thread (the route handler
    uses run_preview_job_async to schedule it without blocking the loop).
    """
    try:
        from app.services.danmaku_ass import (
            DanmakuOptions,
            NormalizedChatMessage,
            generate_danmaku_ass,
        )
    except Exception as e:
        mark_failed(job, "DANMAKU_IMPORT_FAILED", f"danmaku_ass import failed: {e}")
        return

    options = req.options or {}
    out_dir = _project_root() / req.output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    candidate = req.candidate
    rank = int(candidate.get("rank", 0) or 0)
    kind = candidate.get("kind", "short")
    clip_start = float(candidate.get("clip_start", candidate.get("start", 0)))
    clip_end = float(candidate.get("clip_end", candidate.get("end", clip_start + 60)))
    if clip_end <= clip_start:
        mark_failed(job, "INVALID_RANGE", "clip_end <= clip_start")
        return

    # Cap preview duration
    max_dur = req.max_duration_sec
    if max_dur is None:
        max_dur = (
            ANDROID_PREVIEW_MAX_DURATION_SEC
            if is_android()
            else DEFAULT_PREVIEW_MAX_DURATION_SEC
        )
    preview_dur = min(clip_end - clip_start, float(max_dur))
    if preview_dur < (clip_end - clip_start):
        # Trim the clip window to the preview duration (centre on peak)
        peak = float(candidate.get("peak_time", (clip_start + clip_end) / 2))
        new_start = max(clip_start, peak - preview_dur / 2)
        new_end = new_start + preview_dur
        if new_end > clip_end:
            new_end = clip_end
            new_start = new_end - preview_dur
        clip_start = new_start
        clip_end = new_end

    preview_w = int(req.preview_width or DEFAULT_PREVIEW_WIDTH)
    preview_h = int(req.preview_height or DEFAULT_PREVIEW_HEIGHT)
    # Make the dimensions even (H.264 requires even width/height for yuv420p)
    if preview_w % 2 == 1:
        preview_w -= 1
    if preview_h % 2 == 1:
        preview_h -= 1

    # ── 1. VOD range fetch ───────────────────────────────────────────────
    source_video: Optional[Path] = None
    fetch_ok = True
    if req.source == "twitch_vod":
        update_stage(
            job, JobStage.VOD_RANGE_FETCHING, "プレビュー用動画範囲を取得中...",
            compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 0.1, weights=PREVIEW_STAGE_WEIGHTS),
        )
        if not req.vod_url:
            mark_failed(job, "VOD_URL_REQUIRED", "Twitch VOD URL が必要です")
            return
        tmp_dir = out_dir / f"tmp_{uuid.uuid4().hex[:6]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        fetch = _fetch_twitch_range(
            req.vod_url, req.video_id or "", clip_start, clip_end, tmp_dir,
        )
        if not fetch.get("ok"):
            fetch_ok = False
            update_stage(
                job, JobStage.VOD_RANGE_FETCHING,
                f"Range fetch failed: {fetch.get('message', '')}",
                compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0, weights=PREVIEW_STAGE_WEIGHTS),
            )
        else:
            source_video = Path(fetch["output_path"])
            update_stage(
                job, JobStage.VOD_RANGE_FETCHING, f"Range fetched: {source_video.name}",
                compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0, weights=PREVIEW_STAGE_WEIGHTS),
                result_patch={"temp_video_path": str(source_video.relative_to(_project_root()))},
            )
            # The fetched file is the exact range
            clip_start = 0.0
            clip_end = preview_dur

    if job.cancelled:
        return

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
            compute_stage_progress(JobStage.VOD_RANGE_FETCHING, 1.0, weights=PREVIEW_STAGE_WEIGHTS),
            result_patch={"source_video": str(source_video.relative_to(_project_root()))},
        )

    if req.source == "ass_only":
        mark_failed(job, "ASS_ONLY_PREVIEW_UNSUPPORTED",
                    "ASSのみソースはプレビューに対応していません")
        return

    if source_video is None:
        if not fetch_ok:
            mark_failed(job, "RANGE_FETCH_FAILED",
                        "Twitch VOD 範囲取得に失敗し、ローカルファイルも指定されていません")
        else:
            mark_failed(job, "NO_SOURCE_VIDEO", "ソース動画が見つかりません")
        return

    if job.cancelled:
        return

    # ── 2. Comment filtering (no-op visually; bookkeeping only) ─────────
    update_stage(
        job, JobStage.COMMENT_FILTERING, "表示するコメントを選別中...",
        compute_stage_progress(JobStage.COMMENT_FILTERING, 0.5, weights=PREVIEW_STAGE_WEIGHTS),
    )

    if job.cancelled:
        return

    # ── 3. ASS generation ───────────────────────────────────────────────
    update_stage(
        job, JobStage.ASS_GENERATION, "弾幕ファイルを生成中...",
        compute_stage_progress(JobStage.ASS_GENERATION, 0.1, weights=PREVIEW_STAGE_WEIGHTS),
    )

    # Build DanmakuOptions; merge style preset if provided
    danmaku_options_dict: Dict[str, Any] = {
        "play_res_x": preview_w,
        "play_res_y": preview_h,
        "font_name": options.get("font_name", "Noto Sans JP"),
        "font_size": int(options.get("font_size", 32)),
        "comment_duration": float(options.get("comment_duration", 4.0)),
        "opacity": float(options.get("opacity", 0.9)),
        "outline": int(options.get("outline", 2)),
        "shadow": int(options.get("shadow", 0)),
        "density": options.get("density", "normal"),
        "min_message_length": int(options.get("min_message_length", 1)),
        "deduplicate_consecutive": bool(options.get("deduplicate_consecutive", True)),
    }
    if req.danmaku_style_preset:
        danmaku_options_dict["style_preset"] = req.danmaku_style_preset
    if options.get("max_comments_per_second") is not None:
        danmaku_options_dict["max_comments_per_second"] = options["max_comments_per_second"]
    if options.get("max_lanes") is not None:
        danmaku_options_dict["max_lanes"] = options["max_lanes"]
    if options.get("ng_words"):
        danmaku_options_dict["ng_words"] = options["ng_words"]

    try:
        opts = DanmakuOptions(**danmaku_options_dict)
    except TypeError as e:
        mark_failed(job, "DANMAKU_OPTIONS_INVALID", f"弾幕オプションが無効です: {e}")
        return

    normalized: List[NormalizedChatMessage] = []
    for m in (req.chat_messages or []):
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

    rank_part = f"preview_{rank:03d}" if rank else f"preview_{uuid.uuid4().hex[:6]}"
    ass_path = out_dir / f"{rank_part}_{kind}.ass"
    ass_result = generate_danmaku_ass(
        chat_messages=normalized,
        clip_start=clip_start,
        clip_end=clip_end,
        output_path=str(ass_path),
        options=opts,
    )
    update_stage(
        job, JobStage.ASS_GENERATION,
        f"ASS: {ass_result.stats.used_count} comments",
        compute_stage_progress(JobStage.ASS_GENERATION, 1.0, weights=PREVIEW_STAGE_WEIGHTS),
        result_patch={
            "ass_path": str(ass_path.relative_to(_project_root())),
            "comment_stats": {
                "in_range": ass_result.stats.in_range_count,
                "used": ass_result.stats.used_count,
                "skipped_ng": ass_result.stats.skipped_ng,
                "skipped_too_short": ass_result.stats.skipped_too_short,
                "skipped_duplicate": ass_result.stats.skipped_duplicate,
                "skipped_url": ass_result.stats.skipped_url,
                "skipped_emoji_spam": ass_result.stats.skipped_emoji_spam,
                "skipped_user_repeat": ass_result.stats.skipped_user_repeat,
                "skipped_rate_limit": ass_result.stats.skipped_rate_limit,
            },
        },
    )

    if job.cancelled:
        return

    # ── 4. preview_rendering ────────────────────────────────────────────
    output_path = out_dir / f"{rank_part}_{kind}.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    update_stage(
        job, JobStage.PREVIEW_RENDERING, "FFmpeg でプレビューを生成中...",
        compute_stage_progress(JobStage.PREVIEW_RENDERING, 0.2, weights=PREVIEW_STAGE_WEIGHTS),
    )

    # Build filter chain
    vf_parts: List[str] = []
    if preview_w != 1920 or preview_h != 1080:
        vf_parts.append(f"scale={preview_w}:{preview_h}")

    ass_filter_value = str(ass_path.resolve()).replace("\\", "/").replace(":", "\\:")
    fonts_dir = _project_fonts_dir()
    if fonts_dir.is_dir():
        fd_escaped = str(fonts_dir.resolve()).replace("\\", "/").replace(":", "\\:")
        ass_filter_value += f":fontsdir={fd_escaped}"
    vf_parts.append(f"ass={ass_filter_value}")

    args = [
        "ffmpeg", "-y",
        "-ss", f"{clip_start:.3f}",
        "-i", str(source_video),
        "-t", f"{(clip_end - clip_start):.3f}",
        "-vf", ",".join(vf_parts),
        "-c:v", "libx264",
        "-preset", PREVIEW_PRESET,
        "-crf", str(PREVIEW_CRF),
        "-c:a", "aac",
        "-b:a", "96k",
        "-movflags", "+faststart",
        str(output_path),
    ]

    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=600)
    except FileNotFoundError:
        mark_failed(job, "FFMPEG_NOT_FOUND", "ffmpeg が PATH に見つかりません")
        return
    except subprocess.TimeoutExpired:
        mark_failed(job, "PREVIEW_TIMEOUT", "プレビュー生成がタイムアウトしました")
        return
    if proc.returncode != 0:
        # Detect missing libass
        err = (proc.stderr or "").lower()
        if "ass" in err and ("no such filter" in err or "filter not found" in err):
            mark_failed(
                job, "ASS_FILTER_NOT_SUPPORTED",
                "このFFmpegはASS字幕の焼き込みに対応していません",
            )
        else:
            mark_failed(
                job, "FFMPEG_FAILED",
                f"プレビューの生成に失敗しました: {(proc.stderr or '').strip()[-500:]}",
            )
        return

    if not output_path.is_file() or output_path.stat().st_size == 0:
        mark_failed(job, "OUTPUT_MISSING", f"プレビュー出力がありません: {output_path}")
        return

    duration = clip_end - clip_start
    update_stage(
        job, JobStage.COMPLETED, f"プレビュー完了: {output_path.name}",
        100.0,
        result_patch={
            "preview_path": str(output_path.relative_to(_project_root())),
            "preview_filename": output_path.name,
            "duration_seconds": duration,
            "width": preview_w,
            "height": preview_h,
            "burned_comment_count": ass_result.stats.used_count,
            "in_range_count": ass_result.stats.in_range_count,
            "size_bytes": output_path.stat().st_size,
        },
    )

    # Cleanup temp dir
    tmp_dir = out_dir / f"tmp_{rank_part}"
    if tmp_dir.is_dir():
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


async def run_preview_job_async(job: JobState, req: PreviewRequest) -> None:
    await asyncio.to_thread(run_preview_job, job, req)
