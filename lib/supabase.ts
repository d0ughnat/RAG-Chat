import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy initialization of Supabase client
let supabaseInstance: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    supabaseInstance = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseInstance;
}

// Type definitions for document records
export interface DocumentRecord {
  id: number;
  content: string;
  metadata: DocumentMetadata;
  embedding: number[];
  created_at: string;
}

export interface DocumentMetadata {
  document_name: string;
  page_number: number;
  chunk_index: number;
  total_chunks?: number;
}

export interface MatchedDocument {
  id: number;
  content: string;
  metadata: DocumentMetadata;
  similarity: number;
}

/**
 * Store document chunks with embeddings in Supabase
 */
export async function storeDocuments(
  documents: {
    content: string;
    metadata: DocumentMetadata;
    embedding: number[];
  }[]
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("documents").insert(
    documents.map((doc) => ({
      content: doc.content,
      metadata: doc.metadata,
      embedding: doc.embedding,
    }))
  );

  if (error) {
    throw new Error(`Failed to store documents: ${error.message}`);
  }
}

/**
 * Perform similarity search using the match_documents RPC function
 */
export async function searchDocuments(
  queryEmbedding: number[],
  matchCount: number = 5,
  filter: Record<string, string> = {}
): Promise<MatchedDocument[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter: filter,
  });

  if (error) {
    throw new Error(`Failed to search documents: ${error.message}`);
  }

  return data as MatchedDocument[];
}

/**
 * Perform keyword-based search for better hybrid retrieval
 * Searches for documents containing any of the keywords
 */
export async function searchDocumentsByKeywords(
  keywords: string[],
  matchCount: number = 10,
  filter: Record<string, string> = {}
): Promise<MatchedDocument[]> {
  const supabase = getSupabase();
  
  // Filter valid keywords
  const validKeywords = keywords.filter(k => k.length > 2);
  if (validKeywords.length === 0) return [];
  
  // Search for each keyword and collect results
  const allResults: Map<number, { doc: MatchedDocument; matchCount: number }> = new Map();
  
  for (const keyword of validKeywords.slice(0, 5)) { // Limit to 5 keywords
    let query = supabase
      .from("documents")
      .select("id, content, metadata")
      .ilike("content", `%${keyword}%`);
    
    // Add filter if provided
    if (filter.document_name) {
      query = query.eq("metadata->>document_name", filter.document_name);
    }
    
    const { data, error } = await query.limit(matchCount);
    
    if (error || !data) continue;
    
    for (const doc of data) {
      if (allResults.has(doc.id)) {
        // Increment match count for existing doc
        allResults.get(doc.id)!.matchCount++;
      } else {
        // Add new doc
        allResults.set(doc.id, {
          doc: {
            id: doc.id,
            content: doc.content,
            metadata: doc.metadata as DocumentMetadata,
            similarity: 0.5, // Base score for keyword match
          },
          matchCount: 1
        });
      }
    }
  }
  
  // Calculate similarity based on keyword match ratio
  const results: MatchedDocument[] = Array.from(allResults.values())
    .map(({ doc, matchCount: mc }) => ({
      ...doc,
      // More keywords matched = higher score
      similarity: Math.min(0.3 + (mc / validKeywords.length) * 0.5, 0.9)
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
  
  return results;
}

/**
 * Delete all chunks for a specific document
 */
export async function deleteDocumentByName(
  documentName: string
): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("delete_documents_by_name", {
    doc_name: documentName,
  });

  if (error) {
    throw new Error(`Failed to delete document: ${error.message}`);
  }

  return data as number;
}

/**
 * List all unique document names in the database
 */
export async function listDocuments(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("metadata->document_name")
    .limit(1000);

  if (error) {
    throw new Error(`Failed to list documents: ${error.message}`);
  }

  // Extract unique document names
  const uniqueNames: string[] = [
    ...new Set(
      (data as Array<{ document_name: unknown }>)
        .map((d) => d.document_name)
        .filter((name): name is string => typeof name === "string")
    ),
  ];
  return uniqueNames;
}
