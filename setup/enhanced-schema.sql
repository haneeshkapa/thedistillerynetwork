-- Enhanced SMS Bot Database Schema with Vector Embeddings
USE sms_bot_production;

-- Existing tables (keep as is)
-- ... customers, conversations, knowledge_chunks, system_metrics ...

-- NEW: Vector embeddings table for semantic search
CREATE TABLE knowledge_embeddings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    chunk_id VARCHAR(50) NOT NULL,
    embedding VARBINARY(6144) NOT NULL,  -- 1536 floats * 4 bytes = 6144 bytes for OpenAI embeddings
    embedding_model VARCHAR(50) DEFAULT 'text-embedding-ada-002',
    dimensions INT DEFAULT 1536,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
    INDEX idx_chunk_id (chunk_id),
    INDEX idx_model (embedding_model)
);

-- Alternative JSON storage for debugging/flexibility (choose one approach)
CREATE TABLE knowledge_embeddings_json (
    id INT PRIMARY KEY AUTO_INCREMENT,
    chunk_id VARCHAR(50) NOT NULL,
    embedding JSON NOT NULL,  -- Store as JSON array [0.1, 0.2, ...]
    embedding_model VARCHAR(50) DEFAULT 'text-embedding-ada-002',
    dimensions INT DEFAULT 1536,
    magnitude FLOAT,  -- Pre-computed vector magnitude for cosine similarity
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
    INDEX idx_chunk_id (chunk_id)
);

-- Search performance table for caching similarity results
CREATE TABLE embedding_similarity_cache (
    id INT PRIMARY KEY AUTO_INCREMENT,
    query_hash VARCHAR(64) NOT NULL,  -- SHA-256 hash of query
    chunk_id VARCHAR(50) NOT NULL,
    similarity_score FLOAT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_query_hash (query_hash),
    INDEX idx_similarity (similarity_score),
    -- Cache TTL: clean up entries older than 1 hour
    INDEX idx_created_at (created_at)
);

-- Hybrid search results tracking
CREATE TABLE search_performance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    query TEXT NOT NULL,
    bm25_results JSON,  -- Store top BM25 results for analysis
    semantic_results JSON,  -- Store top semantic results
    final_results JSON,  -- Store final fused results
    response_time_ms INT,
    cache_hit BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
);