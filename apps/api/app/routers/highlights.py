from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.schemas.highlights import (
    AnalyzeRequest,
    AnalyzeResponse,
    HighlightCandidate,
    TimelineRow,
    ClipCreateRequest,
    ClipCreateResponse,
    ClipBatchRequest,
    ClipBatchResponse,
    ShortCreateRequest,
    ShortCreateResponse,
)
from app.services.highlight_service import analyze, generate_clip, batch_generate_clips, generate_short_video

router = APIRouter(prefix="/api/gui", tags=["gui"])


# Allowlist of directories the legacy /api/gui/* endpoints may access.
# Anything outside is rejected with HTTP 400.
def _allowed_roots() -> list[Path]:
    """
    Build the list of directories that the legacy GUI endpoints may read
    from. We use the project root (where `media/`, `output/`, and the
    workspace live) plus the current working directory.
    """
    candidates: list[Path] = []
    try:
        # apps/api/app/routers/highlights.py -> project root is 3 levels up
        project_root = Path(__file__).resolve().parents[3]
        candidates.append(project_root)
        candidates.append(project_root / "media")
        candidates.append(project_root / "output")
    except Exception:
        pass
    cwd = Path.cwd().resolve()
    candidates.append(cwd)
    return candidates


def _is_within_allowed_roots(p: Path) -> bool:
    """
    Return True if `p` (already resolved) is inside one of the allowed
    roots. This protects against path traversal via the `path` query
    parameter.
    """
    try:
        roots = _allowed_roots()
        for root in roots:
            try:
                if p == root or root in p.parents:
                    return True
            except Exception:
                continue
    except Exception:
        return False
    return False


