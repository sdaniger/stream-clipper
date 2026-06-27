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