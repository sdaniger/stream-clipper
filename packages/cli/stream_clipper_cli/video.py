from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import List, Optional

from stream_clipper_cli.models import HighlightCandidate


def generate_clip(
    video_path: Path,
    output_path: Path,
    start: float,
    duration: float,
    ffmpeg_args: Optional[List[str]] = None,
) -> bool:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if not video_path.exists():
        print(f"Error: video file not found: {video_path}", file=sys.stderr)
        return False

    args = [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-ss", str(start),
        "-i", str(video_path),
        "-t", str(duration),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
    ]
    if ffmpeg_args:
        args.extend(ffmpeg_args)
    args.append(str(output_path))

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            print(f"ffmpeg error: {result.stderr.strip()}", file=sys.stderr)
            return False
        return True
    except FileNotFoundError:
        print("Error: ffmpeg not found on PATH. Install ffmpeg or use --no-clip.", file=sys.stderr)
        return False
    except subprocess.TimeoutExpired:
        print(f"Error: ffmpeg timed out for {output_path.name}", file=sys.stderr)
        return False


def generate_clips(
    highlights: List[HighlightCandidate],
    video_path: Path,
    output_dir: Path,
    ffmpeg_args: Optional[List[str]] = None,
) -> List[HighlightCandidate]:
    output_dir.mkdir(parents=True, exist_ok=True)
    results: List[HighlightCandidate] = []

    for h in highlights:
        filename = f"clip_{h.rank:03d}.mp4"
        output_path = output_dir / filename
        success = generate_clip(video_path, output_path, h.clip_start, h.clip_duration, ffmpeg_args)
        if success:
            h.output_file = str(output_path)
        results.append(h)

    return results
