# NicoNico-Style Comment Export Data

This stage prepares comment files for future rendering without burning comments into video.

## Outputs

- `candidate-id-comments.json`: structured comment data, settings, timing, lanes, and resolution.
- `candidate-id-comments.ass`: ASS subtitle file with scrolling comments using `\\move()` events.

## JSON Bundle Shape

The browser export uses this structure:

```ts
type CommentExportBundle = {
  candidateId: string;
  generatedAt: string;
  clipDurationSeconds: number;
  settings: CommentOverlaySettings;
  comments: CommentOverlayItem[];
  files: {
    jsonFileName: string;
    assFileName: string;
  };
};
```

## Manual Test Flow

1. Run the frontend with `npm run dev`.
2. Open a candidate preview.
3. Switch preview mode to `コメントON` or `コメント+字幕`.
4. Adjust density, sync offset, display area, font size, color mode, and filters.
5. Confirm Canvas comments move right to left.
6. In `Comment Export Data`, download JSON and ASS.
7. Open the files in a text editor and confirm timings/settings are present.

## Current Limitations

- Export is generated in the browser only.
- ASS is preparation data for future rendering.
- No FFmpeg burn-in is performed.
- No ASS upload, persistence, or export package bundling is implemented yet.
