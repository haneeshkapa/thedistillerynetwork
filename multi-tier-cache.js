const redis = require('redis');
const mysql = require('mysql2/promise');
const logger = require('./logger');

class MultiTierCache {
    constructor() {
        // L1: In-memory cache (fastest, limited size)
        this.l1Cache = new Map();
        this.l1MaxSize = 1000;
        
        // L2: Redis cache (use REDIS_URL on production)
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
        
        // L3: Skip MySQL in production - use enterprise PostgreSQL storage instead
        if (process.env.DATABASE_URL) {
            console.log('🎯 Multi-tier cache: Using PostgreSQL enterprise storage, skipping local MySQL');
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
        
        this.hitStats = { l1: 0, l2: 0, l3: 0, miss: 0 };
        this.initialize();
    }

    async initialize() {
        try {
            await this.redis.connect();
            logger.info('Multi-tier cache initialized');
        } catch (error) {
            logger.error('Cache initialization error:', error.message);
        }
    }

    async get(key, type = 'query') {
        try {
            // Try L1 first (in-memory)
            if (this.l1Cache.has(key)) {
                this.hitStats.l1++;
                return this.l1Cache.get(key);
            }

            // Try L2 (Redis)
            const l2Result = await this.redis.get(`${type}:${key}`);
            if (l2Result) {
                this.hitStats.l2++;
                const data = JSON.parse(l2Result);
                this.setL1(key, data); // Promote to L1
                return data;
            }

            // Try L3 (Database) for conversations - skip if no MySQL pool (using PostgreSQL)
            if (type === 'conversation' && this.dbPool) {
                const [rows] = await this.dbPool.execute(
                    'SELECT response FROM conversations WHERE phone_hash = ? AND message = ? ORDER BY created_at DESC LIMIT 1',
                    [this.hashPhone(key.split(':')[0]), key.split(':')[1]]
                );
                
                if (rows.length > 0) {
                    this.hitStats.l3++;
                    const data = rows[0].response;
                    await this.setL2(key, data, type, 3600); // Cache for 1 hour
                    this.setL1(key, data);
                    return data;
                }
            }

            this.hitStats.miss++;
            return null;

        } catch (error) {
            logger.error('Cache get error:', error.message);
            return null;
        }
    }

    async set(key, data, type = 'query', ttl = 3600) {
        try {
            // Store in all tiers
            this.setL1(key, data);
            await this.setL2(key, data, type, ttl);
        } catch (error) {
            logger.error('Cache set error:', error.message);
        }
    }

    setL1(key, data) {
        if (this.l1Cache.size >= this.l1MaxSize) {
            const firstKey = this.l1Cache.keys().next().value;
            this.l1Cache.delete(firstKey); // LRU eviction
        }
        this.l1Cache.set(key, data);
    }

    async setL2(key, data, type, ttl = 3600) {
        try {
            await this.redis.setEx(`${type}:${key}`, ttl, JSON.stringify(data));
        } catch (error) {
            logger.error('Redis set error:', error.message);
        }
    }

    hashPhone(phone) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(phone + 'salt123').digest('hex').substring(0, 16);
    }

    getHitRatio() {
        const total = Object.values(this.hitStats).reduce((a, b) => a + b, 0);
        if (total === 0) return { l1: 0, l2: 0, l3: 0, miss: 0 };
        
        return {
            l1: (this.hitStats.l1 / total * 100).toFixed(1) + '%',
            l2: (this.hitStats.l2 / total * 100).toFixed(1) + '%', 
            l3: (this.hitStats.l3 / total * 100).toFixed(1) + '%',
            miss: (this.hitStats.miss / total * 100).toFixed(1) + '%'
        };
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
            logger.error('Cache close error:', error.message);
        }
    }
}

module.exports = MultiTierCache;