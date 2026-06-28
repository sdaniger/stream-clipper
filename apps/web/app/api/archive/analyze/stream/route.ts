import { NextRequest } from "next/server";
import { runArchiveAutoAnalysis, type ArchiveAutoAnalyzeInput, type ArchiveProgressEvent } from "@/lib/server/archive-analysis-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel allows max 300s on Pro/Enterprise plans. We pick a generous default
// of 600s; for long VODs the archive route scales maxDuration up to 30 min.
export const maxDuration = 1800;

function encodeSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function heartbeat(controller: ReadableStreamDefaultController) {
  try {
    controller.enqueue(new TextEncoder().encode(`: keep-alive\n\n`));
  } catch {
    // Closed
  }
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

  // Validate time range params if present.
  if (body.timeStartSeconds != null && (typeof body.timeStartSeconds !== "number" || body.timeStartSeconds < 0)) {
    return new Response(encodeSSE("error", { error: "timeStartSeconds must be a non-negative number." }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }
  if (body.timeEndSeconds != null && (typeof body.timeEndSeconds !== "number" || body.timeEndSeconds < 0)) {
    return new Response(encodeSSE("error", { error: "timeEndSeconds must be a non-negative number." }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }
  if (body.windowSeconds != null && (typeof body.windowSeconds !== "number" || body.windowSeconds < 10 || body.windowSeconds > 300)) {
    return new Response(encodeSSE("error", { error: "windowSeconds must be between 10 and 300." }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }
  if (body.clipLength != null && !["short", "standard", "long"].includes(body.clipLength)) {
    return new Response(encodeSSE("error", { error: 'clipLength must be "short", "standard", or "long".' }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" }
    });
  }

  const abortController = new AbortController();
  const signal = abortController.signal;

  // Forward client disconnect → abort the pipeline.
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(new TextEncoder().encode(encodeSSE(event, data)));
        } catch {
          // Client disconnected
        }
      };

      // Heartbeat every 15s so reverse proxies (nginx, Vercel) don't kill the connection.
      const heartbeatTimer = setInterval(() => heartbeat(controller), 15_000);
      signal.addEventListener("abort", () => clearInterval(heartbeatTimer), { once: true });

      try {
        const result = await runArchiveAutoAnalysis(
          { ...(body as ArchiveAutoAnalyzeInput), signal },
          (progress: ArchiveProgressEvent) => {
            send("progress", progress);
          }
        );
        if (signal.aborted) {
          send("cancelled", { message: "Pipeline was cancelled." });
        } else {
          send("complete", result);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          send("cancelled", { message: "Pipeline was cancelled." });
        } else {
          send("error", { error: error instanceof Error ? error.message : "Unknown archive auto-analysis error" });
        }
      } finally {
        clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
    cancel() {
      abortController.abort();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
