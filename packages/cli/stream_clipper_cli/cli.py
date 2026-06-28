from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

from stream_clipper_cli.analyzer import analyze_highlights, load_chat
from stream_clipper_cli.exporter import print_summary, write_csv, write_json
from stream_clipper_cli.scorer import DEFAULT_KEYWORDS, DEFAULT_KEYWORD_WEIGHT
from stream_clipper_cli.video import generate_clips


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stream-clipper-cli",
        description="Livestream highlight detection and clipping tool",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- analyze subcommand ---
    analyze = sub.add_parser("analyze", help="Analyze chat log for highlights")
    analyze.add_argument("chat_log", type=str, help="Path to chat log file (.json or .csv)")
    analyze.add_argument("--top", type=int, default=5, help="Number of top highlights to extract (default: 5)")
    analyze.add_argument("--keywords", type=str, default=None,
                         help=f"Comma-separated keywords (default: {','.join(DEFAULT_KEYWORDS)})")
    analyze.add_argument("--keyword-weight", type=float, default=DEFAULT_KEYWORD_WEIGHT,
                         help=f"Keyword hit weight in score (default: {DEFAULT_KEYWORD_WEIGHT})")
    analyze.add_argument("--min-gap", type=float, default=30.0,
                         help="Minimum gap between peak centers (seconds, default: 30)")
    analyze.add_argument("--window", type=int, default=30,
                         help="Time bucket window size (seconds, default: 30)")
    analyze.add_argument("--output-json", type=str, default=None,
                         help="Output JSON file path for highlight candidates")
    analyze.add_argument("--output-csv", type=str, default=None,
                         help="Output CSV file path for timeline data")

    # --- clip subcommand ---
    clip = sub.add_parser("clip", help="Analyze and generate video clips")
    clip.add_argument("video", type=str, help="Path to video file (mp4, etc.)")
    clip.add_argument("chat_log", type=str, help="Path to chat log file (.json or .csv)")
    clip.add_argument("--top", type=int, default=5, help="Number of top highlights to clip (default: 5)")
    clip.add_argument("--keywords", type=str, default=None,
                      help=f"Comma-separated keywords (default: {','.join(DEFAULT_KEYWORDS)})")
    clip.add_argument("--keyword-weight", type=float, default=DEFAULT_KEYWORD_WEIGHT,
                      help=f"Keyword hit weight in score (default: {DEFAULT_KEYWORD_WEIGHT})")
    clip.add_argument("--min-gap", type=float, default=30.0,
                      help="Minimum gap between peak centers (seconds, default: 30)")
    clip.add_argument("--window", type=int, default=30,
                      help="Time bucket window size (seconds, default: 30)")
    clip.add_argument("--clip-duration", type=float, default=30.0,
                      help="Max clip duration in seconds (default: 30)")
    clip.add_argument("--clip-padding", type=float, default=5.0,
                      help="Seconds of context before/after highlight (default: 5)")
    clip.add_argument("--no-clip", action="store_true",
                      help="Skip video clip generation, only output analysis")
    clip.add_argument("--output-dir", type=str, default="output",
                      help="Output directory for clips (default: output/)")
    clip.add_argument("--output-json", type=str, default=None,
                      help="Output JSON file path for highlight candidates")
    clip.add_argument("--output-csv", type=str, default=None,
                      help="Output CSV file path for timeline data")
    clip.add_argument("--ffmpeg-args", type=str, default=None,
                      help="Additional ffmpeg arguments (e.g. '--ffmpeg-args=-preset fast')")

    return parser


def parse_keywords(raw: Optional[str]) -> List[str]:
    if raw is None:
        return DEFAULT_KEYWORDS
    return [kw.strip() for kw in raw.split(",") if kw.strip()]


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    keywords = parse_keywords(args.keywords)

    if args.command == "analyze":
        return cmd_analyze(args, keywords)
    elif args.command == "clip":
        return cmd_clip(args, keywords)
    else:
        parser.print_help()
        return 1


def cmd_analyze(args: argparse.Namespace, keywords: List[str]) -> int:
    chat_path = Path(args.chat_log)
    if not chat_path.exists():
        print(f"Error: chat log not found: {chat_path}", file=sys.stderr)
        return 1

    try:
        chat_entries = load_chat(chat_path)
    except Exception as e:
        print(f"Error loading chat log: {e}", file=sys.stderr)
        return 1

    if not chat_entries:
        print("Warning: chat log is empty", file=sys.stderr)
        return 0

    highlights, timeline = analyze_highlights(
        chat_entries,
        top_n=args.top,
        keywords=keywords,
        keyword_weight=args.keyword_weight,
        min_gap=args.min_gap,
        window_seconds=args.window,
    )

    print_summary(highlights)

    if args.output_json:
        json_path = Path(args.output_json)
        write_json(highlights, json_path)
        print(f"Wrote highlights JSON → {json_path}")

    if args.output_csv:
        csv_path = Path(args.output_csv)
        write_csv(timeline, csv_path)
        print(f"Wrote timeline CSV → {csv_path}")

    return 0


def cmd_clip(args: argparse.Namespace, keywords: List[str]) -> int:
    video_path = Path(args.video)
    if not video_path.exists():
        print(f"Error: video file not found: {video_path}", file=sys.stderr)
        return 1

    chat_path = Path(args.chat_log)
    if not chat_path.exists():
        print(f"Error: chat log not found: {chat_path}", file=sys.stderr)
        return 1

    try:
        chat_entries = load_chat(chat_path)
    except Exception as e:
        print(f"Error loading chat log: {e}", file=sys.stderr)
        return 1

    if not chat_entries:
        print("Warning: chat log is empty", file=sys.stderr)
        return 0

    highlights, timeline = analyze_highlights(
        chat_entries,
        top_n=args.top,
        keywords=keywords,
        keyword_weight=args.keyword_weight,
        min_gap=args.min_gap,
        window_seconds=args.window,
        clip_duration=args.clip_duration,
        clip_padding=args.clip_padding,
    )

    print_summary(highlights)

    if args.output_json:
        json_path = Path(args.output_json)
        write_json(highlights, json_path)
        print(f"Wrote highlights JSON → {json_path}")

    if args.output_csv:
        csv_path = Path(args.output_csv)
        write_csv(timeline, csv_path)
        print(f"Wrote timeline CSV → {csv_path}")

    if not args.no_clip:
        output_dir = Path(args.output_dir)

        ffmpeg_args: Optional[List[str]] = None
        if args.ffmpeg_args:
            ffmpeg_args = args.ffmpeg_args.split()

        print(f"Generating clips in {output_dir}/ ...")
        generate_clips(highlights, video_path, output_dir, ffmpeg_args)

        clip_count = sum(1 for h in highlights if h.output_file is not None)
        print(f"Generated {clip_count}/{len(highlights)} clip(s)")
    else:
        print("Skipped clip generation (--no-clip)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
