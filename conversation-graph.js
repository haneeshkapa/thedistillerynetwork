const redis = require('redis');
const mysql = require('mysql2/promise');
const logger = require('./logger');

class ConversationGraph {
    constructor() {
        this.graph = new Map(); // In-memory graph for active sessions
        
        // Redis for distributed memory (use REDIS_URL on production)
        if (process.env.REDIS_URL) {
            this.redis = redis.createClient({
                url: process.env.REDIS_URL
            });
        } else {
            this.redis = redis.createClient({
                host: 'localhost',
                port: 6379
            });
        }
        
        // Skip MySQL in production - use enterprise PostgreSQL storage instead
        if (process.env.DATABASE_URL) {
            console.log('🎯 Using PostgreSQL enterprise storage, skipping local MySQL');
            this.dbPool = null;
        } else {
            // MySQL for local development only
            this.dbPool = mysql.createPool({
                host: '127.0.0.1',
                port: 3306,
                user: 'sms_bot', 
                password: 'smsbot123',
                database: 'sms_bot_production',
                waitForConnections: true,
                connectionLimit: 5,
                acquireTimeout: 60000,
                timeout: 60000
            });
        }

        this.initialize();
    }

    async initialize() {
        try {
            await this.redis.connect();
            logger.info('Conversation graph initialized');
        } catch (error) {
            logger.error('Conversation graph initialization error:', error.message);
        }
    }

    async addConversationNode(phone, query, products, response, metadata = {}) {
        try {
            const phoneHash = this.hashPhone(phone);
            const timestamp = new Date();

            // Update in-memory graph
            const customerNode = this.graph.get(phone) || {
                products: new Set(),
                queries: [],
                relationships: new Map(),
                lastInteraction: null,
                tier: 'casual',
                totalConversations: 0
            };

            customerNode.queries.push({
                query,
                products,
                response,
                timestamp,
                confidence: metadata.confidence || 0.8,
                processingTime: metadata.processingTime || 0
            });

            // Update product relationships
            products.forEach(product => {
                customerNode.products.add(product);
            });

            customerNode.lastInteraction = timestamp;
            customerNode.totalConversations++;
            this.graph.set(phone, customerNode);

            // Store in Redis for 1 hour
            await this.redis.setEx(`customer:${phoneHash}`, 3600, JSON.stringify({
                ...customerNode,
                products: Array.from(customerNode.products),
                queries: customerNode.queries.slice(-5) // Keep last 5 queries only
            }));

            // Store in MySQL for persistence
            await this.storeInDatabase(phone, query, response, metadata);

            logger.debug(`Added conversation node for customer ${phoneHash.substring(0, 8)}...`);

        } catch (error) {
            logger.error('Error adding conversation node:', error.message);
        }
    }

