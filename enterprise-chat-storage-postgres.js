const { Pool } = require('pg');
const redis = require('redis');
const crypto = require('crypto');

/**
 * PostgreSQL Enterprise Chat Storage for Jonathan's Distillation Bot
 * Handles conversation memory with distillation expertise context
 */
class EnterpriseChatStoragePostgres {
    constructor(options = {}) {
        this.config = {
            // PostgreSQL configuration (from Render DATABASE_URL)
            postgres: {
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            },
            
            // Redis configuration (from Render REDIS_URL)
            redis: {
                url: process.env.REDIS_URL
            },
            
            // Storage thresholds for distillation conversations
            maxActiveConversations: options.maxActiveConversations || 1000,
            maxMessagesPerCustomer: options.maxMessagesPerCustomer || 50,
            archiveAfterDays: options.archiveAfterDays || 30,
        };
        
        this.activeConversations = new Map(); // Hot cache for active distillation discussions
        this.dbPool = null;
        this.redis = null;
        
        this.initialize();
    }

    async initialize() {
        try {
            // Initialize PostgreSQL pool
            this.dbPool = new Pool(this.config.postgres);
            
            // Test database connection
            const client = await this.dbPool.connect();
            await client.query('SELECT NOW()');
            client.release();
            console.log('✅ PostgreSQL connected successfully for Jonathan\'s distillation bot');
            
            // Initialize Redis
            if (process.env.REDIS_URL) {
                this.redis = redis.createClient({
                    url: process.env.REDIS_URL
                });
                
                this.redis.on('error', (err) => {
                    console.error('Redis connection error:', err);
                });
                
                await this.redis.connect();
                await this.redis.ping();
                console.log('✅ Redis connected for conversation caching');
            } else {
                console.log('⚠️ Redis not configured, skipping cache layer');
            }
            
            // Create tables for distillation conversations
            await this.createDistillationTables();
            
            // Load recent active conversations
            await this.loadActiveConversations();
            
            console.log('✅ Enterprise chat storage initialized for distillation expertise', {
                activeConversations: this.activeConversations.size,
                maxActiveConversations: this.config.maxActiveConversations
            });
            
        } catch (error) {
            console.error('❌ Enterprise chat storage initialization failed:', error);
            throw error;
        }
    }

    /**
     * Create PostgreSQL tables optimized for distillation conversations
     */
    async createDistillationTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS distillation_conversations (
                id BIGSERIAL PRIMARY KEY,
                phone_hash VARCHAR(64) NOT NULL,
                phone_original VARCHAR(20),
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processing_time_ms INTEGER,
                tokens_used INTEGER,
                provider VARCHAR(50),
                confidence_score FLOAT,
                conversation_type VARCHAR(50), -- 'distillation', 'equipment', 'order', 'general'
                expertise_level VARCHAR(20), -- 'beginner', 'intermediate', 'expert'
                archived BOOLEAN DEFAULT FALSE,
                archived_at TIMESTAMP NULL
            );

