const { Pool } = require('pg');
const logger = require('./logger');

/**
 * PostgreSQL-based Knowledge Retriever for Jonathan's Distillation Bot
 * Replaces file-based knowledge.json with database storage
 */
class KnowledgeRetrieverPostgres {
    constructor() {
        this.dbPool = null;
        this.cache = new Map();
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes
        this.lastCacheUpdate = 0;
        
        this.initialize();
    }
    
    async initialize() {
        try {
            if (!process.env.DATABASE_URL) {
                logger.warn('DATABASE_URL not set, falling back to file-based knowledge');
                return false;
            }
            
            this.dbPool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 5,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000
            });
            
            // Test connection
            const client = await this.dbPool.connect();
            await client.query('SELECT NOW()');
            client.release();
            
            // Ensure knowledge base tables exist
            await this.ensureTables();
            
            logger.info('PostgreSQL Knowledge Retriever initialized successfully');
            return true;
            
        } catch (error) {
            logger.error('Failed to initialize PostgreSQL knowledge retriever', { error: error.message });
            return false;
        }
    }
    
    async ensureTables() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS knowledge_base (
                id BIGSERIAL PRIMARY KEY,
                category VARCHAR(100) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                keywords TEXT[], -- Array of searchable keywords
                priority INTEGER DEFAULT 5, -- 1-10, higher = more important
                active BOOLEAN DEFAULT TRUE,
                version INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(50) DEFAULT 'admin',
                updated_by VARCHAR(50) DEFAULT 'admin'
            );

            -- Indexes for fast retrieval
            CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base(category);
            CREATE INDEX IF NOT EXISTS idx_kb_active ON knowledge_base(active);
            CREATE INDEX IF NOT EXISTS idx_kb_priority ON knowledge_base(priority DESC);
            CREATE INDEX IF NOT EXISTS idx_kb_keywords ON knowledge_base USING GIN(keywords);
            CREATE INDEX IF NOT EXISTS idx_kb_content_search ON knowledge_base USING GIN(to_tsvector('english', title || ' ' || content));
        `;
        
        await this.dbPool.query(createTableSQL);
        
        // Check if we have any knowledge entries
        const countResult = await this.dbPool.query('SELECT COUNT(*) FROM knowledge_base WHERE active = TRUE');
        const count = parseInt(countResult.rows[0].count);
        
        if (count === 0) {
            await this.insertDefaultKnowledge();
        }
    }
    
    async insertDefaultKnowledge() {
        const defaultKnowledge = [
            {
                category: 'company',
                title: 'American Copper Works',
                content: 'American Copper Works - Premium copper stills and distillation equipment manufacturer. Specializing in moonshine stills, copper accessories, and distillation supplies. All products are for legal water distillation and fuel alcohol production only.',
                keywords: ['American Copper Works', 'company', 'copper', 'stills', 'distillation', 'moonshine', 'equipment'],
                priority: 10
            },
            {
                category: 'contact',
                title: 'Contact Information',
                content: 'Phone: (603) 997-6786 | Website: moonshinestills.com | Email: contact available through website',
                keywords: ['phone', 'contact', 'website', 'moonshinestills', '603', '997', '6786'],
                priority: 10
            },
            {
                category: 'products',
                title: 'Product Categories',
                content: 'We manufacture premium copper stills, distillation columns, fermentation tanks, copper accessories, and related distillation equipment. Available in various sizes from hobby to commercial scale.',
                keywords: ['products', 'copper', 'stills', 'distillation', 'columns', 'fermentation', 'tanks', 'accessories', 'hobby', 'commercial'],
                priority: 9
            },
            {
                category: 'technical',
                title: 'Distillation Expertise',
                content: 'Expert knowledge in alcohol distillation processes, mash bill formulation, fermentation, cuts (heads, hearts, tails), proofing, and still operation. Copper construction for optimal heat distribution and flavor.',
                keywords: ['distillation', 'alcohol', 'mash', 'fermentation', 'heads', 'hearts', 'tails', 'proofing', 'copper', 'heat'],
                priority: 8
            },
            {
                category: 'legal',
                title: 'Legal Notice',
                content: 'All equipment is sold for legal water distillation, essential oil extraction, and fuel alcohol production. Customers are responsible for complying with federal, state, and local laws regarding alcohol production.',
                keywords: ['legal', 'water', 'distillation', 'essential', 'oil', 'fuel', 'alcohol', 'laws', 'federal', 'state', 'local'],
                priority: 7
            }
        ];
        
        for (const item of defaultKnowledge) {
            const insertSQL = `
                INSERT INTO knowledge_base (category, title, content, keywords, priority)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
            `;
            
            await this.dbPool.query(insertSQL, [
                item.category,
                item.title,
                item.content,
                item.keywords,
                item.priority
            ]);
        }
        
        logger.info('Default knowledge base entries created');
    }
    
    /**
     * Get relevant knowledge for a customer message
     */
    async getRelevantKnowledge(message, maxResults = 5) {
        try {
            const query = message.toLowerCase();
            const queryWords = query.split(/\s+/).filter(word => word.length > 2);
            
            // Multi-approach search for best results
            const results = await Promise.allSettled([
                this.searchByKeywords(queryWords, maxResults),
                this.searchByContent(query, maxResults),
                this.searchByCategory(this.categorizeMessage(query), maxResults)
            ]);
            
            // Combine and deduplicate results
            const allResults = new Map();
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    result.value.forEach(item => {
                        const key = item.id;
                        if (!allResults.has(key) || allResults.get(key).relevance < item.relevance) {
                            // Add bonus points for different search methods
                            item.relevance += (index === 0) ? 10 : (index === 1) ? 5 : 2;
                            allResults.set(key, item);
                        }
                    });
                }
            });
            
            // Sort by relevance and priority
            const sortedResults = Array.from(allResults.values())
                .sort((a, b) => (b.relevance + b.priority) - (a.relevance + a.priority))
                .slice(0, maxResults);
            
            const formattedResult = this.formatKnowledgeInfo(sortedResults);
            
            logger.info('Knowledge retrieval from PostgreSQL', {
                message: message.substring(0, 50),
                resultsFound: sortedResults.length,
                totalLength: formattedResult.length
            });
            
            return formattedResult;
            
        } catch (error) {
            logger.error('Failed to retrieve knowledge from PostgreSQL', { error: error.message });
            return this.getFallbackKnowledge();
        }
    }
    
    async searchByKeywords(queryWords, limit) {
        if (queryWords.length === 0) return [];
        
        const keywordConditions = queryWords.map((_, index) => 
            `$${index + 1} = ANY(keywords)`
        ).join(' OR ');
        
        const searchSQL = `
            SELECT id, category, title, content, keywords, priority,
                   (SELECT COUNT(*) FROM unnest(keywords) k WHERE k = ANY($${queryWords.length + 1})) as keyword_matches
            FROM knowledge_base 
            WHERE active = TRUE AND (${keywordConditions})
            ORDER BY keyword_matches DESC, priority DESC
            LIMIT $${queryWords.length + 2}
        `;
        
        const result = await this.dbPool.query(searchSQL, [...queryWords, queryWords, limit]);
        
        return result.rows.map(row => ({
            id: row.id,
            category: row.category,
            title: row.title,
            content: row.content,
            keywords: row.keywords,
            priority: row.priority,
            relevance: row.keyword_matches * 20
        }));
    }
    
    async searchByContent(query, limit) {
        const contentSearchSQL = `
            SELECT id, category, title, content, keywords, priority,
                   ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', $1)) as text_rank
            FROM knowledge_base 
            WHERE active = TRUE 
            AND (to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $1)
                 OR lower(title) LIKE $2 
                 OR lower(content) LIKE $2)
            ORDER BY text_rank DESC, priority DESC
            LIMIT $3
        `;
        
        const result = await this.dbPool.query(contentSearchSQL, [query, `%${query.substring(0, 20)}%`, limit]);
        
        return result.rows.map(row => ({
            id: row.id,
            category: row.category,
            title: row.title,
            content: row.content,
            keywords: row.keywords,
            priority: row.priority,
            relevance: Math.round(row.text_rank * 100)
        }));
    }
    
    async searchByCategory(category, limit) {
        if (!category) return [];
        
        const categorySearchSQL = `
            SELECT id, category, title, content, keywords, priority
            FROM knowledge_base 
            WHERE active = TRUE AND category = $1
            ORDER BY priority DESC
            LIMIT $2
        `;
        
        const result = await this.dbPool.query(categorySearchSQL, [category, limit]);
        
        return result.rows.map(row => ({
            id: row.id,
            category: row.category,
            title: row.title,
            content: row.content,
            keywords: row.keywords,
            priority: row.priority,
            relevance: 15 // Medium relevance for category matches
        }));
    }
    
    categorizeMessage(message) {
        const msgLower = message.toLowerCase();
        
        if (msgLower.includes('phone') || msgLower.includes('contact') || msgLower.includes('email') || msgLower.includes('website')) {
            return 'contact';
        }
        if (msgLower.includes('product') || msgLower.includes('still') || msgLower.includes('equipment') || msgLower.includes('copper')) {
            return 'products';
        }
        if (msgLower.includes('company') || msgLower.includes('about') || msgLower.includes('business')) {
            return 'company';
        }
        if (msgLower.includes('price') || msgLower.includes('cost') || msgLower.includes('order') || msgLower.includes('buy')) {
            return 'pricing';
        }
        if (msgLower.includes('distill') || msgLower.includes('mash') || msgLower.includes('ferment') || msgLower.includes('proof')) {
            return 'technical';
        }
        if (msgLower.includes('legal') || msgLower.includes('law') || msgLower.includes('permit')) {
            return 'legal';
        }
        
        return null;
    }
    
    formatKnowledgeInfo(results) {
        if (results.length === 0) {
            return this.getFallbackKnowledge();
        }
        
        let info = '';
        
        results.forEach((item, index) => {
            if (index > 0) info += '\n\n';
            info += `${item.title}:\n${item.content}`;
        });
        
        return info;
    }
    
    getFallbackKnowledge() {
        return `American Copper Works - Premium copper stills and distillation equipment.
