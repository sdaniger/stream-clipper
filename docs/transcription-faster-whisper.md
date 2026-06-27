# faster-whisper Transcription

This stage adds a minimal development transcription backend.

## Endpoints

- `GET /api/transcription/health`
- `POST /api/transcription/transcribe`

The Next app proxies these through same-origin routes, but the actual transcription work runs in FastAPI.

## Request

```json
{
  "clip_path": "output/clips/example.mp4",
  "model": "small",
  "language": "ja"
}
```

`clip_path` must be relative to `MEDIA_ROOT`. Absolute paths and path traversal are rejected.

## Response Shape

The transcribe endpoint returns:

- transcript text
- timestamped segments
- SRT content
- TXT content
- output paths for generated `.json`, `.srt`, and `.txt` files

## Manual UI Flow

1. Start the FastAPI app on port `8000`.
2. Start the Next app on port `3000`.
3. Put a video under `media/input/`.
4. Use `Local media dev tools` to probe and generate a clip.
5. Click `Transcribe clip`.
6. Open the candidate preview to inspect transcript segments and output paths.

## Notes

- First model load can be slow because faster-whisper may download model files.
- CPU mode defaults to `int8` for development practicality.
- This is a synchronous skeleton. Long-term production work should move transcription to a job queue.
