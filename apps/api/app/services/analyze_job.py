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
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

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
    m = re.search(r"/[^/]+/video/(\d+)", url)
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


# ─── In-memory LRU chat cache ─────────────────────────────────────────────────

_CHAT_CACHE: Dict[str, List[Dict[str, Any]]] = {}
_CHAT_CACHE_LOCK = threading.Lock()
_CHAT_CACHE_MAX = 10
_CHAT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
_PRACTICAL_MESSAGE_CAP = 300_000

def _cache_get(vod_id: str) -> Optional[List[Dict[str, Any]]]:
    with _CHAT_CACHE_LOCK:
        cached = _CHAT_CACHE.get(vod_id)
        if cached is not None:
            return cached

    cache_path = _chat_cache_path(vod_id)
    if not cache_path.is_file():
        return None
    try:
        if time.time() - cache_path.stat().st_mtime > _CHAT_CACHE_TTL_SECONDS:
            cache_path.unlink(missing_ok=True)
            return None
        loaded = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(loaded, list) or not loaded:
        return None
    messages = [m for m in loaded if isinstance(m, dict)]
    if not messages:
        return None
    with _CHAT_CACHE_LOCK:
        while len(_CHAT_CACHE) >= _CHAT_CACHE_MAX:
            _CHAT_CACHE.pop(next(iter(_CHAT_CACHE)))
        _CHAT_CACHE[vod_id] = messages
    return messages

def _cache_set(vod_id: str, messages: List[Dict[str, Any]]) -> None:
    with _CHAT_CACHE_LOCK:
        while len(_CHAT_CACHE) >= _CHAT_CACHE_MAX:
            _CHAT_CACHE.pop(next(iter(_CHAT_CACHE)))
        _CHAT_CACHE[vod_id] = messages
    try:
        cache_path = _chat_cache_path(vod_id)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(messages, ensure_ascii=False), encoding="utf-8")
        legacy_path = cache_path.with_name(f"v{vod_id}.rechat.json")
        legacy_path.unlink(missing_ok=True)
    except Exception:
        pass


def _chat_cache_path(vod_id: str) -> Path:
    return _project_root() / "media" / "cache" / "comments" / f"{vod_id}.rechat.json"


def _default_chat_limit_for_duration(duration_seconds: Optional[int]) -> int:
    if not duration_seconds or duration_seconds <= 0:
        return 50000
    estimated = int(duration_seconds * 7)
    return max(5000, min(_PRACTICAL_MESSAGE_CAP, estimated))


