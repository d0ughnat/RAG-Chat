import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { generateQueryEmbedding } from "./embeddings";
import { searchDocuments, searchDocumentsByKeywords, MatchedDocument } from "./supabase";

// RAG configuration - LOWER thresholds for better matching
const TOP_K_RESULTS = 10; // Get more results
const SIMILARITY_THRESHOLD = 0.1; // Very low threshold to not miss anything
const MAX_CONTEXT_LENGTH = 10000;
const RERANK_TOP_K = 6;

// Initialize the Gemini chat model
export function getChatModel(): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY!,
    model: "gemini-2.5-flash",
    temperature: 0.1,
    maxOutputTokens: 2048,
  });
}

/**
 * Question type categories for intelligent scanning
 */
type QuestionType = 
  | "definition"      // What is X?
  | "comparison"      // Difference between X and Y
  | "explanation"     // How does X work?
  | "location"        // Where is X? Position of X
  | "listing"         // List all X, What are the types of X
  | "quantity"        // How many X? Count of X
  | "procedure"       // Steps to do X, How to X
  | "cause_effect"    // Why does X happen? What causes X
  | "property"        // What are properties/characteristics of X
  | "example"         // Give example of X
  | "time"            // When does X happen?
  | "general";

/**
 * Detect question type for smarter database scanning
 */
function detectQuestionType(query: string): QuestionType {
  const q = query.toLowerCase();
  
  // Location/Position questions
  if (/where|position|location|located|place|found in|which (page|section|chapter|part)/.test(q)) {
    return "location";
  }
  
  // Listing questions
  if (/list|what are the|types of|kinds of|categories|enumerate|name all|give all/.test(q)) {
    return "listing";
  }
  
  // Quantity questions
  if (/how many|how much|count|number of|total|percentage|ratio/.test(q)) {
    return "quantity";
  }
  
  // Procedure/Steps questions
  if (/how to|steps|procedure|process|method|way to|instructions/.test(q)) {
    return "procedure";
  }
  
  // Cause/Effect questions
  if (/why|cause|effect|result|consequence|reason|because|leads to/.test(q)) {
    return "cause_effect";
  }
  
  // Property/Characteristic questions
  if (/properties|characteristics|features|attributes|qualities|aspects/.test(q)) {
    return "property";
  }
  
  // Example questions
  if (/example|instance|such as|like what|give me|show me/.test(q)) {
    return "example";
  }
  
  // Time questions
  if (/when|time|date|period|duration|how long|before|after/.test(q)) {
    return "time";
  }
  
  // Definition questions
  if (/what is|define|meaning|definition|describe|explain what/.test(q)) {
    return "definition";
  }
  
  // Comparison questions
  if (/difference|compare|vs\.?|versus|distinguish|contrast|similar|between/.test(q)) {
    return "comparison";
  }
  
  // Explanation questions
  if (/how does|how do|explain|describe how|works/.test(q)) {
    return "explanation";
  }
  
  return "general";
}

/**
 * Extract search keywords based on question type
 * This helps the AI "think" about what to look for
 */
