from pydantic import BaseModel, Field
from typing import List, Optional


class HighlightCandidate(BaseModel):
    rank: int
    start: float
    end: float
    peak_time: float
    score: float
    chat_count: int
    keyword_hits: int
    matched_keywords: List[str]
    reasons: List[str] = []
    clip_start: float
    clip_duration: float
    output_file: Optional[str] = None


class TimelineRow(BaseModel):
    start: float
    end: float
    score: float
    chat_count: int
    keyword_hits: int
    matched_keywords: List[str]


class AnalyzeRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    log_path: str = Field(..., description="Path to the chat log file (.json or .csv)")
    window: int = Field(default=30, ge=10, le=600, description="Time bucket window in seconds")
    top: int = Field(default=5, ge=1, le=100, description="Number of top highlights to return")
    min_gap: float = Field(default=30.0, ge=0, description="Minimum gap between peak centers")
    keywords: Optional[str] = Field(default=None, description="Comma-separated custom keywords")
    keyword_weight: float = Field(default=2.0, ge=0, description="Keyword hit weight in score")
    clip_duration: float = Field(default=30.0, ge=5, description="Default clip duration in seconds")
    clip_padding: float = Field(default=5.0, ge=0, description="Seconds of context padding")


class AnalyzeResponse(BaseModel):
    highlights: List[HighlightCandidate]
    timeline: List[TimelineRow]
    metadata: dict = {}


class ClipCreateRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    start: float = Field(..., ge=0, description="Clip start time in seconds")
    duration: float = Field(..., ge=1, description="Clip duration in seconds")
    output_dir: str = Field(default="output", description="Output directory")
    rank: int = Field(default=1, ge=1, description="Highlight rank for filename")


class ClipCreateResponse(BaseModel):
    output_file: str
    success: bool


class ClipBatchRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    highlights: List[HighlightCandidate]
    output_dir: str = Field(default="output", description="Output directory")


class ClipBatchResponse(BaseModel):
    clips: List[ClipCreateResponse]
