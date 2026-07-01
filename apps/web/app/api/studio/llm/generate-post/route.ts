import { NextRequest, NextResponse } from "next/server";
import { getLlmStatus } from "@/lib/server/llm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clock(seconds: unknown): string {
  const s = Math.max(0, Math.round(typeof seconds === "number" ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function fallbackPackage(candidate: any, evaluation: any, context: any) {
  const title = evaluation?.title || candidate?.title || "配信ハイライト";
  const streamer = context?.streamer || "";
  const vodTitle = context?.archiveTitle || "";
  const range = `${clock(candidate?.clip_start)}-${clock(candidate?.clip_end)}`;
  const tags = [
    "切り抜き", "ハイライト", "VTuber", "配信", "自動生成",
    candidate?.kind === "short" ? "Shorts" : candidate?.kind === "long" ? "長尺" : "通常動画",
    candidate?.category || evaluation?.contentType || "clip",
  ].filter(Boolean);
  if (streamer) tags.unshift(streamer);
  return {
    titles: [
      title,
      `${title} #${candidate?.rank || 1}`,
      `${streamer ? `${streamer} ` : ""}${range} の見どころ`,
    ].slice(0, 5),
    description: [
      evaluation?.summary || "チャット反応から自動検出した切り抜き候補です。",
      "",
      vodTitle ? `元配信: ${vodTitle}` : "",
      streamer ? `配信者: ${streamer}` : "",
      `範囲: ${range}`,
      "",
      "#切り抜き #VTuber #ハイライト",
    ].filter(Boolean).join("\n"),
    tags: Array.from(new Set(tags)).slice(0, 20),
    pinnedComment: evaluation?.audienceReaction ? `このシーンの反応: ${evaluation.audienceReaction}` : "どの場面が一番好きでしたか？",
    thumbnailText: [evaluation?.audienceReaction || "神シーン", title].filter(Boolean).slice(0, 3),
    socialPost: `${title}\n${evaluation?.summary || "配信の見どころを切り抜きました。"}`.slice(0, 240),
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
  const status = getLlmStatus();
  return NextResponse.json({
    ok: true,
    llm_status: status,
    package: fallbackPackage(body.candidate || {}, body.evaluation || null, body.context || {}),
  });
}
