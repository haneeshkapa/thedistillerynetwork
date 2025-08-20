const mysql = require('mysql2/promise');
const redis = require('redis');
const crypto = require('crypto');
const logger = require('./logger');

class HybridVectorRetriever {
    constructor() {
        // Skip MySQL in production - use PostgreSQL enterprise storage instead
        if (process.env.DATABASE_URL) {
            console.log('🎯 Hybrid Vector Retriever: Using PostgreSQL enterprise storage, skipping local MySQL');
            this.dbPool = null;
        } else {
            // Database connection for local development only
            this.dbPool = mysql.createPool({
                host: '127.0.0.1',
                port: 3306,
                user: 'sms_bot',
                password: 'smsbot123',
                database: 'sms_bot_production',
                waitForConnections: true,
                connectionLimit: 10
            });
        }

        // Redis for embedding cache
        this.redis = redis.createClient({
            host: 'localhost',
            port: 6379
        });

        // OpenAI API configuration
        this.openaiApiKey = process.env.OPENAI_API_KEY || 'your-openai-api-key';
        this.embeddingModel = 'text-embedding-ada-002';
        this.dimensions = 1536;

        this.initialize();
    }

    async initialize() {
        try {
            await this.redis.connect();
            logger.info('Hybrid vector retriever initialized');
        } catch (error) {
            logger.error('Vector retriever initialization error:', error.message);
        }
    }

    /**
     * Generate embeddings for text using OpenAI API
     */
    async generateEmbedding(text) {
        try {
            const cacheKey = `embedding:${crypto.createHash('sha256').update(text).digest('hex')}`;
            
            // Check cache first
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                logger.debug('Embedding cache hit');
                return JSON.parse(cached);
            }

            // Call OpenAI API
            const response = await fetch('https://api.openai.com/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: text,
                    model: this.embeddingModel
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json();
            const embedding = data.data[0].embedding;

            // Cache for 7 days
            await this.redis.setEx(cacheKey, 604800, JSON.stringify(embedding));
            
            logger.debug('Generated new embedding', { 
                textLength: text.length,
                dimensions: embedding.length 
            });

            return embedding;

        } catch (error) {
            logger.error('Embedding generation error:', error.message);
            throw error;
        }
    }

    /**
     * Store embedding in database
     */
    async storeEmbedding(chunkId, text) {
        try {
            // Skip database operations if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                console.log('📊 Skipping MySQL embedding storage - using PostgreSQL enterprise storage');
                return false;
            }
            
            const embedding = await this.generateEmbedding(text);
            const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

            await this.dbPool.execute(`
                INSERT INTO knowledge_embeddings (chunk_id, embedding, embedding_model, dimensions)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    embedding = VALUES(embedding),
                    updated_at = CURRENT_TIMESTAMP
            `, [chunkId, embeddingBuffer, this.embeddingModel, this.dimensions]);

            logger.debug(`Stored embedding for chunk ${chunkId}`);
            return true;

        } catch (error) {
            logger.error('Embedding storage error:', error.message);
            return false;
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    calculateCosineSimilarity(vectorA, vectorB) {
        if (vectorA.length !== vectorB.length) {
            throw new Error('Vectors must have same dimensions');
        }

        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;

        for (let i = 0; i < vectorA.length; i++) {
            dotProduct += vectorA[i] * vectorB[i];
            magnitudeA += vectorA[i] * vectorA[i];
            magnitudeB += vectorB[i] * vectorB[i];
        }

        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);

        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }

