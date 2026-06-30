import asyncio

from fastapi import APIRouter, HTTPException, Query

from app.schemas.transcription import TranscribeRequest, TranscribeResponse, TranscriptionHealth
from app.services.transcription_service import check_transcription_health as _legacy_health


router = APIRouter(prefix="/api/transcription", tags=["transcription"])


@router.get("/health", response_model=TranscriptionHealth)
def health(provider: str | None = Query(default=None, description="Provider override")) -> TranscriptionHealth:
    if provider and provider != "existing":
        from app.services.transcription_provider import get_transcription_provider
        try:
            prov = get_transcription_provider(provider)
            return prov.check_health()
        except ValueError:
            pass
    return _legacy_health()


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    """
    Async endpoint: the underlying transcribe_clip is CPU/IO bound and
    can take minutes. Running it via asyncio.to_thread keeps the
    event loop free for other requests.
    """
    provider_name = request.provider or "auto"
    if provider_name == "existing" or (provider_name in ("auto", None) and not _is_android()):
        # Use the existing faster-whisper service
        from app.services.transcription_service import transcribe_clip
        try:
            return await asyncio.to_thread(transcribe_clip, request)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    # Use provider abstraction
    from app.services.transcription_provider import get_transcription_provider
    try:
        prov = get_transcription_provider(provider_name)
        return await asyncio.to_thread(
            prov.transcribe,
            request.clip_path,
            model=request.model,
            language=request.language,
            device=request.device,
            compute_type=request.compute_type,
            beam_size=request.beam_size,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _is_android() -> bool:
    from app.services.platform_utils import is_android
    return is_android()
