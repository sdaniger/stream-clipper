"""
Analyze-job orchestrator.

Implements the analyze pipeline as a sequence of well-defined stages
and writes progress to the JobState. The pipeline:

  1. metadata_fetching    - resolve VOD metadata (via yt-dlp)
  2. chat_fetching        - fetch chat (via chat-downloader or pre-loaded JSON)
  3. chat_normalizing     - normalize into the standard message shape
  4. timeline_scoring     - sliding-window scoring
  5. candidate_generation - short / medium / long candidates

Cancels gracefully when the job's cancelled flag is set.
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.job_state import (
    ANALYZE_STAGE_WEIGHTS,
    JobStage,
    JobState,
    compute_stage_progress,
    mark_failed,
    update_stage,
)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _resolve_workspace_path(p: str) -> Path:
    base = _project_root()
    pp = Path(p)
    if pp.is_absolute():
        return pp
    return base / pp


def _extract_video_id(url: str) -> Optional[str]:
    m = re.search(r"/videos?/(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]video=(\d+)", url)
    if m:
        return m.group(1)
    return None


def _yt_dlp_metadata(url: str) -> Dict[str, Any]:
    """
    Fetch VOD metadata via yt-dlp. Uses --dump-single-json for a single JSON
    object describing the VOD. Falls back to a minimal stub if yt-dlp is
    not available.
    """
    try:
        proc = subprocess.run(
            ["yt-dlp", "--no-playlist", "--skip-download", "-J", url],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except FileNotFoundError:
        return {"ok": False, "error_code": "YT_DLP_NOT_FOUND"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error_code": "YT_DLP_TIMEOUT"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error_code": "YT_DLP_FAILED",
            "stderr": proc.stderr.strip()[-500:],
        }
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {"ok": False, "error_code": "YT_DLP_PARSE_FAILED", "error": str(e)}
    return {
        "ok": True,
        "video_id": str(data.get("id") or _extract_video_id(url) or ""),
        "title": data.get("title"),
        "duration_seconds": data.get("duration"),
        "uploader": data.get("uploader") or data.get("channel"),
        "thumbnail": data.get("thumbnail"),
    }


def _fetch_chat_with_chat_downloader(
    url: str,
    max_messages: int,
    on_progress=None,
) -> Dict[str, Any]:
    """
    Fetch chat with chat-downloader. Runs the `chat_downloader` CLI
    (`python -m chat_downloader`) and parses its JSON-line stdout.
    """
    # Resolve python
    candidates = [
        "chat_downloader",
    ]
    last_err = ""
    for cmd in candidates:
        try:
            proc = subprocess.Popen(
                [cmd, url, "--max-messages", str(max_messages), "-f", "json"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            messages: List[Dict[str, Any]] = []
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = item.get("timestamp")
                author = (
                    item.get("author", {}).get("name")
                    if isinstance(item.get("author"), dict)
                    else item.get("author")
                )
                msg = item.get("message")
                if ts is None or msg is None:
                    continue
                messages.append({
                    "timestamp": float(ts),
                    "author": str(author) if author else "",
                    "message": str(msg),
                })
                if on_progress and len(messages) % 200 == 0:
                    on_progress(len(messages))
            proc.wait(timeout=30)
            if proc.returncode != 0:
                last_err = (proc.stderr.read() if proc.stderr else "").strip()[-500:]
                continue
            return {"ok": True, "messages": messages}
        except FileNotFoundError:
            continue
        except Exception as e:
            last_err = str(e)
            continue
    return {"ok": False, "error_code": "CHAT_DOWNLOADER_FAILED", "message": last_err or "unknown"}


# ─── Public entry point ──────────────────────────────────────────────────────

def run_analyze_job(
    job: JobState,
    *,
    vod_url: Optional[str] = None,
    chat_data: Optional[List[Dict[str, Any]]] = None,
    preloaded_timeline: Optional[Dict[str, Any]] = None,
    window: int = 30,
    step: int = 10,
    top_short: int = 5,
    top_medium: int = 5,
    top_long: int = 3,
    min_score: float = 0.0,
    custom_keywords: Optional[List[str]] = None,
    scoring_weights: Optional[Dict[str, float]] = None,
) -> None:
    """
    Run the analyze pipeline synchronously, updating the job state.
    """
    try:
        # Lazy import CLI core
        from stream_clipper_cli.timeline_scoring import build_timeline_from_dicts, ChatMessage
        from stream_clipper_cli.candidate_pipeline import (
            generate_all_candidates, Candidate,
        )
        from stream_clipper_cli.youtube_metadata import build_youtube_metadata
    except Exception as e:  # pragma: no cover
        mark_failed(job, "CLI_IMPORT_FAILED", f"Failed to import stream_clipper_cli: {e}")
        return

    update_stage(job, JobStage.METADATA_FETCHING, "VOD metadata を取得中...", compute_stage_progress(JobStage.METADATA_FETCHING, 0.1))
    metadata: Dict[str, Any] = {"ok": False}
    if vod_url:
        video_id = _extract_video_id(vod_url) or ""
        meta = _yt_dlp_metadata(vod_url)
        if meta.get("ok"):
            metadata = meta
            update_stage(
                job, JobStage.METADATA_FETCHING,
                f"VOD: {meta.get('title') or video_id}",
                compute_stage_progress(JobStage.METADATA_FETCHING, 1.0),
                result_patch={"vod_url": vod_url, "video_id": meta.get("video_id") or video_id, "metadata": meta},
            )
        else:
            # Fall back to id-only
            metadata = {
                "ok": True,
                "video_id": video_id,
                "title": video_id or "Unknown VOD",
                "duration_seconds": None,
                "uploader": None,
                "warning": meta.get("error_code"),
            }
            update_stage(
                job, JobStage.METADATA_FETCHING,
                f"Metadata limited (yt-dlp {meta.get('error_code')})",
                compute_stage_progress(JobStage.METADATA_FETCHING, 1.0),
                result_patch={"vod_url": vod_url, "video_id": video_id, "metadata": metadata},
            )
    else:
        # No URL; use chat_data
        metadata = {
            "ok": True,
            "video_id": "",
            "title": "Local VOD",
            "duration_seconds": None,
        }
        update_stage(
            job, JobStage.METADATA_FETCHING,
            "Skipped (no VOD URL)",
            compute_stage_progress(JobStage.METADATA_FETCHING, 1.0),
            result_patch={"metadata": metadata},
        )

    if job.cancelled:
        return

    # ── 2. chat_fetching ────────────────────────────────────────────────
    update_stage(
        job, JobStage.CHAT_FETCHING, "チャット取得中...",
        compute_stage_progress(JobStage.CHAT_FETCHING, 0.0),
    )
    raw_chat: List[Dict[str, Any]] = []
    if chat_data:
        raw_chat = list(chat_data)
        update_stage(
            job, JobStage.CHAT_FETCHING, f"Inline chat: {len(raw_chat)} messages",
            compute_stage_progress(JobStage.CHAT_FETCHING, 1.0),
            result_patch={"chat_count": len(raw_chat)},
        )
    elif vod_url:
        max_messages = 50000
        result = _fetch_chat_with_chat_downloader(
            vod_url, max_messages,
            on_progress=lambda n: update_stage(
                job, JobStage.CHAT_FETCHING,
                f"チャット取得中: {n} messages",
                compute_stage_progress(JobStage.CHAT_FETCHING, min(0.95, n / max_messages)),
            ),
        )
        if not result.get("ok"):
            mark_failed(
                job,
                result.get("error_code", "CHAT_FETCH_FAILED"),
                result.get("message", "Chat fetch failed"),
            )
            return
        raw_chat = result["messages"]
        update_stage(
            job, JobStage.CHAT_FETCHING,
            f"Chat loaded: {len(raw_chat)} messages",
            compute_stage_progress(JobStage.CHAT_FETCHING, 1.0),
            result_patch={"chat_count": len(raw_chat)},
        )
    else:
        mark_failed(job, "NO_CHAT_SOURCE", "No chat_data or vod_url provided")
        return

    if job.cancelled:
        return

    # ── 3. chat_normalizing ─────────────────────────────────────────────
    update_stage(
        job, JobStage.CHAT_NORMALIZING, "チャット正規化中...",
        compute_stage_progress(JobStage.CHAT_NORMALIZING, 0.5),
    )
    normalized: List[Dict[str, Any]] = []
    for entry in raw_chat:
        if not isinstance(entry, dict):
            continue
        ts = entry.get("timestamp") or entry.get("time") or entry.get("time_sec")
        try:
            ts = float(ts)
        except (TypeError, ValueError):
            continue
        if ts < 0:
            continue
        msg = entry.get("message") or entry.get("text") or entry.get("body") or ""
        if not isinstance(msg, str) or not msg.strip():
            continue
        author = entry.get("author") or entry.get("user") or entry.get("author_name") or ""
        normalized.append({
            "timestamp": ts,
            "time_sec": ts,
            "author": str(author),
            "message": msg.strip(),
        })
    if not normalized:
        mark_failed(job, "EMPTY_CHAT", "正規化後のチャットが空です")
        return
    update_stage(
        job, JobStage.CHAT_NORMALIZING,
        f"正規化: {len(normalized)} messages",
        compute_stage_progress(JobStage.CHAT_NORMALIZING, 1.0),
        result_patch={"normalized_chat_count": len(normalized)},
    )

    if job.cancelled:
        return

    # ── 4. timeline_scoring ────────────────────────────────────────────
    update_stage(
        job, JobStage.TIMELINE_SCORING,
        "タイムラインを構築中...",
        compute_stage_progress(JobStage.TIMELINE_SCORING, 0.2),
    )
    try:
        timeline = build_timeline_from_dicts(
            normalized, window=window, step=step,
            weights=scoring_weights,
            custom_keywords=custom_keywords,
        )
    except Exception as e:
        mark_failed(job, "TIMELINE_FAILED", f"Timeline build failed: {e}")
        return
    if not timeline:
        mark_failed(job, "EMPTY_TIMELINE", "タイムラインが空です")
        return
    update_stage(
        job, JobStage.TIMELINE_SCORING,
        f"タイムライン: {len(timeline)} windows",
        compute_stage_progress(JobStage.TIMELINE_SCORING, 1.0),
        result_patch={"timeline_count": len(timeline)},
    )

    if job.cancelled:
        return

    # ── 5. candidate_generation ────────────────────────────────────────
    update_stage(
        job, JobStage.CANDIDATE_GENERATION,
        "候補を生成中...",
        compute_stage_progress(JobStage.CANDIDATE_GENERATION, 0.1),
    )
    vod_duration = (metadata.get("duration_seconds") if metadata else None) or None
    try:
        all_cands = generate_all_candidates(
            timeline,
            vod_duration=vod_duration,
            short_top=top_short,
            medium_top=top_medium,
            long_top=top_long,
            min_score=min_score,
        )
    except Exception as e:
        mark_failed(job, "CANDIDATE_GENERATION_FAILED", f"Candidate generation failed: {e}")
        return

    # Build YouTube metadata for each candidate
    vod_title = (metadata.get("title") if metadata else None) or ""
    streamer = (metadata.get("uploader") if metadata else None) or ""
    for kind, cands in all_cands.items():
        for c in cands:
            try:
                ym = build_youtube_metadata(c, vod_title=vod_title, streamer_name=streamer)
                # attach to the dict representation
                c.reasons = list(c.reasons) + [f"📺 {ym.title[:60]}"]
            except Exception:
                pass

    # Serialize candidates
    serialized = {
        kind: [c.to_dict() for c in cands] for kind, cands in all_cands.items()
    }
    timeline_dicts = [w.to_dict() for w in timeline]

    # Include normalized chat (compact) so the client can compute
    # chat-in-range without re-fetching.
    chat_compact = [
        {"timestamp": m["timestamp"], "time_sec": m["time_sec"], "message": m["message"], "author": m.get("author", "")}
        for m in normalized
    ]

    update_stage(
        job, JobStage.CANDIDATE_GENERATION,
        f"Short {len(serialized['short'])} / Medium {len(serialized['medium'])} / Long {len(serialized['long'])}",
        compute_stage_progress(JobStage.CANDIDATE_GENERATION, 1.0),
        result_patch={
            "candidates": serialized,
            "timeline": timeline_dicts,
            "vod_title": vod_title,
            "streamer": streamer,
            "vod_duration": vod_duration,
            "normalized_chat": chat_compact,
        },
    )

    # Done
    update_stage(
        job, JobStage.COMPLETED,
        f"分析完了: short {len(serialized['short'])} / medium {len(serialized['medium'])} / long {len(serialized['long'])}",
        100.0,
    )


async def run_analyze_job_async(**kwargs) -> None:
    await asyncio.to_thread(run_analyze_job, **kwargs)
