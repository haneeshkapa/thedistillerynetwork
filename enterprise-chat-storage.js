const mysql = require('mysql2/promise');
const redis = require('redis');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

/**
 * Enterprise Chat Storage System
 * Handles massive conversation data with performance, archiving, and scalability
 */
class EnterpriseChatStorage {
    constructor(options = {}) {
        this.config = {
            // Database configuration
            mysql: {
                host: process.env.MYSQL_HOST || '127.0.0.1',
                port: parseInt(process.env.MYSQL_PORT) || 3306,
                user: process.env.MYSQL_USER || 'sms_bot',
                password: process.env.MYSQL_PASSWORD || 'smsbot123',
                database: process.env.MYSQL_DATABASE || 'sms_bot_production',
                connectionLimit: 20
            },
            
            // Redis configuration  
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || null
            },
            
            // Storage thresholds
            maxActiveConversations: options.maxActiveConversations || 1000,
            maxMessagesPerCustomer: options.maxMessagesPerCustomer || 50,
            archiveAfterDays: options.archiveAfterDays || 30,
            
            // Performance settings
            batchSize: options.batchSize || 100,
            compressionEnabled: options.compressionEnabled || true,
            
            // Local file settings (for hot data only)
            localStorageDir: options.localStorageDir || './storage/conversations',
            maxLocalFileSize: options.maxLocalFileSize || 10 * 1024 * 1024, // 10MB
        };
        
        this.activeConversations = new Map(); // Hot cache in memory
        this.dbPool = null;
        this.redis = null;
        
