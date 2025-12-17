import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { ParsedPDF, cleanText } from "./pdf-parser";
import { DocumentMetadata } from "./supabase";

export interface ChunkConfig {
  chunkSize: number;
  chunkOverlap: number;
}

export interface DocumentChunk {
  content: string;
  metadata: DocumentMetadata;
}

// Default chunking configuration
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  chunkSize: parseInt(process.env.CHUNK_SIZE || "1000", 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || "200", 10),
};

/**
 * Split parsed PDF into semantic chunks with metadata
 */
export async function chunkDocument(
  parsedPDF: ParsedPDF,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG
): Promise<DocumentChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const allChunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  // Process each page
  for (const page of parsedPDF.pages) {
    const cleanedText = cleanText(page.text);

    if (!cleanedText) continue;

    // Create a LangChain document for splitting
    const doc = new Document({
      pageContent: cleanedText,
      metadata: {
        document_name: parsedPDF.documentName,
        page_number: page.pageNumber,
      },
    });

    // Split the page into chunks
    const pageChunks = await splitter.splitDocuments([doc]);

    // Add chunks with proper metadata
    for (const chunk of pageChunks) {
      allChunks.push({
        content: chunk.pageContent,
        metadata: {
          document_name: parsedPDF.documentName,
          page_number: page.pageNumber,
          chunk_index: globalChunkIndex,
        },
      });
      globalChunkIndex++;
    }
  }

  // Update total_chunks in all metadata
  return allChunks.map((chunk) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      total_chunks: allChunks.length,
    },
  }));
}

/**
 * Chunk document using full text (alternative approach for better context)
 */
export async function chunkDocumentFullText(
  parsedPDF: ParsedPDF,
  config: ChunkConfig = DEFAULT_CHUNK_CONFIG
): Promise<DocumentChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });

  const cleanedText = cleanText(parsedPDF.fullText);

  const doc = new Document({
    pageContent: cleanedText,
    metadata: {
      document_name: parsedPDF.documentName,
    },
  });

  const chunks = await splitter.splitDocuments([doc]);

  return chunks.map((chunk, index) => ({
    content: chunk.pageContent,
    metadata: {
      document_name: parsedPDF.documentName,
      page_number: estimatePageNumber(
        index,
        chunks.length,
        parsedPDF.totalPages
      ),
      chunk_index: index,
      total_chunks: chunks.length,
    },
  }));
}

/**
 * Estimate which page a chunk belongs to based on its position
 */
function estimatePageNumber(
  chunkIndex: number,
  totalChunks: number,
  totalPages: number
): number {
  const ratio = chunkIndex / totalChunks;
  return Math.min(Math.floor(ratio * totalPages) + 1, totalPages);
}
