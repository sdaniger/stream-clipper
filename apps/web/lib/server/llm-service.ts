/**
 * OpenAI-compatible LLM client for clip evaluation.
 *
 * Configure via environment variables — no API key = disabled gracefully.
 *
 *   LLM_API_URL   – e.g. https://api.openai.com/v1/chat/completions
 *   LLM_API_KEY   – Bearer token
 *   LLM_MODEL     – e.g. gpt-4o-mini, gpt-4o, claude-3-haiku (default: gpt-4o-mini)
 *
 * The prompt is specialized for Japanese VTuber/twitch clip evaluation:
 * given a transcript of a 1-3 minute clip, the LLM returns a structured
 * JSON object with summary, highlights, interestingness score and reasoning.
 */

export type LlmEvaluation = {
  summary: string;
  highlights: string[];
  interestingness: number;
  reason: string;
};

export type LlmStatus = {
  available: boolean;
  model: string;
  endpoint: string;
  reason?: string;
};

export function getLlmConfig() {
  const endpoint = (process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions").trim();
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  const model = (process.env.LLM_MODEL ?? "gpt-4o-mini").trim();

  if (!apiKey) {
    return {
      available: false as const,
      model,
      endpoint,
      apiKey: "",
      reason: "LLM_API_KEY is not set. Add it to your .env file."
    };
  }

  return { available: true as const, model, endpoint, apiKey };
}

export function getLlmStatus(): LlmStatus {
  const config = getLlmConfig();
  return {
    available: config.available,
    model: config.model,
    endpoint: config.endpoint,
    reason: "reason" in config ? config.reason : undefined
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

export async function evaluateClip(transcript: string): Promise<LlmEvaluation> {
  const config = getLlmConfig();
  if (!config.available) {
    throw new Error(config.reason ?? "LLM is not configured.");
  }

  const userPrompt = `以下は配信クリップの文字起こしです。評価してください。\n\n文字起こし:\n${transcript}`;

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.5,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM API returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`LLM API error: ${data.error.message}`);
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
