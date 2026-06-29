from pydantic import BaseModel, Field, field_validator, model_validator
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


class NormalizedChatMessage(BaseModel):
    timestamp: float = Field(..., description="VOD time in seconds")
    time_sec: float = Field(..., description="Same as timestamp for compatibility")
    message: str = Field(..., description="Chat message text")
    author: Optional[str] = Field(default=None, description="Author display name")


class AnalyzeRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    log_path: Optional[str] = Field(default=None, description="Path to the chat log file (.json or .csv). Alternative to chat_data.")
    chat_data: Optional[List[NormalizedChatMessage]] = Field(default=None, description="Chat messages inline. Alternative to log_path.")
    vod_url: Optional[str] = Field(default=None, description="Twitch VOD URL (for reference only, chat is fetched via chat_data)")
    window: int = Field(default=30, ge=10, le=600, description="Time bucket window in seconds")
    top: int = Field(default=5, ge=1, le=100, description="Number of top highlights to return")
    min_gap: float = Field(default=30.0, ge=0, description="Minimum gap between peak centers")
    keywords: Optional[str] = Field(default=None, description="Comma-separated custom keywords")
    keywords_list: Optional[List[str]] = Field(default=None, description="Custom keywords as array")
    keyword_weight: float = Field(default=2.0, ge=0, description="Keyword hit weight in score")
    clip_duration: float = Field(default=30.0, ge=5, description="Default clip duration in seconds")
    clip_padding: float = Field(default=5.0, ge=0, description="Seconds of context padding")

    @model_validator(mode="after")
    def check_path_or_data(self):
        if not self.log_path and not self.chat_data:
            raise ValueError("Either 'log_path' or 'chat_data' is required")
        return self


class AnalyzeResponse(BaseModel):
    highlights: List[HighlightCandidate]
    timeline: List[TimelineRow]
    metadata: dict = {}


class ClipCreateRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    start: float = Field(..., ge=0, description="Clip start time in seconds")
    duration: Optional[float] = Field(default=None, ge=1, description="Clip duration in seconds")
    end: Optional[float] = Field(default=None, ge=0, description="Clip end time (alternative to duration)")
    output_dir: str = Field(default="output", description="Output directory")
    rank: int = Field(default=1, ge=1, description="Highlight rank for filename")
    encoder: str = Field(default="auto", description="Encoder: auto, libx264, or h264_nvenc")
    mode: str = Field(default="reencode", description="Clip mode: reencode or copy")

    @model_validator(mode="after")
    def resolve_duration(cls, values):
        if values.duration is None and values.end is not None:
            values.duration = max(1.0, values.end - values.start)
        if values.duration is None:
            raise ValueError("Either 'duration' or 'end' is required")
        return values


class ClipCreateResponse(BaseModel):
    output_file: str
    success: bool


class ClipBatchRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    highlights: List[HighlightCandidate]
    output_dir: str = Field(default="output", description="Output directory")
    encoder: str = Field(default="auto", description="Encoder: auto, libx264, or h264_nvenc")
    mode: str = Field(default="reencode", description="Clip mode: reencode or copy")


class ClipBatchResponse(BaseModel):
    clips: List[ClipCreateResponse]


class ShortCreateRequest(BaseModel):
    video_path: str = Field(..., description="Path to the video file")
    start: float = Field(default=0, ge=0, description="Start time in seconds")
    duration: float = Field(default=30, ge=1, le=120, description="Duration in seconds")
    output_dir: str = Field(default="output", description="Output directory")
    rank: int = Field(default=1, ge=1, description="Rank for filename")
    subtitle_text: Optional[str] = Field(default=None, description="Optional subtitle text to burn in")
    target_width: int = Field(default=608, ge=360, le=1080, description="Output width (default: 608 for 9:16)")
    target_height: int = Field(default=1080, ge=360, le=1920, description="Output height (default: 1080)")


class ShortCreateResponse(BaseModel):
    output_file: str
    success: bool
