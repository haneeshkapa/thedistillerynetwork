#!/usr/bin/env node

/**
 * Fix knowledge table constraint to allow new source types
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixConstraint() {
  try {
    console.log('🔧 Fixing knowledge table constraint...');
    
    // Drop the old constraint
    await pool.query(`
      ALTER TABLE knowledge 
      DROP CONSTRAINT IF EXISTS knowledge_source_check
    `);
    
    // Add the new constraint with more source types
    await pool.query(`
      ALTER TABLE knowledge 
      ADD CONSTRAINT knowledge_source_check 
      CHECK (source IN ('manual', 'shopify', 'shopify-meta', 'shopify-policy', 'shopify-page', 'website', 'website-blog', 'website-page', 'website-collection'))
    `);
    
    console.log('✅ Constraint updated successfully!');
    console.log('Now the knowledge base can store content from:');
    console.log('  - manual entries');
    console.log('  - shopify products');
    console.log('  - shopify metafields');
    console.log('  - shopify policies');
    console.log('  - shopify pages');
    console.log('  - website pages');
    console.log('  - website blogs');
    console.log('  - website collections');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing constraint:', err);
    process.exit(1);
  }
}

fixConstraint();