import { NextResponse } from "next/server";
import { analyzeChatEntries } from "@/lib/chat-analysis";
import { fetchChatWithChatDownloader, type FetchChatDownloaderInput } from "@/lib/server/chat-downloader-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<FetchChatDownloaderInput>;

    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url must be a livestream, VOD, or clip URL string." }, { status: 400 });
    }

    if (body.maxMessages !== undefined && typeof body.maxMessages !== "number") {
      return NextResponse.json({ error: "maxMessages must be a number when provided." }, { status: 400 });
    }

    const fetched = await fetchChatWithChatDownloader({ url: body.url, maxMessages: body.maxMessages });
    const analysis = analyzeChatEntries(fetched.normalizedMessages, `chatdl-${Date.now()}`);

    const response: Record<string, unknown> = {
      source: fetched.source,
      url: fetched.url,
      normalizedPath: fetched.normalizedPath,
      rawPath: fetched.rawPath,
      messageCount: fetched.normalizedMessages.length,
      normalizedMessages: fetched.normalizedMessages,
      commandPreview: fetched.commandPreview,
      fetchedAt: fetched.fetchedAt,
      candidates: analysis.candidates,
      summary: analysis.summary
    };

    if (fetched.partialResult) {
      response.partialResult = true;
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown chat-downloader import error" }, { status: 400 });
  }
}