Contact: (603) 997-6786 | moonshinestills.com
Specializing in moonshine stills, copper accessories, and distillation supplies.
All products are for legal water distillation and fuel alcohol production only.`;
    }
    
    /**
     * Admin functions for knowledge management
     */
    async addKnowledge(category, title, content, keywords = [], priority = 5, userId = 'admin') {
        const insertSQL = `
            INSERT INTO knowledge_base (category, title, content, keywords, priority, created_by, updated_by)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            RETURNING id, created_at
        `;
        
        const result = await this.dbPool.query(insertSQL, [
            category, title, content, keywords, priority, userId
        ]);
        
        logger.info('Knowledge added', {
            id: result.rows[0].id,
            title,
            category,
            userId
        });
        
        return result.rows[0];
    }
    
    async updateKnowledge(id, updates, userId = 'admin') {
        const allowedFields = ['category', 'title', 'content', 'keywords', 'priority', 'active'];
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        
        for (const [field, value] of Object.entries(updates)) {
            if (allowedFields.includes(field)) {
                updateFields.push(`${field} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }
        }
        
        if (updateFields.length === 0) {
            throw new Error('No valid fields to update');
        }
        
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        updateFields.push(`updated_by = $${paramIndex}`);
        values.push(userId);
        paramIndex++;
        
        const updateSQL = `
            UPDATE knowledge_base 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, updated_at
        `;
        values.push(id);
        
        const result = await this.dbPool.query(updateSQL, values);
        
        if (result.rows.length === 0) {
            throw new Error('Knowledge item not found');
        }
        
        logger.info('Knowledge updated', { id, userId, fields: Object.keys(updates) });
        return result.rows[0];
    }
    
    async deleteKnowledge(id, userId = 'admin') {
        // Soft delete - mark as inactive
        const deleteSQL = `
            UPDATE knowledge_base 
            SET active = FALSE, updated_by = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND active = TRUE
            RETURNING id, title
        `;
        
        const result = await this.dbPool.query(deleteSQL, [userId, id]);
        
        if (result.rows.length === 0) {
            throw new Error('Knowledge item not found or already deleted');
        }
        
        logger.info('Knowledge deleted', { id, title: result.rows[0].title, userId });
        return result.rows[0];
    }
    
    async getAllKnowledge(includeInactive = false) {
        const whereClause = includeInactive ? '' : 'WHERE active = TRUE';
        const selectSQL = `
            SELECT id, category, title, content, keywords, priority, active, 
                   created_at, updated_at, created_by, updated_by
            FROM knowledge_base 
            ${whereClause}
            ORDER BY category, priority DESC, title
        `;
        
        const result = await this.dbPool.query(selectSQL);
        return result.rows;
    }
    
    async getKnowledgeStats() {
        const statsSQL = `
            SELECT 
                COUNT(*) as total_entries,
                COUNT(CASE WHEN active = TRUE THEN 1 END) as active_entries,
                COUNT(DISTINCT category) as categories,
                MAX(updated_at) as last_update,
                AVG(priority) as avg_priority
            FROM knowledge_base
        `;
        
        const result = await this.dbPool.query(statsSQL);
        return result.rows[0];
    }
    
    async close() {
        if (this.dbPool) {
            await this.dbPool.end();
            logger.info('PostgreSQL Knowledge Retriever closed');
        }
    }
}

module.exports = KnowledgeRetrieverPostgres;