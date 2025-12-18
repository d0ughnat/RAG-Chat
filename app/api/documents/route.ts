import { NextResponse } from "next/server";
import { listDocuments, deleteDocumentByName } from "@/lib/supabase";

// Disable caching for document list
export const dynamic = "force-dynamic";

// GET: List all documents
export async function GET() {
  try {
    const documents = await listDocuments();
    return NextResponse.json({
      success: true,
      documents,
      count: documents.length,
    });
  } catch (error) {
    console.error("List documents error:", error);
    return NextResponse.json(
      {
        error: "Failed to list documents",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// DELETE: Delete a document by name
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const documentName = searchParams.get("name");

    if (!documentName) {
      return NextResponse.json(
        { error: "Document name is required" },
        { status: 400 }
      );
    }

    const deletedCount = await deleteDocumentByName(documentName);

    return NextResponse.json({
      success: true,
      message: `Deleted ${deletedCount} chunks for document: ${documentName}`,
      deletedChunks: deletedCount,
    });
  } catch (error) {
    console.error("Delete document error:", error);
    return NextResponse.json(
      {
        error: "Failed to delete document",
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
