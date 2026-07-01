import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv() -> None:
        env_path = Path(__file__).resolve().parents[1] / ".env"
        if not env_path.exists():
            return

        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_dotenv()

# Add the CLI package to sys.path for reuse in highlight service
_cli_path = Path(__file__).resolve().parents[3] / "packages" / "cli"
if str(_cli_path) not in sys.path:
    sys.path.insert(0, str(_cli_path))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.transcription import router as transcription_router
from app.routers.highlights import router as highlights_router
from app.routers.studio_jobs import router as studio_jobs_router


def create_app() -> FastAPI:
    app = FastAPI(title="Stream Clipper API", version="0.2.0")
    cors_origins = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(transcription_router)
    app.include_router(highlights_router)
    app.include_router(studio_jobs_router)
    return app


app = create_app()
