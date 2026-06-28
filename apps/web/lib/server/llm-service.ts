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
 */

export type LlmProvider = "groq" | "gemini" | "openai";

export type LlmEvaluation = {
  summary: string;
  highlights: string[];
  interestingness: number;
  reason: string;
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

const SYSTEM_PROMPT =
  "あなたは配信クリップの文字起こしを評価する専門家です。" +
  "以下の会話文字起こしを読んで、指定された JSON 形式だけを返答してください。" +
  "余計なテキストや説明は一切含めないでください。" +
  "summary は日本語で3行以内。highlights は盛り上がった瞬間を日本語で2〜3個。" +
  "interestingness は 1〜100 の整数値。reason はなぜそのスコアかを日本語で簡潔に。" +
  "返すのは必ず以下の JSON だけにしてください:\n" +
  '{"summary":"...","highlights":["...","..."],"interestingness":85,"reason":"..."}';

export async function evaluateClip(transcript: string, provider?: LlmProvider): Promise<LlmEvaluation> {
  const config = getLlmConfig(provider);
  if (!config.available) {
    throw new Error(config.reason ?? "LLM is not configured.");
  }

  const userPrompt = `以下は配信クリップの文字起こしです。評価してください。\n\n文字起こし:\n${transcript}`;

  if (config.provider === "gemini") {
    return callGemini(config, userPrompt);
  }
  return callOpenAiCompatible(config, userPrompt);
}

async function callGemini(
  config: { endpoint: string; model: string; apiKey: string },
  userPrompt: string
): Promise<LlmEvaluation> {
  const url = `${config.endpoint}/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 600,
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

  const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const content = candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("Gemini returned empty content.");
  }

  return parseLlmResponse(content);
}

async function callOpenAiCompatible(
  config: { endpoint: string; model: string; apiKey: string; provider: LlmProvider },
  userPrompt: string
): Promise<LlmEvaluation> {
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
      temperature: 0.5,
      max_tokens: 600,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${config.provider} API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`${config.provider} API error: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty content.");
  }

  return parseLlmResponse(content);
}

function parseLlmResponse(raw: string): LlmEvaluation {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`LLM response not valid JSON. Raw: "${raw.slice(0, 200)}"`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as Partial<LlmEvaluation>;

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.filter((h): h is string => typeof h === "string").slice(0, 3)
    : [];
  const interestingness = typeof parsed.interestingness === "number"
    ? Math.max(1, Math.min(100, Math.round(parsed.interestingness)))
    : 50;
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

  return { summary, highlights, interestingness, reason };
}
