import { NextRequest, NextResponse } from "next/server";
import { parsePDF } from "@/lib/pdf-parser";
import { chunkDocument, ChunkConfig, DEFAULT_CHUNK_CONFIG } from "@/lib/chunker";
import { generateEmbeddings } from "@/lib/embeddings";
import { storeDocuments } from "@/lib/supabase";

// Configure for longer timeout on Vercel (PDF processing can be slow)
export const maxDuration = 60; // 60 seconds timeout
export const dynamic = "force-dynamic"; // Disable caching

// Maximum file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 10MB limit" },
        { status: 400 }
      );
    }

    // Get optional chunking configuration from form data
    const chunkSize = formData.get("chunkSize");
    const chunkOverlap = formData.get("chunkOverlap");

    const config: ChunkConfig = {
      chunkSize: chunkSize ? parseInt(chunkSize as string, 10) : DEFAULT_CHUNK_CONFIG.chunkSize,
      chunkOverlap: chunkOverlap ? parseInt(chunkOverlap as string, 10) : DEFAULT_CHUNK_CONFIG.chunkOverlap,
    };

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`Processing PDF: ${file.name} (${file.size} bytes)`);

    // Step 1: Parse PDF
    const parsedPDF = await parsePDF(buffer, file.name);
    console.log(`Parsed ${parsedPDF.totalPages} pages`);

    // Step 2: Chunk the document
    const chunks = await chunkDocument(parsedPDF, config);
    console.log(`Created ${chunks.length} chunks`);

    if (chunks.length === 0) {
      return NextResponse.json(
        { error: "No text content could be extracted from the PDF" },
        { status: 400 }
      );
    }

    // Step 3: Generate embeddings
    const texts = chunks.map((chunk) => chunk.content);
    const embeddings = await generateEmbeddings(texts);
    console.log(`Generated ${embeddings.length} embeddings`);

    // Step 4: Store in Supabase
    const documentsToStore = chunks.map((chunk, index) => ({
      content: chunk.content,
      metadata: chunk.metadata,
      embedding: embeddings[index],
    }));

    await storeDocuments(documentsToStore);
    console.log(`Stored ${documentsToStore.length} documents in Supabase`);

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${file.name}`,
      stats: {
        fileName: file.name,
        fileSize: file.size,
        totalPages: parsedPDF.totalPages,
        totalChunks: chunks.length,
        chunkConfig: config,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      {
        error: "Failed to process PDF",
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
