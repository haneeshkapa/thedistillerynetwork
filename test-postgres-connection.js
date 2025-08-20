#!/usr/bin/env node

// Test script to check PostgreSQL connection with production environment
require('dotenv').config();

async function testPostgresConnection() {
    console.log('🔍 Testing PostgreSQL connection...');
    
    if (!process.env.DATABASE_URL) {
        console.log('❌ DATABASE_URL not set');
        return;
    }
    
    console.log('🔗 DATABASE_URL configured:', process.env.DATABASE_URL.substring(0, 20) + '...');
    
    try {
        // Test with extended timeout
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000  // Longer timeout for testing
        });
        
        console.log('🔄 Attempting connection...');
        const client = await pool.connect();
        
        console.log('✅ PostgreSQL connection successful!');
        
        // Test basic query
        const result = await client.query('SELECT NOW() as current_time');
        console.log('📅 Database time:', result.rows[0].current_time);
        
        // Check if our tables exist
        const tableCheck = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'distillation_conversations'
        `);
        
        if (tableCheck.rows.length > 0) {
            console.log('✅ distillation_conversations table exists');
            
            // Check how many conversations are stored
            const countResult = await client.query('SELECT COUNT(*) FROM distillation_conversations');
            console.log('📊 Total conversations in database:', countResult.rows[0].count);
            
        } else {
            console.log('❌ distillation_conversations table does not exist');
        }
        
        client.release();
        await pool.end();
        
    } catch (error) {
        console.error('❌ PostgreSQL connection failed:', error.message);
        console.error('Error details:', error.code, error.errno);
    }
}

testPostgresConnection().then(() => process.exit(0));