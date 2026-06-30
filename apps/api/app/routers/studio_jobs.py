"""
Job-based Studio API.

Endpoints:
  POST /studio/jobs/analyze   - kick off an analyze job (returns job_id)
  POST /studio/jobs/render    - kick off a render job (returns job_id)
  GET  /studio/jobs           - list jobs
  GET  /studio/jobs/{job_id}  - poll job state
  DELETE /studio/jobs/{job_id} - cancel + remove a job

The analyze and render pipelines live in:
  - app.services.analyze_job
  - app.services.render_job

This module only deals with request/response shaping and the
job_state registry.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.services.job_state import (
    JobState,
    cancel_job,
    create_job,
    delete_job,
    get_job,
    list_jobs,
)
from app.services.analyze_job import run_analyze_job, run_analyze_job_async
from app.services.render_job import RenderRequest, run_render_job, run_render_job_async


router = APIRouter(prefix="/studio/jobs", tags=["studio-jobs"])


# ─── Request/response models ────────────────────────────────────────────────

class AnalyzeJobRequest(BaseModel):
    vod_url: Optional[str] = None
    chat_data: Optional[List[Dict[str, Any]]] = None
    window: int = Field(default=30, ge=5, le=600)
    step: int = Field(default=10, ge=1, le=120)
    top_short: int = Field(default=5, ge=1, le=50)
    top_medium: int = Field(default=5, ge=1, le=50)
    top_long: int = Field(default=3, ge=1, le=20)
    min_score: float = Field(default=0.0, ge=0)
    custom_keywords: Optional[List[str]] = None
    scoring_weights: Optional[Dict[str, float]] = None

    @field_validator("vod_url", "chat_data")
    @classmethod
    def at_least_one_source(cls, v, info):
        return v


class AnalyzeJobResponse(BaseModel):
    job_id: str
    status: str
    message: str = ""


class DanmakuOptionsModel(BaseModel):
    play_res_x: int = 1920
    play_res_y: int = 1080
    font_name: str = "Noto Sans CJK JP"
    font_size: int = 32
    comment_duration: float = 4.0
    opacity: float = 0.9
    density: str = "medium"
    min_message_length: int = 1
    deduplicate_consecutive: bool = True
    safety_comment_limit: Optional[int] = None


class RenderJobRequest(BaseModel):
    candidate: Dict[str, Any]
    source: str = "twitch_vod"  # "twitch_vod" | "local_file" | "ass_only"
    vod_url: Optional[str] = None
    video_id: Optional[str] = None
    video_path: Optional[str] = None
    chat_messages: Optional[List[Dict[str, Any]]] = None
    options: Optional[DanmakuOptionsModel] = None
    output_dir: str = "output/clips"
    with_danmaku: bool = True
    ffmpeg_preset: str = "veryfast"
    ffmpeg_crf: int = 23
    target_aspect: str = "16:9"
    streamer_name: Optional[str] = None
    vod_title: Optional[str] = None


class JobStateResponse(BaseModel):
    job_id: str
    job_kind: str
    status: str
    progress: float
    current_stage: str
    message: str
    created_at: float
    updated_at: float
    finished_at: Optional[float]
    result: Dict[str, Any]
    error_code: Optional[str]
    error_message: Optional[str]
    cancelled: bool
    history: List[Dict[str, Any]]


# ─── Routes ─────────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=AnalyzeJobResponse)
async def start_analyze(req: AnalyzeJobRequest) -> AnalyzeJobResponse:
    if not req.vod_url and not req.chat_data:
        raise HTTPException(status_code=400, detail="vod_url or chat_data is required")
    job = create_job("analyze")
    # Schedule on the event loop without blocking the request.
    asyncio.create_task(run_analyze_job_async(
        job=job,
        vod_url=req.vod_url,
        chat_data=req.chat_data,
        window=req.window,
        step=req.step,
        top_short=req.top_short,
        top_medium=req.top_medium,
        top_long=req.top_long,
        min_score=req.min_score,
        custom_keywords=req.custom_keywords,
        scoring_weights=req.scoring_weights,
    ))
    return AnalyzeJobResponse(
        job_id=job.job_id,
        status=job.status.value,
        message="analyze job started",
    )


@router.post("/render", response_model=AnalyzeJobResponse)
async def start_render(req: RenderJobRequest) -> AnalyzeJobResponse:
    job = create_job("render")
    rr = RenderRequest(
        candidate=req.candidate,
        source=req.source,
        vod_url=req.vod_url,
        video_id=req.video_id,
        video_path=req.video_path,
        chat_messages=req.chat_messages,
        options=req.options.model_dump() if req.options else {},
        output_dir=req.output_dir,
        with_danmaku=req.with_danmaku,
        ffmpeg_preset=req.ffmpeg_preset,
        ffmpeg_crf=req.ffmpeg_crf,
        target_aspect=req.target_aspect,
        streamer_name=req.streamer_name,
        vod_title=req.vod_title,
    )
    asyncio.create_task(run_render_job_async(job, rr))
    return AnalyzeJobResponse(
        job_id=job.job_id,
        status=job.status.value,
        message="render job started",
    )


@router.get("", response_model=List[JobStateResponse])
async def list_all_jobs(job_kind: Optional[str] = None) -> List[JobStateResponse]:
    jobs = list_jobs(job_kind=job_kind)
    return [_job_to_response(j) for j in jobs]


@router.get("/{job_id}", response_model=JobStateResponse)
async def get_job_state(job_id: str) -> JobStateResponse:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    return _job_to_response(job)


@router.delete("/{job_id}")
async def cancel_or_delete(job_id: str) -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    cancel_job(job_id)
    delete_job(job_id)
    return {"ok": True, "job_id": job_id}


@router.post("/{job_id}/cancel")
async def cancel_only(job_id: str) -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"job not found: {job_id}")
    cancel_job(job_id)
    return {"ok": True, "job_id": job_id}


# ─── Helpers ────────────────────────────────────────────────────────────────

def _job_to_response(job: JobState) -> JobStateResponse:
    d = job.to_dict()
    return JobStateResponse(
        job_id=d["job_id"],
        job_kind=d["job_kind"],
        status=d["status"],
        progress=d["progress"],
        current_stage=d["current_stage"],
        message=d["message"],
        created_at=d["created_at"],
        updated_at=d["updated_at"],
        finished_at=d["finished_at"],
        result=d["result"],
        error_code=d["error_code"],
        error_message=d["error_message"],
        cancelled=d["cancelled"],
        history=d["history"],
    )
