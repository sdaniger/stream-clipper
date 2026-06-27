# Local Video and FFmpeg Development Flow

This stage uses a development-safe local media directory instead of browser access to arbitrary local paths.

## Directory Layout

Default `MEDIA_ROOT` is `./media` from the repository root.

```text
media/
  input/
    archive.mp4
    downloads/
      yt-dlp downloaded archive videos
  output/
    clips/
      generated clips
    comments_ass/
      generated ASS comment files used for burn-in
    clips_with_comments/
      generated MP4 clips with comments burned in
    packages/
      editor-friendly asset package folders
    thumbnails/
      generated thumbnail candidate still frames
```

You can override the root when running the web app:

```bash
MEDIA_ROOT=/absolute/path/to/media npm run dev
```

## Manual Test Flow

1. Install `ffmpeg` and `ffprobe` so both are available on `PATH`.
2. Optionally install `yt-dlp` with `pip install yt-dlp` for archive URL downloads.
3. Confirm your FFmpeg build supports the `ass` subtitle filter for comment burn-in.
4. Put a source video at `media/input/archive.mp4`, or use `yt-dlp URL import` to download one into `media/input/downloads/`.
5. Start the app with `npm run dev`.
6. Open `Local media dev tools`.
7. Enter `input/archive.mp4` as the input path, or enter a URL and click `Download and register video`.
8. Click `Check FFmpeg`.
9. Click `Probe video` to extract FFprobe metadata.
10. Pick a candidate variant.
11. Click `Generate clip from selected variant`.
12. Check `media/output/clips/` for the generated `.mp4`.
13. Open that candidate preview.
14. Open `投稿素材` and generate thumbnail candidate JPGs if needed.
15. Check `media/output/thumbnails/` for generated still frames.
16. Adjust `Comment Preview Settings` if needed.
17. Click `コメント付きMP4生成` in `Comment Export Data`.
18. Check `media/output/comments_ass/` for the saved `.ass` file.
19. Check `media/output/clips_with_comments/` for the generated comment-burned `.mp4`.
20. Click `Generate editor package` in `Export Package Preview`.
21. Check `media/output/packages/` for `metadata.json`, `notes.md`, and copied assets.

## Current API Routes

- `GET /api/media/status`: checks `MEDIA_ROOT`, `ffmpeg`, and `ffprobe` availability.
- `POST /api/media/probe`: probes a video path relative to `MEDIA_ROOT`.
- `POST /api/media/yt-dlp/metadata`: extracts archive URL metadata with optional `yt-dlp`.
- `POST /api/media/yt-dlp/download`: downloads an archive URL into `media/input/downloads/` and returns a relative input path.
- `POST /api/media/clips`: generates a clip from a relative input path, candidate id, variant id, start time, and duration.
- `POST /api/media/thumbnails`: generates a thumbnail candidate still frame from a generated clip.
- `GET /api/media/files?path=...`: serves generated local preview assets, currently used for thumbnail JPG display/download.
- `POST /api/media/clips-with-comments`: writes or reads an ASS file under `MEDIA_ROOT`, then generates an MP4 with ASS comments burned in.
- `POST /api/media/packages`: creates an editor-friendly package folder with metadata, notes, comments, and available generated assets.

## Safety Notes

- API inputs must be paths relative to `MEDIA_ROOT`.
- Absolute paths and `..` traversal are rejected.
- yt-dlp downloads are always written under `media/input/downloads`.
- Generated clip output is always written under `media/output/clips`.
- Generated ASS files from preview settings are written under `media/output/comments_ass`.
- Comment-burned MP4 output is always written under `media/output/clips_with_comments`.
- Export packages are always written under `media/output/packages`.
- Thumbnail candidate images are always written under `media/output/thumbnails`.
- This is a development skeleton, not a production media job system.
