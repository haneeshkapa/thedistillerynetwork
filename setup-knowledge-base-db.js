#!/usr/bin/env node

// Setup script to migrate knowledge base from JSON to PostgreSQL
require('dotenv').config();

async function setupKnowledgeBaseDB() {
    console.log('🧠 Setting up PostgreSQL knowledge base storage...');
    
    if (!process.env.DATABASE_URL) {
        console.log('❌ DATABASE_URL not set');
        return;
    }
    
    const { Pool } = require('pg');
    const fs = require('fs');
    const path = require('path');
    
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });
        
        console.log('🔄 Creating knowledge base tables...');
        
        // Create knowledge base table with versioning
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
            
            -- Knowledge base versions table for change tracking
            CREATE TABLE IF NOT EXISTS knowledge_base_versions (
                id BIGSERIAL PRIMARY KEY,
                knowledge_id BIGINT REFERENCES knowledge_base(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                content TEXT NOT NULL,
                change_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(50) DEFAULT 'admin'
            );
            
            CREATE INDEX IF NOT EXISTS idx_kb_versions_knowledge_id ON knowledge_base_versions(knowledge_id);
            CREATE INDEX IF NOT EXISTS idx_kb_versions_version ON knowledge_base_versions(version DESC);
        `;
        
        await pool.query(createTableSQL);
        console.log('✅ Knowledge base tables created successfully');
        
        // Check if we need to migrate existing knowledge from JSON
        const existingCount = await pool.query('SELECT COUNT(*) FROM knowledge_base');
        const count = parseInt(existingCount.rows[0].count);
        
        if (count === 0) {
            console.log('📥 No existing knowledge found, checking for JSON file to migrate...');
            await migrateFromJSON(pool);
        } else {
            console.log(`📊 Knowledge base already has ${count} entries`);
        }
        
        await pool.end();
        console.log('✅ Knowledge base setup complete!');
        
    } catch (error) {
        console.error('❌ Knowledge base setup failed:', error.message);
        process.exit(1);
    }
}

async function migrateFromJSON(pool) {
    const jsonPath = path.join(__dirname, 'data', 'knowledge.json');
    
    if (!fs.existsSync(jsonPath)) {
        console.log('📝 No existing knowledge.json found, will start with empty knowledge base');
        
        // Insert some basic company information
        const basicKnowledge = [
            {
                category: 'company',
                title: 'Company Name',
                content: 'American Copper Works - Premium distillation equipment manufacturer',
                keywords: ['American Copper Works', 'company', 'distillation', 'equipment'],
                priority: 10
            },
            {
                category: 'contact',
                title: 'Phone Number',
                content: 'Main phone: (555) 123-4567',
                keywords: ['phone', 'contact', 'call'],
                priority: 9
            },
            {
                category: 'products',
                title: 'Product Categories',
                content: 'We manufacture copper stills, distillation columns, fermentation tanks, and related distillation equipment.',
                keywords: ['stills', 'copper', 'distillation', 'equipment', 'products'],
                priority: 8
            }
        ];
        
        for (const item of basicKnowledge) {
            const insertSQL = `
                INSERT INTO knowledge_base (category, title, content, keywords, priority)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `;
            
            const result = await pool.query(insertSQL, [
                item.category,
                item.title, 
                item.content,
                item.keywords,
                item.priority
            ]);
            
            console.log(`✅ Added basic knowledge: ${item.title} (ID: ${result.rows[0].id})`);
        }
        
        return;
    }
    
    console.log('📄 Found existing knowledge.json, migrating...');
    
    try {
        // Read and parse existing JSON knowledge
        const jsonContent = fs.readFileSync(jsonPath, 'utf8');
        let knowledgeData;
        
        try {
            knowledgeData = JSON.parse(jsonContent);
        } catch (parseError) {
            console.error('❌ Failed to parse knowledge.json:', parseError.message);
            return;
        }
        
        // Convert flat JSON structure to organized database entries
        let migrated = 0;
        
        if (Array.isArray(knowledgeData)) {
            // Handle array format
            for (let i = 0; i < knowledgeData.length; i++) {
                const item = knowledgeData[i];
                await insertKnowledgeItem(pool, {
                    category: 'general',
                    title: `Knowledge Item ${i + 1}`,
                    content: typeof item === 'string' ? item : JSON.stringify(item),
                    keywords: extractKeywords(typeof item === 'string' ? item : JSON.stringify(item)),
                    priority: 5
                });
                migrated++;
            }
        } else if (typeof knowledgeData === 'object') {
            // Handle object format
            for (const [key, value] of Object.entries(knowledgeData)) {
                await insertKnowledgeItem(pool, {
                    category: categorizeKey(key),
                    title: formatTitle(key),
                    content: typeof value === 'string' ? value : JSON.stringify(value),
                    keywords: extractKeywords(key + ' ' + (typeof value === 'string' ? value : '')),
                    priority: prioritizeByKey(key)
                });
                migrated++;
            }
        }
        
        console.log(`✅ Successfully migrated ${migrated} knowledge items from JSON`);
        
        // Backup the original JSON file
        const backupPath = jsonPath + '.migrated.' + new Date().toISOString().replace(/:/g, '-').split('.')[0] + '.backup';
        fs.copyFileSync(jsonPath, backupPath);
        console.log(`📦 Original JSON backed up to: ${backupPath}`);
        
    } catch (error) {
        console.error('❌ Failed to migrate knowledge from JSON:', error.message);
    }
}

async function insertKnowledgeItem(pool, item) {
    const insertSQL = `
        INSERT INTO knowledge_base (category, title, content, keywords, priority)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
    `;
    
    const result = await pool.query(insertSQL, [
        item.category,
        item.title,
        item.content,
        item.keywords,
        item.priority
    ]);
    
    return result.rows[0].id;
}

function categorizeKey(key) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('phone') || keyLower.includes('contact') || keyLower.includes('email')) return 'contact';
    if (keyLower.includes('product') || keyLower.includes('equipment') || keyLower.includes('still')) return 'products';
    if (keyLower.includes('company') || keyLower.includes('about') || keyLower.includes('business')) return 'company';
    if (keyLower.includes('price') || keyLower.includes('cost') || keyLower.includes('order')) return 'pricing';
    if (keyLower.includes('shipping') || keyLower.includes('delivery')) return 'shipping';
    if (keyLower.includes('technical') || keyLower.includes('spec') || keyLower.includes('distill')) return 'technical';
    return 'general';
}

function formatTitle(key) {
    return key.split(/[_-]/).map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

function extractKeywords(text) {
    // Extract meaningful keywords from text
    const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'a', 'an'];
    
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !commonWords.includes(word))
        .slice(0, 10); // Limit to 10 keywords
    
    return [...new Set(words)]; // Remove duplicates
}

function prioritizeByKey(key) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes('company') || keyLower.includes('phone') || keyLower.includes('contact')) return 10;
    if (keyLower.includes('product') || keyLower.includes('equipment')) return 8;
    if (keyLower.includes('price') || keyLower.includes('order')) return 7;
    if (keyLower.includes('technical') || keyLower.includes('spec')) return 6;
    return 5;
}

if (require.main === module) {
    setupKnowledgeBaseDB().then(() => process.exit(0));
}

module.exports = setupKnowledgeBaseDB;