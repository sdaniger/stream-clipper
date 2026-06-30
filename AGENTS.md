# Stream Clipper Agent Guide

## Project Overview

This project is a livestream clipping tool for VTuber and streamer archives.

The Studio is designed as an **auto-clip pipeline**: a single Twitch / YouTube VOD URL
is enough to fetch chat, score the timeline, generate Shorts / standard / long-form
candidates, and export YouTube-ready MP4s with hard-burned ASS danmaku, all driven
by a job-based progress system.

## Core Features

- Import livestream archive URLs (Twitch VOD is the standard source)
- Fetch or import chat logs
- Score chat activity in a 30s window / 10s step sliding timeline
  (chat / unique_author / keyword / laugh / surprise / clip_worthy / burst)
- Generate **Shorts (45-90s, 9:16)**, **standard (3-5min, 16:9)**, and
  **long (8-12min, 16:9, multi-peak)** candidates separately — never stretch
  a single peak to 10 minutes
- Render the chosen candidate with hard-burned NicoNico-style ASS danmaku
  via FFmpeg + libx264 (no `-c:v copy`)
- Generate YouTube title / description / tags automatically
- Job-based progress UI (no raw activity log) with cancel + retry
- Top-5 batch generation in one click
- Polished glassmorphism UI

## Tech Stack

### Frontend (apps/web)

- Next.js 15 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- HTML video / iframe Twitch player

### Backend (apps/api)

- Python 3.11+
- FastAPI
- async job system (in-memory, single-process)
- `stream_clipper_cli` package is reused for analysis

### CLI core (packages/cli)

- `timeline_scoring`  — sliding-window scoring with sub-scores
- `candidate_pipeline` — short / medium / long candidate generators
- `youtube_metadata`  — title / description / tags generator
- `analyzer`, `scorer`, `video`, `exporter` — legacy / CLI surface

### Video Processing

- FFmpeg (libx264, hard-burn `ass=` filter)
- FFprobe
- yt-dlp (`--download-sections` for Twitch VOD range fetch)

### Transcription

- faster-whisper (still used for the legacy `transcribe` endpoint)

## Repository Structure

```text
apps/
  web/                    Next.js Studio UI
    app/
      studio/             StudioClient + page
      api/studio/
        analyze-vod/      legacy SSE analyze (still works)
        analyze-local/    legacy SSE analyze (still works)
        export-danmaku-clip/  legacy danmaku export (still works)
        jobs/             new job API proxy
          analyze/
          render/
          [jobId]/
    components/studio/    Step1 / Step2 (CandidateTabs) / Step3 / JobProgress
    lib/
      studio-jobs-api.ts  new job client
      studio-analysis.ts  legacy TS analyze
      studio-api.ts       legacy danmaku API
  api/                    FastAPI backend
    app/
      main.py
      routers/
        highlights.py     legacy
        transcription.py
        studio_jobs.py    new job endpoints
      services/
        job_state.py      stage state machine
        analyze_job.py    analyze pipeline orchestrator
        render_job.py     render pipeline orchestrator
        danmaku_ass.py    ASS file generation
        danmaku_export.py legacy export wrapper
        twitch_range_fetcher.py  yt-dlp --download-sections
packages/
  cli/stream_clipper_cli/
    timeline_scoring.py   NEW: sliding-window sub-scores
    candidate_pipeline.py NEW: short / medium / long generators
    youtube_metadata.py   NEW: title / description / tags
    analyzer.py           legacy
    scorer.py             legacy
    video.py              ffmpeg helpers
    exporter.py           CSV/JSON export
    models.py             ChatEntry, HighlightCandidate, TimelineRow
```

## Pipeline

### Analyze (POST /studio/jobs/analyze)

Stages (in order):

1. `metadata_fetching`     — yt-dlp metadata (`--dump-single-json`)
2. `chat_fetching`         — chat-downloader JSON-line stream
3. `chat_normalizing`      — drop empty / negative-timestamp messages
4. `timeline_scoring`      — sliding 30s/10s windows with sub-scores
5. `candidate_generation`  — short / medium / long generators

Each stage updates the job's `progress` field (0-100) and `current_stage`.

### Render (POST /studio/jobs/render)

Stages (in order):

1. `vod_range_fetching`    — Twitch VOD range via `yt-dlp --download-sections`
2. `ass_generation`        — NicoNico-style right-to-left comments via ASS
3. `ffmpeg_rendering`      — libx264 hard-burn (`-vf ass=...`, never `-c:v copy`)
4. `metadata_generation`   — YouTube title/description/tags JSON

### Job API surface

- `POST /studio/jobs/analyze`        — start an analyze job
- `POST /studio/jobs/render`         — start a render job
- `GET  /studio/jobs/{job_id}`       — poll progress
- `GET  /studio/jobs?job_kind=...`   — list jobs
- `POST /studio/jobs/{job_id}/cancel`— cancel an in-flight job
- `DELETE /studio/jobs/{job_id}`     — cancel + remove

The Next.js app proxies these via `apps/web/app/api/studio/jobs/*`.

### Candidate types

- **Short**: a single high-score peak, 45-90s, 9:16.
  The `clip_worthy_score`/`laugh_score`/`surprise_score` of the peak window
  drives ranking. Top-N = 5 by default.
- **Standard (medium)**: 2-3 nearby peaks merged, 3-5min, 16:9.
  Greedy cluster: pick the highest-scoring window, then merge any
  other window within 60s of any cluster member (capped at 3 peaks).
- **Long**: multi-peak cluster across an activity run, 8-12min, 16:9.
  Generated from runs of activity separated by gaps > 120s of
  below-median chat. Requires `peak_count >= 2`.
  `long_score = peak_count*2.0 + sustained*1.5 + avg*1.0 + max_peak*1.2
  + unique_author*0.8 + keyword*1.2 + coherence*2.0 - dead_air*1.5`

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

The FastAPI backend is started automatically by `npm run dev:api` (port 8000).
`STUDIO_API_BASE_URL` can be overridden in `.env`.

## Tests

CLI core tests are in `packages/cli/tests/`. Run with:

```bash
PYTHONPATH=packages/cli python3 packages/cli/tests/test_candidate_pipeline.py
```

(Requires `pytest` if you want to use the pytest runner; the tests can
also be exercised as a plain script via `python3 -c`.)
