"""
Danmaku export orchestrator.

Supports three sources for the video used to burn danmaku comments into:
  - "local_file":  user-provided local video file
  - "twitch_vod":  download a time range from a Twitch VOD via yt-dlp
                   --download-sections (see twitch_range_fetcher.py)
  - "ass_only":    skip video entirely; just produce the .ass file

Pipeline (local_file / twitch_vod with danmaku):
  - For local_file with a single FFmpeg pass: extract + burn-in in one
    command (no intermediate pre-clip.mp4).
  - For twitch_vod: yt-dlp has already produced a clip-sized MP4 (since
    --download-sections returns the range), so we just burn ASS in.
  - For ass_only: skip video, generate the .ass only.

All comments within the selected range are emitted as ASS Dialogue lines.
No per-stream cap is applied; an opt-in `safety_comment_limit` exists
for runaway cases.
"""
from __future__ import annotations

import hashlib
import os
import shutil
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
from app.services.platform_utils import is_android, select_video_encoder  # noqa: E402
from app.services.twitch_range_fetcher import (  # noqa: E402
    TwitchRangeFetchRequest,
    TwitchRangeFetchResult,
    fetch_twitch_range,
)

ExportSource = Literal["local_file", "twitch_vod", "ass_only"]

# FFmpeg encoder presets. (preset, crf). Higher crf = smaller file, lower quality.
FFMPEG_PRESETS = {
    "ultrafast": 26,
    "veryfast":  23,
    "fast":      22,
    "medium":    20,
    "slow":      18,
}


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
    options: Optional[dict] = None  # DanmakuOptions kwargs + ffmpeg knobs


@dataclass
class DanmakuExportResult:
    ok: bool
    source: Optional[ExportSource] = None
    output_file: Optional[str] = None
    temporary_video_file: Optional[str] = None
    ass_file: Optional[str] = None
    range_comment_count: int = 0
    burned_comment_count: int = 0
    in_range_count: int = 0
    skipped_ng: int = 0
    skipped_too_short: int = 0
    skipped_duplicate: int = 0
    skipped_safety_limit: int = 0
    all_comments: bool = True
    clip_start: float = 0.0
    clip_end: float = 0.0
    error_code: Optional[str] = None
    message: Optional[str] = None
    fallback: Optional[dict] = None
    command_preview: Optional[str] = None
    duration_seconds: float = 0.0
    ffmpeg_preset: Optional[str] = None
    ffmpeg_crf: Optional[int] = None
    ass_cache_hit: bool = False
    temp_video_cache_hit: bool = False


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _fonts_dir() -> Path:
    return _project_root() / "assets" / "fonts"


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
) -> tuple[Optional[Path], Path, Path]:
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


def _ass_cache_key(chat_objs: list, clip_start: float, clip_end: float, options: dict) -> str:
    """Stable cache key for the ASS file based on input + visual options."""
    parts = [
        f"s={clip_start:.6f}",
        f"e={clip_end:.6f}",
        f"n={len(chat_objs)}",
        f"first={chat_objs[0].time_sec if chat_objs else 0}",
        f"last={chat_objs[-1].time_sec if chat_objs else 0}",
        f"d={options.get('density','medium')}",
        f"f={options.get('font_size',32)}",
        f"cd={options.get('comment_duration',4.0)}",
        f"o={options.get('opacity',0.9)}",
        f"fn={options.get('font_name','Noto Sans CJK JP')}",
        f"sl={options.get('safety_comment_limit','')}",
        f"dd={options.get('deduplicate_consecutive',True)}",
        f"ml={options.get('min_message_length',1)}",
    ]
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return h


def _resolve_preset_crf(options: Optional[dict]) -> tuple[str, int]:
    """Pick (preset, crf) from options with sensible defaults."""
    if not options:
        return "veryfast", 23
    p = options.get("preset") or "veryfast"
    if p not in FFMPEG_PRESETS:
        p = "veryfast"
    crf_opt = options.get("crf")
    if crf_opt is not None:
        try:
            crf = int(crf_opt)
            crf = max(15, min(35, crf))
        except (TypeError, ValueError):
            crf = FFMPEG_PRESETS[p]
    else:
        crf = FFMPEG_PRESETS[p]
    return p, crf


