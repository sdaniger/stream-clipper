from __future__ import annotations

import json
import os
import subprocess
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.schemas.transcription import (
    TranscriptOutputs,
    TranscriptSegment,
    TranscribeRequest,
    TranscribeResponse,
    TranscriptionHealth,
)


class TranscriptionProvider(ABC):
    @abstractmethod
    def transcribe(self, clip_path: str, **options) -> TranscribeResponse:
        ...

    @abstractmethod
    def check_health(self) -> TranscriptionHealth:
        ...


# ── Existing (faster-whisper) ────────────────────────────────────────────────


class ExistingTranscriptionProvider(TranscriptionProvider):
    def transcribe(self, clip_path: str, **options) -> TranscribeResponse:
        from app.services.transcription_service import transcribe_clip

        request = TranscribeRequest(clip_path=clip_path, **options)
        return transcribe_clip(request)

    def check_health(self) -> TranscriptionHealth:
        from app.services.transcription_service import check_transcription_health

        return check_transcription_health()


# ── whisper.cpp CLI (Android / Termux) ───────────────────────────────────────


class WhisperCppCliProvider(TranscriptionProvider):
    def __init__(self) -> None:
        self._model_path: Optional[Path] = None

    def _model_path_resolved(self) -> Path:
        if self._model_path is not None:
            return self._model_path
        model_name = os.getenv("WHISPER_CPP_MODEL", "ggml-base.bin")
        model_dir = Path(os.getenv("WHISPER_CPP_MODEL_DIR", "./models/whisper")).resolve()
        model_dir.mkdir(parents=True, exist_ok=True)
        model_path = model_dir / model_name
        if not model_path.is_file():
            model_path = self._download_model(model_name, model_dir)
        self._model_path = model_path
        return model_path

    def _download_model(self, name: str, dest_dir: Path) -> Path:
        url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{name}"
        dest = dest_dir / name
        import urllib.request
        import urllib.error

        try:
            urllib.request.urlretrieve(url, str(dest))
        except (urllib.error.URLError, OSError) as exc:
            raise RuntimeError(f"Failed to download whisper.cpp model {name}: {exc}") from exc
        return dest

    def transcribe(self, clip_path: str, language: str = "ja", **options) -> TranscribeResponse:
        from app.services.media_paths import relative_to_media_root, transcript_output_dir
        from app.services.transcription_service import build_srt, build_txt, format_display_time

        clip = Path(clip_path).resolve()
        if not clip.is_file():
            raise FileNotFoundError(f"Clip not found: {clip_path}")

        # Prepare output paths
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        stem = clip.stem
        out_dir = transcript_output_dir()
        base = out_dir / f"{stem}_{timestamp}"

        # ── Extract 16 kHz mono WAV ──────────────────────────────
        wav_path = base.with_suffix(".wav")
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", str(clip),
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                str(wav_path),
            ],
            capture_output=True, text=True, timeout=600,
        )
        if not wav_path.is_file():
            raise RuntimeError("Failed to extract audio for transcription")

        # ── Run whisper.cpp ──────────────────────────────────────
        whisper_bin = os.getenv("WHISPER_CPP_BIN", "whisper")
        model = self._model_path_resolved()
        subprocess.run(
            [
                whisper_bin,
                "--model", str(model),
                "--file", str(wav_path),
                "--language", language,
                "--output-json",
                "--output-file", str(base),
            ],
            capture_output=True, text=True, timeout=3600,
        )

        # Clean up WAV
        try:
            wav_path.unlink()
        except OSError:
            pass

        # ── Parse output ────────────────────────────────────────
        whisper_output = base.with_suffix(".json")
        if whisper_output.is_file():
            with open(whisper_output, encoding="utf-8") as f:
                raw = json.load(f)
        else:
            raw = {}

        # whisper.cpp JSON output can have different shapes:
        #   { "transcription": { "segments": [...] } }   (newer)
        #   [ { "start": ..., "end": ..., "text": ... } ] (older)
        #   { "segments": [...] }                         (alternate)
        raw_segments: list[dict] = []
        if isinstance(raw, dict):
            raw_segments = (
                raw.get("transcription", {}).get("segments", [])
                or raw.get("segments", [])
            )
        elif isinstance(raw, list):
            raw_segments = raw

        segments: list[TranscriptSegment] = []
        for i, seg in enumerate(raw_segments, 1):
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", start))
            text = (seg.get("text") or "").strip()
            segments.append(TranscriptSegment(
                id=i,
                start=start,
                end=end,
                start_time=format_display_time(start),
                end_time=format_display_time(end),
                text=text,
            ))

        full_text = " ".join(s.text for s in segments if s.text).strip()
        srt = build_srt(segments)
        txt = build_txt(segments)

        # ── Write output files ──────────────────────────────────
        json_path = base.with_suffix(".json")
        srt_path = base.with_suffix(".srt")
        txt_path = base.with_suffix(".txt")

        payload = {
            "engine": "whisper.cpp",
            "model": model.name,
            "language": language,
            "clip_path": relative_to_media_root(clip),
            "text": full_text,
            "segments": [s.model_dump() for s in segments],
            "outputs": {
                "srt_path": relative_to_media_root(srt_path),
                "txt_path": relative_to_media_root(txt_path),
            },
        }
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        srt_path.write_text(srt, encoding="utf-8")
        txt_path.write_text(txt, encoding="utf-8")

        # Determine duration from whisper output
        duration: Optional[float] = None
        if segments:
            duration = segments[-1].end

        return TranscribeResponse(
            engine="whisper.cpp",
            model=model.name,
            device="cpu",
            compute_type="int8",
            language=language,
            duration_seconds=duration,
            clip_path=relative_to_media_root(clip),
            text=full_text,
            segments=segments,
            srt=srt,
            txt=txt,
            outputs=TranscriptOutputs(
                json_path=relative_to_media_root(json_path),
                srt_path=relative_to_media_root(srt_path),
                txt_path=relative_to_media_root(txt_path),
            ),
        )

    def check_health(self) -> TranscriptionHealth:
        import shutil

        available_bin = shutil.which(os.getenv("WHISPER_CPP_BIN", "whisper")) is not None
        # Always attempt to resolve the model path so that the health
        # check can discover an existing model that has not yet been
        # touched on this Python instance.
        model_ok = False
        try:
            model_ok = self._model_path_resolved().is_file()
        except Exception:
            model_ok = False
        available = available_bin and model_ok
        model_name = self._model_path.name if self._model_path else os.getenv("WHISPER_CPP_MODEL", "ggml-base.bin")
        return TranscriptionHealth(
            available=available,
            engine="whisper.cpp",
            default_model=model_name,
            device="cpu",
            compute_type="int8",
            error=None if available else "whisper.cpp binary or model not found",
        )


