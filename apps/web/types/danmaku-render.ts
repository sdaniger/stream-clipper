/**
 * Danmaku render / burn-in / preview types.
 *
 * Three comment display modes:
 *   - off:            no comments at all
 *   - preview_overlay: lightweight canvas overlay in the browser only,
 *                      used for the on-page preview
 *   - hard_burn:      comments are hard-burned into the exported MP4
 *                     using FFmpeg + libx264 + the ass= filter
 *
 * Style presets bundle font / opacity / outline / density defaults
 * so the on-page UI can offer "NicoNico style" / "Twitch-like" / etc.
 * as one-click choices. They are also recognized on the backend
 * (see apps/api/app/services/danmaku_ass.py) so the same preset name
 * is used end-to-end.
 */

export type CommentBurnInMode = "off" | "preview_overlay" | "hard_burn";

export type DanmakuStylePreset =
  | "niconico_classic"
  | "twitch_extension_like"
  | "minimal"
  | "dense";

export type DanmakuDensity = "low" | "normal" | "high" | "insane";

export type DanmakuCommentSize = "small" | "medium" | "large";

export type DanmakuRenderOptions = {
  enabled: boolean;
  burnInMode: CommentBurnInMode;
  stylePreset: DanmakuStylePreset;
  size: DanmakuCommentSize;
  density: DanmakuDensity;
  // Optional overrides (apply on top of the preset).
  fontFamily?: string;
  fontSize?: number;
  opacity?: number;
  outline?: number;
  shadow?: number;
  durationSec?: number;
  maxLanes?: number;
  maxCommentsPerSecond?: number;
  topMarginPx?: number;
  bottomMarginPx?: number;
  // Generate a hard-burn preview clip on demand (720p, ultrafast).
  hardEncodePreview?: boolean;
};

/** Default render options — used when the user has not changed anything. */
export const DEFAULT_DANMAKU_RENDER_OPTIONS: DanmakuRenderOptions = {
  enabled: true,
  burnInMode: "hard_burn",
  stylePreset: "niconico_classic",
  size: "medium",
  density: "normal",
  fontFamily: "Noto Sans JP",
  hardEncodePreview: false,
};

/** User-facing preset labels (JA / EN). */
export const STYLE_PRESET_LABEL_JA: Record<DanmakuStylePreset, string> = {
  niconico_classic: "ニコニコ風",
  twitch_extension_like: "Twitch拡張風",
  minimal: "控えめ",
  dense: "多め",
};

export const STYLE_PRESET_LABEL_EN: Record<DanmakuStylePreset, string> = {
  niconico_classic: "NicoNico classic",
  twitch_extension_like: "Twitch extension",
  minimal: "Minimal",
  dense: "Dense",
};

export const STYLE_PRESET_DESCRIPTION_JA: Record<DanmakuStylePreset, string> = {
  niconico_classic: "白文字＋黒縁の定番スタイル",
  twitch_extension_like: "Twitchの弾幕拡張に近い軽めの見た目",
  minimal: "少数コメントで邪魔にならない",
  dense: "盛り上がり重視。画面が賑やかに",
};

export const STYLE_PRESET_DESCRIPTION_EN: Record<DanmakuStylePreset, string> = {
  niconico_classic: "Classic white text with black outline",
  twitch_extension_like: "Lighter look inspired by Twitch chat extensions",
  minimal: "Few comments, low distraction",
  dense: "Lots of comments for high-energy moments",
};

export const BURN_IN_MODE_LABEL_JA: Record<CommentBurnInMode, string> = {
  off: "なし",
  preview_overlay: "プレビューのみ",
  hard_burn: "MP4に焼き込み",
};

export const BURN_IN_MODE_LABEL_EN: Record<CommentBurnInMode, string> = {
  off: "Off",
  preview_overlay: "Preview only",
  hard_burn: "Burn to MP4",
};

export const BURN_IN_MODE_DESCRIPTION_JA: Record<CommentBurnInMode, string> = {
  off: "コメントを表示しません",
  preview_overlay: "ブラウザ上の確認用です。MP4には焼き込まれません。",
  hard_burn: "コメントを動画の一部として保存。YouTube/SNSでも表示されます。",
};

export const BURN_IN_MODE_DESCRIPTION_EN: Record<CommentBurnInMode, string> = {
  off: "No comments will be shown",
  preview_overlay: "For in-browser preview only. Comments will not be in the MP4.",
  hard_burn: "Comments are saved as part of the video. They will appear on YouTube / SNS.",
};

/** Maps our size preset to a baseline font size in pixels (1080p). */
export const SIZE_TO_FONT_PX: Record<DanmakuCommentSize, number> = {
  small: 30,
  medium: 36,
  large: 44,
};

/** Maps our density preset to max comments per second. */
export const DENSITY_TO_MAX_PER_SEC: Record<DanmakuDensity, number> = {
  low: 4,
  normal: 8,
  high: 14,
  insane: 24,
};
