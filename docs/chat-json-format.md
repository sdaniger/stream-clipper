# Chat JSON Import Format

Stream Clipper supports a simple normalized chat format for rule-based highlight analysis.

The JSON root must be an array of chat message objects:

```json
[
  {
    "timestamp_seconds": 1234,
    "author_name": "user1",
    "message": "草"
  }
]
```

## Fields

- `timestamp_seconds`: non-negative number. Timestamp in seconds from the start of the archive.
- `author_name`: non-empty string. Display name or stable user label.
- `message`: string. Chat message text.

## Current Analysis Rules

- Messages are grouped into 30-second buckets.
- Highlight candidates are generated from chat volume spikes, unique chatter count, repeated phrases, and reaction keywords.
- Reaction hints currently include laughter, surprise, praise, and clip requests.
- Generated candidates are review suggestions only. The source archive still needs manual confirmation.

See `docs/sample-chat.json` for a small test fixture.

## Chat Sources

Current source adapters are conceptualized as:

- `manual_json`: paste JSON directly into the UI.
- `imported_file`: load a local `.json` file into the UI.
- `chat_downloader`: optional server-side adapter using the `chat_downloader` CLI.
- `future_twitch_live_capture`: reserved for later.
- `future_platform_api`: reserved for later.

## Optional chat-downloader Flow

Install the optional Python CLI in the environment where the Next.js app runs:

```bash
pip install chat-downloader
chat_downloader --version
```

Manual test:

1. Run the web app with `npm run dev`.
2. Open `Chat JSON import`.
3. Enter a supported livestream, VOD, or clip URL in `chat-downloader URL`.
4. Set `Max messages` if needed.
5. Choose `append` or `replace`.
6. Click `Fetch and append` or `Fetch and replace`.
7. Confirm candidates appear in the queue.
8. Confirm normalized chat JSON was written under `media/output/chat_logs/`.

The adapter stores:

- Raw chat-downloader JSONL: `media/output/chat_logs/chat_downloader_*.jsonl`
- Normalized app JSON: `media/output/chat_logs/chat_downloader_*.normalized.json`

Manual JSON import remains the fallback if `chat_downloader` is not installed or a platform URL is unsupported.