# ── Disabled (no-op / error) ─────────────────────────────────────────────────


class DisabledTranscriptionProvider(TranscriptionProvider):
    def transcribe(self, clip_path: str, **options) -> TranscribeResponse:
        raise RuntimeError("Transcription is disabled.")

    def check_health(self) -> TranscriptionHealth:
        return TranscriptionHealth(
            available=False,
            engine="disabled",
            default_model="",
            device="",
            compute_type="",
            error="Transcription is disabled",
        )


# ── Factory ──────────────────────────────────────────────────────────────────

_PROVIDER_CACHE: dict[str, TranscriptionProvider] = {}


def get_transcription_provider(
    provider_name: Optional[str] = None,
) -> TranscriptionProvider:
    if provider_name is None or provider_name == "auto":
        from app.services.platform_utils import is_android

        if is_android():
            provider_name = os.getenv("TRANSCRIPTION_PROVIDER", "whisper_cpp")
        else:
            provider_name = os.getenv("TRANSCRIPTION_PROVIDER", "existing")

    if provider_name in _PROVIDER_CACHE:
        return _PROVIDER_CACHE[provider_name]

    if provider_name == "existing":
        provider: TranscriptionProvider = ExistingTranscriptionProvider()
    elif provider_name == "whisper_cpp":
        provider = WhisperCppCliProvider()
    elif provider_name == "disabled":
        provider = DisabledTranscriptionProvider()
    else:
        raise ValueError(f"Unknown transcription provider: {provider_name}")

    _PROVIDER_CACHE[provider_name] = provider
    return provider