def _fetch_twitch_chat_direct(vod_id: str, max_messages: int = 50000,
                               on_progress=None,
                               duration_seconds: Optional[int] = None) -> Dict[str, Any]:
    """
    Fetch Twitch VOD chat via parallel segment fetching (mirrors the fast
    Next.js approach):
    1. Get an integrity token
    2. Split the VOD timeline into N segments and fetch each in a thread
    3. Normalize messages as they arrive (merge fetch + normalize)
    4. Deduplicate via shared seen_ids set
    """
    # Check cache first
    cached = _cache_get(vod_id)
    if cached is not None:
        if on_progress:
            on_progress(len(cached), 1, 1)
        return {"ok": True, "messages": cached, "cached": True}

    import requests as req
    GQL_URL = "https://gql.twitch.tv/gql"
    INTEGRITY_URL = "https://gql.twitch.tv/integrity"
    CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
    HASH_COMMENTS = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a"
    BASE_HEADERS = {
        "Client-ID": CLIENT_ID,
        "Content-Type": "text/plain;charset=UTF-8",
        "Origin": "https://www.twitch.tv",
        "Referer": "https://www.twitch.tv/",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    }

    # Get integrity token
    try:
        it_resp = req.post(INTEGRITY_URL, json={}, headers=BASE_HEADERS, timeout=10)
        integrity_token = it_resp.json().get("token", "")
    except Exception:
        integrity_token = ""

    headers = dict(BASE_HEADERS)
    if integrity_token:
        headers["Client-Integrity"] = integrity_token

    # Determine VOD duration (for segment splitting)
    duration = duration_seconds or 3600
    if duration <= 0:
        duration = 3600

    # Dynamic thread count: 4 for short VODs, up to 16 for long ones.
    thread_count = max(4, min(16, int((duration + 299) // 300)))
    segment_count = max(1, min(max_messages // 200, 100))
    comments_per_segment = max(1, max_messages // segment_count)

    shared_seen: Set[str] = set()
    seen_lock = threading.Lock()
    total = [0]
    total_lock = threading.Lock()
    deadline = time.time() + 600  # 10 min timeout
    all_messages: List[Dict[str, Any]] = []
    results_lock = threading.Lock()
    progress_interval = max(50, max_messages // 100)

    def _gql_page(offset_sec: int) -> dict:
        query = [{
            "operationName": "VideoCommentsByOffsetOrCursor",
            "variables": {"videoID": vod_id, "contentOffsetSeconds": offset_sec, "first": 100},
            "extensions": {"persistedQuery": {"version": 1, "sha256Hash": HASH_COMMENTS}}
        }]
        resp = req.post(GQL_URL, json=query, headers=headers, timeout=10)
        return resp.json()

    def _parse_edges(edges: list) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for edge in edges:
            node = edge.get("node") or {}
            cid = node.get("id")
            ts = node.get("contentOffsetSeconds")
            if ts is None:
                continue
            try:
                ts = round(float(ts), 3)
            except Exception:
                continue
            commenter = node.get("commenter") or {}
            user = str(commenter.get("displayName") or commenter.get("login") or "unknown")
            fragments = node.get("message", {}).get("fragments") or []
            msg = ""
            for f in fragments:
                if isinstance(f, dict):
                    msg += f.get("text", "")
            if not msg:
                continue
            out.append({
                "timestamp": ts,
                "author": user,
                "message": msg.strip(),
                "_cid": cid or "",
            })
        return out

    def fetch_segment(seg_offset: int, seg_limit: int) -> int:
        page_offset = seg_offset
        stale = 0
        fetched = 0
        while fetched < seg_limit:
            if time.time() >= deadline:
                break
            with total_lock:
                if total[0] >= max_messages:
                    break
            try:
                data = _gql_page(page_offset)
            except Exception:
                stale += 1
                if stale >= 3:
                    break
                page_offset += 30
                continue
            if isinstance(data, list) and len(data) > 0:
                result = data[0]
            else:
                stale += 1
                if stale >= 3:
                    break
                page_offset += 30
                continue
            if "errors" in result:
                break
            edges = result.get("data", {}).get("video", {}).get("comments", {}).get("edges") or []
            if not edges:
                stale += 1
                if stale >= 3:
                    break
                page_offset += 30
                continue
            stale = 0
            parsed = _parse_edges(edges)
            max_os = page_offset
            appended = 0
            for item in parsed:
                cid = item.pop("_cid", "")
                ts = item["timestamp"]
                with seen_lock:
                    if cid and cid in shared_seen:
                        continue
                    if cid:
                        shared_seen.add(cid)
                with total_lock:
                    if total[0] >= max_messages:
                        return fetched
                    total[0] += 1
                    current = total[0]
                with results_lock:
                    all_messages.append(item)
                fetched += 1
                appended += 1
                if ts > max_os:
                    max_os = ts
                if on_progress and (current % progress_interval == 0 or current <= 100):
                    on_progress(min(current, max_messages), None, segment_count)
                if fetched >= seg_limit:
                    break
            if appended == 0:
                stale += 1
                if stale >= 3:
                    break
            else:
                stale = 0
            if fetched < seg_limit:
                page_offset = int(max_os) + 3
        return fetched

    executor = ThreadPoolExecutor(max_workers=thread_count)
    try:
        futures = {}
        for seg in range(segment_count):
            seg_offset = int(seg * duration / segment_count)
            futures[executor.submit(fetch_segment, seg_offset, comments_per_segment)] = seg

        completed_segments = 0
        for future in as_completed(futures):
            try:
                future.result()
                completed_segments += 1
                if on_progress:
                    with total_lock:
                        current = total[0]
                    on_progress(min(current, max_messages), completed_segments, segment_count)
            except Exception as e:
                import logging
                logging.getLogger("analyze_job").warning("Chat segment fetch failed: %s", e)

    finally:
        executor.shutdown(wait=False)

    # Merge segments (sort by timestamp)
    all_messages.sort(key=lambda m: m["timestamp"])
    all_messages = all_messages[:max_messages]

    if not all_messages:
        return {"ok": False, "error_code": "TWITCH_CHAT_FAILED", "message": "No chat messages could be fetched"}
    if on_progress:
        on_progress(len(all_messages), segment_count, segment_count)

    # Cache
    _cache_set(vod_id, all_messages)

    return {"ok": True, "messages": all_messages}


def _fetch_chat_with_chat_downloader(
    url: str,
    max_messages: int,
    on_progress=None,
    duration_seconds: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Fetch chat for a VOD URL.
    For Twitch VODs, uses direct Twitch GQL API (same mechanism as Next.js).
    For other sources, falls back to chat-downloader CLI.
    """
    # For Twitch VODs, go directly to API (skip broken chat-downloader CLI)
    import re as _re
    m = _re.search(r'(?:twitch\.tv/videos?/|videos?/)(\d+)', url) or _re.search(r'/[^/]+/video/(\d+)', url)
    if m:
        vid = m.group(1)
        result = _fetch_twitch_chat_direct(vid, max_messages, on_progress=on_progress, duration_seconds=duration_seconds)
        if result.get("ok"):
            return result
        # Direct fetch failed, try chat-downloader as fallback
        last_err = result.get("message", "")
    else:
        last_err = ""

    # Fallback: chat-downloader CLI for non-Twitch URLs
    candidates = ["chat_downloader"]
    for cmd in candidates:
        try:
            proc = subprocess.Popen(
                [cmd, url, "--max_messages", str(max_messages), "--format", "json"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            messages: List[Dict[str, Any]] = []
            if proc.stdout is None:
                last_err = "chat-downloader stdout unavailable"
                continue
            try:
                # Use communicate() with a generous timeout so the
                # process cannot block forever if the underlying tool
                # hangs while producing output.
                stdout_data, stderr_data = proc.communicate(timeout=600)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.communicate(timeout=10)
                except Exception:
                    pass
                last_err = "chat-downloader timed out"
                continue
            for raw in stdout_data.splitlines():
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
                if on_progress and len(messages) % 50 == 0:
                    on_progress(len(messages))
            if proc.returncode != 0:
                last_err = (stderr_data or "").strip()[-500:]
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
        vod_dur = (metadata.get("duration_seconds") if metadata else None)
        max_messages = _default_chat_limit_for_duration(int(vod_dur) if vod_dur else None)
        def _chat_progress(n: int, completed_segments: Optional[int] = None, total_segments: Optional[int] = None) -> None:
            segment_text = ""
            if completed_segments is not None and total_segments:
                segment_text = f" / segments {completed_segments}/{total_segments}"
            update_stage(
                job, JobStage.CHAT_FETCHING,
                f"Twitchチャット取得中: {n} メッセージ{segment_text}",
                compute_stage_progress(JobStage.CHAT_FETCHING, min(0.95, n / max_messages)),
            )

        result = _fetch_chat_with_chat_downloader(
            vod_url, max_messages,
            on_progress=_chat_progress,
            duration_seconds=int(vod_dur) if vod_dur else None,
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
    total_raw = len(raw_chat)
    update_stage(
        job, JobStage.CHAT_NORMALIZING, "チャット正規化中...",
        compute_stage_progress(JobStage.CHAT_NORMALIZING, 0.1),
    )
    normalized: List[Dict[str, Any]] = []
    for idx, entry in enumerate(raw_chat):
        if idx % 500 == 0 and total_raw > 0:
            update_stage(
                job, JobStage.CHAT_NORMALIZING,
                f"チャット正規化中: {idx}/{total_raw}",
                compute_stage_progress(JobStage.CHAT_NORMALIZING, 0.1 + 0.8 * idx / total_raw),
            )
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
    if job.cancelled:
        return
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
    category_counts: Dict[str, int] = {}
    for cands in serialized.values():
        for c in cands:
            cat = str(c.get("category") or "general")
            category_counts[cat] = category_counts.get(cat, 0) + 1
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
            "category_counts": category_counts,
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
