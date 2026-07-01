import type { Candidate } from "@/lib/studio-jobs-api";

export type StudioLlmEvaluation = {
  title: string;
  summary: string;
  keyMoments: Array<{ label: string; quote: string }>;
  interestingness: number;
  viralPotential: number;
  contentType: string;
  targetAudience: string;
  audienceReaction: string;
  language: string;
  reasoning: string;
  evaluatedBy: string;
  recommendation: "generate" | "review" | "skip";
  bestFormat: "short" | "medium" | "long";
  startOffsetSec: number;
  endOffsetSec: number;
  combinedScore: number;
  fallback?: boolean;
};

export async function evaluateStudioCandidate(input: {
  candidate: Candidate;
  chatMessages?: Array<{ timestamp: number; time_sec?: number; message: string; author?: string }>;
  transcriptSegments?: Array<{ start: number; end: number; text: string }>;
  context?: { streamer?: string | null; archiveTitle?: string | null };
  signal?: AbortSignal;
}): Promise<StudioLlmEvaluation> {
  const res = await fetch("/api/studio/llm/evaluate-candidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidate: input.candidate,
      chatMessages: input.chatMessages ?? [],
      transcriptSegments: input.transcriptSegments ?? [],
      context: input.context ?? {},
    }),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data.evaluation as StudioLlmEvaluation;
}

export async function generateStudioPostPackage(input: {
  candidate: Candidate;
  evaluation?: StudioLlmEvaluation;
  context?: { streamer?: string | null; archiveTitle?: string | null };
  signal?: AbortSignal;
}) {
  const res = await fetch("/api/studio/llm/generate-post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: input.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data.package as {
    titles: string[];
    description: string;
    tags: string[];
    pinnedComment: string;
    thumbnailText: string[];
    socialPost: string;
    fallback?: boolean;
  };
}
