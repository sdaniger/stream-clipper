"""
Platform detection and encoder selection for FFmpeg rendering.

Detects the runtime OS and selects the appropriate video encoder, with
Android-specific fallback logic.
"""
from __future__ import annotations

import os
import platform
import subprocess
import sys
from typing import Dict, Optional


def detect_platform() -> str:
    """Returns 'android', 'linux', 'darwin', 'windows', or 'unknown'."""
    system = platform.system().lower()
    if system == "linux":
        # Android's Linux kernel reports "Linux"; check for Android-specific
        # properties (e.g. /system/build.prop or ro.build.version.sdk).
        try:
            with open("/system/build.prop", "rb") as f:
                if b"ro.build.version.sdk" in f.read(4096):
                    return "android"
        except (FileNotFoundError, IOError, PermissionError):
            pass
        # Also check the ANDROID_ROOT environment variable. The previous
        # implementation checked `"ANDROID_ROOT" in sys.platform` which is
        # always false because sys.platform is the kernel name.
        if sys.platform == "linux" and os.environ.get("ANDROID_ROOT"):
            return "android"
        return "linux"
    elif system == "darwin":
        return "darwin"
    elif system == "windows":
        return "windows"
    return "unknown"


def _check_available_encoders() -> Dict[str, bool]:
    """Check which encoders ffmpeg supports by running `ffmpeg -encoders`."""
    result: Dict[str, bool] = {}
    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=15,
        )
        out = proc.stdout
        result["h264_nvenc"] = "h264_nvenc" in out
        result["hevc_nvenc"] = "hevc_nvenc" in out
        result["h264_mediacodec"] = "h264_mediacodec" in out
        result["hevc_mediacodec"] = "hevc_mediacodec" in out
        result["h264_videotoolbox"] = "h264_videotoolbox" in out
        result["libx264"] = "libx264" in out
        result["libx265"] = "libx265" in out
    except Exception:
        pass
    return result


_PLATFORM_CACHE: Optional[str] = None
_ENCODER_CACHE: Optional[Dict[str, bool]] = None


def get_platform() -> str:
    global _PLATFORM_CACHE
    if _PLATFORM_CACHE is None:
        _PLATFORM_CACHE = detect_platform()
    return _PLATFORM_CACHE


def get_available_encoders() -> Dict[str, bool]:
    global _ENCODER_CACHE
    if _ENCODER_CACHE is None:
        _ENCODER_CACHE = _check_available_encoders()
    return _ENCODER_CACHE


def select_video_encoder(
    prefer_nvenc: bool = False,
    prefer_mediacodec: bool = False,
) -> str:
    """
    Select the best video encoder for the current platform.

    Priority (highest first):
      1. User-explicit preference: prefer_nvenc or prefer_mediacodec
      2. On Android (experimental): h264_mediacodec / hevc_mediacodec
      3. On desktop with NVIDIA: h264_nvenc (only if prefer_nvenc=True)
      4. libx264 (always available, stable for ASS burn-in)

    For ASS/comment burn-in, libx264 is always recommended as the
    safest choice (no GPU encoding quirks with overlay filters).
    """
    platform_name = get_platform()
    encoders = get_available_encoders()

    # Android: force libx264 by default. Only use MediaCodec if explicitly
    # opted in, and never for ASS burn-in.
    if platform_name == "android":
        if prefer_mediacodec and encoders.get("h264_mediacodec"):
            return "h264_mediacodec"
        return "libx264"

    # macOS: VideoToolbox is available but has filter limitations
    if platform_name == "darwin":
        if prefer_nvenc and encoders.get("h264_videotoolbox"):
            return "h264_videotoolbox"
        return "libx264"

    # Linux / Windows desktop:
    if prefer_nvenc and encoders.get("h264_nvenc"):
        return "h264_nvenc"
    if prefer_mediacodec and encoders.get("h264_mediacodec"):
        return "h264_mediacodec"

    return "libx264"


def is_android() -> bool:
    return get_platform() == "android"


def nvenc_disabled_reason() -> Optional[str]:
    """
    Return a user-facing message if h264_nvenc cannot be used on this platform.
    """
    p = get_platform()
    if p == "android":
        return "AndroidではNVIDIA NVENCは利用できません。CPUエンコード libx264 に切り替えてください。"
    if p == "darwin":
        return "macOSではNVIDIA NVENCは利用できません。CPUエンコード libx264 を使用します。"
    encoders = get_available_encoders()
    if not encoders.get("h264_nvenc"):
        return "NVIDIA NVENCエンコーダーが見つかりません。CPUエンコード libx264 を使用します。"
    return None
