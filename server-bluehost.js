/**
 * SMS Bot Server - Bluehost MySQL Version
 * - Integrates with Anthropic Claude API for AI responses
 * - Uses MySQL for data storage (conversations, messages, knowledge, personality, logs)
 * - Integrates with Google Sheets for customer data lookup
 * - Integrates with Shopify for product catalog syncing
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const mysql = require('mysql2/promise');
const path = require('path');
const redis = require('redis');

const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const PriceValidator = require('./price-validator');
const enhancedShopifySync = require('./enhanced-shopify-sync');

require('dotenv').config({ path: '.env.bluehost' });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Load environment variables
const {
  ANTHROPIC_API_KEY,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID,
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_ACCESS_TOKEN,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  REDIS_URL,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_DB,
  PORT = 3000
} = process.env;

// Set up MySQL connection pool
const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT || 3306,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

// Initialize Redis client
let redisClient = null;
if (REDIS_URL) {
  redisClient = redis.createClient({
    url: REDIS_URL
  });
} else if (REDIS_HOST) {
  redisClient = redis.createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT || 6379
    },
    password: REDIS_PASSWORD || undefined,
    database: REDIS_DB || 0
  });
}

if (redisClient) {
  redisClient.on('error', (err) => {
    console.error('❌ Redis Client Error:', err);
    redisClient = null;
  });
  
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });
  
  redisClient.connect().catch(err => {
    console.error('❌ Failed to connect to Redis:', err.message);
    redisClient = null;
  });
} else {
  console.warn('⚠️ No Redis configuration found, using in-memory cache');
}

// Initialize Anthropic Claude client
const anthropicClient = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Google Sheets setup for customer data
let customerSheetDoc = null;
let customerSheet = null;

async function initializeGoogleSheets() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.warn('⚠️ Google Sheets configuration incomplete');
    return;
  }

  try {
    customerSheetDoc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await customerSheetDoc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
    await customerSheetDoc.loadInfo();
    customerSheet = customerSheetDoc.sheetsByIndex[0];
    console.log('✅ Google Sheets initialized successfully');
  } catch (error) {
    console.error('❌ Google Sheets initialization error:', error.message);
    customerSheetDoc = null;
    customerSheet = null;
  }
}

// Initialize MySQL database tables
async function initializeDatabase() {
  try {
    console.log('🔧 Initializing MySQL database tables...');
    
    // Conversations table
    await pool.execute(`CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(100),
      paused BOOLEAN DEFAULT FALSE,
      requested_human BOOLEAN DEFAULT FALSE,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_phone (phone),
      INDEX idx_last_active (last_active)
    )`);

    // Messages table  
    await pool.execute(`CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      sender ENUM('user', 'assistant') NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_phone (phone),
      INDEX idx_timestamp (timestamp),
      FOREIGN KEY (phone) REFERENCES conversations(phone) ON DELETE CASCADE
    )`);

    // Knowledge base table
    await pool.execute(`CREATE TABLE IF NOT EXISTS knowledge (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      source VARCHAR(100) DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_source (source),
      INDEX idx_created_at (created_at)
    )`);

    // Personality table
    await pool.execute(`CREATE TABLE IF NOT EXISTS personality (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    // System instructions table
    await pool.execute(`CREATE TABLE IF NOT EXISTS system_instructions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    // Logs table
    await pool.execute(`CREATE TABLE IF NOT EXISTS logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      level ENUM('info', 'warn', 'error') NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_level (level),
      INDEX idx_timestamp (timestamp)
    )`);

    // Insert default data if tables are empty
    const [personalityRows] = await pool.execute('SELECT id FROM personality LIMIT 1');
    if (personalityRows.length === 0) {
      const defaultPersonality = `You are Jonathan's AI assistant for his distillation equipment business. You're knowledgeable, helpful, and focused on providing excellent customer service for moonshine stills, copper equipment, and distillation supplies.

Key traits:
- Expert knowledge of distillation equipment and processes
- Friendly but professional tone
- Focus on safety and quality
- Always try to help customers find the right equipment
- Mention specific products when relevant`;

      await pool.execute('INSERT INTO personality (content) VALUES (?)', [defaultPersonality]);
    }

    const [systemRows] = await pool.execute('SELECT id FROM system_instructions LIMIT 1');
    if (systemRows.length === 0) {
      const defaultSystem = `You are an AI assistant for Jonathan's distillation equipment business. Help customers with:

1. Product recommendations and technical specifications
2. Order status and shipping information  
3. Safety guidelines and best practices
4. Troubleshooting equipment issues
5. General business information

Always be helpful, accurate, and focus on customer satisfaction.

Website: moonshinestills.com
Phone: (603) 997-6786
Email: tdnorders@gmail.com`;

      await pool.execute('INSERT INTO system_instructions (content) VALUES (?)', [defaultSystem]);
    }

    console.log('✅ MySQL database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
}

// Initialize components
async function initialize() {
  await initializeDatabase();
  await initializeGoogleSheets();
  
  // Initialize advanced retriever with MySQL
  global.advancedRetriever = new AdvancedKnowledgeRetriever({
    dbType: 'mysql',
    dbPool: pool
  });
  
  console.log('🚀 SMS Bot Server initialized successfully');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: "Jonathan's Distillation SMS Bot is running",
    timestamp: new Date().toISOString()
  });
});

// Main SMS reply endpoint (same as original but with MySQL queries)
app.post('/reply', async (req, res) => {
  try {
    const { phone, text: userMessage } = req.body;
    
    if (!phone || !userMessage) {
      return res.status(400).json({ error: 'Phone and text are required' });
    }

    // Normalize phone number
    const normalizedPhone = phone.replace(/^\+?1?/, '').replace(/\D/g, '');
    
    // Check if customer exists in Google Sheets
    const customer = await findCustomerByPhone(normalizedPhone);
    
    if (!customer) {
      console.log(`❌ Customer not found: ${normalizedPhone}`);
      return res.status(204).send();
    }

    // Get or create conversation (MySQL)
    let [convRows] = await pool.execute(
      'SELECT * FROM conversations WHERE phone = ?', 
      [normalizedPhone]
    );
    
    let conversation;
    if (convRows.length === 0) {
      await pool.execute(
        'INSERT INTO conversations (phone, name) VALUES (?, ?)',
        [normalizedPhone, customer.name || 'Unknown']
      );
      [convRows] = await pool.execute(
        'SELECT * FROM conversations WHERE phone = ?', 
        [normalizedPhone]
      );
    }
    conversation = convRows[0];

    // Check if paused
    if (conversation.paused) {
      console.log(`⏸️ Conversation paused for ${normalizedPhone}`);
      return res.status(204).send();
    }

    // Save user message
    await pool.execute(
      'INSERT INTO messages (phone, sender, message) VALUES (?, ?, ?)',
      [normalizedPhone, 'user', userMessage]
    );

    // Update last active
    await pool.execute(
      'UPDATE conversations SET last_active = CURRENT_TIMESTAMP WHERE phone = ?',
      [normalizedPhone]
    );

    // Generate AI response (same logic as original)
    const aiResponse = await generateAIResponse(normalizedPhone, userMessage, customer);

    // Save AI response
    await pool.execute(
      'INSERT INTO messages (phone, sender, message) VALUES (?, ?, ?)',
      [normalizedPhone, 'assistant', aiResponse]
    );

    res.send(aiResponse);

  } catch (error) {
    console.error('❌ Reply endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Customer lookup function (same as original)
async function findCustomerByPhone(phone) {
  if (!customerSheet) return null;
  
  try {
    const rows = await customerSheet.getRows({ limit: 1000, offset: 0 });
    
    for (const row of rows) {
      const rowData = row._rawData;
      if (!rowData || rowData.length === 0) continue;
      
      // Check multiple phone fields
      for (let i = 0; i < Math.min(15, rowData.length); i++) {
        const cellValue = String(rowData[i] || '').trim();
        if (cellValue.length < 7) continue;
        
        const normalizedCell = cellValue.replace(/\D/g, '');
        const normalizedPhone = phone.replace(/\D/g, '');
        
        if (normalizedCell.includes(normalizedPhone) || normalizedPhone.includes(normalizedCell)) {
          return {
            name: rowData[2] || rowData[0] || 'Unknown Customer',
            phone: phone,
            _rawData: rowData
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Customer lookup error:', error);
    return null;
  }
}

// AI Response generation (adapted for MySQL)
async function generateAIResponse(phone, userMessage, customer) {
  try {
    // Get personality and system instructions
    const [persRows] = await pool.execute('SELECT content FROM personality ORDER BY id DESC LIMIT 1');
    const [sysRows] = await pool.execute('SELECT content FROM system_instructions ORDER BY id DESC LIMIT 1');
    
    const personality = persRows.length ? persRows[0].content : '';
    const systemInstructions = sysRows.length ? sysRows[0].content : '';

    // Get conversation history
    const [historyRows] = await pool.execute(
      'SELECT sender, message FROM messages WHERE phone = ? ORDER BY timestamp DESC LIMIT 10',
      [phone]
    );

    // Build context (same logic as original)
    let conversationHistory = '';
    if (historyRows.length > 1) {
      conversationHistory = historyRows.reverse().slice(0, -1).map(msg => 
        `${msg.sender === 'user' ? 'Customer' : 'Assistant'}: ${msg.message}`
      ).join('\n');
    }

    // Get knowledge context
    const knowledgeContent = await global.advancedRetriever.getRelevantKnowledge(userMessage);
    
    // Customer context
    const customerContext = customer ? 
      `Customer Name: ${customer.name}\nPhone: ${customer.phone}` : 
      'Customer information not available';

    // Build prompt
    const fullPrompt = `${systemInstructions}

${personality}

CUSTOMER CONTEXT:
${customerContext}

KNOWLEDGE BASE:
${knowledgeContent}

CONVERSATION HISTORY:
${conversationHistory}

CURRENT MESSAGE: ${userMessage}

Respond helpfully and professionally:`;

    // Generate response with Claude
    const response = await anthropicClient.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 300,
      messages: [{ role: 'user', content: fullPrompt }]
    });

    return response.content[0].text.trim();

  } catch (error) {
    console.error('❌ AI response generation error:', error);
    return "I'm having trouble processing your request right now. Please try again or call (603) 997-6786 for immediate assistance.";
  }
}

// Add all other endpoints (admin, management, etc.) with MySQL adaptations
// ... (I'll add the key admin endpoints)

// Admin endpoints
app.get('/api/conversations', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT phone, name, paused, requested_human, last_active FROM conversations ORDER BY last_active DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

app.get('/api/messages/:phone', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT sender, message, timestamp FROM messages WHERE phone = ? ORDER BY timestamp ASC',
      [req.params.phone]
    );
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/knowledge', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, LEFT(content, 100) as content, source, created_at FROM knowledge ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('❌ Error fetching knowledge:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge' });
  }
});

// Management dashboard
app.get('/management.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'management.html'));
});

// Start server
initialize().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`🚀 SMS Bot Server running on port ${PORT}`);
    console.log(`📊 Management Dashboard: http://localhost:${PORT}/management.html`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    server.close(() => {
      pool.end();
      if (redisClient) redisClient.quit();
      process.exit(0);
    });
  });
}).catch(error => {
  console.error('❌ Failed to initialize server:', error);
  process.exit(1);
});