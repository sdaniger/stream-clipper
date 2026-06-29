export type CandidateStatus = "selected" | "pending" | "rejected";

export type TranscriptSegment = {
  start: string;
  end: string;
  speaker: string;
  text: string;
  highlight?: boolean;
};

export type ClipTranscriptOutput = {
  jsonPath: string;
  srtPath: string;
  txtPath: string;
};

export type ClipTranscription = {
  engine: string;
  model: string;
  device: string;
  computeType: string;
  language: string | null;
  durationSeconds: number | null;
  text: string;
  segments: TranscriptSegment[];
  srt: string;
  txt: string;
  outputs: ClipTranscriptOutput;
  createdAt: string;
};

export type GeneratedClipReference = {
  inputPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  start: string;
  duration: string;
  mode: "copy" | "reencode";
  commandPreview: string;
  sizeBytes: number;
};

export type CommentBurnedClipReference = {
  candidateId: string;
  variantId?: string;
  inputClipPath: string;
  assPath: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type CommentAssetReference = {
  candidateId: string;
  jsonPath: string;
  assPath: string;
  jsonFileName: string;
  assFileName: string;
  createdAt: string;
};

export type ExportPackageAssetReference = {
  label: string;
  kind: "video" | "transcript" | "comments" | "thumbnail";
  fileName: string;
  packagePath: string;
  sourcePath?: string;
  sizeBytes: number;
};

export type ExportPackageReference = {
  candidateId: string;
  packagePath: string;
  absolutePackagePath: string;
  metadataPath: string;
  notesPath: string;
  copiedAssets: ExportPackageAssetReference[];
  createdAt: string;
};

export type ThumbnailCandidateReference = {
  candidateId: string;
  sourceClipPath: string;
  timestamp: string;
  outputPath: string;
  absoluteOutputPath: string;
  commandPreview: string;
  createdAt: string;
};

export type RepresentativeComment = {
  time: string;
  author: string;
  text: string;
  intensity: "low" | "medium" | "high";
};

export type DetectionReason = {
  label: string;
  detail: string;
  score: number;
};

export type CandidateWarning = {
  label: string;
  detail: string;
  severity: "low" | "medium" | "high";
};

export type ClipCandidateMarker = {
  id: string;
  time: string;
  label: string;
  kind: "setup" | "funny" | "peak" | "ending" | "note";
};

export type ClipCandidateVariant = {
  id: string;
  label: string;
  start: string;
  end: string;
  duration: string;
  description: string;
  tradeoff: string;
  recommended?: boolean;
};

export type ClipCandidateNotes = {
  editPlan: string;
  titleIdea: string;
  thumbnailIdea: string;
  uploadText: string;
};

export type EditorStatus = "keep" | "discard";

export type TwitchClipReference = {
  id: string;
  editUrl: string;
  previewUrl: string;
  embedUrl: string;
  duration: number;
  createdAt: string;
  broadcasterId: string;
};

export type ClipCandidate = {
  id: string;
  title: string;
  streamer: string;
  archiveTitle: string;
  /** Source VOD URL (set at pipeline import time) */
  sourceUrl?: string;
  /** Relative path to the source video file under MEDIA_ROOT (e.g. "input/downloads/video.mp4"). */
  sourceVideoPath?: string;
  detectedAt: string;
  duration: string;
  confidence: number;
  status: CandidateStatus;
  editorStatus?: EditorStatus;
  summary: string;
  whyDetected: string[];
  tags: string[];
  chat: {
    messages: number;
    peakPerMinute: number;
    topPhrases: string[];
    sentiment: string;
  };
  peak: {
    offset: string;
    label: string;
    intensity: number;
    sparkline: number[];
  };
  transcript: string[];
  transcriptSegments: TranscriptSegment[];
  generatedClip?: GeneratedClipReference;
  commentAssets?: CommentAssetReference;
  commentBurnedClip?: CommentBurnedClipReference;
  exportPackage?: ExportPackageReference;
  thumbnailCandidates?: ThumbnailCandidateReference[];
  transcription?: ClipTranscription;
  /** Real-time NicoNico comment overlay items generated during the pipeline. */
  commentOverlayItems?: Array<{
    id: string;
    time: number;
    text: string;
    userId?: string;
    mode: string;
    color: string;
    size: number;
    lane?: number;
    duration: number;
    weight?: number;
    category?: string;
  }>;
  /** LLM evaluation results (summary + interestingness). */
  llmEvaluation?: {
    title?: string;
    summary: string;
    keyMoments?: Array<{ label: string; quote: string }>;
    highlights?: string[];
    interestingness: number;
    viralPotential?: number;
    contentType?: "funny" | "exciting" | "wholesome" | "dramatic" | "informative" | "skill" | "fail" | "reaction" | "chat_highlight" | "other";
    targetAudience?: string;
    audienceReaction?: string;
    language?: string;
    reasoning?: string;
    reason?: string;
    evaluatedBy?: string;
  };
  /** VOD timestamp link for Twitch VOD (e.g. https://twitch.tv/videos/123?t=1h23m45s) */
  vodTimestampUrl?: string;
  /** Twitch clip created via Helix API */
  twitchClip?: TwitchClipReference;
  representativeComments: RepresentativeComment[];
  detectionReasons: DetectionReason[];
  warnings: CandidateWarning[];
  notes: ClipCandidateNotes;
  markers: ClipCandidateMarker[];
  variants: ClipCandidateVariant[];
  selectedVariantId: string;
  visualTone: string;
};

export const statusLabels: Record<CandidateStatus, string> = {
  selected: "Selected",
  pending: "Pending",
  rejected: "Rejected"
};