        return dotProduct / (magnitudeA * magnitudeB);
    }

    /**
     * Perform semantic search using vector embeddings
     */
    async semanticSearch(query, limit = 10) {
        try {
            // Skip semantic search if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                console.log('📊 Skipping MySQL semantic search - using PostgreSQL enterprise storage');
                return [];
            }
            
            const queryEmbedding = await this.generateEmbedding(query);
            const queryBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);

            // Check similarity cache first
            const queryHash = crypto.createHash('sha256').update(query).digest('hex');
            const cacheKey = `semantic:${queryHash}:${limit}`;
            
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                logger.debug('Semantic search cache hit');
                return JSON.parse(cached);
            }

            // Get all embeddings from database
            const [embeddings] = await this.dbPool.execute(`
                SELECT e.chunk_id, e.embedding, k.content, k.category, k.confidence_score
                FROM knowledge_embeddings e
                JOIN knowledge_chunks k ON e.chunk_id = k.id
                ORDER BY k.confidence_score DESC
            `);

            // Calculate similarities
            const similarities = embeddings.map(row => {
                const storedEmbedding = Array.from(new Float32Array(row.embedding.buffer));
                const similarity = this.calculateCosineSimilarity(queryEmbedding, storedEmbedding);
                
                return {
                    chunkId: row.chunk_id,
                    content: row.content,
                    category: row.category,
                    confidence_score: row.confidence_score,
                    similarity: similarity,
                    searchType: 'semantic'
                };
            });

            // Sort by similarity and get top results
            const results = similarities
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, limit);

            // Cache for 1 hour
            await this.redis.setEx(cacheKey, 3600, JSON.stringify(results));

            logger.debug('Semantic search completed', {
                query: query.substring(0, 50),
                totalEmbeddings: embeddings.length,
                topSimilarity: results[0]?.similarity || 0
            });

            return results;

        } catch (error) {
            logger.error('Semantic search error:', error.message);
            return [];
        }
    }

    /**
     * Perform BM25 search (existing functionality)
     */
    async bm25Search(query, limit = 10) {
        try {
            // Skip BM25 search if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                console.log('📊 Skipping MySQL BM25 search - using PostgreSQL enterprise storage');
                return [];
            }
            
            const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
            
            if (searchTerms.length === 0) {
                logger.debug('BM25 search: No valid search terms found', { query });
                return [];
            }

            const searchQuery = searchTerms.map(term => `+${term}*`).join(' ');
            
            logger.debug('BM25 search executing', { query, searchQuery, limit });
            
            const [results] = await this.dbPool.execute(`
                SELECT id, content, category, confidence_score,
                       MATCH(content) AGAINST(? IN BOOLEAN MODE) as relevance_score
                FROM knowledge_chunks
                WHERE MATCH(content) AGAINST(? IN BOOLEAN MODE)
                   OR content LIKE ?
                ORDER BY relevance_score DESC, confidence_score DESC
                LIMIT ${limit}
            `, [searchQuery, searchQuery, `%${query}%`]);

            logger.debug('BM25 search results', { resultCount: results.length, query });

            return results.map(row => ({
                chunkId: row.id,
                content: row.content,
                category: row.category,
                confidence_score: row.confidence_score,
                similarity: row.relevance_score / 10, // Normalize to 0-1 scale
                searchType: 'bm25'
            }));

        } catch (error) {
            logger.error('BM25 search error:', { 
                message: error.message,
                query,
                stack: error.stack
            });
            return [];
        }
    }

    /**
     * Hybrid search combining BM25 and semantic search with fusion
     */
    async hybridSearch(query, options = {}) {
        const {
            limit = 8,
            semanticWeight = 0.6,
            bm25Weight = 0.4,
            minSemanticSimilarity = 0.7,
            enableFusion = true
        } = options;

        const startTime = Date.now();
        
        try {
            // Run both searches in parallel
            const [semanticResults, bm25Results] = await Promise.all([
                this.semanticSearch(query, limit * 2),
                this.bm25Search(query, limit * 2)
            ]);

            let fusedResults;

            if (enableFusion && semanticResults.length > 0 && bm25Results.length > 0) {
                // Reciprocal Rank Fusion (RRF)
                fusedResults = this.reciprocalRankFusion(semanticResults, bm25Results, {
                    semanticWeight,
                    bm25Weight,
                    minSemanticSimilarity
                });
            } else {
                // Fallback to best available results
                fusedResults = semanticResults.length > 0 ? semanticResults : bm25Results;
            }

            // Limit final results
            const finalResults = fusedResults.slice(0, limit);

            const responseTime = Date.now() - startTime;

            // Store performance metrics
            await this.storeSearchPerformance({
                query,
                bm25Results: bm25Results.slice(0, 3),
                semanticResults: semanticResults.slice(0, 3),
                finalResults: finalResults.slice(0, 3),
                responseTimeMs: responseTime,
                cacheHit: false
            });

            logger.debug('Hybrid search completed', {
                query: query.substring(0, 50),
                semanticCount: semanticResults.length,
                bm25Count: bm25Results.length,
                finalCount: finalResults.length,
                responseTimeMs: responseTime
            });

            return finalResults;

        } catch (error) {
            logger.error('Hybrid search error:', error.message);
            return [];
        }
    }

    /**
     * Reciprocal Rank Fusion algorithm
     */
    reciprocalRankFusion(semanticResults, bm25Results, options) {
        const { semanticWeight, bm25Weight, minSemanticSimilarity } = options;
        const k = 60; // RRF constant

        // Create maps for easy lookup
        const semanticMap = new Map();
        const bm25Map = new Map();
        
        semanticResults.forEach((result, index) => {
            if (result.similarity >= minSemanticSimilarity) {
                semanticMap.set(result.chunkId, { 
                    ...result, 
                    rank: index + 1,
                    rrfScore: semanticWeight / (k + index + 1)
                });
            }
        });

        bm25Results.forEach((result, index) => {
            bm25Map.set(result.chunkId, { 
                ...result, 
                rank: index + 1,
                rrfScore: bm25Weight / (k + index + 1)
            });
        });

        // Combine scores
        const combinedResults = new Map();
        
        // Add semantic results
        for (const [chunkId, result] of semanticMap) {
            combinedResults.set(chunkId, {
                ...result,
                fusedScore: result.rrfScore,
                sources: ['semantic']
            });
        }

        // Add or combine with BM25 results
        for (const [chunkId, result] of bm25Map) {
            if (combinedResults.has(chunkId)) {
                const existing = combinedResults.get(chunkId);
                existing.fusedScore += result.rrfScore;
                existing.sources.push('bm25');
                existing.searchType = 'hybrid';
            } else {
                combinedResults.set(chunkId, {
                    ...result,
                    fusedScore: result.rrfScore,
                    sources: ['bm25']
                });
            }
        }

        // Sort by fused score
        return Array.from(combinedResults.values())
            .sort((a, b) => b.fusedScore - a.fusedScore);
    }

    /**
     * Store search performance metrics
     */
    async storeSearchPerformance(metrics) {
        try {
            // Skip database operations if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                console.log('📊 Skipping MySQL performance storage - using PostgreSQL enterprise storage');
                return;
            }
            
            await this.dbPool.execute(`
                INSERT INTO search_performance 
                (query, bm25_results, semantic_results, final_results, response_time_ms, cache_hit)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                metrics.query,
                JSON.stringify(metrics.bm25Results),
                JSON.stringify(metrics.semanticResults),
                JSON.stringify(metrics.finalResults),
                metrics.responseTimeMs,
                metrics.cacheHit
            ]);
        } catch (error) {
            logger.error('Performance storage error:', error.message);
        }
    }

    /**
     * Bulk update embeddings for all knowledge chunks
     */
    async updateAllEmbeddings() {
        try {
            // Skip database operations if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                console.log('📊 Skipping MySQL bulk embedding update - using PostgreSQL enterprise storage');
                return { processed: 0, errors: 0, note: 'MySQL not available in production' };
            }
            
            const [chunks] = await this.dbPool.execute(`
                SELECT id, content FROM knowledge_chunks 
                WHERE LENGTH(content) > 10
                ORDER BY confidence_score DESC
            `);

            logger.info(`Starting bulk embedding update for ${chunks.length} chunks`);
            
            let processed = 0;
            let errors = 0;

            for (const chunk of chunks) {
                try {
                    await this.storeEmbedding(chunk.id, chunk.content);
                    processed++;
                    
                    if (processed % 10 === 0) {
                        logger.info(`Processed ${processed}/${chunks.length} embeddings`);
                    }

                    // Rate limiting: 3000 requests per minute for OpenAI
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    errors++;
                    logger.error(`Embedding error for chunk ${chunk.id}:`, error.message);
                }
            }

            logger.info(`Bulk embedding update completed: ${processed} processed, ${errors} errors`);
            return { processed, errors };

        } catch (error) {
            logger.error('Bulk embedding update error:', error.message);
            throw error;
        }
    }

    /**
     * Get search analytics
     */
    async getSearchAnalytics(days = 7) {
        try {
            // Skip database operations if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                return {
                    note: 'Using PostgreSQL Enterprise Storage instead',
                    storage: 'PostgreSQL Enterprise Storage',
                    total_searches: 'Not available',
                    avg_response_time: 'Not available',
                    cache_hits: 'Not available',
                    cacheHitRatio: 'Not available',
                    topQueries: []
                };
            }
            
            const [results] = await this.dbPool.execute(`
                SELECT 
                    COUNT(*) as total_searches,
                    AVG(response_time_ms) as avg_response_time,
                    COUNT(CASE WHEN cache_hit = 1 THEN 1 END) as cache_hits,
                    COUNT(CASE WHEN JSON_LENGTH(semantic_results) > 0 THEN 1 END) as semantic_searches,
                    COUNT(CASE WHEN JSON_LENGTH(bm25_results) > 0 THEN 1 END) as bm25_searches
                FROM search_performance 
                WHERE created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
            `, [days]);

            const [topQueries] = await this.dbPool.execute(`
                SELECT query, COUNT(*) as frequency
                FROM search_performance 
                WHERE created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY query
                ORDER BY frequency DESC
                LIMIT 10
            `, [days]);

            return {
                ...results[0],
                cacheHitRatio: results[0].total_searches > 0 
                    ? (results[0].cache_hits / results[0].total_searches * 100).toFixed(2) + '%'
                    : '0%',
                topQueries: topQueries
            };

        } catch (error) {
            logger.error('Analytics error:', error.message);
            return { error: error.message };
        }
    }

    async close() {
        try {
            await this.redis.quit();
            if (this.dbPool) {
                await this.dbPool.end();
            }
        } catch (error) {
            logger.error('Close error:', error.message);
        }
    }
}

module.exports = HybridVectorRetriever;