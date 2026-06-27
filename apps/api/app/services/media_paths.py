import os
from pathlib import Path


def workspace_root() -> Path:
    cwd = Path.cwd().resolve()
    if cwd.name == "api" and cwd.parent.name == "apps":
        return cwd.parent.parent
    return cwd


def media_root() -> Path:
    configured_root = os.getenv("MEDIA_ROOT", "./media")
    return (workspace_root() / configured_root).resolve()


def normalize_relative_path(relative_path: str) -> str:
    normalized = relative_path.strip().replace("\\", "/")
    if not normalized:
        raise ValueError("clip_path is required.")
    if Path(normalized).is_absolute():
        raise ValueError("clip_path must be relative to MEDIA_ROOT.")

    parts = [part for part in normalized.split("/") if part and part != "."]
    if any(part == ".." for part in parts):
        raise ValueError("Path traversal is not allowed in clip_path.")

    return "/".join(parts)


def resolve_media_path(relative_path: str) -> Path:
    normalized = normalize_relative_path(relative_path)
    root = media_root()
    absolute_path = (root / normalized).resolve()

    if root not in absolute_path.parents and absolute_path != root:
        raise ValueError("clip_path must stay inside MEDIA_ROOT.")

    return absolute_path


def relative_to_media_root(path: Path) -> str:
    return path.resolve().relative_to(media_root()).as_posix()


def transcript_output_dir() -> Path:
    output_dir = media_root() / "output" / "transcripts"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir
