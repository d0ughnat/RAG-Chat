import { NextRequest, NextResponse } from "next/server";
import { generateRAGResponse } from "@/lib/rag";

// Configure for longer timeout on Vercel
export const maxDuration = 60; // 60 seconds timeout
export const dynamic = "force-dynamic"; // Disable caching

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, topK = 5, documentFilter } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 }
      );
    }

    if (query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query cannot be empty" },
        { status: 400 }
      );
    }

    // Generate RAG response
    const result = await generateRAGResponse(
      query.trim(),
      topK,
      documentFilter
    );

    return NextResponse.json({
      success: true,
      answer: result.answer,
      sources: result.sources,
      contextCount: result.context.length,
    });
  } catch (error) {
    console.error("Query error:", error);
    return NextResponse.json(
      {
        error: "Failed to process query",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