def _ffmpeg_extract_clip_onepass(
    input_path: Path,
    output_path: Path,
    clip_start: float,
    clip_end: float,
    ass_path: Optional[Path],
    preset: str,
    crf: int,
) -> subprocess.CompletedProcess:
    """
    Single-pass FFmpeg: seek to clip_start, run for clip_end-clip_start
    seconds, optionally apply an ASS filter, encode to H.264.
    This avoids the round-trip of extracting then re-encoding.
    """
    duration = max(0.1, clip_end - clip_start)
    args = [
        "ffmpeg", "-y",
        "-ss", f"{clip_start:.3f}",
        "-i", str(input_path),
        "-t", f"{duration:.3f}",
    ]
    if ass_path is not None:
        ass_filter_value = str(ass_path).replace("\\", "/").replace(":", "\\:")
        fd = _fonts_dir()
        if fd.is_dir():
            fd_escaped = str(fd.resolve()).replace("\\", "/").replace(":", "\\:")
            ass_filter_value += f":fontsdir={fd_escaped}"
        args.extend(["-vf", f"ass={ass_filter_value}"])
        args.extend(["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-c:a", "copy"])
    else:
        args.extend(["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-c:a", "aac", "-b:a", "128k"])
    args.extend(["-movflags", "+faststart", str(output_path)])
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
        timeout=900,
    )


def _ass_filter_with_fontsdir(ass_path: Path) -> str:
    """Build ass= filter value with fontsdir if available."""
    ass_filter_value = str(ass_path).replace("\\", "/").replace(":", "\\:")
    fd = _fonts_dir()
    if fd.is_dir():
        fd_escaped = str(fd.resolve()).replace("\\", "/").replace(":", "\\:")
        ass_filter_value += f":fontsdir={fd_escaped}"
    return ass_filter_value


