"""
Danmaku export orchestrator.

Supports three sources for the video used to burn danmaku comments into:
  - "local_file":  user-provided local video file
  - "twitch_vod":  download a time range from a Twitch VOD via yt-dlp
                   --download-sections (see twitch_range_fetcher.py)
  - "ass_only":    skip video entirely; just produce the .ass file

Pipeline (local_file / twitch_vod with danmaku):
  1. Stage 1: extract the time range to a temporary MP4
  2. Stage 2: generate the ASS file from chat messages
  3. Stage 3: burn ASS into the temporary MP4

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
from typing import Literal, Optional

from app.services.danmaku_ass import (  # noqa: E402
    DanmakuOptions,
    DanmakuResult,
    DanmakuStats,
    NormalizedChatMessage,
    generate_danmaku_ass,
)
from app.services.twitch_range_fetcher import (  # noqa: E402
    TwitchRangeFetchRequest,
    TwitchRangeFetchResult,
    fetch_twitch_range,
)

ExportSource = Literal["local_file", "twitch_vod", "ass_only"]


@dataclass
class DanmakuExportRequest:
    """Parameters for a single danmaku export run."""
    source: ExportSource = "local_file"
    # For source == "local_file"
    video_path: Optional[str] = None
    # For source == "twitch_vod"
    vod_url: Optional[str] = None
    video_id: Optional[str] = None
    # Common
    chat_messages: list = field(default_factory=list)
    clip_start: float = 0.0
    clip_end: float = 0.0
    output_dir: str = "output"
    with_danmaku: bool = True
    fast: bool = False
    options: Optional[dict] = None  # DanmakuOptions kwargs


@dataclass
class DanmakuExportResult:
    ok: bool
    source: Optional[ExportSource] = None
    output_file: Optional[str] = None
    temporary_video_file: Optional[str] = None
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
    fallback: Optional[dict] = None  # e.g. {"local_file": True, "ass_only": True}
    command_preview: Optional[str] = None
    duration_seconds: float = 0.0


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _workspace_media_root() -> Path:
    return _project_root() / "media"


def _resolve_video_path(video_path: str) -> Path:
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
    source: ExportSource,
    with_danmaku: bool,
    rank: Optional[int] = None,
) -> tuple[Path, Optional[Path], Path]:
    """
    Build output paths:
      - clip:   intermediate clipped video (None for ass_only)
      - ass:    generated ASS file
      - final:  output mp4 (None for ass_only)
    """
    base = _project_root()
    out_dir = Path(output_dir)
    if not out_dir.is_absolute():
        out_dir = base / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
    suffix = "_danmaku" if with_danmaku else ""
    rank_part = f"clip_{(rank if rank is not None else ts.replace(':', '-'))}"
    if rank is not None:
        rank_part = f"clip_{rank:03d}"
    name = f"{rank_part}{suffix}_{uuid.uuid4().hex[:6]}"
    final = out_dir / f"{name}.mp4"
    ass = out_dir / f"{name}.ass"
    clip = out_dir / f"{name}.pre.mp4" if source != "ass_only" else None
    return clip, ass, final


def _ffmpeg_extract_clip(
    input_path: Path,
    output_path: Path,
    clip_start: float,
    clip_end: float,
    fast: bool,
) -> subprocess.CompletedProcess:
    duration = max(0.1, clip_end - clip_start)
    if fast:
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


def _normalize_chat(chat_messages: list) -> list:
    normalized: list = []
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
        normalized.append({
            "timestamp": float(ts),
            "time_sec": float(ts),
            "message": msg,
            "author": author if isinstance(author, str) else None,
        })
    return normalized


def export_danmaku_clip(req: DanmakuExportRequest) -> DanmakuExportResult:
    """End-to-end danmaku export. Returns a result envelope."""
    start_ts = time.time()
    source: ExportSource = req.source
    danmaku_opts = _build_danmaku_options(req.options)
    chat_objs_dicts = _normalize_chat(req.chat_messages)
    chat_objs = [
        NormalizedChatMessage(
            timestamp=m["timestamp"],
            time_sec=m["time_sec"],
            message=m["message"],
            author=m.get("author"),
        )
        for m in chat_objs_dicts
    ]

    # Build output paths. We pick a stable rank from the request metadata.
    rank = None
    # Caller can pass rank via options or chat; we use the first message's
    # anchor time as a fallback name. The actual rank is mostly cosmetic.
    # Stage 0: Resolve / fetch the source video
    source_video_abs: Optional[Path] = None
    temporary_video_rel: Optional[str] = None
    command_preview: Optional[str] = None

    if source == "local_file":
        if not req.video_path:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="LOCAL_VIDEO_REQUIRED",
                message="ローカル動画ファイルが必要です。",
            )
        try:
            source_video_abs = _resolve_video_path(req.video_path)
        except FileNotFoundError as e:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="LOCAL_VIDEO_NOT_FOUND",
                message=str(e),
                fallback={"local_file": False, "twitch_vod": True, "ass_only": True},
            )

    elif source == "twitch_vod":
        if not req.vod_url:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="VOD_URL_REQUIRED",
                message="Twitch VOD URLが必要です。",
            )
        if req.clip_end <= req.clip_start:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="INVALID_RANGE",
                message=f"end ({req.clip_end}) must be greater than start ({req.clip_start}).",
            )
        fetch_result: TwitchRangeFetchResult = fetch_twitch_range(TwitchRangeFetchRequest(
            vod_url=req.vod_url,
            video_id=req.video_id,
            start_seconds=req.clip_start,
            end_seconds=req.clip_end,
            output_dir=req.output_dir + "/tmp" if not req.output_dir.endswith("/tmp") else req.output_dir,
            format=req.options.get("format") if req.options else None,
        ))
        if not fetch_result.ok:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code=fetch_result.error_code or "TWITCH_VOD_RANGE_FETCH_FAILED",
                message=fetch_result.message or "Twitch VODから選択範囲を取得できませんでした。",
                fallback={"local_file": True, "ass_only": True},
            )
        source_video_abs = Path(fetch_result.absolute_path)
        temporary_video_rel = fetch_result.output_path
        command_preview = fetch_result.command_preview
        # When the entire range was downloaded, the clip is already at the
        # full duration — there's no further clip extraction step. We set
        # clip_start to 0 so the next stage is a no-op.
        req = DanmakuExportRequest(
            source=req.source,
            video_path=req.video_path,
            vod_url=req.vod_url,
            video_id=req.video_id,
            chat_messages=req.chat_messages,
            clip_start=0.0,
            clip_end=req.clip_end - req.clip_start,
            output_dir=req.output_dir,
            with_danmaku=req.with_danmaku,
            fast=req.fast,
            options=req.options,
        )
        # Use new (shifted) range for output naming
        clip_start_for_paths = 0.0
        clip_end_for_paths = req.clip_end
    else:  # ass_only
        if req.clip_end <= req.clip_start:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="INVALID_RANGE",
                message=f"end ({req.clip_end}) must be greater than start ({req.clip_start}).",
            )

    # ─── ASS-only fast path ─────────────────────────────────────────────────
    if source == "ass_only" or req.with_danmaku is False and source == "ass_only":
        # Generate ASS only.
        clip_path, ass_path, final_path = _build_output_paths(
            req.output_dir, source, True, rank
        )
        ass_result = generate_danmaku_ass(
            chat_messages=chat_objs,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            output_path=str(ass_path),
            options=danmaku_opts,
        )
        return DanmakuExportResult(
            ok=True,
            source=source,
            output_file=None,
            ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
            comment_count=ass_result.stats.used_count,
            in_range_count=ass_result.stats.in_range_count,
            skipped_ng=ass_result.stats.skipped_ng,
            skipped_too_short=ass_result.stats.skipped_too_short,
            skipped_duplicate=ass_result.stats.skipped_duplicate,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            duration_seconds=time.time() - start_ts,
        )

    # ─── Stage 1: extract clip (or use already-extracted temp) ───────────
    clip_path, ass_path, final_path = _build_output_paths(
        req.output_dir, source, req.with_danmaku, rank
    )

    if source == "twitch_vod":
        # The fetched file IS the clip — no need to re-extract.
        # Use it directly as the input to the burn step.
        clip_path_input = source_video_abs
    else:
        # local_file: extract a sub-clip from the source.
        try:
            _ffmpeg_extract_clip(
                input_path=source_video_abs,
                output_path=clip_path,
                clip_start=req.clip_start,
                clip_end=req.clip_end,
                fast=req.fast,
            )
        except subprocess.CalledProcessError as e:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="CLIP_EXTRACT_FAILED",
                message=f"クリップ抽出に失敗しました: {(e.stderr or '')[-500:]}",
            )
        except subprocess.TimeoutExpired:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="CLIP_EXTRACT_TIMEOUT",
                message="クリップ抽出がタイムアウトしました。",
            )
        clip_path_input = clip_path

    # ─── Without-danmaku path: return the clip as the final output ──────
    if not req.with_danmaku:
        if source == "twitch_vod":
            # The temp file IS the clip; rename it to a final name.
            final_path.write_bytes(source_video_abs.read_bytes())
        else:
            final_path.write_bytes(clip_path.read_bytes())
            clip_path.unlink(missing_ok=True)
        return DanmakuExportResult(
            ok=True,
            source=source,
            output_file=str(final_path.relative_to(_project_root())).replace("\\", "/"),
            temporary_video_file=temporary_video_rel,
            ass_file=None,
            comment_count=0,
            in_range_count=0,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            duration_seconds=time.time() - start_ts,
            command_preview=command_preview,
        )

    # ─── Stage 2: generate ASS ────────────────────────────────────────────
    ass_result = generate_danmaku_ass(
        chat_messages=chat_objs,
        clip_start=req.clip_start,
        clip_end=req.clip_end,
        output_path=str(ass_path),
        options=danmaku_opts,
    )

    # ─── Stage 3: burn ASS into clip ─────────────────────────────────────
    try:
        _ffmpeg_burn_ass(
            clip_path=clip_path_input,
            ass_path=ass_path,
            output_path=final_path,
        )
    except subprocess.CalledProcessError as e:
        return DanmakuExportResult(
            ok=False,
            source=source,
            error_code="ASS_BURN_FAILED",
            message=f"ASSの焼き込みに失敗しました: {(e.stderr or '')[-500:]}",
            temporary_video_file=temporary_video_rel,
            ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
            comment_count=ass_result.stats.used_count,
            in_range_count=ass_result.stats.in_range_count,
            skipped_ng=ass_result.stats.skipped_ng,
            skipped_too_short=ass_result.stats.skipped_too_short,
            skipped_duplicate=ass_result.stats.skipped_duplicate,
        )
    except subprocess.TimeoutExpired:
        return DanmakuExportResult(
            ok=False,
            source=source,
            error_code="ASS_BURN_TIMEOUT",
            message="ASSの焼き込みがタイムアウトしました。",
            temporary_video_file=temporary_video_rel,
            ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
            comment_count=ass_result.stats.used_count,
            in_range_count=ass_result.stats.in_range_count,
        )

    # Clean up the local-file intermediate (not the twitch temp, which is
    # already in /tmp/ and may be useful for re-export with different
    # options; we leave it for now).
    if source == "local_file":
        clip_path.unlink(missing_ok=True)

    return DanmakuExportResult(
        ok=True,
        source=source,
        output_file=str(final_path.relative_to(_project_root())).replace("\\", "/"),
        temporary_video_file=temporary_video_rel,
        ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
        comment_count=ass_result.stats.used_count,
        in_range_count=ass_result.stats.in_range_count,
        skipped_ng=ass_result.stats.skipped_ng,
        skipped_too_short=ass_result.stats.skipped_too_short,
        skipped_duplicate=ass_result.stats.skipped_duplicate,
        clip_start=req.clip_start,
        clip_end=req.clip_end,
        duration_seconds=time.time() - start_ts,
        command_preview=command_preview,
    )
