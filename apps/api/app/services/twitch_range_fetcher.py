"""
Twitch VOD range fetcher.

Downloads only a selected time range from a Twitch VOD using yt-dlp's
`--download-sections` feature. The resulting file is a temporary MP4 that
the danmaku export pipeline consumes as the source for clip extraction +
ASS burn-in.

Why this exists:
- The user has the VOD URL but not the local file.
- We don't want to download the entire multi-hour VOD when we only need
  a 30s clip.
- yt-dlp natively supports `--download-sections` for partial VOD
  downloads, but it requires ffmpeg as the merge step.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class TwitchRangeFetchRequest:
    vod_url: str
    video_id: Optional[str] = None
    start_seconds: float = 0.0
    end_seconds: float = 0.0
    output_dir: str = "output/tmp"
    format: Optional[str] = None  # yt-dlp format selector
    yt_dlp_path: Optional[str] = None  # override yt-dlp binary path


@dataclass
class TwitchRangeFetchResult:
    ok: bool
    output_path: Optional[str] = None
    absolute_path: Optional[str] = None
    size_bytes: int = 0
    duration_seconds: float = 0.0
    command_preview: Optional[str] = None
    error_code: Optional[str] = None
    message: Optional[str] = None


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_workspace_tmp_dir(output_dir: str) -> Path:
    base = _project_root()
    out = Path(output_dir)
    if not out.is_absolute():
        out = base / out
    out.mkdir(parents=True, exist_ok=True)
    return out


def _seconds_to_hhmmss(seconds: float) -> str:
    safe = max(0.0, seconds)
    h = int(safe // 3600)
    m = int((safe % 3600) // 60)
    s = safe - h * 3600 - m * 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def _extract_video_id(url: str) -> Optional[str]:
    m = re.search(r"/videos?/(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]video=(\d+)", url)
    if m:
        return m.group(1)
    return None


def _which_yt_dlp(override: Optional[str]) -> str:
    if override:
        return override
    env = os.environ.get("YT_DLP_PATH")
    if env:
        return env
    return "yt-dlp"


def fetch_twitch_range(req: TwitchRangeFetchRequest) -> TwitchRangeFetchResult:
    """
    Download a time range from a Twitch VOD using yt-dlp --download-sections.

    Returns a TwitchRangeFetchResult with the path to the temporary MP4.
    """
    start_ts = time.time()

    # 1. Validate inputs
    if not req.vod_url or not req.vod_url.strip():
        return TwitchRangeFetchResult(
            ok=False,
            error_code="VOD_URL_REQUIRED",
            message="vod_url is required for Twitch VOD range fetch.",
        )
    if req.end_seconds <= req.start_seconds:
        return TwitchRangeFetchResult(
            ok=False,
            error_code="INVALID_RANGE",
            message=f"end_seconds ({req.end_seconds}) must be greater than start_seconds ({req.start_seconds}).",
        )
    if (req.end_seconds - req.start_seconds) > 30 * 60:
        return TwitchRangeFetchResult(
            ok=False,
            error_code="RANGE_TOO_LARGE",
            message="Twitch VOD range fetch is limited to 30 minutes per request.",
        )

    # 2. Resolve video_id (for filename + logging)
    video_id = req.video_id or _extract_video_id(req.vod_url)
    if not video_id:
        return TwitchRangeFetchResult(
            ok=False,
            error_code="INVALID_VOD_URL",
            message="Twitch VOD URLから video ID を抽出できませんでした。",
        )

    # 3. Build output path
    out_dir = _resolve_workspace_tmp_dir(req.output_dir)
    safe_start = int(req.start_seconds)
    safe_end = int(req.end_seconds)
    base_name = f"v{video_id}_{safe_start}_{safe_end}_{uuid.uuid4().hex[:6]}"
    out_path = out_dir / f"{base_name}.mp4"

    # 4. Build yt-dlp command
    yt_dlp = _which_yt_dlp(req.yt_dlp_path)
    fmt = (req.format or "bv*[height<=1080]+ba/best").strip()
    start_str = _seconds_to_hhmmss(req.start_seconds)
    end_str = _seconds_to_hhmmss(req.end_seconds)

    args = [
        yt_dlp,
        "--no-playlist",
        "--restrict-filenames",
        "--no-mtime",
        "-N", "8",
        "--buffer-size", "1M",
        "--http-chunk-size", "10M",
        "--merge-output-format", "mp4",
        "-f", fmt,
        "-o", str(out_path),
        "--print", "after_move:filepath",
        # Partial download: only the requested time range
        "--download-sections", f"*{start_str}-{end_str}",
        "--force-keyframes-at-cuts",
        req.vod_url,
    ]
    command_preview = f"{yt_dlp} {' '.join(_shell_quote(a) for a in args[1:])}"

    # 5. Run yt-dlp
    try:
        proc = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            timeout=15 * 60,  # 15 minutes
        )
    except FileNotFoundError:
        return TwitchRangeFetchResult(
            ok=False,
            error_code="YT_DLP_NOT_FOUND",
            message=f"yt-dlpが見つかりません: {yt_dlp}。`pip install yt-dlp`で導入するか、YT_DLP_PATH環境変数で指定してください。",
        )
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "").strip()[-1500:]
        return TwitchRangeFetchResult(
            ok=False,
            error_code="YT_DLP_FAILED",
            message=f"yt-dlp failed: {tail}",
            command_preview=command_preview,
        )
    except subprocess.TimeoutExpired:
        return TwitchRangeFetchResult(
            ok=False,
            error_code="YT_DLP_TIMEOUT",
            message="Twitch VOD range fetch timed out (15 min).",
            command_preview=command_preview,
        )

    # 6. Verify the output file exists
    actual_path_str = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else str(out_path)
    actual_path = Path(actual_path_str)
    if not actual_path.is_file():
        return TwitchRangeFetchResult(
            ok=False,
            error_code="OUTPUT_MISSING",
            message=f"yt-dlpは成功したが出力ファイルが見つかりません: {actual_path_str}",
            command_preview=command_preview,
        )

    size = actual_path.stat().st_size
    rel_path = str(actual_path.relative_to(_project_root())).replace("\\", "/")

    return TwitchRangeFetchResult(
        ok=True,
        output_path=rel_path,
        absolute_path=str(actual_path),
        size_bytes=size,
        duration_seconds=time.time() - start_ts,
        command_preview=command_preview,
    )


def _shell_quote(value: str) -> str:
    if re.match(r"^[a-zA-Z0-9_./:=+@%-]+$", value):
        return value
    return f"'{value.replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'"
