from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def run_gui() -> int:
    """Start the Stream Clipper GUI (FastAPI backend + Vite frontend)."""
    project_root = Path(__file__).resolve().parents[2]
    api_dir = project_root / "apps" / "api"
    gui_dir = project_root / "packages" / "gui"

    if not (api_dir / "app" / "main.py").exists():
        print("Error: FastAPI backend not found at apps/api/", file=sys.stderr)
        return 1

    if not (gui_dir / "package.json").exists():
        print("Error: GUI frontend not found at packages/gui/", file=sys.stderr)
        return 1

    venv_python = api_dir / ".venv" / "bin" / "python"
    if not venv_python.exists():
        venv_python = Path("python3")

    print("Starting Stream Clipper GUI...")
    print(f"  Backend: http://127.0.0.1:8000")
    print(f"  Frontend: http://127.0.0.1:5173")
    print("  Press Ctrl+C to stop\n")

    # Start backend
    backend = subprocess.Popen(
        [str(venv_python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(api_dir),
    )

    # Start frontend
    frontend = subprocess.Popen(
        ["npx", "vite", "--host", "127.0.0.1"],
        cwd=str(gui_dir),
    )

    try:
        backend.wait()
        frontend.wait()
    except KeyboardInterrupt:
        print("\nShutting down...")
        backend.terminate()
        frontend.terminate()
        backend.wait()
        frontend.wait()
        print("Done.")

    return 0
