import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";

// Batch size for embedding requests (Gemini allows up to 100)
const EMBEDDING_BATCH_SIZE = 100;

// Initialize the Gemini embeddings model
export function getEmbeddingsModel(): GoogleGenerativeAIEmbeddings {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY!,
    model: "text-embedding-004", // Latest Gemini embedding model
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });
}

// Get embeddings model configured for queries
export function getQueryEmbeddingsModel(): GoogleGenerativeAIEmbeddings {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY!,
    model: "text-embedding-004",
    taskType: TaskType.RETRIEVAL_QUERY,
  });
}

/**
 * Generate embeddings for a list of texts in batches
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings = getEmbeddingsModel();
  const allEmbeddings: number[][] = [];

  // Process in batches for efficiency
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const batchEmbeddings = await embeddings.embedDocuments(batch);
    allEmbeddings.push(...batchEmbeddings);

    // Log progress for large batches
    if (texts.length > EMBEDDING_BATCH_SIZE) {
      console.log(
        `Embedded ${Math.min(i + EMBEDDING_BATCH_SIZE, texts.length)}/${texts.length} chunks`
      );
    }
  }

  return allEmbeddings;
}

/**
 * Generate embedding for a single query
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const embeddings = getQueryEmbeddingsModel();
  return embeddings.embedQuery(query);
}