@router.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@router.get("/video")
async def stream_video(path: str, request: Request):
    """Stream a local video file for the GUI preview."""
    video_file = Path(path).resolve()
    if not _is_within_allowed_roots(video_file):
        raise HTTPException(status_code=400, detail="Path is not within an allowed directory.")
    if not video_file.exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {path}")
    if not video_file.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    file_size = video_file.stat().st_size
    range_header = request.headers.get("range")

    if range_header:
        start, end = 0, file_size - 1
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1

        if start < 0 or end < start or start >= file_size:
            raise HTTPException(status_code=416, detail="Range not satisfiable")

        content_length = end - start + 1
        content_range = f"bytes {start}-{end}/{file_size}"

        async def ranged():
            with open(video_file, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk_size = min(8192, remaining)
                    data = f.read(chunk_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            ranged(),
            media_type="video/mp4",
            status_code=206,
            headers={
                "Content-Range": content_range,
                "Content-Length": str(content_length),
                "Accept-Ranges": "bytes",
            },
        )

    return FileResponse(
        str(video_file),
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"},
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_highlights(req: AnalyzeRequest):
    # Resolve log_path from chat_data if provided
    log_path = req.log_path
    temp_path: str | None = None
    if not log_path and req.chat_data:
        # Save inline chat data to a temp file in the CLI-compatible format
        cli_entries = [
            {"timestamp": msg.timestamp, "author": msg.author or "", "message": msg.message}
            for msg in req.chat_data
        ]
        fd, temp_path = tempfile.mkstemp(suffix=".json", prefix="stream-clipper-chat-")
        os.close(fd)
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(cli_entries, f, ensure_ascii=False)
        except Exception:
            # Clean up the temp file if writing fails; the surrounding
            # `finally` block only fires after we successfully enter the
            # try-block below.
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise
        log_path = temp_path
    elif log_path:
        _validated_resolved_path(log_path)

    if not log_path or not Path(log_path).exists():
        raise HTTPException(status_code=404, detail=f"Chat log not found: {log_path}")

    # Validate video_path (if provided) is within allowed roots.
    if req.video_path:
        _validated_resolved_path(req.video_path)

    # Support keywords as list
    kw = req.keywords
    if req.keywords_list:
        kw = ",".join(req.keywords_list)

    try:
        highlights, timeline, metadata = await asyncio.to_thread(
            analyze,
            video_path=req.video_path,
            log_path=log_path,
            window=req.window,
            top=req.top,
            min_gap=req.min_gap,
            keywords=kw,
            keyword_weight=req.keyword_weight,
            clip_duration=req.clip_duration,
            clip_padding=req.clip_padding,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    return AnalyzeResponse(
        highlights=[HighlightCandidate(**h) for h in highlights],
        timeline=[TimelineRow(**t) for t in timeline],
        metadata=metadata,
    )


@router.post("/clips/create", response_model=ClipCreateResponse)
async def create_clip(req: ClipCreateRequest):
    _validated_resolved_path(req.video_path)
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    try:
        output = await asyncio.to_thread(
            generate_clip,
            video_path=req.video_path,
            start=req.start,
            duration=req.duration,
            output_dir=req.output_dir,
            rank=req.rank,
            encoder=req.encoder,
            mode=req.mode,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clip generation failed: {e}")

    return ClipCreateResponse(output_file=output, success=True)


@router.post("/clips/batch", response_model=ClipBatchResponse)
async def batch_clips(req: ClipBatchRequest):
    _validated_resolved_path(req.video_path)
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    try:
        results = await asyncio.to_thread(
            batch_generate_clips,
            video_path=req.video_path,
            highlights=[h.model_dump() for h in req.highlights],
            output_dir=req.output_dir,
            encoder=req.encoder,
            mode=req.mode,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch clip generation failed: {e}")

    return ClipBatchResponse(
        clips=[ClipCreateResponse(**r) for r in results]
    )


@router.post("/short/create", response_model=ShortCreateResponse)
async def create_short(req: ShortCreateRequest):
    _validated_resolved_path(req.video_path)
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    try:
        output = await asyncio.to_thread(
            generate_short_video,
            video_path=req.video_path,
            start=req.start,
            duration=req.duration,
            output_dir=req.output_dir,
            rank=req.rank,
            subtitle_text=req.subtitle_text,
            target_width=req.target_width,
            target_height=req.target_height,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Short video generation failed: {e}")

    return ShortCreateResponse(output_file=output, success=True)


def _validated_resolved_path(p: str) -> Path:
    """Resolve `p` and confirm it stays inside an allowed root."""
    try:
        resolved = Path(p).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid path: {p}")
    if not _is_within_allowed_roots(resolved):
        raise HTTPException(status_code=400, detail="Path is not within an allowed directory.")
    return resolved


@router.get("/export/json")
async def export_json(video_path: str, log_path: str, window: int = 30, top: int = 10):
    """Analyze and return JSON export."""
    _validated_resolved_path(video_path)
    _validated_resolved_path(log_path)
    try:
        highlights, timeline, metadata = await asyncio.to_thread(
            analyze,
            video_path=video_path,
            log_path=log_path,
            window=window,
            top=top,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    content = json.dumps({"highlights": highlights, "timeline": timeline, "metadata": metadata}, indent=2, ensure_ascii=False)
    return StreamingResponse(
        iter([content]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=highlights.json"},
    )


@router.get("/export/csv")
async def export_csv(video_path: str, log_path: str, window: int = 30, top: int = 10):
    """Analyze and return CSV export of timeline."""
    _validated_resolved_path(video_path)
    _validated_resolved_path(log_path)
    try:
        highlights, timeline, metadata = await asyncio.to_thread(
            analyze,
            video_path=video_path,
            log_path=log_path,
            window=window,
            top=top,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["start", "end", "score", "chat_count", "keyword_hits", "matched_keywords"])
    for t in timeline:
        writer.writerow([t["start"], t["end"], t["score"], t["chat_count"], t["keyword_hits"], ";".join(t["matched_keywords"])])
    content = "\ufeff" + output.getvalue()

    return StreamingResponse(
        iter([content]),
        media_type="text/csv;charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=timeline.csv"},
    )


@router.get("/output-files")
async def list_output_files(output_dir: str = "output"):
    """List generated files in the output directory."""
    out_path = Path(output_dir)
    try:
        out_path = out_path.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid output_dir: {output_dir}")
    if not _is_within_allowed_roots(out_path):
        raise HTTPException(status_code=400, detail="output_dir is not within an allowed directory.")
    if not out_path.exists() or not out_path.is_dir():
        return {"files": [], "path": str(out_path)}
    files = []
    for f in sorted(out_path.iterdir()):
        if f.is_file() and f.suffix in (".mp4", ".json", ".csv", ".srt", ".txt"):
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "path": str(f),
            })
    return {"files": files, "path": str(out_path)}
