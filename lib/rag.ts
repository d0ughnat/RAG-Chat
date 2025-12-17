import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { generateQueryEmbedding } from "./embeddings";
import { searchDocuments, MatchedDocument } from "./supabase";

// RAG configuration - Enhanced for academic questions
const TOP_K_RESULTS = 10; // Increased for more comprehensive context
const SIMILARITY_THRESHOLD = 0.2; // Lower threshold to capture more relevant content
const MAX_CONTEXT_LENGTH = 15000; // More context for complex questions

// Initialize the Gemini chat model with higher capability settings
export function getChatModel(): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY!,
    model: "gemini-2.5-flash",
    temperature: 0.2, // Lower temperature for more precise academic answers
    maxOutputTokens: 4096, // Longer responses for detailed explanations
  });
}

/**
 * Expand query with related terms for better retrieval
 * This helps capture relevant content even with different terminology
 */
function expandQuery(query: string): string[] {
  const queries = [query];
  
  // Add variations of the query for better coverage
  const lowerQuery = query.toLowerCase();
  
  // Extract key terms and create focused sub-queries
  const technicalTerms = query.match(/\b[A-Z]{2,}[A-Z0-9]*\b/g) || [];
  for (const term of technicalTerms) {
    queries.push(`What is ${term}?`);
    queries.push(`${term} definition characteristics properties`);
  }
  
  // Add comparison query if comparing things
  if (lowerQuery.includes('difference') || lowerQuery.includes('compare') || lowerQuery.includes('vs')) {
    queries.push(query.replace(/difference|compare|vs/gi, 'characteristics'));
  }
  
  return queries.slice(0, 3); // Limit to 3 queries to avoid too many API calls
}

/**
 * Retrieve relevant documents with multi-query strategy
 */
export async function retrieveContext(
  query: string,
  topK: number = TOP_K_RESULTS,
  documentFilter?: string
): Promise<MatchedDocument[]> {
  // Expand query for better retrieval
  const queries = expandQuery(query);
  
  const allResults: MatchedDocument[] = [];
  const seenIds = new Set<number>();
  
  // Search with each query variation
  for (const q of queries) {
    const queryEmbedding = await generateQueryEmbedding(q);
    
    const filter: Record<string, string> | undefined = documentFilter
      ? { document_name: documentFilter }
      : undefined;
    
    const results = await searchDocuments(queryEmbedding, topK, filter ?? {});
    
    // Add unique results
    for (const doc of results) {
      if (!seenIds.has(doc.id) && doc.similarity >= SIMILARITY_THRESHOLD) {
        seenIds.add(doc.id);
        allResults.push(doc);
      }
    }
  }
  
  // Sort by similarity and return top results
  return allResults
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

/**
 * Format retrieved documents into context for the LLM
 * Enhanced with better structure for academic understanding
 */
export function formatContext(documents: MatchedDocument[]): string {
  if (documents.length === 0) {
    return "No relevant context found in the documents.";
  }

  // Group documents by page for better context flow
  const byPage = new Map<number, MatchedDocument[]>();
  for (const doc of documents) {
    const page = doc.metadata.page_number;
    if (!byPage.has(page)) {
      byPage.set(page, []);
    }
    byPage.get(page)!.push(doc);
  }

  // Format with clear structure
  let context = "";
  let totalLength = 0;
  
  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);
  
  for (const page of sortedPages) {
    const pageDocs = byPage.get(page)!;
    for (const doc of pageDocs) {
      const section = `[Page ${page}, Relevance: ${(doc.similarity * 100).toFixed(1)}%]\n${doc.content}\n\n`;
      
      if (totalLength + section.length > MAX_CONTEXT_LENGTH) {
        break;
      }
      
      context += section;
      totalLength += section.length;
    }
  }

  return context.trim();
}

/**
 * Format source references for the response
 */
export function formatSources(documents: MatchedDocument[]): string[] {
  const uniqueSources = new Map<string, { pages: Set<number>; maxSimilarity: number }>();

  for (const doc of documents) {
    const name = doc.metadata.document_name;
    if (!uniqueSources.has(name)) {
      uniqueSources.set(name, { pages: new Set(), maxSimilarity: 0 });
    }
    const source = uniqueSources.get(name)!;
    source.pages.add(doc.metadata.page_number);
    source.maxSimilarity = Math.max(source.maxSimilarity, doc.similarity);
  }

  return Array.from(uniqueSources.entries()).map(([name, { pages }]) => {
    const pageList = Array.from(pages).sort((a, b) => a - b).join(", ");
    return `${name} (pages: ${pageList})`;
  });
}

