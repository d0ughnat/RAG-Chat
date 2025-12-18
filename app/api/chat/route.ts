import { NextRequest } from "next/server";
import { streamRAGResponse } from "@/lib/rag";

// Configure for longer timeout on Vercel
export const maxDuration = 30; // 30 seconds timeout
export const dynamic = "force-dynamic"; // Disable caching
export const fetchCache = "force-no-store"; // Ensure no caching

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, topK = 3, documentFilter } = body; // Reduced from 8 to 5

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Valid query is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create a TransformStream for better streaming control
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        let hasError = false;
        
        try {
          const generator = streamRAGResponse(query.trim(), topK, documentFilter);
          let chunkCount = 0;

          for await (const item of generator) {
            if (item.type === "chunk" && item.data) {
              chunkCount++;
              const data = JSON.stringify({ type: "chunk", content: item.data });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            } else if (item.type === "sources") {
              const data = JSON.stringify({ type: "sources", sources: item.data });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          // Signal completion with metadata
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", chunks: chunkCount })}\n\n`));
        } catch (error) {
          hasError = true;
          console.error("Stream generation error:", error);
          
          // Handle rate limit errors gracefully
          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          const isRateLimit = errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("rate");
          
          const userMessage = isRateLimit 
            ? "The AI service is temporarily busy. Please wait a moment and try again."
            : errorMsg;
          
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: userMessage, isRateLimit })}\n\n`)
          );
        } finally {
          if (!hasError) {
            controller.close();
          } else {
            controller.close();
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
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
