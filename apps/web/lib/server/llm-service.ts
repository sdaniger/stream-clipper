/**
 * Multi-provider LLM client for clip evaluation.
 *
 * Providers:
 *   - "groq"   – Groq OpenAI-compatible API (llama-3.3-70b-versatile)
 *   - "gemini" – Google Gemini API (gemini-2.0-flash)
 *   - "openai" – OpenAI-compatible API (any model)
 *
 * Configure via environment variables:
 *   LLM_PROVIDER  – "groq" | "gemini" | "openai" (default: "gemini")
 *   LLM_API_KEY   – API key
 *   LLM_MODEL     – model name (optional, has provider-specific defaults)
 *   LLM_API_URL   – custom endpoint (optional, has provider-specific defaults)
 *
 * The evaluator returns a rich assessment tailored to VTuber / streamer
 * archive clips: a one-line clip title, a 2–3 sentence summary, the most
 * quotable moments, separate "interestingness" (intrinsic quality) and
 * "viralPotential" (shareability) scores, a contentType label, a
 * targetAudience hint, the predicted audience reaction, the language
 * actually used, and a short reasoning block.
 */

import { createHash } from "node:crypto";

export type LlmProvider = "groq" | "gemini" | "openai";

export type LlmContentType =
  | "funny"
  | "exciting"
  | "wholesome"
  | "dramatic"
  | "informative"
  | "skill"
  | "fail"
  | "reaction"
  | "chat_highlight"
  | "other";

export type LlmEvaluation = {
  /** Short, catchy clip title in Japanese (max 30 chars). */
  title: string;
  /** 2–3 sentence Japanese summary of what happens. */
  summary: string;
  /** Up to 3 standout moments with short labels and quoted lines. */
  keyMoments: Array<{ label: string; quote: string }>;
  /** Intrinsic quality 1–100: how interesting is the content itself. */
  interestingness: number;
  /** Shareability 1–100: how likely this clip is to spread on socials. */
  viralPotential: number;
  /** Category label for the clip. */
  contentType: LlmContentType;
  /** 1–2 sentence hint about who would enjoy this clip. */
  targetAudience: string;
  /** Predicted viewer reaction: laughter, hype, surprise, … */
  audienceReaction: string;
  /** Detected dominant language ("ja" / "en" / "mixed" / etc.). */
  language: string;
  /** Why the scores landed where they did (Japanese, ≤2 sentences). */
  reasoning: string;
  /** Provider + model that produced this evaluation. */
  evaluatedBy: string;
};

export type LlmStatus = {
  available: boolean;
  provider: LlmProvider;
  model: string;
  endpoint: string;
  reason?: string;
};

const PROVIDER_DEFAULTS: Record<LlmProvider, { endpoint: string; model: string }> = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  gemini: {
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
  },
  openai: {
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
};

export function getLlmConfig(overrideProvider?: LlmProvider) {
  const provider = overrideProvider ?? (process.env.LLM_PROVIDER ?? "gemini").trim() as LlmProvider;
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.gemini;
  const endpoint = (process.env.LLM_API_URL ?? defaults.endpoint).trim();
  const model = (process.env.LLM_MODEL ?? defaults.model).trim();

  const apiKey =
    process.env.LLM_API_KEY?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "";

  if (!apiKey) {
    return {
      available: false as const,
      provider,
      model,
      endpoint,
      apiKey: "",
      reason: "No API key found. Set LLM_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY in .env.",
    };
  }

  return { available: true as const, provider, model, endpoint, apiKey };
}

export function getLlmStatus(): LlmStatus {
  const config = getLlmConfig();
  return {
    available: config.available,
    provider: config.provider,
    model: config.model,
    endpoint: config.endpoint,
    reason: "reason" in config ? config.reason : undefined,
  };
}