        this.initialize();
    }

    async initialize() {
        try {
            // Initialize database pool
            this.dbPool = mysql.createPool(this.config.mysql);
            
            // Initialize Redis
            this.redis = redis.createClient({
                host: this.config.redis.host,
                port: this.config.redis.port,
                password: this.config.redis.password
            });
            
            if (this.redis.connect) {
                await this.redis.connect();
            }
            
            // Create storage directories
            await fs.mkdir(this.config.localStorageDir, { recursive: true });
            await fs.mkdir(path.join(this.config.localStorageDir, 'archive'), { recursive: true });
            
            // Load recent active conversations into memory
            await this.loadActiveConversations();
            
            // Setup automated archiving
            this.setupArchiving();
            
            logger.info('Enterprise chat storage initialized', {
                activeConversations: this.activeConversations.size,
                maxActiveConversations: this.config.maxActiveConversations
            });
            
        } catch (error) {
            logger.error('Enterprise chat storage initialization failed', error);
            throw error;
        }
    }

    /**
     * Store a new conversation message with intelligent tiering
     */
    async storeMessage(phone, message, response, metadata = {}) {
        const startTime = Date.now();
        
        try {
            const phoneHash = this.hashPhone(phone);
            const timestamp = new Date();
            
            // 1. Store in database (persistent)
            const messageId = await this.storeInDatabase(phoneHash, phone, message, response, metadata, timestamp);
            
            // 2. Update active conversations (memory)
            await this.updateActiveConversation(phone, message, response, metadata, timestamp);
            
            // 3. Cache recent conversation in Redis (fast access)
            await this.updateRedisCache(phoneHash, message, response, timestamp);
            
            // 4. Check if we need to archive old conversations (optional)
            // await this.checkArchiveThresholds(phone); // TODO: Implement if needed
            
            const processingTime = Date.now() - startTime;
            logger.debug('Message stored in enterprise storage', {
                phone: phoneHash.substring(0, 8),
                processingTime,
                messageId
            });
            
            return messageId;
            
        } catch (error) {
            logger.error('Failed to store message in enterprise storage', error, { phone });
            throw error;
        }
    }

    /**
     * Retrieve conversation history with intelligent loading
     */
    async getConversationHistory(phone, limit = 10) {
        const startTime = Date.now();
        
        try {
            const phoneHash = this.hashPhone(phone);
            
            // 1. Try active conversations first (fastest)
            if (this.activeConversations.has(phone)) {
                const conversation = this.activeConversations.get(phone);
                const recentMessages = conversation.messages.slice(-limit);
                
                logger.debug('Conversation loaded from active memory', {
                    phone: phoneHash.substring(0, 8),
                    messages: recentMessages.length,
                    processingTime: Date.now() - startTime
                });
                
                return recentMessages;
            }
            
            // 2. Try Redis cache (fast)
            const cachedHistory = await this.redis.get(`conversation:${phoneHash}`);
            if (cachedHistory) {
                const messages = JSON.parse(cachedHistory);
                const limitedMessages = messages.slice(-limit);
                
                logger.debug('Conversation loaded from Redis', {
                    phone: phoneHash.substring(0, 8),
                    messages: limitedMessages.length,
                    processingTime: Date.now() - startTime
                });
                
                return limitedMessages;
            }
            
            // 3. Load from database (slower but complete)
            const messages = await this.loadFromDatabase(phoneHash, limit);
            
            // Cache for next time
            if (messages.length > 0) {
                await this.redis.setEx(`conversation:${phoneHash}`, 3600, JSON.stringify(messages));
            }
            
            logger.debug('Conversation loaded from database', {
                phone: phoneHash.substring(0, 8),
                messages: messages.length,
                processingTime: Date.now() - startTime
            });
            
            return messages;
            
        } catch (error) {
            logger.error('Failed to get conversation history', error, { phone });
            return [];
        }
    }

    /**
     * Store conversation in database with optimized schema
     */
    async storeInDatabase(phoneHash, phone, message, response, metadata, timestamp) {
        try {
            const [result] = await this.dbPool.execute(`
                INSERT INTO enterprise_conversations 
                (phone_hash, phone_original, message, response, metadata, created_at, processing_time_ms, tokens_used, provider, confidence_score)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                phoneHash,
                phone, // Store original for admin lookup (encrypted in production)
                message,
                response,
                JSON.stringify(metadata),
                timestamp,
                metadata.processingTime || null,
                metadata.tokensUsed || null,
                metadata.provider || 'claude',
                metadata.confidence || null
            ]);
            
            return result.insertId;
            
        } catch (error) {
            // If table doesn't exist, create it
            if (error.code === 'ER_NO_SUCH_TABLE') {
                await this.createEnterpriseSchema();
                return this.storeInDatabase(phoneHash, phone, message, response, metadata, timestamp);
            }
            throw error;
        }
    }

    /**
     * Load recent conversations into active memory on startup
     */
    async loadActiveConversations() {
        try {
            // Get customers with recent activity (last 7 days)
            const [recentCustomers] = await this.dbPool.execute(`
                SELECT DISTINCT phone_original, phone_hash, MAX(created_at) as last_activity
                FROM enterprise_conversations 
                WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY phone_hash
                ORDER BY last_activity DESC
                LIMIT ?
            `, [this.config.maxActiveConversations]);

            // Load their recent conversations
            for (const customer of recentCustomers) {
                const messages = await this.loadFromDatabase(customer.phone_hash, this.config.maxMessagesPerCustomer);
                
                if (messages.length > 0) {
                    this.activeConversations.set(customer.phone_original, {
                        phone: customer.phone_original,
                        phoneHash: customer.phone_hash,
                        messages: messages,
                        lastActivity: customer.last_activity,
                        totalMessages: messages.length
                    });
                }
            }
            
            logger.info('Active conversations loaded', {
                count: this.activeConversations.size,
                maxAllowed: this.config.maxActiveConversations
            });
            
        } catch (error) {
            logger.error('Failed to load active conversations', error);
        }
    }

    /**
     * Update active conversation in memory with size limits
     */
    async updateActiveConversation(phone, message, response, metadata, timestamp) {
        try {
            let conversation = this.activeConversations.get(phone);
            
            if (!conversation) {
                // Create new conversation
                conversation = {
                    phone: phone,
                    phoneHash: this.hashPhone(phone),
                    messages: [],
                    firstContact: timestamp,
                    lastActivity: timestamp,
                    totalMessages: 0
                };
            }
            
            // Add new message
            conversation.messages.push({
                timestamp: timestamp,
                customerMessage: message,
                botResponse: response,
                metadata: metadata
            });
            
            conversation.lastActivity = timestamp;
            conversation.totalMessages = conversation.messages.length;
            
            // Trim to max messages
            if (conversation.messages.length > this.config.maxMessagesPerCustomer) {
                conversation.messages = conversation.messages.slice(-this.config.maxMessagesPerCustomer);
            }
            
            this.activeConversations.set(phone, conversation);
            
            // If we have too many active conversations, remove oldest
            if (this.activeConversations.size > this.config.maxActiveConversations) {
                this.evictOldestConversation();
            }
            
        } catch (error) {
            logger.error('Failed to update active conversation', error);
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
            logger.debug('Evicted oldest conversation from active memory', { 
                phone: this.hashPhone(oldestPhone).substring(0, 8) 
            });
        }
    }

    /**
     * Update Redis cache with recent messages
     */
    async updateRedisCache(phoneHash, message, response, timestamp) {
        try {
            const cacheKey = `conversation:${phoneHash}`;
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
            
            // Cache for 1 hour
            await this.redis.setEx(cacheKey, 3600, JSON.stringify(messages));
            
        } catch (error) {
            logger.error('Failed to update Redis cache', error);
        }
    }

    /**
     * Archive old conversations to reduce active data size
     */
    async setupArchiving() {
        // Only run archiving in production, not in development/test
        if (process.env.NODE_ENV === 'production') {
            // Run archiving every hour
            setInterval(async () => {
                try {
                    await this.archiveOldConversations();
                } catch (error) {
                    logger.error('Archiving process failed', error);
                }
            }, 60 * 60 * 1000); // 1 hour
            
            logger.info('Automatic archiving scheduled for production');
        }
    }

    /**
     * Move old conversations to archive tables/files
     */
    async archiveOldConversations() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.archiveAfterDays);
            
            // Get conversations to archive
            const [oldConversations] = await this.dbPool.execute(`
                SELECT id, phone_hash, phone_original, message, response, created_at
                FROM enterprise_conversations
                WHERE created_at < ? AND archived = 0
                LIMIT ?
            `, [cutoffDate, this.config.batchSize]);
            
            if (oldConversations.length === 0) {
                return; // Nothing to archive
            }
            
            // Create archive file
            const archiveDate = new Date().toISOString().split('T')[0];
            const archiveFile = path.join(
                this.config.localStorageDir, 
                'archive', 
                `conversations_${archiveDate}.json`
            );
            
            let archiveData = [];
            
            // Read existing archive if it exists
            try {
                const existing = await fs.readFile(archiveFile, 'utf8');
                archiveData = JSON.parse(existing);
            } catch (e) {
                // File doesn't exist, start fresh
            }
            
            // Add conversations to archive
            archiveData.push(...oldConversations.map(conv => ({
                id: conv.id,
                phoneHash: conv.phone_hash,
                message: conv.message,
                response: conv.response,
                timestamp: conv.created_at,
                archivedAt: new Date()
            })));
            
            // Write archive file
            await fs.writeFile(archiveFile, JSON.stringify(archiveData, null, 2));
            
            // Mark as archived in database
            const conversationIds = oldConversations.map(c => c.id);
            await this.dbPool.execute(`
                UPDATE enterprise_conversations 
                SET archived = 1, archived_at = NOW() 
                WHERE id IN (${conversationIds.map(() => '?').join(',')})
            `, conversationIds);
            
            logger.info('Conversations archived', {
                count: oldConversations.length,
                archiveFile: archiveFile,
                cutoffDate: cutoffDate
            });
            
        } catch (error) {
            logger.error('Failed to archive conversations', error);
        }
    }

    /**
     * Create enterprise database schema
     */
    async createEnterpriseSchema() {
        const schema = `
            CREATE TABLE IF NOT EXISTS enterprise_conversations (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                phone_hash VARCHAR(64) NOT NULL,
                phone_original VARCHAR(20),
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processing_time_ms INT,
                tokens_used INT,
                provider VARCHAR(50),
                confidence_score FLOAT,
                archived TINYINT DEFAULT 0,
                archived_at TIMESTAMP NULL,
                
                INDEX idx_phone_hash (phone_hash),
                INDEX idx_created_at (created_at),
                INDEX idx_archived (archived),
                INDEX idx_phone_created (phone_hash, created_at)
            );
        `;
        
        await this.dbPool.execute(schema);
        logger.info('Enterprise conversations table created');
    }

    /**
     * Load messages from database
     */
    async loadFromDatabase(phoneHash, limit = 10) {
        try {
            const [rows] = await this.dbPool.execute(`
                SELECT message, response, created_at, metadata, confidence_score
                FROM enterprise_conversations
                WHERE phone_hash = ? AND archived = 0
                ORDER BY created_at DESC
                LIMIT ?
            `, [phoneHash, limit]);
            
            return rows.map(row => ({
                timestamp: row.created_at,
                customerMessage: row.message,
                botResponse: row.response,
                confidence: row.confidence_score,
                metadata: row.metadata ? JSON.parse(row.metadata) : {}
            })).reverse(); // Return in chronological order
            
        } catch (error) {
            logger.error('Failed to load messages from database', error);
            return [];
        }
    }

    /**
     * Get storage statistics
     */
    async getStorageStats() {
        try {
            const [dbStats] = await this.dbPool.execute(`
                SELECT 
                    COUNT(*) as total_conversations,
                    COUNT(DISTINCT phone_hash) as unique_customers,
                    COUNT(CASE WHEN archived = 0 THEN 1 END) as active_conversations,
                    COUNT(CASE WHEN archived = 1 THEN 1 END) as archived_conversations,
                    MAX(created_at) as latest_conversation,
                    MIN(created_at) as earliest_conversation
                FROM enterprise_conversations
            `);
            
            const redisInfo = await this.redis.info('memory');
            const redisMemory = redisInfo.split('\r\n')
                .find(line => line.startsWith('used_memory_human:'))
                ?.split(':')[1];
            
            return {
                database: dbStats[0],
                activeConversations: this.activeConversations.size,
                maxActiveConversations: this.config.maxActiveConversations,
                redisMemoryUsage: redisMemory,
                cacheHitRatio: 'Not implemented', // TODO: Add cache hit tracking
                archiveThreshold: this.config.archiveAfterDays
            };
            
        } catch (error) {
            logger.error('Failed to get storage stats', error);
            return { error: error.message };
        }
    }

    /**
     * Hash phone number for privacy
     */
    hashPhone(phone) {
        return crypto.createHash('sha256').update(phone + 'sms_bot_salt').digest('hex').substring(0, 16);
    }

    /**
     * Migrate from old JSON storage system
     */
    async migrateFromJsonStorage(jsonFilePath) {
        try {
            logger.info('Starting migration from JSON storage', { file: jsonFilePath });
            
            const jsonData = JSON.parse(await fs.readFile(jsonFilePath, 'utf8'));
            let migrated = 0;
            
            for (const [phone, conversation] of Object.entries(jsonData)) {
                if (conversation.messages && Array.isArray(conversation.messages)) {
                    for (const message of conversation.messages) {
                        await this.storeMessage(
                            phone, 
                            message.customerMessage, 
                            message.botResponse, 
                            {
                                migrated: true,
                                originalTimestamp: message.timestamp,
                                provider: 'legacy'
                            }
                        );
                        migrated++;
                    }
                }
            }
            
            // Backup old file
            await fs.rename(jsonFilePath, `${jsonFilePath}.migrated.backup`);
            
            logger.info('Migration completed', { 
                migratedMessages: migrated,
                backupFile: `${jsonFilePath}.migrated.backup`
            });
            
            return migrated;
            
        } catch (error) {
            logger.error('Migration failed', error);
            throw error;
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
            logger.info('Enterprise chat storage closed');
        } catch (error) {
            logger.error('Error closing enterprise chat storage', error);
        }
    }
}

module.exports = EnterpriseChatStorage;