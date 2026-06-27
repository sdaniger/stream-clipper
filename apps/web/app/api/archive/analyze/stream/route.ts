import { runArchiveAutoAnalysis, type ArchiveAutoAnalyzeInput, type ArchiveProgressEvent } from "@/lib/server/archive-analysis-service";

export const runtime = "nodejs";

function encodeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  let body: Partial<ArchiveAutoAnalyzeInput>;
  try {
    body = (await request.json()) as Partial<ArchiveAutoAnalyzeInput>;
  } catch {
    return new Response(encodeSSE("error", { error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }

  if (typeof body.url !== "string") {
    return new Response(encodeSSE("error", { error: "url must be an archive URL string." }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(new TextEncoder().encode(encodeSSE(event, data)));
        } catch {
          // Client disconnected
        }
      };

      try {
        const result = await runArchiveAutoAnalysis(body as ArchiveAutoAnalyzeInput, (progress: ArchiveProgressEvent) => {
          send("progress", progress);
        });
        send("complete", result);
      } catch (error) {
        send("error", { error: error instanceof Error ? error.message : "Unknown archive auto-analysis error" });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
