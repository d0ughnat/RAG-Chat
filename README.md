# RAG Chat - PDF Q&A with Google Gemini

A production-ready PDF-based Retrieval-Augmented Generation (RAG) system built with Next.js, LangChain, Google Gemini, and Supabase.

## Features

- 📄 **PDF Upload & Processing**: Upload PDFs and automatically extract, chunk, and index content
- 🔍 **Semantic Search**: Vector similarity search using pgvector in Supabase
- 🤖 **AI-Powered Responses**: Get accurate answers using Google Gemini with RAG
- 📚 **Source References**: Every answer includes references to source documents
- ⚡ **Streaming Responses**: Real-time streaming of AI responses
- 🎨 **Modern UI**: Clean, responsive interface built with Tailwind CSS

## Architecture

```
PDF → Parse → Chunk → Embeddings → Supabase (pgvector) → Retrieval → Gemini LLM
```

### Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS
- **AI/ML**: LangChain, Google Gemini (gemini-1.5-flash, text-embedding-004)
- **Database**: Supabase (PostgreSQL + pgvector)
- **PDF Processing**: pdfjs-dist

## Getting Started

### Prerequisites

- Node.js 18+
- A Google Cloud account with Gemini API access
- A Supabase project

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Google Gemini API Key
GOOGLE_API_KEY=your_google_api_key_here

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Optional: Chunking Configuration
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

### 3. Set Up Supabase Database

Run the SQL migration in your Supabase SQL editor:

```sql
-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the documents table
CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding VECTOR(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON documents 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS documents_metadata_idx 
ON documents 
USING GIN (metadata);

-- Create RPC function for similarity search
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding VECTOR(768),
    match_count INT DEFAULT 5,
    filter JSONB DEFAULT '{}'
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        documents.id,
        documents.content,
        documents.metadata,
        1 - (documents.embedding <=> query_embedding) AS similarity
    FROM documents
    WHERE 
        CASE 
            WHEN filter != '{}' THEN documents.metadata @> filter
            ELSE TRUE
        END
    ORDER BY documents.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Function to delete documents by name
CREATE OR REPLACE FUNCTION delete_documents_by_name(doc_name TEXT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM documents
    WHERE metadata->>'document_name' = doc_name;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
```

Or use the Supabase CLI:

```bash
npx supabase db push
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## API Endpoints

### POST /api/upload

Upload and process a PDF file.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` (PDF file), optional `chunkSize` and `chunkOverlap`

**Response:**
```json
{
  "success": true,
  "message": "Successfully processed document.pdf",
  "stats": {
    "fileName": "document.pdf",
    "fileSize": 123456,
    "totalPages": 10,
    "totalChunks": 45,
    "chunkConfig": { "chunkSize": 1000, "chunkOverlap": 200 }
  }
}
```

### POST /api/query

Query documents (non-streaming).

**Request:**
```json
{
  "query": "What is the main topic?",
  "topK": 5,
  "documentFilter": "optional-document-name.pdf"
}
```

**Response:**
```json
{
  "success": true,
  "answer": "The main topic is...",
  "sources": ["document.pdf (pages: 1, 2, 3)"],
  "contextCount": 3
}
```

### POST /api/chat

Query documents with streaming response (Server-Sent Events).

**Request:**
```json
{
  "query": "What is the main topic?",
  "topK": 5
}
```

**Response:** Server-Sent Events stream

### GET /api/documents

List all uploaded documents.

### DELETE /api/documents?name=document.pdf

Delete a document and all its chunks.

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── upload/route.ts     # PDF upload endpoint
│   │   ├── query/route.ts      # Non-streaming query endpoint
│   │   ├── chat/route.ts       # Streaming chat endpoint
│   │   └── documents/route.ts  # Document management endpoint
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── PDFUploader.tsx         # PDF upload component
│   ├── ChatInterface.tsx       # Chat UI component
│   └── DocumentList.tsx        # Document list component
├── lib/
│   ├── supabase.ts             # Supabase client & operations
│   ├── pdf-parser.ts           # PDF parsing with pdfjs-dist
│   ├── chunker.ts              # Text chunking with LangChain
│   ├── embeddings.ts           # Gemini embeddings
│   └── rag.ts                  # RAG retrieval & generation
├── supabase/
│   └── migrations/
│       └── 001_create_documents_table.sql
└── .env.example
```

## Configuration

### Chunking Parameters

- `CHUNK_SIZE` (default: 1000): Maximum characters per chunk
- `CHUNK_OVERLAP` (default: 200): Overlap between chunks for context continuity

### RAG Parameters

Configured in `lib/rag.ts`:

- `TOP_K_RESULTS`: Number of chunks to retrieve (default: 5)
- `SIMILARITY_THRESHOLD`: Minimum similarity score (default: 0.5)

### Model Selection

In `lib/rag.ts`, you can switch between models:

- `gemini-1.5-flash`: Faster, good for most use cases
- `gemini-1.5-pro`: Higher quality, better for complex reasoning

## License

MIT
