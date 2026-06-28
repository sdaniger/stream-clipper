import type { ChatLogEntry } from "@/lib/chat-analysis";
import type { ClipCandidate, RepresentativeComment } from "@/lib/mock-candidates";
import type { CommentExportBundle, CommentExportPayload, CommentOverlayCategory, CommentOverlayItem, CommentOverlaySettings } from "@/types/comment-overlay";

export const defaultCommentOverlaySettings: CommentOverlaySettings = {
  enabled: true,
  density: "danmaku",
  syncOffsetSeconds: 0,
  displayArea: "full",
  fontSize: "medium",
  colorMode: "white",
  hideUserNames: true,
  filterUrls: true,
  filterLongComments: true,
  filterRepeatedComments: true,
  fontName: "Noto Sans JP",
  outlineWidth: 4,
  maxPerSecond: 12,
  longCommentLimit: 40,
  repeatedCommentWindowMs: 3000
};

export const commentCategoryColors: Record<CommentOverlayCategory, string> = {
  laughter: "#ffffff",
  surprise: "#fde047",
  praise: "#67e8f9",
  clip: "#fb923c",
  normal: "#ffffff"
};

export const commentFontSizes: Record<CommentOverlaySettings["fontSize"], number> = {
  small: 36,
  medium: 52,
  large: 68
};

/** NicoNico-style line height — 60px at 1080p, scales with resolution. */
const REF_LINE_HEIGHT = 60;
function getLineHeight(canvasHeight: number) {
  return Math.max(30, Math.round(REF_LINE_HEIGHT * canvasHeight / 1080));
}

const densityModulo: Record<CommentOverlaySettings["density"], number> = {
  low: 4,
  medium: 2,
  high: 4,
  danmaku: 1
};

/**
 * Cap on how many NicoNico-style comments can be on screen at the same
 * moment. Scales with resolution.
 */
const REF_MAX_CONCURRENT = 12;
function getMaxConcurrent(canvasHeight: number) {
  return Math.max(4, Math.round(REF_MAX_CONCURRENT * canvasHeight / 1080));
}

/**
 * Narinico-style variable scroll speed. Longer comments scroll faster,
 * but the speed-variance is capped so all comments look natural.
 *
 * Formula from twitch_nico.py compute_speed_px_per_sec:
 *   base_v = (out_w + comment_w) / BASE_DWELL_SEC
 *   scale = (comment_w / REF_WIDTH_PX)^GAMMA
 *   boost = clamp(scale, SHORT_SPEED_MIN, LONG_SPEED_MAX)
 *   v = base_v * boost
 *   duration = (out_w + comment_w) / v
 *
 * For a typical 10-char comment at 52px on a 1920px screen:
 *   w ≈ 322px, base_v = 2242/5.0 = 448 px/s
 *   scale = 0.68^0.5 = 0.82, clipped to 0.80 → v = 358 px/s
 *   duration = 2242/358 = 6.3s (consistent, nice flow)
 *
 * For a 30-char long comment: w ≈ 967px, scale = 1.38^0.5 = 1.17, clipped
 * to 1.0 → v = 577 px/s, duration = 2887/577 = 5.0s (sped up, still
 * readable).
 */
const REF_SCREEN_WIDTH = 1920;
const REF_WIDTH_PX = 700;
const SPEED_GAMMA = 0.5;
const SPEED_MIN = 0.80;
const SPEED_MAX = 1.00;
const BASE_DWELL_SEC = 5.0;
const REF_SAFE_GAP_PX = 24;

const durationCache = new Map<number, number>();

/** Compute scroll duration for a comment of the given pixel width.
 *  canvasWidth defaults to 1920 (1080p) for backward compatibility. */
function computeScrollDuration(commentWidth: number, canvasWidth: number = REF_SCREEN_WIDTH): number {
  const cacheKey = commentWidth * 10000 + canvasWidth;
  const cached = durationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const safeGap = Math.round(REF_SAFE_GAP_PX * canvasWidth / REF_SCREEN_WIDTH);
  const rawBase = (canvasWidth + commentWidth + safeGap) / BASE_DWELL_SEC;
  const scaleRaw = Math.pow(commentWidth / Math.max(1, REF_WIDTH_PX), SPEED_GAMMA);
  const boost = Math.min(SPEED_MAX, Math.max(SPEED_MIN, scaleRaw));
  const v = rawBase * boost;
  const result = (canvasWidth + commentWidth + safeGap) / Math.max(0.01, v);
  if (durationCache.size > 2000) durationCache.clear();
  durationCache.set(cacheKey, result);
  return result;
}

