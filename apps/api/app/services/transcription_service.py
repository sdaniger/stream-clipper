import importlib.metadata
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.schemas.transcription import (
    TranscriptOutputs,
    TranscriptSegment,
    TranscribeRequest,
    TranscribeResponse,
    TranscriptionHealth,
)
from app.services.media_paths import relative_to_media_root, resolve_media_path, transcript_output_dir


MODEL_CACHE: dict[tuple[str, str, str], Any] = {}


def default_model() -> str:
    return os.getenv("FASTER_WHISPER_MODEL", "small")


def default_device() -> str:
    return os.getenv("FASTER_WHISPER_DEVICE", "cpu")


def default_compute_type() -> str:
    return os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "int8")


def check_transcription_health() -> TranscriptionHealth:
    try:
        import faster_whisper  # noqa: F401

        try:
            version = importlib.metadata.version("faster-whisper")
        except importlib.metadata.PackageNotFoundError:
            version = None

        return TranscriptionHealth(
            available=True,
            default_model=default_model(),
            device=default_device(),
            compute_type=default_compute_type(),
            version=version,
        )
    except Exception as error:  # pragma: no cover - depends on local Python environment
        return TranscriptionHealth(
            available=False,
            default_model=default_model(),
            device=default_device(),
            compute_type=default_compute_type(),
            error=str(error),
        )


def transcribe_clip(request: TranscribeRequest) -> TranscribeResponse:
    clip_path = resolve_media_path(request.clip_path)
    if not clip_path.exists() or not clip_path.is_file():
        raise FileNotFoundError(f"Clip file not found under MEDIA_ROOT: {request.clip_path}")

    validate_clip_file(clip_path)

    health = check_transcription_health()
    if not health.available:
        raise RuntimeError(health.error or "faster-whisper is not available.")

    model_name = request.model or default_model()
    device = request.device or default_device()
    compute_type = request.compute_type or default_compute_type()
    model = get_model(model_name, device, compute_type)
    segment_iter, info = model.transcribe(
        str(clip_path),
        language=request.language,
        beam_size=request.beam_size,
        vad_filter=True,
    )
    segments = [to_transcript_segment(index, segment) for index, segment in enumerate(segment_iter, start=1)]
    text = " ".join(segment.text.strip() for segment in segments).strip()
    srt = build_srt(segments)
    txt = build_txt(segments)
    outputs = write_outputs(
        clip_path=clip_path,
        model_name=model_name,
        device=device,
        compute_type=compute_type,
        language=getattr(info, "language", request.language),
        duration_seconds=getattr(info, "duration", None),
        text=text,
        segments=segments,
        srt=srt,
        txt=txt,
    )

    return TranscribeResponse(
        model=model_name,
        device=device,
        compute_type=compute_type,
        language=getattr(info, "language", request.language),
        duration_seconds=getattr(info, "duration", None),
        clip_path=relative_to_media_root(clip_path),
        text=text,
        segments=segments,
        srt=srt,
        txt=txt,
        outputs=outputs,
    )


def get_model(model_name: str, device: str, compute_type: str) -> Any:
    cache_key = (model_name, device, compute_type)
    if cache_key in MODEL_CACHE:
        return MODEL_CACHE[cache_key]

    try:
        from faster_whisper import WhisperModel
    except Exception as error:  # pragma: no cover - depends on local Python environment
        raise RuntimeError(f"Could not import faster-whisper: {error}") from error

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as error:  # pragma: no cover - model download/runtime specific
        raise RuntimeError(f"Could not load faster-whisper model '{model_name}': {error}") from error

    MODEL_CACHE[cache_key] = model
    return model


def to_transcript_segment(index: int, segment: Any) -> TranscriptSegment:
    start = float(getattr(segment, "start", 0.0))
    end = float(getattr(segment, "end", start))

    return TranscriptSegment(
        id=index,
        start=start,
        end=end,
        start_time=format_display_time(start),
        end_time=format_display_time(end),
        text=str(getattr(segment, "text", "")).strip(),
        avg_logprob=get_optional_float(segment, "avg_logprob"),
        no_speech_prob=get_optional_float(segment, "no_speech_prob"),
    )


def build_srt(segments: list[TranscriptSegment]) -> str:
    blocks = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(
            f"{index}\n{format_srt_time(segment.start)} --> {format_srt_time(segment.end)}\n{segment.text}"
        )
    return "\n\n".join(blocks).strip() + ("\n" if blocks else "")


def build_txt(segments: list[TranscriptSegment]) -> str:
    return "\n".join(
        f"[{segment.start_time} - {segment.end_time}] {segment.text}" for segment in segments
    ).strip() + ("\n" if segments else "")


def write_outputs(
    *,
    clip_path: Path,
    model_name: str,
    device: str,
    compute_type: str,
    language: str | None,
    duration_seconds: float | None,
    text: str,
    segments: list[TranscriptSegment],
    srt: str,
    txt: str,
) -> TranscriptOutputs:
    output_dir = transcript_output_dir()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = sanitize_file_part(clip_path.stem)
    base_path = output_dir / f"{stem}_{timestamp}"
    json_path = base_path.with_suffix(".json")
    srt_path = base_path.with_suffix(".srt")
    txt_path = base_path.with_suffix(".txt")

    payload = {
        "engine": "faster-whisper",
        "model": model_name,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "duration_seconds": duration_seconds,
        "clip_path": relative_to_media_root(clip_path),
        "text": text,
        "segments": [segment.dict() for segment in segments],
        "outputs": {
            "srt_path": relative_to_media_root(srt_path),
            "txt_path": relative_to_media_root(txt_path),
        },
    }

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    srt_path.write_text(srt, encoding="utf-8")
    txt_path.write_text(txt, encoding="utf-8")

    return TranscriptOutputs(
        json_path=relative_to_media_root(json_path),
        srt_path=relative_to_media_root(srt_path),
        txt_path=relative_to_media_root(txt_path),
    )


def format_display_time(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    remainder = total_seconds % 60

    if hours:
        return f"{hours:02d}:{minutes:02d}:{remainder:02d}"
    return f"{minutes:02d}:{remainder:02d}"


def format_srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours = total_ms // 3_600_000
    minutes = (total_ms % 3_600_000) // 60_000
    secs = (total_ms % 60_000) // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def get_optional_float(segment: Any, attribute: str) -> float | None:
    value = getattr(segment, attribute, None)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def validate_clip_file(clip_path: Path) -> None:
    import subprocess

    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=format_name",
             "-of", "default=noprint_wrappers=1:nokey=1", str(clip_path)],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0 or not result.stdout.strip():
            raise ValueError(
                f"Clip file is corrupted or unreadable (moov atom missing): {clip_path.name}"
            )
    except FileNotFoundError:
        raise RuntimeError("ffprobe is not available on PATH.")
    except subprocess.TimeoutExpired:
        raise ValueError(f"Clip validation timed out for: {clip_path.name}")


def sanitize_file_part(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in "._-" else "-" for character in value)
    return safe.strip("-")[:100] or "transcript"