def _ffmpeg_burn_ass(
    clip_path: Path,
    ass_path: Path,
    output_path: Path,
    preset: str,
    crf: int,
) -> subprocess.CompletedProcess:
    """Burn ASS into a pre-extracted clip."""
    ass_filter_value = _ass_filter_with_fontsdir(ass_path)
    cmd = [
        "ffmpeg", "-y",
        "-i", str(clip_path),
        "-vf", f"ass={ass_filter_value}",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf),
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
    safety = options.get("safety_comment_limit")
    return DanmakuOptions(
        play_res_x=int(options.get("play_res_x", 1920)),
        play_res_y=int(options.get("play_res_y", 1080)),
        font_name=options.get("font_name", "Noto Sans CJK JP"),
        font_size=int(options.get("font_size", 36)),
        comment_duration=float(options.get("comment_duration", 4.0)),
        opacity=float(options.get("opacity", 0.9)),
        outline=int(options.get("outline", 2)),
        shadow=int(options.get("shadow", 1)),
        density=options.get("density", "medium"),
        style_preset=options.get("style_preset"),
        max_lanes=options.get("max_lanes"),
        max_comments_per_second=options.get("max_comments_per_second"),
        lane_height=options.get("lane_height"),
        lane_fraction=options.get("lane_fraction"),
        top_margin=options.get("top_margin"),
        bottom_margin=options.get("bottom_margin"),
        horizontal_padding=options.get("horizontal_padding"),
        long_comment_scale=options.get("long_comment_scale"),
        emoji_only_scale=options.get("emoji_only_scale"),
        filter_urls=bool(options.get("filter_urls", True)),
        filter_repeated_by_user=bool(options.get("filter_repeated_by_user", True)),
        emoji_spam_limit=options.get("emoji_spam_limit", 10),
        repeated_user_window_sec=float(options.get("repeated_user_window_sec", 3.0)),
        ng_words=tuple(ng_words),
        min_message_length=int(options.get("min_message_length", 1)),
        deduplicate_consecutive=bool(options.get("deduplicate_consecutive", True)),
        safety_comment_limit=int(safety) if safety is not None else None,
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


def _temp_video_path_for(video_id: str, start: float, end: float) -> Path:
    """Stable path for the cached range MP4."""
    base = _project_root() / "media" / "output" / "tmp"
    base.mkdir(parents=True, exist_ok=True)
    safe_id = (video_id or "video").replace("/", "_")
    return base / f"v{safe_id}_{int(start)}_{int(end)}.mp4"


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

    preset, crf = _resolve_preset_crf(req.options)
    reuse_temp = bool((req.options or {}).get("reuse_temp_clip", True))
    reuse_ass = bool((req.options or {}).get("reuse_ass", False))

    rank = None
    source_video_abs: Optional[Path] = None
    temporary_video_rel: Optional[str] = None
    command_preview: Optional[str] = None
    temp_video_cache_hit = False

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
        # Try the temp-clip cache first
        cached_path = _temp_video_path_for(
            req.video_id or "video", req.clip_start, req.clip_end
        )
        if reuse_temp and cached_path.is_file() and cached_path.stat().st_size > 0:
            source_video_abs = cached_path
            temporary_video_rel = str(cached_path.relative_to(_project_root())).replace("\\", "/")
            temp_video_cache_hit = True
        else:
            fetch_result: TwitchRangeFetchResult = fetch_twitch_range(TwitchRangeFetchRequest(
                vod_url=req.vod_url,
                video_id=req.video_id,
                start_seconds=req.clip_start,
                end_seconds=req.clip_end,
                output_dir=str(cached_path.parent.relative_to(_project_root())),
                format=(req.options or {}).get("format"),
            ))
            if not fetch_result.ok:
                return DanmakuExportResult(
                    ok=False,
                    source=source,
                    error_code=fetch_result.error_code or "TWITCH_VOD_RANGE_FETCH_FAILED",
                    message=fetch_result.message or "Twitch VODから選択範囲を取得できませんでした。",
                    fallback={"local_file": True, "ass_only": True},
                )
            # The fetcher already writes to the cached path; if it returned
            # a different path (e.g. fallback), use that.
            source_video_abs = Path(fetch_result.absolute_path)
            temporary_video_rel = fetch_result.output_path
            command_preview = fetch_result.command_preview
        # The fetched file IS the full range — clip_start becomes 0 for
        # the subsequent ASS burn-in stage.
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

    else:  # ass_only
        if req.clip_end <= req.clip_start:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="INVALID_RANGE",
                message=f"end ({req.clip_end}) must be greater than start ({req.clip_start}).",
            )

    # ─── ASS-only fast path ─────────────────────────────────────────────────
    if source == "ass_only":
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
            range_comment_count=ass_result.stats.in_range_count,
            burned_comment_count=ass_result.stats.used_count,
            in_range_count=ass_result.stats.in_range_count,
            skipped_ng=ass_result.stats.skipped_ng,
            skipped_too_short=ass_result.stats.skipped_too_short,
            skipped_duplicate=ass_result.stats.skipped_duplicate,
            skipped_safety_limit=ass_result.stats.skipped_safety_limit,
            all_comments=danmaku_opts.safety_comment_limit is None,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            duration_seconds=time.time() - start_ts,
            ffmpeg_preset=None,
            ffmpeg_crf=None,
        )

    # ─── Generate ASS (with optional cache) ─────────────────────────────────
    ass_path_existing = None
    ass_cache_hit = False
    if reuse_ass and req.options is not None:
        ass_cache_hash = _ass_cache_key(
            chat_objs_dicts, req.clip_start, req.clip_end, req.options
        )
        ass_cache_dir = _project_root() / "media" / "output" / "ass_cache"
        ass_cache_dir.mkdir(parents=True, exist_ok=True)
        ass_path_existing = ass_cache_dir / f"ass_{ass_cache_hash}.ass"
        if ass_path_existing.is_file() and ass_path_existing.stat().st_size > 0:
            ass_cache_hit = True

    if ass_cache_hit and ass_path_existing is not None:
        # Copy the cached ASS into our final ASS path
        clip_path, ass_path, final_path = _build_output_paths(
            req.output_dir, source, req.with_danmaku, rank
        )
        ass_path.parent.mkdir(parents=True, exist_ok=True)
        ass_path.write_bytes(ass_path_existing.read_bytes())
        # Synthesize stats: ASS is opaque here, but we know all in-range are emitted
        in_range_count = sum(
            1 for m in chat_objs
            if req.clip_start <= m.time_sec <= req.clip_end
        )
        ass_stats = DanmakuStats(
            in_range_count=in_range_count,
            used_count=in_range_count,
            skipped_ng=0,
            skipped_too_short=0,
            skipped_duplicate=0,
        )
    else:
        clip_path, ass_path, final_path = _build_output_paths(
            req.output_dir, source, req.with_danmaku, rank
        )
        ass_result = generate_danmaku_ass(
            chat_messages=chat_objs,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            output_path=str(ass_path),
            options=danmaku_opts,
        )
        ass_stats = ass_result.stats
        # Save to ASS cache for future reuse
        if reuse_ass and req.options is not None:
            try:
                ass_cache_hash = _ass_cache_key(
                    chat_objs_dicts, req.clip_start, req.clip_end, req.options
                )
                ass_cache_dir = _project_root() / "media" / "output" / "ass_cache"
                ass_cache_dir.mkdir(parents=True, exist_ok=True)
                ass_cache_path = ass_cache_dir / f"ass_{ass_cache_hash}.ass"
                if not ass_cache_path.exists():
                    ass_cache_path.write_bytes(ass_path.read_bytes())
            except Exception:
                pass

    # ─── Without-danmaku path: return the clip as the final output ──────
    if not req.with_danmaku:
        if source == "twitch_vod":
            # Stream-copy to avoid loading the entire source video into
            # memory. shutil.copy2 uses sendfile/copy_file_range when
            # available and is safe for multi-GB files.
            shutil.copy2(source_video_abs, final_path)
        else:
            try:
                _ffmpeg_extract_clip_onepass(
                    input_path=source_video_abs,
                    output_path=final_path,
                    clip_start=req.clip_start,
                    clip_end=req.clip_end,
                    ass_path=None,
                    preset=preset,
                    crf=crf,
                )
            except subprocess.CalledProcessError as e:
                return DanmakuExportResult(
                    ok=False,
                    source=source,
                    error_code="CLIP_EXTRACT_FAILED",
                    message=f"クリップ抽出に失敗しました: {(e.stderr or '')[-500:]}",
                    ffmpeg_preset=preset,
                    ffmpeg_crf=crf,
                )
        # Clean up the local_file intermediate if it was created
        if clip_path is not None and source == "local_file":
            clip_path.unlink(missing_ok=True)
        return DanmakuExportResult(
            ok=True,
            source=source,
            output_file=str(final_path.relative_to(_project_root())).replace("\\", "/"),
            temporary_video_file=temporary_video_rel,
            ass_file=None,
            range_comment_count=ass_stats.in_range_count,
            burned_comment_count=0,
            clip_start=req.clip_start,
            clip_end=req.clip_end,
            duration_seconds=time.time() - start_ts,
            ffmpeg_preset=preset,
            ffmpeg_crf=crf,
            temp_video_cache_hit=temp_video_cache_hit,
        )

    # ─── Burn ASS into the source video ──────────────────────────────────
    if source == "twitch_vod":
        # Single-pass: burn ASS into the already-fetched range clip.
        burn_input = source_video_abs
        try:
            _ffmpeg_extract_clip_onepass(
                input_path=burn_input,
                output_path=final_path,
                clip_start=0.0,
                clip_end=req.clip_end,
                ass_path=ass_path,
                preset=preset,
                crf=crf,
            )
        except subprocess.CalledProcessError as e:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="ASS_BURN_FAILED",
                message=f"ASSの焼き込みに失敗しました: {(e.stderr or '')[-500:]}",
                temporary_video_file=temporary_video_rel,
                ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
                range_comment_count=ass_stats.in_range_count,
                burned_comment_count=ass_stats.used_count,
                ffmpeg_preset=preset,
                ffmpeg_crf=crf,
            )
    else:
        # local_file: single-pass extract + burn-in to skip the intermediate file.
        try:
            _ffmpeg_extract_clip_onepass(
                input_path=source_video_abs,
                output_path=final_path,
                clip_start=req.clip_start,
                clip_end=req.clip_end,
                ass_path=ass_path,
                preset=preset,
                crf=crf,
            )
        except subprocess.CalledProcessError as e:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="ASS_BURN_FAILED",
                message=f"ASSの焼き込みに失敗しました: {(e.stderr or '')[-500:]}",
                ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
                range_comment_count=ass_stats.in_range_count,
                burned_comment_count=ass_stats.used_count,
                ffmpeg_preset=preset,
                ffmpeg_crf=crf,
            )
        except subprocess.TimeoutExpired:
            return DanmakuExportResult(
                ok=False,
                source=source,
                error_code="ASS_BURN_TIMEOUT",
                message="ASSの焼き込みがタイムアウトしました。",
                ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
                range_comment_count=ass_stats.in_range_count,
                burned_comment_count=ass_stats.used_count,
                ffmpeg_preset=preset,
                ffmpeg_crf=crf,
            )

    if clip_path is not None and source == "local_file":
        clip_path.unlink(missing_ok=True)

    return DanmakuExportResult(
        ok=True,
        source=source,
        output_file=str(final_path.relative_to(_project_root())).replace("\\", "/"),
        temporary_video_file=temporary_video_rel,
        ass_file=str(ass_path.relative_to(_project_root())).replace("\\", "/"),
        range_comment_count=ass_stats.in_range_count,
        burned_comment_count=ass_stats.used_count,
        in_range_count=ass_stats.in_range_count,
        skipped_ng=ass_stats.skipped_ng,
        skipped_too_short=ass_stats.skipped_too_short,
        skipped_duplicate=ass_stats.skipped_duplicate,
        skipped_safety_limit=ass_stats.skipped_safety_limit,
        all_comments=danmaku_opts.safety_comment_limit is None,
        clip_start=req.clip_start,
        clip_end=req.clip_end,
        duration_seconds=time.time() - start_ts,
        ffmpeg_preset=preset,
        ffmpeg_crf=crf,
        command_preview=command_preview,
        ass_cache_hit=ass_cache_hit,
        temp_video_cache_hit=temp_video_cache_hit,
    )