            CREATE INDEX IF NOT EXISTS idx_phone_hash ON distillation_conversations(phone_hash);
            CREATE INDEX IF NOT EXISTS idx_created_at ON distillation_conversations(created_at);
            CREATE INDEX IF NOT EXISTS idx_archived ON distillation_conversations(archived);
            CREATE INDEX IF NOT EXISTS idx_conversation_type ON distillation_conversations(conversation_type);
            CREATE INDEX IF NOT EXISTS idx_phone_created ON distillation_conversations(phone_hash, created_at);
            CREATE INDEX IF NOT EXISTS idx_active_recent ON distillation_conversations(archived, created_at);
        `;
        
        await this.dbPool.query(createTableSQL);
        console.log('✅ Distillation conversations table ready');
    }

    /**
     * Store a conversation message with distillation context
     */
    async storeMessage(phone, message, response, metadata = {}) {
        const startTime = Date.now();
        
        try {
            const phoneHash = this.hashPhone(phone);
            const timestamp = new Date();
            
            // Analyze conversation type and expertise level
            const conversationAnalysis = this.analyzeDistillationContext(message, response);
            
            // Store in database with distillation-specific fields
            const insertSQL = `
                INSERT INTO distillation_conversations 
                (phone_hash, phone_original, message, response, metadata, created_at, processing_time_ms, 
                 tokens_used, provider, confidence_score, conversation_type, expertise_level)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id
            `;
            
            const values = [
                phoneHash,
                phone,
                message,
                response,
                JSON.stringify({
                    ...metadata,
                    ...conversationAnalysis
                }),
                timestamp,
                metadata.processingTime || null,
                metadata.tokensUsed || null,
                metadata.provider || 'claude',
                metadata.confidence || null,
                conversationAnalysis.type,
                conversationAnalysis.expertiseLevel
            ];
            
            const result = await this.dbPool.query(insertSQL, values);
            const messageId = result.rows[0].id;
            
            // Update active conversations with distillation context
            await this.updateActiveConversation(phone, message, response, metadata, timestamp);
            
            // Update Redis cache
            if (this.redis) {
                await this.updateRedisCache(phoneHash, message, response, timestamp);
            }
            
            const processingTime = Date.now() - startTime;
            console.log(`🥃 Distillation conversation stored (${processingTime}ms):`, {
                phone: phoneHash.substring(0, 8),
                messageId,
                type: conversationAnalysis.type,
                expertise: conversationAnalysis.expertiseLevel
            });
            
            return messageId;
            
        } catch (error) {
            console.error('❌ Failed to store distillation conversation:', error);
            throw error;
        }
    }

    /**
     * Analyze message content for distillation context
     */
    analyzeDistillationContext(message, response) {
        const messageLower = message.toLowerCase();
        const responseLower = response.toLowerCase();
        
        // Determine conversation type
        let type = 'general';
        if (/mash.*bill|ferment|distill|cuts|heads|hearts|tails|proof|abv|still|column|pot.*still/.test(messageLower + ' ' + responseLower)) {
            type = 'distillation';
        } else if (/copper|equipment|still|gallon|purchase|buy|order|price/.test(messageLower)) {
            type = 'equipment';
        } else if (/order|tracking|shipping|delivery/.test(messageLower)) {
            type = 'order';
        }
        
        // Determine expertise level based on terminology used
        let expertiseLevel = 'beginner';
        if (/methanol|congener|reflux.*ratio|theoretical.*plate|HETP|azeotrope/.test(messageLower + ' ' + responseLower)) {
            expertiseLevel = 'expert';
        } else if (/cuts|heads.*hearts.*tails|proof.*gallon|wash.*temperature|column.*height/.test(messageLower + ' ' + responseLower)) {
            expertiseLevel = 'intermediate';
        }
        
        return {
            type,
            expertiseLevel,
            hasDistillationTerms: type === 'distillation',
            hasTechnicalTerms: expertiseLevel !== 'beginner'
        };
    }

    /**
     * Get conversation history with distillation context
     */
    async getConversationHistory(phone, limit = 10) {
        const startTime = Date.now();
        
        try {
            const phoneHash = this.hashPhone(phone);
            
            // Try active conversations first
            if (this.activeConversations.has(phone)) {
                const conversation = this.activeConversations.get(phone);
                const recentMessages = conversation.messages.slice(-limit);
                
                console.log(`🥃 Distillation conversation loaded from memory (${Date.now() - startTime}ms):`, {
                    phone: phoneHash.substring(0, 8),
                    messages: recentMessages.length,
                    types: [...new Set(conversation.messages.map(m => m.metadata?.type).filter(Boolean))]
                });
                
                return recentMessages;
            }
            
            // Try Redis cache
            if (this.redis) {
                const cachedHistory = await this.redis.get(`distillation:${phoneHash}`);
                if (cachedHistory) {
                    const messages = JSON.parse(cachedHistory);
                    const limitedMessages = messages.slice(-limit);
                    
                    console.log(`🥃 Conversation loaded from Redis cache (${Date.now() - startTime}ms)`);
                    return limitedMessages;
                }
            }
            
            // Load from database
            const messages = await this.loadFromDatabase(phoneHash, limit);
            
            // Cache for next time
            if (this.redis && messages.length > 0) {
                await this.redis.setEx(`distillation:${phoneHash}`, 3600, JSON.stringify(messages));
            }
            
            console.log(`🥃 Distillation conversation loaded from database (${Date.now() - startTime}ms)`);
            return messages;
            
        } catch (error) {
            console.error('❌ Failed to get distillation conversation history:', error);
            return [];
        }
    }

    /**
     * Load messages from database with distillation context
     */
    async loadFromDatabase(phoneHash, limit = 10) {
        try {
            const query = `
                SELECT message, response, created_at, metadata, confidence_score, 
                       conversation_type, expertise_level
                FROM distillation_conversations
                WHERE phone_hash = $1 AND archived = FALSE
                ORDER BY created_at DESC
                LIMIT $2
            `;
            
            const result = await this.dbPool.query(query, [phoneHash, limit]);
            
            return result.rows.map(row => ({
                timestamp: row.created_at,
                customerMessage: row.message,
                botResponse: row.response,
                confidence: row.confidence_score,
                metadata: {
                    ...(row.metadata || {}),
                    conversationType: row.conversation_type,
                    expertiseLevel: row.expertise_level
                }
            })).reverse(); // Return in chronological order
            
        } catch (error) {
            console.error('❌ Failed to load distillation messages from database:', error);
            return [];
        }
    }

    /**
     * Get distillation conversation analytics
     */
    async getDistillationStats() {
        try {
            const query = `
                SELECT 
                    COUNT(*) as total_conversations,
                    COUNT(DISTINCT phone_hash) as unique_customers,
                    COUNT(CASE WHEN archived = FALSE THEN 1 END) as active_conversations,
                    COUNT(CASE WHEN conversation_type = 'distillation' THEN 1 END) as distillation_conversations,
                    COUNT(CASE WHEN conversation_type = 'equipment' THEN 1 END) as equipment_conversations,
                    COUNT(CASE WHEN conversation_type = 'order' THEN 1 END) as order_conversations,
                    COUNT(CASE WHEN expertise_level = 'expert' THEN 1 END) as expert_level_conversations,
                    COUNT(CASE WHEN expertise_level = 'intermediate' THEN 1 END) as intermediate_level_conversations,
                    COUNT(CASE WHEN expertise_level = 'beginner' THEN 1 END) as beginner_level_conversations,
                    MAX(created_at) as latest_conversation,
                    MIN(created_at) as earliest_conversation
                FROM distillation_conversations
            `;
            
            const result = await this.dbPool.query(query);
            const dbStats = result.rows[0];
            
            return {
                database: dbStats,
                activeConversations: this.activeConversations.size,
                maxActiveConversations: this.config.maxActiveConversations,
                specialization: 'alcohol_distillation',
                jonathan_expertise: true
            };
            
        } catch (error) {
            console.error('❌ Failed to get distillation stats:', error);
            return { error: error.message };
        }
    }

    /**
     * Update active conversation in memory
     */
    async updateActiveConversation(phone, message, response, metadata, timestamp) {
        try {
            let conversation = this.activeConversations.get(phone);
            
            if (!conversation) {
                conversation = {
                    phone: phone,
                    phoneHash: this.hashPhone(phone),
                    messages: [],
                    firstContact: timestamp,
                    lastActivity: timestamp,
                    totalMessages: 0,
                    distillationTopics: new Set(),
                    expertiseProgression: []
                };
            }
            
            // Analyze for distillation topics
            const analysis = this.analyzeDistillationContext(message, response);
            if (analysis.hasDistillationTerms) {
                conversation.distillationTopics.add(analysis.type);
            }
            conversation.expertiseProgression.push(analysis.expertiseLevel);
            
            // Add new message
            conversation.messages.push({
                timestamp: timestamp,
                customerMessage: message,
                botResponse: response,
                metadata: { ...metadata, ...analysis }
            });
            
            conversation.lastActivity = timestamp;
            conversation.totalMessages = conversation.messages.length;
            
            // Trim to max messages
            if (conversation.messages.length > this.config.maxMessagesPerCustomer) {
                conversation.messages = conversation.messages.slice(-this.config.maxMessagesPerCustomer);
            }
            
            this.activeConversations.set(phone, conversation);
            
            // Evict oldest if too many
            if (this.activeConversations.size > this.config.maxActiveConversations) {
                this.evictOldestConversation();
            }
            
        } catch (error) {
            console.error('❌ Failed to update active distillation conversation:', error);
        }
    }

    /**
     * Update Redis cache for distillation conversations
     */
    async updateRedisCache(phoneHash, message, response, timestamp) {
        if (!this.redis) return;
        
        try {
            const cacheKey = `distillation:${phoneHash}`;
            const existing = await this.redis.get(cacheKey);
            
            let messages = existing ? JSON.parse(existing) : [];
            
            messages.push({
                timestamp: timestamp,
                customerMessage: message,
                botResponse: response
            });
            
            // Keep only last 20 messages in cache
            if (messages.length > 20) {
                messages = messages.slice(-20);
            }
            
            await this.redis.setEx(cacheKey, 3600, JSON.stringify(messages));
            
        } catch (error) {
            console.error('❌ Failed to update distillation Redis cache:', error);
        }
    }

    /**
     * Load recent active conversations into memory
     */
    async loadActiveConversations() {
        try {
            const query = `
                SELECT DISTINCT phone_original, phone_hash, MAX(created_at) as last_activity,
                       array_agg(DISTINCT conversation_type) as topics,
                       array_agg(DISTINCT expertise_level) as expertise_levels
                FROM distillation_conversations 
                WHERE created_at > NOW() - INTERVAL '7 days'
                GROUP BY phone_hash, phone_original
                ORDER BY last_activity DESC
                LIMIT $1
            `;
            
            const result = await this.dbPool.query(query, [this.config.maxActiveConversations]);
            
            for (const customer of result.rows) {
                const messages = await this.loadFromDatabase(customer.phone_hash, this.config.maxMessagesPerCustomer);
                
                if (messages.length > 0) {
                    this.activeConversations.set(customer.phone_original, {
                        phone: customer.phone_original,
                        phoneHash: customer.phone_hash,
                        messages: messages,
                        lastActivity: customer.last_activity,
                        totalMessages: messages.length,
                        distillationTopics: new Set(customer.topics || []),
                        expertiseProgression: customer.expertise_levels || []
                    });
                }
            }
            
            console.log('🥃 Active distillation conversations loaded:', {
                count: this.activeConversations.size,
                maxAllowed: this.config.maxActiveConversations
            });
            
        } catch (error) {
            console.error('❌ Failed to load active distillation conversations:', error);
        }
    }

    /**
     * Remove oldest conversation from active memory
     */
    evictOldestConversation() {
        let oldestPhone = null;
        let oldestTime = Date.now();
        
        for (const [phone, conversation] of this.activeConversations) {
            if (conversation.lastActivity < oldestTime) {
                oldestTime = conversation.lastActivity;
                oldestPhone = phone;
            }
        }
        
        if (oldestPhone) {
            this.activeConversations.delete(oldestPhone);
            console.log('♻️ Evicted oldest distillation conversation:', this.hashPhone(oldestPhone).substring(0, 8));
        }
    }

    /**
     * Hash phone number for privacy
     */
    hashPhone(phone) {
        return crypto.createHash('sha256').update(phone + 'jonathan_distillery_salt').digest('hex').substring(0, 16);
    }

    async close() {
        try {
            if (this.redis) {
                await this.redis.quit();
            }
            if (this.dbPool) {
                await this.dbPool.end();
            }
            console.log('✅ Enterprise distillation chat storage closed');
        } catch (error) {
            console.error('❌ Error closing distillation chat storage:', error);
        }
    }
}

module.exports = EnterpriseChatStoragePostgres;