-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the documents table for storing PDF chunks and embeddings
CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding VECTOR(768), -- Gemini embedding-001 uses 768 dimensions
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create an index for faster similarity searches
CREATE INDEX IF NOT EXISTS documents_embedding_idx 
ON documents 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create an index on metadata for filtering by document name
CREATE INDEX IF NOT EXISTS documents_metadata_idx 
ON documents 
USING GIN (metadata);

-- RPC function for similarity search
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

-- Function to delete documents by document name
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