function extractSearchTerms(query: string, questionType: QuestionType): {
  primaryTerms: string[];
  contextTerms: string[];
  searchHints: string[];
} {
  const words = query.toLowerCase().split(/\s+/);
  const primaryTerms: string[] = [];
  const contextTerms: string[] = [];
  const searchHints: string[] = [];
  
  // Remove common stop words
  const stopWords = new Set(['what', 'is', 'the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'or', 'how', 'does', 'do', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'may', 'might', 'must', 'will', 'shall']);
  
  // Extract acronyms (high priority)
  const acronyms = query.match(/\b[A-Z]{2,}[A-Z0-9]*\b/g) || [];
  primaryTerms.push(...acronyms);
  
  // Extract quoted phrases (exact match needed)
  const quoted = query.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];
  primaryTerms.push(...quoted);
  
  // Extract capitalized terms (likely proper nouns/technical terms)
  const capitalized = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  primaryTerms.push(...capitalized);
  
  // Extract remaining meaningful words
  for (const word of words) {
    if (!stopWords.has(word) && word.length > 2 && !primaryTerms.some(t => t.toLowerCase() === word)) {
      contextTerms.push(word);
    }
  }
  
  // Add search hints based on question type
  switch (questionType) {
    case "definition":
      searchHints.push("definition", "meaning", "refers to", "is defined as", "is a");
      break;
    case "comparison":
      searchHints.push("difference", "compared to", "unlike", "whereas", "while", "but");
      break;
    case "location":
      searchHints.push("located", "found", "position", "placed", "situated");
      break;
    case "listing":
      searchHints.push("types", "kinds", "categories", "includes", "consists of", "such as");
      break;
    case "quantity":
      searchHints.push("number", "count", "total", "amount", "percentage");
      break;
    case "procedure":
      searchHints.push("step", "first", "then", "next", "finally", "process", "method");
      break;
    case "cause_effect":
      searchHints.push("because", "causes", "results in", "leads to", "due to", "therefore");
      break;
    case "property":
      searchHints.push("property", "characteristic", "feature", "attribute", "has", "contains");
      break;
    case "example":
      searchHints.push("example", "instance", "such as", "like", "for instance");
      break;
    case "time":
      searchHints.push("when", "during", "before", "after", "while", "until");
      break;
    case "explanation":
      searchHints.push("works by", "functions", "operates", "mechanism", "through");
      break;
  }
  
  return {
    primaryTerms: [...new Set(primaryTerms)],
    contextTerms: [...new Set(contextTerms)].slice(0, 5),
    searchHints
  };
}

/**
 * Build optimized search query for database
 */
function buildSearchQuery(query: string, questionType: QuestionType): string {
  const { primaryTerms, contextTerms } = extractSearchTerms(query, questionType);
  
  // Combine primary terms with context for embedding search
  const searchParts = [...primaryTerms, ...contextTerms.slice(0, 3)];
  
  // For certain question types, add context
  if (questionType === "definition" && primaryTerms.length > 0) {
    return `${primaryTerms.join(" ")} definition meaning characteristics`;
  }
  
  if (questionType === "comparison" && primaryTerms.length >= 2) {
    return `${primaryTerms[0]} ${primaryTerms[1]} difference comparison`;
  }
  
  if (questionType === "procedure") {
    return `${searchParts.join(" ")} steps process method how to`;
  }
  
  if (questionType === "listing") {
    return `${searchParts.join(" ")} types kinds list categories`;
  }
  
  // Default: use original query (already good for embedding)
  return query;
}

/**
 * Rerank documents based on relevance scoring and question type
 * Uses word-by-word matching for better accuracy
 */
function rerankDocuments(documents: MatchedDocument[], query: string, questionType: QuestionType, topK: number): MatchedDocument[] {
  const { primaryTerms, contextTerms, searchHints } = extractSearchTerms(query, questionType);
  
  // Get all keywords for word-by-word matching
  const queryKeywords = extractKeywords(query);
  
  const scored = documents.map(doc => {
    let score = doc.similarity * 100; // Base similarity score (0-100)
    const contentLower = doc.content.toLowerCase();
    const contentWords = contentLower.split(/\s+/);
    
    // WORD-BY-WORD matching - count how many query words appear
    let wordMatches = 0;
    for (const keyword of queryKeywords) {
      if (contentLower.includes(keyword.toLowerCase())) {
        wordMatches++;
        score += 8; // Boost for each matching word
      }
    }
    
    // Extra boost if many words match
    if (queryKeywords.length > 0) {
      const matchRatio = wordMatches / queryKeywords.length;
      score += matchRatio * 20; // Up to 20 points for high match ratio
    }
    
    // Boost for primary term matches (most important - acronyms, proper nouns)
    for (const term of primaryTerms) {
      if (contentLower.includes(term.toLowerCase())) {
        score += 25; // High boost for primary terms
      }
    }
    
    // Boost for context term matches
    for (const term of contextTerms) {
      if (contentLower.includes(term.toLowerCase())) {
        score += 10;
      }
    }
    
    // Boost for search hint patterns (question-type specific)
    for (const hint of searchHints) {
      if (contentLower.includes(hint)) {
        score += 5;
      }
    }
    
    // Boost based on question type patterns
    switch (questionType) {
      case "definition":
        if (/is\s+(a|an|the)\s+|defined\s+as|refers\s+to|means/.test(contentLower)) score += 15;
        break;
      case "listing":
        if (/\d+\.|•|[-–—]\s|first|second|third|includes|types/.test(contentLower)) score += 15;
        break;
      case "procedure":
        if (/step\s*\d|first|then|next|finally|1\.|2\.|3\./.test(contentLower)) score += 15;
        break;
      case "quantity":
        if (/\d+%|\d+\s*(percent|times|units|km|m|kg|g|ml|l)/.test(contentLower)) score += 15;
        break;
      case "comparison":
        if (/however|whereas|while|unlike|but|compared|difference/.test(contentLower)) score += 15;
        break;
    }
    
    // Penalize very short content (less useful)
    if (doc.content.length < 50) score -= 20;
    if (doc.content.length < 100) score -= 10;
    
    // Boost longer, more detailed content
    if (doc.content.length > 300) score += 5;
    if (doc.content.length > 500) score += 5;
    
    return { ...doc, rerankScore: score };
  });
  
  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);
}

