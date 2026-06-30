"""
Job state machine for the auto-clip pipeline.

Each job has a list of well-known stages, a 0-100 progress value, and a
result envelope. Jobs are stored in an in-memory dict (the FastAPI process
is single-process; for multi-process deployments this would be Redis).
"""
from __future__ import annotations

import enum
import threading
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


class JobStage(str, enum.Enum):
    PENDING = "pending"
    METADATA_FETCHING = "metadata_fetching"
    CHAT_FETCHING = "chat_fetching"
    CHAT_NORMALIZING = "chat_normalizing"
    TIMELINE_SCORING = "timeline_scoring"
    CANDIDATE_GENERATION = "candidate_generation"
    VOD_RANGE_FETCHING = "vod_range_fetching"
    ASS_GENERATION = "ass_generation"
    FFMPEG_RENDERING = "ffmpeg_rendering"
    METADATA_GENERATION = "metadata_generation"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Stages in order, used for progress mapping
STAGE_ORDER: List[JobStage] = [
    JobStage.METADATA_FETCHING,
    JobStage.CHAT_FETCHING,
    JobStage.CHAT_NORMALIZING,
    JobStage.TIMELINE_SCORING,
    JobStage.CANDIDATE_GENERATION,
    JobStage.VOD_RANGE_FETCHING,
    JobStage.ASS_GENERATION,
    JobStage.FFMPEG_RENDERING,
    JobStage.METADATA_GENERATION,
    JobStage.COMPLETED,
]


# Default progress weights per stage (must sum to 100).
# Render-only jobs use a subset; analyze-only jobs use a different subset.
ANALYZE_STAGE_WEIGHTS: Dict[JobStage, float] = {
    JobStage.METADATA_FETCHING: 10,
    JobStage.CHAT_FETCHING: 50,
    JobStage.CHAT_NORMALIZING: 5,
    JobStage.TIMELINE_SCORING: 10,
    JobStage.CANDIDATE_GENERATION: 25,
}


RENDER_STAGE_WEIGHTS: Dict[JobStage, float] = {
    JobStage.VOD_RANGE_FETCHING: 30,
    JobStage.ASS_GENERATION: 10,
    JobStage.FFMPEG_RENDERING: 50,
    JobStage.METADATA_GENERATION: 10,
}


@dataclass
class JobState:
    job_id: str
    job_kind: str  # "analyze" | "render"
    status: JobStage = JobStage.PENDING
    progress: float = 0.0
    current_stage: JobStage = JobStage.PENDING
    message: str = ""
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    # Result payload
    result: Dict[str, Any] = field(default_factory=dict)
    # Error
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    # Cancellation flag
    cancelled: bool = False
    # History of stage transitions
    history: List[Dict[str, Any]] = field(default_factory=list)
    # Lock
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "job_kind": self.job_kind,
            "status": self.status.value,
            "progress": round(self.progress, 2),
            "current_stage": self.current_stage.value,
            "message": self.message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "finished_at": self.finished_at,
            "result": self.result,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "cancelled": self.cancelled,
            "history": self.history,
        }


# ─── Job registry (in-memory) ────────────────────────────────────────────────

_jobs: Dict[str, JobState] = {}
_jobs_lock = threading.Lock()


def create_job(job_kind: str) -> JobState:
    job_id = uuid.uuid4().hex
    job = JobState(job_id=job_id, job_kind=job_kind)
    with _jobs_lock:
        _jobs[job_id] = job
    return job


def get_job(job_id: str) -> Optional[JobState]:
    with _jobs_lock:
        return _jobs.get(job_id)


def list_jobs(job_kind: Optional[str] = None) -> List[JobState]:
    with _jobs_lock:
        jobs = list(_jobs.values())
    if job_kind is not None:
        jobs = [j for j in jobs if j.job_kind == job_kind]
    jobs.sort(key=lambda j: j.created_at, reverse=True)
    return jobs


def delete_job(job_id: str) -> bool:
    with _jobs_lock:
        return _jobs.pop(job_id, None) is not None


def cancel_job(job_id: str) -> bool:
    job = get_job(job_id)
    if not job:
        return False
    with job._lock:
        if job.status not in (JobStage.COMPLETED, JobStage.FAILED, JobStage.CANCELLED):
            job.cancelled = True
            job.status = JobStage.CANCELLED
            job.finished_at = time.time()
            job.message = "cancelled"
            job.history.append({
                "stage": job.current_stage.value,
                "message": "cancelled",
                "ts": job.finished_at,
            })
            return True
    return False


# ─── Stage transition helpers ─────────────────────────────────────────────────

def update_stage(
    job: JobState,
    stage: JobStage,
    message: str = "",
    progress: Optional[float] = None,
    result_patch: Optional[Dict[str, Any]] = None,
) -> None:
    """Atomically update the job's stage, message, progress, and result."""
    with job._lock:
        job.current_stage = stage
        if progress is not None:
            job.progress = max(0.0, min(100.0, progress))
        if message:
            job.message = message
        if result_patch:
            job.result.update(result_patch)
        if stage in (JobStage.COMPLETED, JobStage.FAILED, JobStage.CANCELLED):
            job.status = stage
            job.finished_at = time.time()
            if progress is None:
                job.progress = 100.0 if stage == JobStage.COMPLETED else job.progress
        else:
            job.status = stage
        job.updated_at = time.time()
        job.history.append({
            "stage": stage.value,
            "message": message,
            "progress": job.progress,
            "ts": job.updated_at,
        })


def mark_failed(job: JobState, code: str, message: str) -> None:
    with job._lock:
        job.status = JobStage.FAILED
        job.error_code = code
        job.error_message = message
        job.finished_at = time.time()
        job.updated_at = job.finished_at
        job.message = f"{code}: {message}"
        job.history.append({
            "stage": job.current_stage.value,
            "message": job.message,
            "ts": job.updated_at,
        })


def compute_stage_progress(
    stage: JobStage,
    within_stage: float = 0.0,
    weights: Optional[Dict[JobStage, float]] = None,
) -> float:
    """
    Compute the overall progress (0-100) given the current stage and a
    0..1 fraction of progress within that stage.
    """
    if weights is None:
        weights = ANALYZE_STAGE_WEIGHTS
    total = 0.0
    for s in STAGE_ORDER:
        if s == stage:
            total += weights.get(s, 0) * within_stage
            break
        total += weights.get(s, 0)
    return min(100.0, max(0.0, total))
