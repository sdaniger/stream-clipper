"""
Danmaku export orchestrator.

Two-stage FFmpeg pipeline:
  1. Extract clip from input video at the requested time range.
  2. Burn the generated ASS file into the clip using the `ass` filter.

The two-stage approach is intentional:
- It keeps each FFmpeg invocation simple and debuggable.
- The intermediate clip can be cached and re-burned with different ASS
  parameters (e.g. different density) without re-downloading.

This is the Python service that exposes the same logic to the API router
and to the CLI; the actual route in the Next.js app delegates here.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Make danmaku_ass importable when called as a module
from app.services.danmaku_ass import (  # noqa: E402
    DanmakuOptions,
    DanmakuResult,
    DanmakuStats,
    NormalizedChatMessage,
    generate_danmaku_ass,
)


@dataclass
class DanmakuExportRequest:
    """Parameters for a single danmaku export run."""
    video_path: str  # absolute path to the local source video
    chat_messages: list  # list of NormalizedChatMessage dicts
    clip_start: float
    clip_end: float
    output_dir: str = "output"
    with_danmaku: bool = True
    fast: bool = False
    options: Optional[dict] = None  # DanmakuOptions kwargs


@dataclass
class DanmakuExportResult:
    ok: bool
    output_file: Optional[str] = None
    ass_file: Optional[str] = None
    comment_count: int = 0
    in_range_count: int = 0
    skipped_ng: int = 0
    skipped_too_short: int = 0
    skipped_duplicate: int = 0
    clip_start: float = 0.0
    clip_end: float = 0.0
    error_code: Optional[str] = None
    message: Optional[str] = None
    command_preview: Optional[str] = None
    duration_seconds: float = 0.0


def _project_root() -> Path:
    """Resolve the project root (apps/api is one level deep)."""
    return Path(__file__).resolve().parents[3]


def _workspace_media_root() -> Path:
    """MEDIA_ROOT defaults to ./media in the workspace root."""
    return _project_root() / "media"


def _resolve_video_path(video_path: str) -> Path:
    """
    Resolve a user-provided video path.

    Tries in order:
      1. As-is (absolute)
      2. Relative to MEDIA_ROOT
      3. Relative to workspace root
    """
    p = Path(video_path)
    if p.is_file():
        return p.resolve()

    media_root = _workspace_media_root()
    candidate = media_root / video_path
    if candidate.is_file():
        return candidate.resolve()

    workspace_candidate = _project_root() / video_path
    if workspace_candidate.is_file():
        return workspace_candidate.resolve()

    raise FileNotFoundError(
        f"Video not found: {video_path}. Checked absolute, MEDIA_ROOT, and workspace."
    )


def _build_output_paths(
    output_dir: str,
    video_path: Path,
    with_danmaku: bool,
) -> tuple[Path, Path, Path]:
    """
    Build output paths:
      - clip:   intermediate clipped video (no danmaku)
      - ass:    generated ASS file
      - final:  output mp4 (with or without danmaku burned in)
    """
    base = _project_root()
    out_dir = Path(output_dir)
    if not out_dir.is_absolute():
        out_dir = base / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    suffix = "_danmaku" if with_danmaku else ""
    name = f"clip_{int(time.time())}_{uuid.uuid4().hex[:6]}{suffix}"
    clip = out_dir / f"{name}.mp4"
    ass = out_dir / f"{name}.ass"
    final = out_dir / f"{name}.mp4"
    return clip, ass, final


def _ffmpeg_extract_clip(
    input_path: Path,
    output_path: Path,
    clip_start: float,
    clip_end: float,
    fast: bool,
) -> subprocess.CompletedProcess:
    """Stage 1: extract a clip from the source video."""
    duration = max(0.1, clip_end - clip_start)
    if fast:
        # Re-encode for accurate cuts. Default to copy (much faster) when
        # possible.
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{clip_start:.3f}",
            "-i", str(input_path),
            "-t", f"{duration:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path),
        ]
    else:
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{clip_start:.3f}",
            "-i", str(input_path),
            "-t", f"{duration:.3f}",
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart",
            str(output_path),
        ]
    return subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
        timeout=600,
    )


def _ffmpeg_burn_ass(
    clip_path: Path,
    ass_path: Path,
    output_path: Path,
) -> subprocess.CompletedProcess:
    """Stage 2: burn ASS into the clipped video."""
    # The `ass` filter requires a path; the filter graph uses single quotes
    # around the value. Backslashes need to be escaped for ffmpeg's filter
    # parser.
    ass_filter_value = str(ass_path).replace("\\", "/").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip_path),
        "-vf", f"ass={ass_filter_value}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "copy",
        "-movflags", "+faststart",
        str(output_path),
    ]
    return subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
        timeout=900,
    )


def _build_danmaku_options(options: Optional[dict]) -> DanmakuOptions:
    """Map a dict of options into a DanmakuOptions instance."""
    if not options:
        return DanmakuOptions()
    ng_words = options.get("ng_words") or []
    if isinstance(ng_words, str):
        ng_words = [w.strip() for w in ng_words.split(",") if w.strip()]
    return DanmakuOptions(
        play_res_x=int(options.get("play_res_x", 1920)),
        play_res_y=int(options.get("play_res_y", 1080)),
        font_name=options.get("font_name", "Noto Sans CJK JP"),
        font_size=int(options.get("font_size", 32)),
        comment_duration=float(options.get("comment_duration", 4.0)),
        opacity=float(options.get("opacity", 0.9)),
        max_comments=int(options.get("max_comments", 120)),
        density=options.get("density", "medium"),
        ng_words=tuple(ng_words),
        min_message_length=int(options.get("min_message_length", 1)),
        deduplicate_consecutive=bool(options.get("deduplicate_consecutive", True)),
    )


def export_danmaku_clip(req: DanmakuExportRequest) -> DanmakuExportResult:
    """End-to-end danmaku export. Returns a result envelope."""
    start_ts = time.time()
    try:
        video_abs = _resolve_video_path(req.video_path)
    except FileNotFoundError as e:
        return DanmakuExportResult(
            ok=False,
            error_code="LOCAL_VIDEO_NOT_FOUND",
            message=str(e),
        )

    if req.clip_end <= req.clip_start:
        return DanmakuExportResult(
            ok=False,
            error_code="INVALID_RANGE",
            message=f"clip_end ({req.clip_end}) must be greater than clip_start ({req.clip_start}).",
        )

    # Build options
    danmaku_opts = _build_danmaku_options(req.options)

    # Build output paths
    clip_path, ass_path, final_path = _build_output_paths(
        req.output_dir, video_abs, req.with_danmaku
    )

    # Stage 1: extract clip
    try:
        _ffmpeg_extract_clip(
            input_path=video_abs,
            output_path=clip_path,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            fast=req.fast,
        )
    except subprocess.CalledProcessError as e:
        return DanmakuExportResult(
            ok=False,
            error_code="CLIP_EXTRACT_FAILED",
            message=f"FFmpeg clip extraction failed: {e.stderr[-500:]}",
        )
    except subprocess.TimeoutExpired:
        return DanmakuExportResult(
            ok=False,
            error_code="CLIP_EXTRACT_TIMEOUT",
            message="FFmpeg clip extraction timed out.",
        )

    if not req.with_danmaku:
        # Without danmaku: just return the extracted clip as the final file.
        # Move (rename) the intermediate to the final name.
        if clip_path != final_path:
            final_path.write_bytes(clip_path.read_bytes())
            clip_path.unlink(missing_ok=True)
        # We didn't generate an ASS file, so ass_file is null.
        return DanmakuExportResult(
            ok=True,
            output_file=str(final_path.relative_to(_project_root())),
            ass_file=None,
            comment_count=0,
            in_range_count=0,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            duration_seconds=time.time() - start_ts,
        )

    # Stage 2: generate ASS
    try:
        chat_objs = [NormalizedChatMessage(**m) for m in req.chat_messages]
    except Exception as e:
        # Bad chat shape — clean up intermediate clip
        clip_path.unlink(missing_ok=True)
        return DanmakuExportResult(
            ok=False,
            error_code="INVALID_CHAT_DATA",
            message=f"Chat messages are malformed: {e}",
        )

    ass_result: DanmakuResult = generate_danmaku_ass(
        chat_messages=chat_objs,
        clip_start=req.clip_start,
        clip_end=req.clip_end,
        output_path=str(ass_path),
        options=danmaku_opts,
    )

    # Stage 3: burn ASS into clip
    try:
        _ffmpeg_burn_ass(
            clip_path=clip_path,
            ass_path=ass_path,
            output_path=final_path,
        )
    except subprocess.CalledProcessError as e:
        return DanmakuExportResult(
            ok=False,
            error_code="ASS_BURN_FAILED",
            message=f"FFmpeg ASS burn-in failed: {e.stderr[-500:]}",
            ass_file=str(ass_path.relative_to(_project_root())),
        )
    except subprocess.TimeoutExpired:
        return DanmakuExportResult(
            ok=False,
            error_code="ASS_BURN_TIMEOUT",
            message="FFmpeg ASS burn-in timed out.",
            ass_file=str(ass_path.relative_to(_project_root())),
        )

    # Clean up intermediate clip (the final is the danmaku-burned mp4)
    clip_path.unlink(missing_ok=True)

    return DanmakuExportResult(
        ok=True,
        output_file=str(final_path.relative_to(_project_root())),
        ass_file=str(ass_path.relative_to(_project_root())),
        comment_count=ass_result.stats.used_count,
        in_range_count=ass_result.stats.in_range_count,
        skipped_ng=ass_result.stats.skipped_ng,
        skipped_too_short=ass_result.stats.skipped_too_short,
        skipped_duplicate=ass_result.stats.skipped_duplicate,
        clip_start=req.clip_start,
        clip_end=req.clip_end,
        duration_seconds=time.time() - start_ts,
    )
