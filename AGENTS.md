# Stream Clipper Agent Guide

## Project Overview

This project is a livestream clipping tool for VTuber and streamer archives.

It detects highlight candidates from chat activity, creates video clips, transcribes them, and renders NicoNico-style scrolling comments.

## Core Features

- Import livestream archive URLs
- Fetch or import chat logs
- Detect highlight candidates from chat activity
- Generate clip candidates with FFmpeg
- Transcribe clips with faster-whisper
- Display candidates in a polished glassmorphism UI
- Preview clips with subtitles and NicoNico-style comments
- Export final videos with comment overlays

## Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Framer Motion
- HTML video
- Canvas for comment preview

### Backend

- Python
- FastAPI
- SQLAlchemy or equivalent ORM
- PostgreSQL

### Worker

- Celery
- Redis

### Video Processing

- FFmpeg
- FFprobe
- yt-dlp

### Transcription

- faster-whisper

## Repository Structure

Expected structure:

```text
apps/
  web/
    app/
    components/
    features/
    lib/
  api/
    app/
      main.py
      routers/
      services/
      workers/
      models/
      schemas/
packages/
  shared/
infra/
scripts/
docs/
## Development server

- Do not start `npm run dev` if http://localhost:3000 is already responding.
- Before starting the dev server, check `curl http://localhost:3000`.
- Do not use fixed `sleep 20`.
- Use a polling loop and continue as soon as HTTP 200 is returned.
- Prefer editing files directly and running targeted checks.
## Running the app

The Next.js dev server is long-running.

Rules:
- Do not run `npm run dev` in the foreground.
- First check whether the app is already running:
  `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
- If it is already responding, reuse it.
- If it must be started, use:
  `nohup npm run dev > /tmp/next-dev.log 2>&1 &`
- Never wait for `npm run dev` to exit.
- Never use a fixed `sleep 20`.
- Poll `http://localhost:3000` and continue as soon as it responds.
- If the app does not respond, inspect `/tmp/next-dev.log`.
GItでコミットとpushをする