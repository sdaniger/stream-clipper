from fastapi import APIRouter, HTTPException

from app.schemas.transcription import TranscribeRequest, TranscribeResponse, TranscriptionHealth
from app.services.transcription_service import check_transcription_health, transcribe_clip


router = APIRouter(prefix="/api/transcription", tags=["transcription"])


@router.get("/health", response_model=TranscriptionHealth)
def health() -> TranscriptionHealth:
    return check_transcription_health()


@router.post("/transcribe", response_model=TranscribeResponse)
def transcribe(request: TranscribeRequest) -> TranscribeResponse:
    try:
        return transcribe_clip(request)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
