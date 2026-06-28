export type CommentOverlayMode = "scroll" | "top" | "bottom";

export type CommentOverlayCategory = "laughter" | "surprise" | "praise" | "clip" | "normal";

export type CommentOverlayItem = {
  id: string;
  time: number;
  text: string;
  userId?: string;
  mode: CommentOverlayMode;
  color: string;
  size: number;
  lane?: number;
  duration: number;
  weight?: number;
  category?: CommentOverlayCategory;
};

export type CommentOverlaySettings = {
  enabled: boolean;
  density: "low" | "medium" | "high" | "danmaku";
  syncOffsetSeconds: number;
  displayArea: "full" | "top" | "bottom";
  fontSize: "small" | "medium" | "large";
  colorMode: "white" | "reaction";
  hideUserNames: boolean;
  filterUrls: boolean;
  filterLongComments: boolean;
  filterRepeatedComments: boolean;
  fontName: string;
  outlineWidth: number;
  maxPerSecond: number;
  /** Maximum character length before a comment is filtered. */
  longCommentLimit: number;
  /** Window in ms for detecting repeated comments. */
  repeatedCommentWindowMs: number;
};

export type CommentExportBundle = {
  version: 1;
  candidateId: string;
  candidateTitle: string;
  generatedAt: string;
  clipDurationSeconds: number;
  resolution: {
    width: number;
    height: number;
  };
  settings: CommentOverlaySettings;
  comments: CommentOverlayItem[];
  files: {
    jsonFileName: string;
    assFileName: string;
  };
};

export type CommentExportPayload = CommentExportBundle;