// In-memory cache keyed by the SHA-256 of the transcript (first 32k chars).
// Avoids re-billing the LLM for the same clip after a page reload.
const evaluationCache = new Map<string, { result: LlmEvaluation; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_MAX_ENTRIES = 200;

function cacheKey(transcript: string): string {
  // Normalize: collapse whitespace before hashing so formatting-only
  // differences (e.g. trailing newlines) still hit the cache.
  const normalized = transcript.replace(/\s+/g, " ").trim().slice(0, 32_000);
  return createHash("sha256").update(normalized).digest("hex");
}

function getCachedEvaluation(transcript: string): LlmEvaluation | null {
  const key = cacheKey(transcript);
  const entry = evaluationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    evaluationCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedEvaluation(transcript: string, result: LlmEvaluation): void {
  const key = cacheKey(transcript);
  if (evaluationCache.size > CACHE_MAX_ENTRIES) {
    // Evict oldest.
    const oldest = evaluationCache.keys().next().value;
    if (oldest) evaluationCache.delete(oldest);
  }
  evaluationCache.set(key, { result, ts: Date.now() });
}

const SYSTEM_PROMPT = `あなたは VTuber / 配信者アーカイブの切り抜き編集者です。
以下の文字起こしを読み、切り抜きとしての「価値」と「映え」を多角的に評価してください。
評価は JSON のみで返答し、前後の文章やコードブロックは絶対に出力しないでください。

# スコアリング指針

- interestingness (1–100): コンテンツ自体の面白さ。会話の濃密さ、情報の新しさ、スキルの高さ、笑い・驚きの密度、独創性で判断。
- viralPotential (1–100): SNS での拡散しやすさ。ゼロコンテキストで伝わるか、感情の瞬間があるか、引用しやすい名言があるか、ミーム化しやすいかで判断。
- 両者は独立して評価 (例: 高品質だが地味 = interestingness 高い / viralPotential 低い)。

# 各フィールドの形式

- title: 切り抜きとして使える日本語のタイトル (30 文字以内、煽りすぎ禁止、内容と整合)。
- summary: 内容を 2〜3 文で要約 (日本語)。専門用語はそのまま使って OK。
- keyMoments: 印象的な瞬間を最大 3 個。{ "label": "短いラベル", "quote": "発言そのまま (50 文字以内)" }。
- contentType: 以下のいずれか。複数該当しそうな場合は最も強いものを 1 つ。
  funny / exciting / wholesome / dramatic / informative / skill / fail / reaction / chat_highlight / other
- targetAudience: この切り抜きを楽しみそうな層を 1〜2 文で (例: 「FPS プレイヤー」「ASMR 好き」「初見さん」)。
- audienceReaction: 視聴者の予想リアクション (例: 「爆笑」「涙腺崩壊」「コメント欄が W 連打」)。
- language: 主要な言語コード ("ja", "en", "mixed", "zh", "ko" 等)。
- reasoning: スコア根拠を 2 文以内 (日本語)。

# 出力形式 (厳守)

{
  "title": "...",
  "summary": "...",
  "keyMoments": [{"label":"...","quote":"..."}],
  "interestingness": 75,
  "viralPotential": 60,
  "contentType": "funny",
  "targetAudience": "...",
  "audienceReaction": "...",
  "language": "ja",
  "reasoning": "..."
}`;

const VALID_CONTENT_TYPES: readonly LlmContentType[] = [
  "funny",
  "exciting",
  "wholesome",
  "dramatic",
  "informative",
  "skill",
  "fail",
  "reaction",
  "chat_highlight",
  "other",
];

function clampScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function sanitizeString(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, maxLen) || fallback;
}

function parseLlmResponse(raw: string, evaluatedBy: string): LlmEvaluation {
  // Strip code fences if the model wrapped the JSON in ```json ... ```.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1] : raw;

  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM response not valid JSON. Raw: "${raw.slice(0, 200)}"`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  const rawKeyMoments = Array.isArray(parsed.keyMoments) ? parsed.keyMoments : [];
  const keyMoments: LlmEvaluation["keyMoments"] = [];
  for (const entry of rawKeyMoments.slice(0, 3)) {
    if (entry && typeof entry === "object") {
      const label = sanitizeString((entry as Record<string, unknown>).label, 30, "");
      const quote = sanitizeString((entry as Record<string, unknown>).quote, 100, "");
      if (label || quote) {
        keyMoments.push({ label, quote });
      }
    }
  }

  const contentTypeRaw = typeof parsed.contentType === "string" ? parsed.contentType.trim() : "";
  const contentType: LlmContentType = (VALID_CONTENT_TYPES as readonly string[]).includes(contentTypeRaw)
    ? (contentTypeRaw as LlmContentType)
    : "other";

  return {
    title: sanitizeString(parsed.title, 30, "切り抜き"),
    summary: sanitizeString(parsed.summary, 400, "要約を生成できませんでした。"),
    keyMoments,
    interestingness: clampScore(parsed.interestingness, 50),
    viralPotential: clampScore(parsed.viralPotential, 50),
    contentType,
    targetAudience: sanitizeString(parsed.targetAudience, 120, "—"),
    audienceReaction: sanitizeString(parsed.audienceReaction, 120, "—"),
    language: sanitizeString(parsed.language, 12, "ja"),
    reasoning: sanitizeString(parsed.reasoning, 240, ""),
    evaluatedBy,
  };
}

export type EvaluateClipInput = {
  /** Plain transcript text (concatenated segments). */
  transcript?: string;
  /** Alternative: structured segments with timestamps. */
  segments?: Array<{ start: number; end: number; text: string }>;
  /** Optional provider override. */
  provider?: LlmProvider;
  /** Optional title/context hint to bias the evaluation. */
  context?: { streamer?: string; archiveTitle?: string };
  /** When true, bypass the in-memory cache. */
  noCache?: boolean;
};

export async function evaluateClip(input: EvaluateClipInput): Promise<LlmEvaluation> {
  const segments = input.segments ?? [];
  const transcript = (input.transcript?.trim() || segments.map((s) => s.text).filter(Boolean).join("\n")).trim();

  if (!transcript) {
    throw new Error("transcript or segments is required.");
  }

  // Cache lookup (unless the caller explicitly disables it).
  if (!input.noCache) {
    const cached = getCachedEvaluation(transcript);
    if (cached) return cached;
  }

  const config = getLlmConfig(input.provider);
  if (!config.available) {
    throw new Error(config.reason ?? "LLM is not configured.");
  }

  const userPrompt = buildUserPrompt(transcript, segments, input.context);
  const evaluatedBy = `${config.provider}/${config.model}`;

  const raw = config.provider === "gemini"
    ? await callGemini(config, userPrompt)
    : await callOpenAiCompatible(config, userPrompt);

  const result = parseLlmResponse(raw, evaluatedBy);
  if (!input.noCache) {
    setCachedEvaluation(transcript, result);
  }
  return result;
}

function buildUserPrompt(
  transcript: string,
  segments: Array<{ start: number; end: number; text: string }>,
  context: EvaluateClipInput["context"]
): string {
  const MAX_CHARS = 16_000;
  let body: string;
  if (segments.length > 0) {
    const lines = segments
      .map((s) => `[${formatSeconds(s.start)}] ${s.text}`)
      .join("\n");
    body = lines.length > MAX_CHARS ? truncateAtBoundary(lines, MAX_CHARS) : lines;
  } else {
    body = transcript.length > MAX_CHARS ? truncateAtBoundary(transcript, MAX_CHARS) : transcript;
  }

  const ctxLines: string[] = [];
  if (context?.streamer) ctxLines.push(`配信者: ${context.streamer}`);
  if (context?.archiveTitle) ctxLines.push(`番組タイトル: ${context.archiveTitle}`);
  const ctxBlock = ctxLines.length > 0 ? `${ctxLines.join("\n")}\n\n` : "";

  return `${ctxBlock}以下は配信アーカイブから抜き出した範囲の文字起こしです。前後の文脈は無いことを前提に、単体で成立する切り抜きかを評価してください。\n\n${body}`;
}

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Truncate to the nearest newline boundary so we don't break mid-sentence.
 * Tries to keep both the start (setup) and the end (punchline) of long
 * transcripts — the middle is the most expendable.
 */
function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.4);
  const tail = maxChars - head - 60; // 60 chars for the "(...中略...)" marker
  const headPart = text.slice(0, head);
  const tailPart = text.slice(text.length - tail);
  return `${headPart}\n\n(...中略...)\n\n${tailPart}`;
}

async function callGemini(
  config: { endpoint: string; model: string; apiKey: string },
  userPrompt: string
): Promise<string> {
  const url = `${config.endpoint}/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1500,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const errorObj = data.error as { message: string } | undefined;
  if (errorObj) {
    throw new Error(`Gemini API error: ${errorObj.message}`);
  }

  const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined;
  const finishReason = candidates?.[0]?.finishReason;
  const content = candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    if (finishReason === "MAX_TOKENS") {
      throw new Error("Gemini hit max tokens before producing a JSON body. Try a shorter transcript.");
    }
    throw new Error("Gemini returned empty content.");
  }
  return content;
}

async function callOpenAiCompatible(
  config: { endpoint: string; model: string; apiKey: string; provider: LlmProvider },
  userPrompt: string
): Promise<string> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: config.provider === "openai" ? { type: "json_object" } : undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${config.provider} API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`${config.provider} API error: ${data.error.message}`);
  }

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    if (choice?.finish_reason === "length") {
      throw new Error("LLM hit max tokens before producing JSON. Try a shorter transcript.");
    }
    throw new Error("LLM returned empty content.");
  }
  return content;
}

/** For tests / external cache management. */
export function _clearLlmCache(): void {
  evaluationCache.clear();
}