    async getAssociativeContext(phone, currentQuery) {
        try {
            const phoneHash = this.hashPhone(phone);

            // Try in-memory first
            let customerNode = this.graph.get(phone);

            // Try Redis if not in memory
            if (!customerNode) {
                const redisData = await this.redis.get(`customer:${phoneHash}`);
                if (redisData) {
                    const parsed = JSON.parse(redisData);
                    customerNode = {
                        ...parsed,
                        products: new Set(parsed.products),
                        queries: parsed.queries
                    };
                    this.graph.set(phone, customerNode); // Cache locally
                }
            }

            // Try database if not in Redis
            if (!customerNode) {
                customerNode = await this.loadFromDatabase(phone);
            }

            if (!customerNode) return null;

            // Find related previous interactions
            const relatedQueries = customerNode.queries
                .filter(q => this.calculateQuerySimilarity(q.query, currentQuery) > 0.3)
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 3);

            return {
                recentProducts: Array.from(customerNode.products).slice(-3),
                relatedHistory: relatedQueries,
                customerTier: this.calculateTier(customerNode),
                lastSeen: customerNode.lastInteraction,
                conversationCount: customerNode.totalConversations
            };

        } catch (error) {
            logger.error('Error getting associative context:', error.message);
            return null;
        }
    }

    async storeInDatabase(phone, query, response, metadata) {
        try {
            const phoneHash = this.hashPhone(phone);
            
            // Get or create customer
            let [customers] = await this.dbPool.execute(
                'SELECT id FROM customers WHERE phone_hash = ?',
                [phoneHash]
            );

            let customerId;
            if (customers.length === 0) {
                const [result] = await this.dbPool.execute(
                    'INSERT INTO customers (phone_hash, phone_original, tier) VALUES (?, ?, ?)',
                    [phoneHash, phone, 'casual']
                );
                customerId = result.insertId;
            } else {
                customerId = customers[0].id;
            }

            // Store conversation
            await this.dbPool.execute(`
                INSERT INTO conversations (customer_id, phone_hash, message, response, confidence_score, processing_time_ms, tokens_used, provider, cache_hit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                customerId,
                phoneHash,
                query,
                response,
                metadata.confidence || null,
                metadata.processingTime || null,
                metadata.tokensUsed || null,
                metadata.provider || 'claude',
                metadata.cacheHit || false
            ]);

        } catch (error) {
            logger.error('Database storage error:', error.message);
        }
    }

    async loadFromDatabase(phone) {
        try {
            const phoneHash = this.hashPhone(phone);
            
            const [conversations] = await this.dbPool.execute(`
                SELECT message, response, created_at, confidence_score
                FROM conversations 
                WHERE phone_hash = ? 
                ORDER BY created_at DESC 
                LIMIT 10
            `, [phoneHash]);

            if (conversations.length === 0) return null;

            return {
                products: new Set(),
                queries: conversations.map(conv => ({
                    query: conv.message,
                    response: conv.response,
                    timestamp: conv.created_at,
                    confidence: conv.confidence_score || 0.5
                })),
                relationships: new Map(),
                lastInteraction: conversations[0].created_at,
                tier: 'casual',
                totalConversations: conversations.length
            };

        } catch (error) {
            logger.error('Database load error:', error.message);
            return null;
        }
    }

    calculateQuerySimilarity(query1, query2) {
        // Simple word overlap similarity
        const words1 = new Set(query1.toLowerCase().split(/\s+/));
        const words2 = new Set(query2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(w => words2.has(w)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    calculateTier(customerNode) {
        if (customerNode.totalConversations > 10) return 'vip';
        if (customerNode.totalConversations > 3) return 'regular';
        return 'casual';
    }

    hashPhone(phone) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(phone + 'salt123').digest('hex').substring(0, 16);
    }

    async getGraphStats() {
        try {
            // Skip database operations if no MySQL pool available (using PostgreSQL instead)
            if (!this.dbPool) {
                return {
                    activeCustomers: this.graph.size,
                    redisConnected: this.redis?.isReady || false,
                    dbStats: { note: 'Using PostgreSQL Enterprise Storage instead' },
                    cacheHitRatio: 'Not implemented yet',
                    storage: 'PostgreSQL Enterprise Storage'
                };
            }
            
            const [result] = await this.dbPool.execute(`
                SELECT 
                    COUNT(DISTINCT phone_hash) as unique_customers,
                    COUNT(*) as total_conversations,
                    AVG(confidence_score) as avg_confidence
                FROM conversations 
                WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
            `);

            return {
                activeCustomers: this.graph.size,
                redisConnected: this.redis.isReady,
                dbStats: result[0],
                cacheHitRatio: 'Not implemented yet'
            };

        } catch (error) {
            logger.error('Stats error:', error.message);
            return { error: error.message };
        }
    }

    async close() {
        try {
            if (this.redis) {
                await this.redis.quit();
            }
            if (this.dbPool) {
                await this.dbPool.end();
            }
        } catch (error) {
            logger.error('Close error:', error.message);
        }
    }
}

module.exports = ConversationGraph;