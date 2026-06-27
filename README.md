# Stream Clipper

Frontend mock UI plus local development foundations for chat analysis, FFmpeg clip generation, and faster-whisper transcription.

## Quick start

```bash
# 1. Verify every dependency is present (and get exact install commands for what's missing)
./scripts/check-deps.sh

# 2. Install the Node workspace
npm install

# 3. Start the FastAPI transcription backend (in a separate terminal)
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/fastapi.log 2>&1 &
# (verify)
curl http://127.0.0.1:8000/api/transcription/health

# 4. Start the web app
cd ..
npm run dev
```

Open `http://localhost:3000`.

If the transcription backend is not running, the archive pipeline will still produce candidates but will print a clear warning per clip ("fetch failed — start the Python FastAPI backend on http://127.0.0.1:8000, or uncheck 'transcribe' in the archive panel").

## Web App

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local Media

Default media root is `./media`.

```text
media/input/archive.mp4
media/input/downloads/
media/output/chat_logs/
media/output/clips/
media/output/comments_ass/
media/output/clips_with_comments/
media/output/packages/
media/output/thumbnails/
media/output/transcripts/
```

See `docs/local-video-ffmpeg.md` for the FFmpeg workflow.

## Archive URL Video Import

Stream Clipper has an optional `yt-dlp` adapter for downloading archive/VOD/video URLs into the local media pipeline:

```bash
pip install yt-dlp
yt-dlp --version
```

Open `Local media dev tools`, enter an archive URL in `yt-dlp URL import`, then click `Read URL metadata` or `Download and register video`. Downloads are saved under `media/input/downloads/` and automatically become the current `inputPath` for FFprobe and FFmpeg clip generation.

## Chat Import

Manual JSON import remains available in the web UI. Stream Clipper also has an optional `chat-downloader` adapter for fetching chat from supported livestream, VOD, or clip URLs:

```bash
pip install chat-downloader
chat_downloader --version
```

Open `Chat JSON import`, enter a URL in the `chat-downloader URL` field, then click `Fetch and append` or `Fetch and replace`. The app stores raw JSONL and normalized chat JSON under `media/output/chat_logs/`, then runs the existing rule-based highlight analysis.

See `docs/chat-json-format.md` for the normalized format and manual fallback.

## Transcription Backend

The transcription API is a minimal FastAPI app under `apps/api`.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r apps/api/requirements.txt
uvicorn app.main:app --app-dir apps/api --reload --host 127.0.0.1 --port 8000
```

Useful environment variables:

```bash
MEDIA_ROOT=./media
FASTER_WHISPER_MODEL=small
FASTER_WHISPER_DEVICE=cpu
FASTER_WHISPER_COMPUTE_TYPE=int8
TRANSCRIPTION_API_BASE_URL=http://127.0.0.1:8000
```

Health check:

```bash
curl http://127.0.0.1:8000/api/transcription/health
```

Transcribe a generated clip:

```bash
curl -X POST http://127.0.0.1:8000/api/transcription/transcribe \
  -H 'Content-Type: application/json' \
  -d '{"clip_path":"output/clips/example.mp4","model":"small"}'
```

The backend writes transcript JSON, SRT, and TXT files under `media/output/transcripts/`.

## NicoNico-Style Comment Export

The candidate preview can generate frontend-only comment export files from the same settings used by the Canvas preview:

- `comments.json`
- `comments.ass`

Open a candidate preview, switch to `コメントON` or `コメント+字幕`, tune comment settings, then use `Comment Export Data` to download JSON or ASS.

## Posting Assistance

Open a candidate preview and use `投稿素材` to review title materials, title keywords, thumbnail timestamp candidates, and posting memo fields. Copy buttons help move title materials into an editor's notes.

If a clean clip has been generated, `投稿素材` can create still-frame thumbnail candidates with FFmpeg. Generated images are saved under:

```text
media/output/thumbnails/
```

This assists manual title and thumbnail work only. It does not choose a final title, design thumbnails, or upload anything.

## Comment-Burned MP4

After generating a local clip from `Local media dev tools`, open that candidate preview and click `コメント付きMP4生成` in `Comment Export Data`.

The app sends the current ASS comment data to the local Next.js API, writes the ASS file under `media/output/comments_ass/`, and runs FFmpeg to burn comments into a new MP4 under:

```text
media/output/clips_with_comments/
```

The preview panel shows the generated input clip path, saved ASS path, and comment-burned output path. This requires an FFmpeg build with the `ass` subtitle filter available. This is a local editing asset, not an upload-ready publishing workflow.

## Editor Export Package

Open a candidate preview and click `Generate editor package` in `Export Package Preview`.

The package is written under:

```text
media/output/packages/
```

Each package contains `metadata.json`, `notes.md`, current comment JSON/ASS files, and copies of available generated assets such as clean clips, comment-burned clips, and transcript files. Missing assets are left out so an editor can still package partial work.
