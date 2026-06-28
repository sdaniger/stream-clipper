from __future__ import annotations

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
)
from app.services.highlight_service import analyze, generate_clip, batch_generate_clips

router = APIRouter(prefix="/api/gui", tags=["gui"])


@router.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@router.get("/video")
async def stream_video(path: str, request: Request):
    """Stream a local video file for the GUI preview."""
    video_file = Path(path).resolve()
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

        if start >= file_size:
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
    if not Path(req.log_path).exists():
        raise HTTPException(status_code=404, detail=f"Chat log not found: {req.log_path}")

    try:
        highlights, timeline, metadata = analyze(
            video_path=req.video_path,
            log_path=req.log_path,
            window=req.window,
            top=req.top,
            min_gap=req.min_gap,
            keywords=req.keywords,
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

    return AnalyzeResponse(
        highlights=[HighlightCandidate(**h) for h in highlights],
        timeline=[TimelineRow(**t) for t in timeline],
        metadata=metadata,
    )


@router.post("/clips/create", response_model=ClipCreateResponse)
async def create_clip(req: ClipCreateRequest):
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    try:
        output = generate_clip(
            video_path=req.video_path,
            start=req.start,
            duration=req.duration,
            output_dir=req.output_dir,
            rank=req.rank,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clip generation failed: {e}")

    return ClipCreateResponse(output_file=output, success=True)


@router.post("/clips/batch", response_model=ClipBatchResponse)
async def batch_clips(req: ClipBatchRequest):
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {req.video_path}")

    try:
        results = batch_generate_clips(
            video_path=req.video_path,
            highlights=[h.model_dump() for h in req.highlights],
            output_dir=req.output_dir,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch clip generation failed: {e}")

    return ClipBatchResponse(
        clips=[ClipCreateResponse(**r) for r in results]
    )
