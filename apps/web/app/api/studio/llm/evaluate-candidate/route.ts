import { NextRequest, NextResponse } from "next/server";
import { evaluateClip, getLlmStatus, type LlmEvaluation } from "@/lib/server/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CandidateLike = {
  candidate_id?: string;
  kind?: "short" | "medium" | "long";
  clip_start?: number;
  clip_end?: number;
  peak_time?: number;
  score?: number;
  confidence?: number;
  category?: string;
  reasons?: string[];
  representative_comments?: Array<{ time_sec?: number; author?: string; message?: string; signal_score?: number }>;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function candidateTranscript(candidate: CandidateLike, chatMessages: Array<Record<string, unknown>>, transcriptSegments: Array<Record<string, unknown>>) {
  const start = num(candidate.clip_start);
  const end = num(candidate.clip_end, start + 60);
  const transcriptLines = transcriptSegments
    .filter((s) => num(s.start, -1) <= end && num(s.end, 999999) >= start)
    .map((s) => `[${Math.max(0, num(s.start) - start).toFixed(1)}s] ${String(s.text || "").trim()}`)
    .filter((line) => line.trim().length > 8);
  if (transcriptLines.length > 0) return transcriptLines.join("\n");

  const chatLines = chatMessages
    .filter((m) => {
      const ts = num(m.time_sec ?? m.timestamp, -1);
      return ts >= start && ts <= end;
    })
    .slice(0, 80)
    .map((m) => `[${Math.max(0, num(m.time_sec ?? m.timestamp) - start).toFixed(1)}s] ${String(m.author || "chat")}: ${String(m.message || "")}`)
    .filter((line) => line.trim().length > 8);
  if (chatLines.length > 0) return chatLines.join("\n");

  const reps = candidate.representative_comments || [];
  return reps.map((c) => `[${num(c.time_sec).toFixed(1)}s] ${c.author || "chat"}: ${c.message || ""}`).join("\n");
}

function recommendation(interestingness: number, viralPotential: number): "generate" | "review" | "skip" {
  const combined = interestingness * 0.55 + viralPotential * 0.45;
  if (combined >= 72) return "generate";
  if (combined >= 52) return "review";
  return "skip";
}

function bestFormat(candidate: CandidateLike, evalResult?: LlmEvaluation): "short" | "medium" | "long" {
  if (candidate.kind === "short" || candidate.kind === "medium" || candidate.kind === "long") return candidate.kind;
  if (evalResult?.viralPotential && evalResult.viralPotential >= 75) return "short";
  return "medium";
}

function fallbackEvaluation(candidate: CandidateLike, reason = "LLM is not configured") {
  const confidence = num(candidate.confidence, 55);
  const interestingness = clamp(confidence, 1, 100);
  const viralPotential = clamp(confidence + (candidate.kind === "short" ? 8 : 0), 1, 100);
  const combinedScore = clamp(interestingness * 0.55 + viralPotential * 0.45, 1, 100);
  const title = candidate.category === "funny" ? "コメント欄が沸いた爆笑シーン" : candidate.category === "surprise" ? "驚きのリアクションシーン" : "配信ハイライト";
  return {
    title,
    summary: `ルールベースの候補です。${(candidate.reasons || []).slice(0, 2).join(" / ") || "チャット反応を検出しました。"}`,
    keyMoments: (candidate.representative_comments || []).slice(0, 3).map((c) => ({ label: "代表コメント", quote: String(c.message || "").slice(0, 80) })),
    interestingness,
    viralPotential,
    contentType: candidate.category || "chat_highlight",
    targetAudience: "配信の見どころを短時間で確認したい視聴者。",
    audienceReaction: candidate.category === "funny" ? "爆笑" : "盛り上がり",
    language: "ja",
    reasoning: reason,
    evaluatedBy: "rule-fallback",
    recommendation: recommendation(interestingness, viralPotential),
    bestFormat: bestFormat(candidate),
    startOffsetSec: 0,
    endOffsetSec: 0,
    combinedScore,
    fallback: true,
  };
}

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const candidate = (body.candidate || {}) as CandidateLike;
  const chatMessages = Array.isArray(body.chatMessages) ? body.chatMessages : [];
  const transcriptSegments = Array.isArray(body.transcriptSegments) ? body.transcriptSegments : [];
  const transcript = candidateTranscript(candidate, chatMessages, transcriptSegments);
  const status = getLlmStatus();

  if (!status.available || !transcript.trim()) {
    return NextResponse.json({ ok: true, llm_status: status, evaluation: fallbackEvaluation(candidate, status.reason || "No transcript/chat context available") });
  }

  try {
    const evaluation = await evaluateClip({
      transcript,
      context: {
        streamer: body.context?.streamer || undefined,
        archiveTitle: body.context?.archiveTitle || undefined,
      },
      noCache: false,
    });
    const combinedScore = clamp(evaluation.interestingness * 0.55 + evaluation.viralPotential * 0.45, 1, 100);
    return NextResponse.json({
      ok: true,
      llm_status: status,
      evaluation: {
        ...evaluation,
        recommendation: recommendation(evaluation.interestingness, evaluation.viralPotential),
        bestFormat: bestFormat(candidate, evaluation),
        startOffsetSec: candidate.kind === "short" ? -6 : -12,
        endOffsetSec: candidate.kind === "short" ? 8 : 15,
        combinedScore,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: true, llm_status: status, evaluation: fallbackEvaluation(candidate, error instanceof Error ? error.message : "LLM evaluation failed") });
  }
}
