import type { ClipCandidate, RepresentativeComment } from "@/lib/mock-candidates";
import type { CommentExportBundle, CommentExportPayload, CommentOverlayCategory, CommentOverlayItem, CommentOverlaySettings } from "@/types/comment-overlay";

export const defaultCommentOverlaySettings: CommentOverlaySettings = {
  enabled: true,
  density: "high",
  syncOffsetSeconds: -4,
  displayArea: "full",
  fontSize: "medium",
  colorMode: "white",
  hideUserNames: true,
  filterUrls: true,
  filterLongComments: true,
  filterRepeatedComments: true
};

export const commentCategoryColors: Record<CommentOverlayCategory, string> = {
  laughter: "#ffffff",
  surprise: "#fde047",
  praise: "#67e8f9",
  clip: "#fb923c",
  normal: "#ffffff"
};

export const commentFontSizes: Record<CommentOverlaySettings["fontSize"], number> = {
  small: 28,
  medium: 36,
  large: 44
};

const densityModulo: Record<CommentOverlaySettings["density"], number> = {
  low: 4,
  medium: 2,
  high: 4,
  danmaku: 1
};

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

export function generateCommentOverlayItems(candidate: ClipCandidate, durationSeconds: number): CommentOverlayItem[] {
  const sourceComments = buildSourceComments(candidate);
  const safeDuration = Math.max(12, durationSeconds);
  const repeatedComments = sourceComments.flatMap((comment, sourceIndex) => {
    const category = categorizeComment(comment.text);
    const repeatCount = comment.intensity === "high" ? 4 : comment.intensity === "medium" ? 3 : 2;

    return Array.from({ length: repeatCount }, (_, repeatIndex) => {
      const time = ((sourceIndex * 2.7 + repeatIndex * 3.4 + (sourceIndex % 3) * 0.8) % Math.max(5, safeDuration - 4)) + 0.6;

      return {
        id: `${candidate.id}-overlay-${sourceIndex}-${repeatIndex}`,
        time,
        text: comment.text,
        userId: comment.author,
        mode: "scroll" as const,
        color: commentCategoryColors[category],
        size: commentFontSizes.medium,
        duration: category === "clip" ? 6.2 : 5.4,
        weight: comment.intensity === "high" ? 3 : comment.intensity === "medium" ? 2 : 1,
        category
      };
    });
  });

  return repeatedComments.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function prepareOverlayComments(
  comments: CommentOverlayItem[],
  settings: CommentOverlaySettings,
  canvasHeight: number
): CommentOverlayItem[] {
  const fontSize = commentFontSizes[settings.fontSize];
  const filtered = applyCommentFilters(comments, settings).filter((comment, index) => passesDensity(index, settings.density));
  const lanes = Math.max(1, Math.floor(getDisplayArea(canvasHeight, settings.displayArea).height / Math.max(fontSize + 8, 1)));
  const laneAvailability = Array.from({ length: lanes }, () => 0);

  return filtered.map((comment) => {
    const lane = chooseLane(laneAvailability);
    laneAvailability[lane] = comment.time + Math.max(0.75, comment.duration / 3);

    return {
      ...comment,
      lane,
      size: fontSize,
      color: settings.colorMode === "reaction" ? commentCategoryColors[comment.category ?? "normal"] : "#ffffff"
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

    if (settings.filterLongComments && text.length > 40) {
      return false;
    }

    if (settings.filterRepeatedComments) {
      const key = text.toLowerCase();
      const lastTime = seen.get(key);
      seen.set(key, comment.time);

      if (lastTime !== undefined && comment.time - lastTime < 3) {
        return false;
      }
    }

    return true;
  });
}

export function getDisplayArea(canvasHeight: number, displayArea: CommentOverlaySettings["displayArea"]) {
  if (displayArea === "top") {
    return { top: 0, height: canvasHeight * 0.45 };
  }

  if (displayArea === "bottom") {
    return { top: canvasHeight * 0.55, height: canvasHeight * 0.45 };
  }

  return { top: canvasHeight * 0.04, height: canvasHeight * 0.82 };
}

export function getCommentY(lane: number, canvasHeight: number, settings: CommentOverlaySettings) {
  const fontSize = commentFontSizes[settings.fontSize];
  const area = getDisplayArea(canvasHeight, settings.displayArea);
  return area.top + fontSize + lane * (fontSize + 8);
}

export function getActiveCommentPosition(
  comment: CommentOverlayItem,
  currentTime: number,
  canvasWidth: number,
  textWidth: number,
  settings: CommentOverlaySettings
) {
  const displayTime = comment.time + settings.syncOffsetSeconds;
  const elapsed = currentTime - displayTime;

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
  const exportComments = prepareOverlayComments(comments, settings, height).map((comment) => ({
    ...comment,
    time: roundTime(comment.time + settings.syncOffsetSeconds),
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
  const styles = buildAssStyles();
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

function buildAssStyles() {
  return "Style: NicoComment,Noto Sans JP,36,&H00FFFFFF,&H000000FF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,4,1,7,20,20,20,1";
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
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\N");
}

function estimateAssTextWidth(text: string, fontSize: number) {
  return Math.ceil(Array.from(text).reduce((total, character) => total + (character.charCodeAt(0) > 255 ? fontSize : fontSize * 0.62), 0));
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function passesDensity(index: number, density: CommentOverlaySettings["density"]) {
  if (density === "danmaku") {
    return true;
  }

  if (density === "high") {
    return index % densityModulo[density] !== 3;
  }

  return index % densityModulo[density] === 0;
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