/**
 * Extract important words from query for keyword search
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'or', 
    'how', 'does', 'do', 'are', 'was', 'were', 'be', 'been', 'being', 
    'have', 'has', 'had', 'can', 'could', 'would', 'should', 'may', 
    'might', 'must', 'will', 'shall', 'this', 'that', 'these', 'those',
    'it', 'its', 'they', 'them', 'their', 'there', 'here', 'where',
    'when', 'why', 'which', 'who', 'whom', 'whose', 'about', 'between',
    'give', 'me', 'tell', 'explain', 'describe', 'define', 'list'
  ]);
  
  const words = query.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  // Also extract any acronyms (uppercase)
  const acronyms = query.match(/\b[A-Z]{2,}[A-Z0-9]*\b/g) || [];
  
  return [...new Set([...acronyms.map(a => a.toLowerCase()), ...words])];
}

/**
 * Retrieve relevant documents with HYBRID search
 * Combines embedding search + keyword search for best results
 */
export async function retrieveContext(
  query: string,
  topK: number = TOP_K_RESULTS,
  documentFilter?: string
): Promise<MatchedDocument[]> {
  // Detect question type for smart scanning
  const questionType = detectQuestionType(query);
  
  // Build optimized search query based on question type
  const searchQuery = buildSearchQuery(query, questionType);
  
  // Extract keywords for text search
  const keywords = extractKeywords(query);
  
  const filter: Record<string, string> | undefined = documentFilter
    ? { document_name: documentFilter }
    : undefined;
  
  // Run BOTH searches in parallel for speed
  const [embeddingResults, keywordResults] = await Promise.all([
    // 1. Embedding search (semantic similarity)
    (async () => {
      const queryEmbedding = await generateQueryEmbedding(searchQuery);
      return searchDocuments(queryEmbedding, topK, filter ?? {});
    })(),
    
    // 2. Keyword search (exact word matching)
    keywords.length > 0 
      ? searchDocumentsByKeywords(keywords, topK, filter ?? {}).catch(() => [])
      : Promise.resolve([])
  ]);
  
  // Merge results, avoiding duplicates
  const seenIds = new Set<number>();
  const allResults: MatchedDocument[] = [];
  
  // Add embedding results first (usually more relevant)
  for (const doc of embeddingResults) {
    if (!seenIds.has(doc.id)) {
      seenIds.add(doc.id);
      allResults.push(doc);
    }
  }
  
  // Add keyword results (boost their score slightly for exact matches)
  for (const doc of keywordResults) {
    if (!seenIds.has(doc.id)) {
      seenIds.add(doc.id);
      // Boost keyword matches
      allResults.push({ ...doc, similarity: doc.similarity + 0.2 });
    } else {
      // If already in results, boost the existing one
      const existing = allResults.find(d => d.id === doc.id);
      if (existing) {
        existing.similarity = Math.min(existing.similarity + 0.15, 1.0);
      }
    }
  }
  
  // Filter by threshold (very low to not miss anything)
  const filtered = allResults.filter(doc => doc.similarity >= SIMILARITY_THRESHOLD);
  
  // Rerank based on question type patterns
  return rerankDocuments(filtered, query, questionType, RERANK_TOP_K);
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
 * Smart system prompt - understands different question types
 */
const ACADEMIC_SYSTEM_PROMPT = `You are an intelligent academic assistant that answers questions by analyzing document content.

HOW TO ANSWER DIFFERENT QUESTION TYPES:

DEFINITION (What is X?):
  Give a clear, concise definition first
  Then list 2-3 key characteristics

COMPARISON (Difference between X and Y):
  State the main difference upfront
  Then compare: X has... while Y has...

LISTING (What are the types/kinds of X?):
  Use numbered list: 1, 2, 3...
  Brief description for each item

PROCEDURE (How to do X? Steps for X):
  Number each step: Step 1, Step 2...
  Be specific and actionable

LOCATION (Where is X? Position of X):
  State the location/position directly
  Reference the page number

QUANTITY (How many? How much?):
  Give the number/amount first
  Then context if needed

CAUSE/EFFECT (Why does X happen?):
  State the cause or reason directly
  Explain the mechanism briefly

RULES:
1. ONLY use information from the provided context
2. Cite page numbers: (Page X)
3. If not found, say: "This is not covered in the documents"
4. Use plain text, no markdown symbols
5. Be direct and concise`;

/**
 * Build prompt based on question type for better answers
 */
function buildSmartPrompt(query: string, contextText: string, questionType: QuestionType): string {
  let instruction = "";
  
  switch (questionType) {
    case "definition":
      instruction = "Define the term clearly, then list key characteristics.";
      break;
    case "comparison":
      instruction = "Compare the items by stating differences and similarities.";
      break;
    case "listing":
      instruction = "List all items using numbers (1, 2, 3...).";
      break;
    case "procedure":
      instruction = "Provide step-by-step instructions.";
      break;
    case "location":
      instruction = "State the exact location or position.";
      break;
    case "quantity":
      instruction = "Provide the specific number or amount.";
      break;
    case "cause_effect":
      instruction = "Explain the cause and its effects.";
      break;
    case "property":
      instruction = "List the properties or characteristics.";
      break;
    case "example":
      instruction = "Provide specific examples from the documents.";
      break;
    case "time":
      instruction = "State when this occurs or the time period.";
      break;
    case "explanation":
      instruction = "Explain how this works step by step.";
      break;
    default:
      instruction = "Answer based on the document content.";
  }

  return `DOCUMENT CONTEXT:
${contextText}

QUESTION: ${query}

INSTRUCTION: ${instruction} Use only the information above. Cite page numbers.`;
}

/**
 * Generate a RAG response for a user query
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
  // Detect question type for smart answering
  const questionType = detectQuestionType(query);
  
  // Retrieve relevant context with intelligent scanning
  const relevantDocs = await retrieveContext(query, topK, documentFilter);

  // Format context for the prompt
  const contextText = formatContext(relevantDocs);
  const sources = formatSources(relevantDocs);

  // Build smart prompt based on question type
  const userPrompt = buildSmartPrompt(query, contextText, questionType);

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
 * Stream a RAG response with intelligent question handling
 */
export async function* streamRAGResponse(
  query: string,
  topK: number = TOP_K_RESULTS,
  documentFilter?: string
): AsyncGenerator<{ type: "chunk" | "sources"; data: string | string[] }> {
  // Detect question type for smart scanning and answering
  const questionType = detectQuestionType(query);
  
  // Retrieve with intelligent scanning
  const relevantDocs = await retrieveContext(query, topK, documentFilter);

  // Format context
  const contextText = formatContext(relevantDocs);
  const sources = formatSources(relevantDocs);

  // Build smart prompt based on question type
  const userPrompt = buildSmartPrompt(query, contextText, questionType);

  // Stream response
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