export function categorizeComment(text: string): CommentOverlayCategory {
  const normalized = text.toLowerCase();

  if (/草|ｗｗ|www|笑|lol/.test(normalized)) {
    return "laughter";
  }

  if (/え[?？]?|は[?？]?|まって|待って|うそ|やば|何今の/.test(normalized)) {
    return "surprise";
  }

  if (/神|うま|うますぎ|すご|ナイス|天才|最高/.test(normalized)) {
    return "praise";
  }

  if (/切り抜き|クリップ|clip|ここ|今の/.test(normalized)) {
    return "clip";
  }

  return "normal";
}

export function generateCommentOverlayItems(candidate: ClipCandidate, durationSeconds: number, settings?: Partial<CommentOverlaySettings>): CommentOverlayItem[] {
  const mergedSettings = { ...defaultCommentOverlaySettings, ...settings };
  const sourceComments = buildSourceComments(candidate);
  const safeDuration = Math.max(12, durationSeconds);
  const fontSize = commentFontSizes[mergedSettings.fontSize];
  // Spread all repeated comments evenly across the full clip span so the
  // overlay doesn't cluster everything in the first 20 seconds.
  let index = 0;
  const totalCount = sourceComments.reduce(
    (sum, c) => sum + (c.intensity === "high" ? 4 : c.intensity === "medium" ? 3 : 2),
    0
  );
  const repeatedComments = sourceComments.flatMap((comment) => {
    const category = categorizeComment(comment.text);
    const repeatCount = comment.intensity === "high" ? 4 : comment.intensity === "medium" ? 3 : 2;

    return Array.from({ length: repeatCount }, () => {
      const time = ((index++ / totalCount) * Math.max(8, safeDuration - 2) + 1);
      const estimatedWidth = estimateAssTextWidth(comment.text, fontSize);
      const duration = computeScrollDuration(estimatedWidth);

      return {
        id: `${candidate.id}-overlay-${index}`,
        time,
        text: comment.text,
        userId: comment.author,
        mode: "scroll" as const,
        color: mergedSettings.colorMode === "reaction" ? commentCategoryColors[category] : "#ffffff",
        size: fontSize,
        duration: roundTime(duration),
        weight: comment.intensity === "high" ? 3 : comment.intensity === "medium" ? 2 : 1,
        category
      };
    });
  });

  return repeatedComments.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/**
 * Build a NicoNico-style comment overlay from the ACTUAL chat messages that
 * fell in the candidate's clip time window. This matches the narinico tool's
 * approach: every real message at its real timestamp gets its own scrolling
 * comment, so the output video's danmaku timeline matches the live stream.
 *
 * The candidate is only used to derive a stable id prefix and the top
 * representative comments for any fallback in case the chat slice is
 * empty (very short windows with no chat).
 *
 * Settings applied here:
 *  - syncOffsetSeconds: shifts every message forward (+) or backward (-)
 *    in time. The narinico tool's COMMENT_OFFSET_SEC is wired through this.
 *  - filterUrls / filterLongComments / filterRepeatedComments: drop junk
 *    before they reach the renderer.
 *  - maxPerSecond: rate-limit the danmaku stream so a chat explosion
 *    doesn't crash the renderer. Excess messages are dropped with the
 *    same dedup window as filterRepeatedComments to avoid noise.
 *  - long comments speed up: the narinico tool's "long messages scroll
 *    faster" trick, applied here so a 30-character comment doesn't sit
 *    on screen forever.
 */
export function generateCommentOverlayItemsFromChat(
  candidate: ClipCandidate,
  chatEntries: ChatLogEntry[],
  clipStartSeconds: number,
  clipEndSeconds: number,
  settings: CommentOverlaySettings
): CommentOverlayItem[] {
  const windowMs = settings.filterRepeatedComments ? settings.repeatedCommentWindowMs : 0;
  const recentText = new Map<string, number>();
  const out: CommentOverlayItem[] = [];

  for (let index = 0; index < chatEntries.length; index += 1) {
    const entry = chatEntries[index];
    const raw = entry.message ?? "";
    const text = raw.trim();
    if (!text) continue;

    const absSeconds = entry.timestamp_seconds ?? 0;
    if (absSeconds < clipStartSeconds || absSeconds > clipEndSeconds) continue;

    // sync offset: shift the whole danmaku stream. Clamp early
    // messages to 0 instead of dropping them — a syncOffset of -4
    // means "show this message a bit earlier," not "delete it."
    let relativeSeconds = absSeconds - clipStartSeconds + settings.syncOffsetSeconds;
    if (relativeSeconds < 0) relativeSeconds = 0;

    if (settings.filterUrls && /(https?:\/\/|www\.)/i.test(text)) continue;
    if (settings.filterLongComments && text.length > settings.longCommentLimit) continue;

    if (settings.filterRepeatedComments) {
      const key = text.toLowerCase();
      const lastTime = recentText.get(key);
      if (lastTime !== undefined && relativeSeconds * 1000 - lastTime < windowMs) continue;
      recentText.set(key, relativeSeconds * 1000);
    }

    const category = categorizeComment(text);
    const fontSize = commentFontSizes[settings.fontSize];
    const estimatedWidth = estimateAssTextWidth(text, fontSize);
    const duration = computeScrollDuration(estimatedWidth);

    out.push({
      id: `${candidate.id}-chat-${index}`,
      time: roundTime(relativeSeconds),
      text,
      userId: entry.author_name,
      mode: "scroll",
      color: settings.colorMode === "reaction" ? commentCategoryColors[category] : "#ffffff",
      size: commentFontSizes[settings.fontSize],
      duration: roundTime(duration),
      weight: 1,
      category
    });
  }

  // Density filter (matches the narinico tool's "show fewer comments" option)
  const modulo = densityModulo[settings.density];
  const filtered = settings.density === "danmaku"
    ? out
    : out.filter((_, index) => index % modulo === 0);

  // Per-second cap: drop excess if more than maxPerSecond in any 1s bucket
  const capped = capByPerSecond(filtered, settings.maxPerSecond);

  return capped.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function capByPerSecond(items: CommentOverlayItem[], maxPerSecond: number): CommentOverlayItem[] {
  if (maxPerSecond <= 0) return items;
  const counts = new Map<number, number>();
  const out: CommentOverlayItem[] = [];
  for (const item of items) {
    const bucket = Math.floor(item.time);
    const current = counts.get(bucket) ?? 0;
    if (current >= maxPerSecond) continue;
    counts.set(bucket, current + 1);
    out.push(item);
  }
  return out;
}

export function prepareOverlayComments(
  comments: CommentOverlayItem[],
  settings: CommentOverlaySettings,
  canvasHeight: number,
  canvasWidth: number = REF_SCREEN_WIDTH
): CommentOverlayItem[] {
  const fontSize = commentFontSizes[settings.fontSize];
  const lh = getLineHeight(canvasHeight);
  const safeGap = Math.round(REF_SAFE_GAP_PX * canvasWidth / REF_SCREEN_WIDTH);
  // Density is already applied in generateCommentOverlayItemsFromChat.
  // Only re-apply content filters (URL / long / repeated) as a safety net
  // for comments coming from the fallback synthetic generator.
  const filtered = applyCommentFilters(comments, settings);
  const lanes = Math.max(1, Math.floor(getDisplayArea(canvasHeight, settings.displayArea).height / lh));
  const laneAvailability = Array.from({ length: lanes }, () => 0);
  const laneLastSpeed = Array.from({ length: lanes }, () => Infinity);

  return filtered.map((comment) => {
    const estimatedWidth = estimateAssTextWidth(comment.text, fontSize);
    let scrollDuration = computeScrollDuration(estimatedWidth, canvasWidth);
    const lane = chooseLane(laneAvailability);
    // Speed inheritance: don't make this comment scroll faster than
    // the previous one on the same lane (same as narinico).
    const currentSpeed = (canvasWidth + estimatedWidth + safeGap) / Math.max(0.01, scrollDuration);
    if (currentSpeed > laneLastSpeed[lane]) {
      // Clamp to the slower speed — recompute duration from the max speed.
      scrollDuration = (canvasWidth + estimatedWidth + safeGap) / Math.max(0.01, laneLastSpeed[lane]);
    }
    const finalSpeed = (canvasWidth + estimatedWidth + safeGap) / Math.max(0.01, scrollDuration);
    laneLastSpeed[lane] = Math.min(finalSpeed, laneLastSpeed[lane]);
    // Full duration occupancy — narinico-style: the lane is freed when
    // the comment has fully exited the screen, including safe gap.
    laneAvailability[lane] = comment.time + scrollDuration;

    return {
      ...comment,
      lane,
      size: fontSize,
      color: settings.colorMode === "reaction" ? commentCategoryColors[comment.category ?? "normal"] : "#ffffff",
      duration: scrollDuration
    };
  });
}

export function applyCommentFilters(comments: CommentOverlayItem[], settings: CommentOverlaySettings): CommentOverlayItem[] {
  const seen = new Map<string, number>();

  return comments.filter((comment) => {
    const text = comment.text.trim();

    if (!text) {
      return false;
    }

    if (settings.filterUrls && /(https?:\/\/|www\.)/i.test(text)) {
      return false;
    }

    if (settings.filterLongComments && text.length > settings.longCommentLimit) {
      return false;
    }

    if (settings.filterRepeatedComments) {
      const key = text.toLowerCase();
      const lastTime = seen.get(key);
      seen.set(key, comment.time);

      if (lastTime !== undefined && comment.time - lastTime < settings.repeatedCommentWindowMs / 1000) {
        return false;
      }
    }

    return true;
  });
}

export function getDisplayArea(canvasHeight: number, displayArea: CommentOverlaySettings["displayArea"]) {
  // Narinico-style margins: MARGIN_TOP=3, MARGIN_BOTTOM=80 out of 1080.
  const topPx = Math.round(canvasHeight * 3 / 1080);
  const bottomPx = Math.round(canvasHeight * 80 / 1080);

  if (displayArea === "top") {
    return { top: topPx, height: canvasHeight * 0.5 };
  }

  if (displayArea === "bottom") {
    return { top: canvasHeight * 0.5, height: canvasHeight * 0.5 - bottomPx };
  }

  return { top: topPx, height: canvasHeight - topPx - bottomPx };
}

export function getCommentY(lane: number, canvasHeight: number, settings: CommentOverlaySettings) {
  const area = getDisplayArea(canvasHeight, settings.displayArea);
  const lh = getLineHeight(canvasHeight);
  return area.top + lane * lh + lh * 0.85;
}

export function getActiveCommentPosition(
  comment: CommentOverlayItem,
  currentTime: number,
  canvasWidth: number,
  textWidth: number,
  _settings: CommentOverlaySettings
) {
  // syncOffset is already applied in generateCommentOverlayItemsFromChat,
  // so we use comment.time directly to avoid double-application.
  const elapsed = currentTime - comment.time;

  if (elapsed < 0 || elapsed > comment.duration) {
    return null;
  }

  const progress = elapsed / comment.duration;
  return canvasWidth - progress * (canvasWidth + textWidth);
}

export function createCommentExportPayload({
  candidate,
  comments,
  settings,
  duration,
  width = 1920,
  height = 1080
}: {
  candidate: ClipCandidate;
  comments: CommentOverlayItem[];
  settings: CommentOverlaySettings;
  duration: number;
  width?: number;
  height?: number;
}): CommentExportBundle {
  const exportComments = prepareOverlayComments(comments, settings, height, width).map((comment) => ({
    ...comment,
    time: roundTime(comment.time),
    duration: roundTime(comment.duration)
  })).filter((comment) => comment.time + comment.duration >= 0 && comment.time <= duration);

  return {
    version: 1,
    candidateId: candidate.id,
    candidateTitle: candidate.title,
    generatedAt: new Date().toISOString(),
    clipDurationSeconds: duration,
    resolution: { width, height },
    settings,
    comments: exportComments,
    files: {
      jsonFileName: `${sanitizeFilePart(candidate.id)}-comments.json`,
      assFileName: `${sanitizeFilePart(candidate.id)}-comments.ass`
    }
  };
}

export const createCommentExportBundle = createCommentExportPayload;

export function generateCommentsJson(payload: CommentExportPayload) {
  return JSON.stringify(payload, null, 2);
}

export function generateScrollingCommentsAss(payload: CommentExportPayload) {
  const { width, height } = payload.resolution;
  const styles = buildAssStyles(payload.settings);
  const events = payload.comments.map((comment) => {
    const fontSize = comment.size || commentFontSizes[payload.settings.fontSize];
    const lane = comment.lane ?? 0;
    const y = Math.round(getCommentY(lane, height, payload.settings));
    const estimatedTextWidth = estimateAssTextWidth(comment.text, fontSize);
    const start = Math.max(0, comment.time);
    const end = Math.max(start + 0.1, start + comment.duration);
    const color = assColor(comment.color);
    const escapedText = escapeAssText(payload.settings.hideUserNames || !comment.userId ? comment.text : `${comment.userId}: ${comment.text}`);
    const override = `{\\fs${fontSize}\\c&H${color}&\\move(${width},${y},${-estimatedTextWidth},${y})}`;

    return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},NicoComment,,0,0,0,,${override}${escapedText}`;
  });

  return [
    "[Script Info]",
    "; Generated by Stream Clipper comment export preview",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
  ].join("\n") + "\n";
}

function sanitizeFilePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "comments";
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildSourceComments(candidate: ClipCandidate): RepresentativeComment[] {
  const representative = candidate.representativeComments.length > 0 ? candidate.representativeComments : [];
  const topPhrases = candidate.chat.topPhrases.map((phrase, index) => ({
    time: `00:${String(index + 1).padStart(2, "0")}`,
    author: `phrase-${index}`,
    text: phrase,
    intensity: "medium" as const
  }));

  if (representative.length + topPhrases.length > 0) {
    return [...representative, ...topPhrases];
  }

  return [
    { time: "00:01", author: "mock", text: "草", intensity: "medium" },
    { time: "00:03", author: "mock", text: "うますぎ", intensity: "medium" },
    { time: "00:05", author: "mock", text: "ここ好き", intensity: "high" }
  ];
}

function buildAssStyles(settings: CommentOverlaySettings) {
  const fontName = settings.fontName || "Noto Sans JP";
  const outline = Math.max(3, Math.min(8, Math.round(settings.outlineWidth ?? 4)));
  // Bold + strong outline + semi-transparent black shadow for the
  // NicoNico-like white-text-with-black-glow look.
  return `Style: NicoComment,${fontName},36,&H00FFFFFF,&H000000FF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,1,${outline},3,7,20,20,20,1`;
}

function formatAssTime(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

function assColor(hexColor: string) {
  const normalized = hexColor.replace("#", "").padStart(6, "f").slice(0, 6);
  const red = normalized.slice(0, 2);
  const green = normalized.slice(2, 4);
  const blue = normalized.slice(4, 6);
  return `${blue}${green}${red}`.toUpperCase();
}

function escapeAssText(text: string) {
  // Only escape ASS special characters. Emoji, CJK, and all other
  // Unicode pass through unchanged — modern CJK fonts (Noto Sans JP,
  // MS PGothic) render them fine.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

const textWidthCache = new Map<string, number>();

function estimateAssTextWidth(text: string, fontSize: number) {
  const key = `${fontSize}:${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 255 ? fontSize : fontSize * 0.6;
  }
  const result = Math.max(1, Math.round(width));
  if (textWidthCache.size > 5000) textWidthCache.clear();
  textWidthCache.set(key, result);
  return result;
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function chooseLane(laneAvailability: number[]) {
  let selectedLane = 0;
  let earliestTime = laneAvailability[0] ?? 0;

  for (let index = 1; index < laneAvailability.length; index += 1) {
    if (laneAvailability[index] < earliestTime) {
      selectedLane = index;
      earliestTime = laneAvailability[index];
    }
  }

  return selectedLane;
}
