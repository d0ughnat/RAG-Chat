import { NextRequest } from "next/server";
import { streamRAGResponse } from "@/lib/rag";

// Configure for longer timeout on Vercel
export const maxDuration = 60; // 60 seconds timeout
export const dynamic = "force-dynamic"; // Disable caching

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, topK = 5, documentFilter } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Valid query is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create a ReadableStream for streaming the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generator = streamRAGResponse(query.trim(), topK, documentFilter);

          for await (const item of generator) {
            if (item.type === "chunk") {
              // Stream text chunks
              const data = JSON.stringify({ type: "chunk", content: item.data });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            } else if (item.type === "sources") {
              // Send sources at the end
              const data = JSON.stringify({ type: "sources", sources: item.data });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // Signal completion
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable buffering for Nginx/proxies
      },
    });
  } catch (error) {
    console.error("Stream error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to start stream",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new Response(null, { status: 200 });
}