/**
 * Academic-level system prompt for comprehensive answers
 */
const ACADEMIC_SYSTEM_PROMPT = `You are an expert academic assistant specializing in technical and engineering topics. Your role is to provide comprehensive, graduate-level answers based on the provided document context.

IMPORTANT FORMATTING RULES:
- DO NOT use markdown symbols like #, *, **, or - for formatting
- Use plain text only
- Use line breaks and indentation for structure
- Use numbers (1, 2, 3) for lists instead of bullet points
- Use CAPITAL LETTERS for headings instead of # symbols
- Keep the response clean and readable as plain text

RESPONSE GUIDELINES:

For Definitional Questions:
  Provide clear, precise definitions
  Include key characteristics and properties
  Mention relevant applications or use cases

For Comparison Questions:
  Create structured comparisons with clear labels
  Highlight key differences AND similarities
  Explain the practical implications of differences
  Recommend which option is better for specific use cases

For Analytical Questions:
  Break down complex concepts into components
  Explain underlying principles
  Connect related concepts
  Provide examples when available in the context

For Application Questions:
  Explain why certain choices are made
  Discuss trade-offs and considerations
  Reference specific technical specifications from the documents

CRITICAL RULES:
1. Base ALL answers ONLY on the provided context - never use external knowledge
2. If information is partial, clearly state what IS known from the documents
3. If information is NOT in the documents, say: "Based on the provided documents, I don't have specific information about [topic]."
4. Use technical terminology accurately as presented in the documents
5. Cite page numbers when referencing specific information (e.g., "Page 3")
6. Structure long answers with clear sections using CAPITAL LETTERS for headings
7. DO NOT use any markdown formatting symbols

RESPONSE FORMAT:
  Start with a direct answer to the question
  Follow with detailed explanation and evidence from the documents
  End with any relevant caveats or additional considerations`;

/**
 * Generate a RAG response for a user query - Enhanced for academic questions
 */
export async function generateRAGResponse(
  query: string,
  topK: number = TOP_K_RESULTS,
  documentFilter?: string
): Promise<{
  answer: string;
  sources: string[];
  context: MatchedDocument[];
}> {
  // Retrieve relevant context with expanded search
  const relevantDocs = await retrieveContext(query, topK, documentFilter);

  // Format context for the prompt
  const contextText = formatContext(relevantDocs);
  const sources = formatSources(relevantDocs);

  // Build the enhanced prompt
  const userPrompt = `## Document Context:
${contextText}

---

## Question (Academic Level):
${query}

Please provide a comprehensive, well-structured answer based on the document context above. If this is a comparison question, use a structured format. If technical details are available, include them.`;

  // Generate response using Gemini
  const chatModel = getChatModel();
  const response = await chatModel.invoke([
    new SystemMessage(ACADEMIC_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  return {
    answer: response.content as string,
    sources,
    context: relevantDocs,
  };
}

/**
 * Stream a RAG response for a user query - Enhanced for academic questions
 */
export async function* streamRAGResponse(
  query: string,
  topK: number = TOP_K_RESULTS,
  documentFilter?: string
): AsyncGenerator<{ type: "chunk" | "sources"; data: string | string[] }> {
  // Retrieve relevant context
  const relevantDocs = await retrieveContext(query, topK, documentFilter);

  // Format context for the prompt
  const contextText = formatContext(relevantDocs);
  const sources = formatSources(relevantDocs);

  // Build the enhanced prompt
  const userPrompt = `## Document Context:
${contextText}

---

## Question (Academic Level):
${query}

Please provide a comprehensive, well-structured answer based on the document context above. If this is a comparison question, use a structured format. If technical details are available, include them.`;

  // Stream response using Gemini
  const chatModel = getChatModel();
  const stream = await chatModel.stream([
    new SystemMessage(ACADEMIC_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  for await (const chunk of stream) {
    if (chunk.content) {
      yield { type: "chunk", data: chunk.content as string };
    }
  }

  // Yield sources at the end
  yield { type: "sources", data: sources };
}
