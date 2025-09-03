/**
 * MySQL Database Migration Script
 * Migrates data from PostgreSQL to MySQL for Bluehost deployment
 */

const mysql = require('mysql2/promise');
const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL connection (source)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// MySQL connection (destination)
const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function migrateData() {
  console.log('🔄 Starting PostgreSQL to MySQL migration...');

  try {
    // Create MySQL tables first
    await createMySQLTables();
    
    // Migrate conversations
    await migrateConversations();
    
    // Migrate messages
    await migrateMessages();
    
    // Migrate knowledge
    await migrateKnowledge();
    
    // Migrate personality
    await migratePersonality();
    
    // Migrate system instructions
    await migrateSystemInstructions();
    
    // Migrate logs
    await migrateLogs();
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await pgPool.end();
    await mysqlPool.end();
  }
}

async function createMySQLTables() {
  console.log('📋 Creating MySQL tables...');
  
  const tables = [
    `CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(100),
      paused BOOLEAN DEFAULT FALSE,
      requested_human BOOLEAN DEFAULT FALSE,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phone (phone),
      INDEX idx_last_active (last_active)
    )`,
    
    `CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      sender ENUM('user', 'assistant') NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_phone (phone),
      INDEX idx_timestamp (timestamp)
    )`,
    
    `CREATE TABLE IF NOT EXISTS knowledge (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      source VARCHAR(100) DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_source (source),
      INDEX idx_created_at (created_at)
    )`,
    
    `CREATE TABLE IF NOT EXISTS personality (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS system_instructions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    
    `CREATE TABLE IF NOT EXISTS logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      level ENUM('info', 'warn', 'error') NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_level (level),
      INDEX idx_timestamp (timestamp)
    )`
  ];
  
  for (const table of tables) {
    await mysqlPool.execute(table);
  }
  
  console.log('✅ MySQL tables created');
}

async function migrateConversations() {
  console.log('👥 Migrating conversations...');
  
  const pgResult = await pgPool.query('SELECT phone, name, paused, requested_human, last_active FROM conversations');
  const conversations = pgResult.rows;
  
  for (const conv of conversations) {
    try {
      await mysqlPool.execute(
        'INSERT INTO conversations (phone, name, paused, requested_human, last_active) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), paused = VALUES(paused), requested_human = VALUES(requested_human), last_active = VALUES(last_active)',
        [conv.phone, conv.name, conv.paused, conv.requested_human, conv.last_active]
      );
    } catch (error) {
      console.warn(`⚠️ Skipped conversation ${conv.phone}:`, error.message);
    }
  }
  
  console.log(`✅ Migrated ${conversations.length} conversations`);
}

async function migrateMessages() {
  console.log('💬 Migrating messages...');
  
  const pgResult = await pgPool.query('SELECT phone, sender, message, timestamp FROM messages ORDER BY timestamp');
  const messages = pgResult.rows;
  
  let migrated = 0;
  for (const msg of messages) {
    try {
      await mysqlPool.execute(
        'INSERT INTO messages (phone, sender, message, timestamp) VALUES (?, ?, ?, ?)',
        [msg.phone, msg.sender, msg.message, msg.timestamp]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️ Skipped message:`, error.message);
    }
  }
  
  console.log(`✅ Migrated ${migrated}/${messages.length} messages`);
}

async function migrateKnowledge() {
  console.log('🧠 Migrating knowledge base...');
  
  const pgResult = await pgPool.query('SELECT content, source, created_at FROM knowledge');
  const knowledge = pgResult.rows;
  
  for (const kb of knowledge) {
    try {
      await mysqlPool.execute(
        'INSERT INTO knowledge (content, source, created_at) VALUES (?, ?, ?)',
        [kb.content, kb.source || 'manual', kb.created_at]
      );
    } catch (error) {
      console.warn(`⚠️ Skipped knowledge entry:`, error.message);
    }
  }
  
  console.log(`✅ Migrated ${knowledge.length} knowledge entries`);
}

async function migratePersonality() {
  console.log('🎭 Migrating personality...');
  
  const pgResult = await pgPool.query('SELECT content FROM personality ORDER BY id DESC LIMIT 1');
  if (pgResult.rows.length > 0) {
    await mysqlPool.execute(
      'INSERT INTO personality (content) VALUES (?) ON DUPLICATE KEY UPDATE content = VALUES(content)',
      [pgResult.rows[0].content]
    );
    console.log('✅ Migrated personality');
  } else {
    console.log('⚠️ No personality found');
  }
}

async function migrateSystemInstructions() {
  console.log('⚙️ Migrating system instructions...');
  
  const pgResult = await pgPool.query('SELECT content FROM system_instructions ORDER BY id DESC LIMIT 1');
  if (pgResult.rows.length > 0) {
    await mysqlPool.execute(
      'INSERT INTO system_instructions (content) VALUES (?) ON DUPLICATE KEY UPDATE content = VALUES(content)',
      [pgResult.rows[0].content]
    );
    console.log('✅ Migrated system instructions');
  } else {
    console.log('⚠️ No system instructions found');
  }
}

async function migrateLogs() {
  console.log('📋 Migrating recent logs...');
  
  // Only migrate last 1000 logs to avoid overwhelming MySQL
  const pgResult = await pgPool.query('SELECT level, message, timestamp FROM logs ORDER BY timestamp DESC LIMIT 1000');
  const logs = pgResult.rows;
  
  let migrated = 0;
  for (const log of logs.reverse()) { // Reverse to maintain chronological order
    try {
      await mysqlPool.execute(
        'INSERT INTO logs (level, message, timestamp) VALUES (?, ?, ?)',
        [log.level, log.message, log.timestamp]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️ Skipped log entry:`, error.message);
    }
  }
  
  console.log(`✅ Migrated ${migrated}/${logs.length} log entries`);
}

// Run migration
if (require.main === module) {
  migrateData().catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
}

module.exports = { migrateData };