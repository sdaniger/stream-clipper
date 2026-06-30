from pydantic import BaseModel, Field


class TranscriptionHealth(BaseModel):
    available: bool
    engine: str = "faster-whisper"
    default_model: str
    device: str
    compute_type: str
    version: str | None = None
    error: str | None = None


class TranscribeRequest(BaseModel):
    clip_path: str = Field(..., description="Clip path relative to MEDIA_ROOT, for example output/clips/clip.mp4")
    model: str | None = None
    language: str | None = None
    device: str | None = None
    compute_type: str | None = None
    beam_size: int = Field(default=5, ge=1, le=10)
    provider: str | None = Field(default=None, description="Transcription provider: 'auto', 'existing', 'whisper_cpp', or 'disabled'")


class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    start_time: str
    end_time: str
    text: str
    avg_logprob: float | None = None
    no_speech_prob: float | None = None


class TranscriptOutputs(BaseModel):
    json_path: str
    srt_path: str
    txt_path: str


class TranscribeResponse(BaseModel):
    engine: str = "faster-whisper"
    model: str
    device: str
    compute_type: str
    language: str | None
    duration_seconds: float | None
    clip_path: str
    text: str
    segments: list[TranscriptSegment]
    srt: str
    txt: str
    outputs: TranscriptOutputs
