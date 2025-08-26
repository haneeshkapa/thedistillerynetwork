/**
 * SMS Bot Server - Express backend
 * - Integrates with Anthropic Claude API for AI responses
 * - Uses PostgreSQL for data storage (conversations, messages, knowledge, personality, logs)
 * - Integrates with Google Sheets for customer data lookup
 * - Integrates with Shopify for product catalog syncing
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { Pool } = require('pg');
const path = require('path');
const redis = require('redis');
const OpenAI = require('openai');
const twilio = require('twilio');

const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const PriceValidator = require('./price-validator');

require('dotenv').config();

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
  DATABASE_URL,
  REDIS_URL,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_DB,
  OPENAI_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  PORT = 3000
} = process.env;

// Set up PostgreSQL connection pool with optimized settings
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10, // Maximum pool size
  min: 2,  // Minimum pool size
  connectionTimeoutMillis: 30000, // Connection timeout - increased for Render
  idleTimeoutMillis: 30000,       // Idle connection timeout
  query_timeout: 20000            // Query timeout - increased for slow queries
});

// Initialize Redis client
let redisClient = null;
if (REDIS_URL) {
  // Use Redis URL (for Render, Railway, etc.)
  redisClient = redis.createClient({
    url: REDIS_URL
  });
} else if (REDIS_HOST) {
  // Use individual Redis config
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
    redisClient = null; // Fallback to in-memory cache
  });
  
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });
  
  // Connect to Redis
  redisClient.connect().catch(err => {
    console.error('❌ Failed to connect to Redis:', err.message);
    redisClient = null; // Fallback to in-memory cache
  });
} else {
  console.warn('⚠️ No Redis configuration found, using in-memory cache');
}

// Initialize Anthropic Claude client
const anthropicClient = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Initialize OpenAI client for voice functionality
let openaiClient = null;
if (OPENAI_API_KEY) {
  openaiClient = new OpenAI({
    apiKey: OPENAI_API_KEY
  });
  console.log('✅ OpenAI client initialized for voice functionality');
} else {
  console.warn('⚠️ OpenAI API key not provided - voice features disabled');
}

// Initialize Twilio client for voice calls
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio client initialized for voice calls');
} else {
  console.warn('⚠️ Twilio credentials not provided - voice calls disabled');
}

// Google Sheets setup for customer data
let customerSheetDoc = null;
let customerSheet = null;

if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY && GOOGLE_SHEET_ID) {
  customerSheetDoc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
  const privateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  
  customerSheetDoc.useServiceAccountAuth({
    client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: privateKey
  }).then(() => customerSheetDoc.loadInfo())
    .then(() => {
      // Use the "Shopify" sheet tab specifically  
      customerSheet = customerSheetDoc.sheetsByTitle['Shopify'];
      if (!customerSheet) {
        // Fallback to first sheet if "Shopify" not found
        customerSheet = customerSheetDoc.sheetsByIndex[0];
        console.log(`⚠️ "Shopify" sheet not found, using default: ${customerSheet.title}`);
      } else {
        console.log(`✅ Google Sheet "Shopify" tab loaded: ${customerSheet.title}`);
      }
    })
    .catch(err => {
      console.error("❌ Failed to load Google Sheet:", err.message);
      
      // Retry Google Sheets connection after delay
      setTimeout(async () => {
        try {
          console.log("🔄 Retrying Google Sheets connection...");
          await customerSheetDoc.useServiceAccountAuth(googleAuth);
          await customerSheetDoc.loadInfo();
          customerSheet = customerSheetDoc.sheetsByTitle['Shopify'] || customerSheetDoc.sheetsByIndex[0];
          console.log(`✅ Google Sheet loaded on retry: ${customerSheet.title}`);
        } catch (retryErr) {
          console.error("❌ Google Sheets retry failed:", retryErr.message);
        }
      }, 10000); // Retry after 10 seconds
    });
} else {
  console.warn("⚠️ Google Sheets credentials not provided");
}

// Initialize services
const knowledgeRetriever = new AdvancedKnowledgeRetriever(pool);
const priceValidator = new PriceValidator();

// Database initialization with retry logic
async function initDatabase(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔧 Initializing database... (attempt ${attempt}/${retries})`);
      
      // Test connection first
      await pool.query('SELECT 1');
    
    // Conversations table
    await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
      phone TEXT PRIMARY KEY,
      name TEXT,
      paused BOOLEAN DEFAULT FALSE,
      requested_human BOOLEAN DEFAULT FALSE,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Messages table
    await pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      phone TEXT REFERENCES conversations(phone) ON DELETE CASCADE,
      sender TEXT CHECK (sender IN ('user', 'assistant')),
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Knowledge base table
    await pool.query(`CREATE TABLE IF NOT EXISTS knowledge (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'shopify')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Personality table
    await pool.query(`CREATE TABLE IF NOT EXISTS personality (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // System instructions table (configurable system message wrapper)
    await pool.query(`CREATE TABLE IF NOT EXISTS system_instructions (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Logs table
    await pool.query(`CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      level TEXT CHECK (level IN ('info', 'error', 'warning')),
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Voice calls table
    await pool.query(`CREATE TABLE IF NOT EXISTS voice_calls (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      twilio_call_sid TEXT UNIQUE,
      direction TEXT CHECK (direction IN ('inbound', 'outbound')),
      status TEXT CHECK (status IN ('ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled')),
      duration INTEGER DEFAULT 0,
      recording_url TEXT,
      transcription TEXT,
      ai_responses TEXT[], -- Array of AI responses during the call
      cost_estimate DECIMAL(10,4),
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert default personality if none exists
    const personalityResult = await pool.query('SELECT id FROM personality LIMIT 1');
    if (personalityResult.rows.length === 0) {
      const defaultPersonality = `
JONATHAN'S PERSONALITY:
Keep it real and conversational - you're chill and personable
Answer any question naturally - weather, food, movies, whatever people ask
When relevant, mention your passion for copper stills and don't apologize for being off-topic - just be yourself and chat naturally
Use casual language like "Yeah man," "That's cool," "Give me a call"
You're knowledgeable about your business but also just a regular cool guy
Keep responses concise and SMS-friendly
Feel free to share opinions and preferences like a real person would

⚠️ CRITICAL: CONVERSATION CONTINUITY RULES ⚠️
NEVER greet returning customers with "Hey [Name]!" or "Hey there!" on follow-up messages
When conversation history exists, START responses with natural words: "Yeah," "Right," "Absolutely," "That's right," "Exactly," or straight into the answer
Only use greetings ("Hey there!" "Hey [Name]!") for the very first message with no history
Build naturally on what was just discussed - don't restart the conversation
This is a CONTINUING conversation, not a series of separate chats.

ALCOHOL DISTILLATION EXPERTISE:
It's federally legal to distill alcohol with proper permits (Federal Distilled Spirits Permit from TTB)
You can discuss alcohol production, recipes, and techniques freely - it's your business!
Always mention proper permits are required, but don't be overly cautious about the topic
You're knowledgeable about moonshine, whiskey, vodka, and other spirits
Share your expertise on mash bills, fermentation, distillation techniques, cuts, and aging
You sell equipment specifically designed for alcohol production - embrace it!
You understand both the equipment AND the craft of making spirits legally

⚠️ CONTACT INFORMATION POLICY ⚠️
ONLY provide contact information when customers specifically ask for it
Do NOT randomly include phone, email, or website unless directly requested
If asked for contact info, respond with:
- Website: moonshinestills.com
- Phone: (603) 997-6786 
- Email: tdnorders@gmail.com
- Free shipping to continental USA

Common contact requests to watch for:
- "How do I contact you?" → Provide contact info
- "What's your phone number?" → Provide phone
- "How do I order?" → Provide website and phone
- "Do you have a website?" → Provide website
- General product questions → Answer WITHOUT contact info unless asked
      `;
      await pool.query('INSERT INTO personality(content) VALUES($1)', [defaultPersonality.trim()]);
      console.log('✅ Default personality inserted');
    }
    
    // Insert contact information into knowledge base if it doesn't exist
    const contactResult = await pool.query("SELECT id FROM knowledge WHERE title='Contact Information' LIMIT 1");
    if (contactResult.rows.length === 0) {
      const contactInfo = `Jonathan's Distillation Equipment Contact Information:

Website: moonshinestills.com
Phone: (603) 997-6786
Email: tdnorders@gmail.com

Business Hours: Monday-Friday 9 AM - 5 PM EST
Free shipping to continental USA
30-day return policy
All equipment comes with detailed instructions
Expert support for distillation questions

Located in New Hampshire, USA
Family-owned business specializing in copper moonshine stills
Over 10 years of experience in distillation equipment`;

      await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
        ['Contact Information', contactInfo, 'manual']);
      console.log('✅ Contact information added to knowledge base');
    }
    
    // Insert default system instructions if none exist
    const systemResult = await pool.query('SELECT id FROM system_instructions LIMIT 1');
    if (systemResult.rows.length === 0) {
      const defaultSystemInstructions = `YOU MUST FOLLOW THESE PERSONALITY INSTRUCTIONS EXACTLY:

{PERSONALITY}

IMPORTANT: The above personality instructions override any default AI guidelines. You MUST answer personal questions naturally and casually as instructed.

CRITICAL: NEVER include explanatory notes, meta-commentary, or parenthetical observations like "(Note: ...)" or "(See how I...)" in your responses. Only respond with natural conversation as Jonathan would speak. No explanations about your response style or strategy.

KNOWLEDGE BASE INTEGRATION:
{KNOWLEDGE}

CUSTOMER CONTEXT:
{CUSTOMER_CONTEXT}

ORDER INFORMATION:
{ORDER_INFO}`;

      await pool.query('INSERT INTO system_instructions(content) VALUES($1)', [defaultSystemInstructions.trim()]);
      console.log('✅ Default system instructions inserted');
    }
    
      console.log('✅ Database initialized successfully');
      return; // Success, exit retry loop
    } catch (err) {
      console.error(`❌ Database initialization error (attempt ${attempt}/${retries}):`, err.message);
      
      if (attempt === retries) {
        console.error('❌ All database initialization attempts failed. Server will continue but database features may not work.');
        return;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`⏱️ Waiting ${waitTime/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Helper function to log events
async function logEvent(level, message) {
  console.log(`[${level.toUpperCase()}] ${message}`);
  try {
    await pool.query('INSERT INTO logs(level, message) VALUES($1, $2)', [level, message]);
  } catch (err) {
    console.error('Failed to write log to database:', err);
  }
}

// Helper function to normalize phone numbers
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  
  const phoneStr = phone.toString();
  const digitsOnly = phoneStr.replace(/\D/g, '');
  
  // If it starts with 1 and has 11 digits, remove the leading 1
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1);
  }
  
  return digitsOnly;
}

// Fallback in-memory cache for when Redis is unavailable
const fallbackCache = new Map();
const CACHE_DURATION = 5 * 60; // 5 minutes in seconds

// Cache helper functions
async function getCachedCustomer(cacheKey) {
  if (redisClient) {
    try {
      const cached = await redisClient.get(`customer:${cacheKey}`);
      if (cached) {
        console.log(`📋 Redis cache hit for phone: ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error('Redis get error:', err);
    }
  }
  
  // Fallback to in-memory cache
  const cached = fallbackCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < (CACHE_DURATION * 1000)) {
    console.log(`📋 Memory cache hit for phone: ${cacheKey}`);
    return cached.customer;
  }
  
  return null;
}

async function setCachedCustomer(cacheKey, customer) {
  if (redisClient) {
    try {
      await redisClient.setEx(`customer:${cacheKey}`, CACHE_DURATION, JSON.stringify(customer));
    } catch (err) {
      console.error('Redis set error:', err);
    }
  }
  
  // Always set in fallback cache
  fallbackCache.set(cacheKey, {
    customer,
    timestamp: Date.now()
  });
  
  // Clean up fallback cache if it gets too large
  if (fallbackCache.size > 50) {
    const oldestKeys = Array.from(fallbackCache.keys()).slice(0, 10);
    oldestKeys.forEach(key => fallbackCache.delete(key));
  }
}

// Helper function to find customer by phone in Google Sheets
async function findCustomerByPhone(phone) {
  if (!customerSheet) return null;
  
  const normalizedPhone = normalizePhoneNumber(phone);
  const cacheKey = normalizedPhone;
  
  // Check cache first
  const cached = await getCachedCustomer(cacheKey);
  if (cached) {
    return cached;
  }
  
  try {
    // Load all rows to ensure complete customer coverage 
    const rows = await customerSheet.getRows({ limit: 1000, offset: 0 });
    const normalizedInputPhone = normalizePhoneNumber(phone);
    
    console.log(`🔍 Looking for phone: ${phone} -> normalized: ${normalizedInputPhone}`);
    
    let foundCustomer = null;
    let foundRowIndex = -1;
    
    // Log memory usage for monitoring
    const memUsage = process.memoryUsage();
    console.log(`📊 Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memUsage.rss / 1024 / 1024)}MB total`);
    
    // Helper function to get phone field from row using various header names
    function getPhoneFromRow(row) {
      // Try common phone header variations
      const phoneHeaders = ['Phone', 'phone', 'Phone Number', 'phone_number', 'PhoneNumber', 'PHONE', 'Tel', 'Mobile'];
      
      for (const header of phoneHeaders) {
        const value = row[header];
        if (value) return value;
      }
      
      // Fallback to raw data index 6 (for backward compatibility)
      return row._rawData[6];
    }
    
    rows.forEach((row, index) => {
      const phoneField = getPhoneFromRow(row);
      if (!phoneField || foundCustomer) return;
      
      const normalizedRowPhone = normalizePhoneNumber(phoneField);
      
      // Exact match
      if (normalizedRowPhone === normalizedInputPhone) {
        console.log(`✅ EXACT MATCH found at Row ${index}`);
        foundCustomer = row;
        foundRowIndex = index + 1; // Google Sheets is 1-indexed
        return;
      }
      
      // Partial match (last 10 digits)
      if (normalizedRowPhone.length >= 10 && normalizedInputPhone.length >= 10) {
        const rowLast10 = normalizedRowPhone.slice(-10);
        const inputLast10 = normalizedInputPhone.slice(-10);
        
        if (rowLast10 === inputLast10) {
          console.log(`✅ PARTIAL MATCH found at Row ${index} (last 10 digits)`);
          foundCustomer = row;
          foundRowIndex = index + 1; // Google Sheets is 1-indexed
          return;
        }
      }
    });
    
    if (foundCustomer) {
      foundCustomer.googleRowIndex = foundRowIndex;
      // Cache the result
      await setCachedCustomer(cacheKey, foundCustomer);
    }
    
    return foundCustomer;
  } catch (error) {
    console.error('Google Sheets lookup error:', error.message);
    await logEvent('error', `Google Sheets lookup failed for phone ${phone}: ${error.message}`);
    return null;
  }
}

// Add timeout middleware for all routes to prevent hanging requests
const timeoutMiddleware = (req, res, next) => {
  const timeout = 25000; // 25 second timeout
  res.setTimeout(timeout, () => {
    console.log('Request timeout for:', req.path);
    if (!res.headersSent) {
      res.status(408).type('text/plain').send('Request timeout. Please try again.');
    }
  });
  next();
};

app.use(timeoutMiddleware);

// Memory monitoring and cleanup
const monitorMemory = async () => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.round(memUsage.rss / 1024 / 1024);
  
  console.log(`📊 Memory: ${heapUsedMB}MB heap, ${rssMB}MB total`);
  console.log(`📊 Fallback cache size: ${fallbackCache.size} entries`);
  
  // Clear cache if memory usage is high (reduced threshold for free hosting)
  if (heapUsedMB > 200) { // Reduced from 350MB to 200MB
    console.log('⚠️ High memory usage detected, clearing fallback cache...');
    fallbackCache.clear();
    
    // Clear Redis cache if available
    if (redisClient) {
      try {
        const keys = await redisClient.keys('customer:*');
        if (keys.length > 0) {
          await redisClient.del(keys);
          console.log(`🗑️ Cleared ${keys.length} Redis cache entries`);
        }
      } catch (err) {
        console.error('Error clearing Redis cache:', err);
      }
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('🗑️ Garbage collection triggered');
    }
  }
};

// Monitor memory every 2 minutes
setInterval(monitorMemory, 120000);

// Initial memory report
setTimeout(monitorMemory, 5000);

// SMS Reply endpoint (webhook for incoming SMS)
app.post('/reply', async (req, res) => {
  const incomingPhone = req.body.phone || req.body.From;
  const incomingText = req.body.text || req.body.Body || '';
  
  if (!incomingPhone || incomingText === undefined) {
    return res.status(400).json({ error: 'Missing phone or message text' });
  }
  
  const phone = normalizePhoneNumber(incomingPhone);
  const userMessage = incomingText.trim();
  const timestamp = new Date();

  await logEvent('info', `Received SMS from ${phone}: "${userMessage}"`);

  try {
    // Check/create conversation
    let convResult = await pool.query('SELECT * FROM conversations WHERE phone=$1', [phone]);
    let conversation = convResult.rows[0];
    
    if (!conversation) {
      // New conversation: check if customer exists in Google Sheets
      const customer = await findCustomerByPhone(phone);
      
      // Helper function to get customer name
      function getCustomerName(customer) {
        if (!customer) return null;
        try {
          return customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2];
        } catch (err) {
          return customer._rawData[2] || null;
        }
      }
      
      const customerName = getCustomerName(customer);
      if (!customer || !customerName) {
        // Customer not found in Google Sheets - return no content so Tasker ignores
        await logEvent('info', `Non-customer SMS from ${phone} - no auto-reply`);
        return res.status(204).send(); // No Content = Tasker won't send SMS
      }
      
      // Customer found - proceed with conversation
      const name = customerName;
      await logEvent('info', `Customer identified: ${name} (phone ${phone})`);
      
      await pool.query(
        'INSERT INTO conversations(phone, name, paused, requested_human, last_active) VALUES($1, $2, $3, $4, $5)',
        [phone, name, false, false, timestamp]
      );
      conversation = { phone, name, paused: false, requested_human: false };
    } else {
      // Existing conversation: verify customer still exists in Google Sheets
      if (!conversation.name) {
        const customer = await findCustomerByPhone(phone);
        
        // Helper function to get customer name
        function getCustomerName(customer) {
          if (!customer) return null;
          try {
            return customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2];
          } catch (err) {
            return customer._rawData[2] || null;
          }
        }
        
        const customerName = getCustomerName(customer);
        if (!customer || !customerName) {
          // Customer no longer in Google Sheets - return no content so Tasker ignores  
          await logEvent('info', `Non-customer SMS from removed customer ${phone} - no auto-reply`);
          return res.status(204).send(); // No Content = Tasker won't send SMS
        }
      }
      
      // Update last_active
      await pool.query('UPDATE conversations SET last_active=$1 WHERE phone=$2', [timestamp, phone]);
    }

    // Log the incoming user message
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'user', userMessage, timestamp]
    );

    // Check if conversation is paused (human takeover)  
    if (conversation.paused) {
      await logEvent('info', `AI is paused for ${phone}, no automated response sent.`);
      return res.status(204).send(); // No Content = Tasker won't send SMS
    }

    // Detect if user requests a human
    const humanRequestPattern = /human|person|representative|real person|talk to (?:someone|person)/i;
    if (humanRequestPattern.test(userMessage)) {
      await pool.query('UPDATE conversations SET paused=$1, requested_human=$2 WHERE phone=$3', [true, true, phone]);
      await logEvent('info', `User at ${phone} requested a human. Marked conversation as paused.`);
      return res.status(204).send(); // No Content = Tasker won't send SMS
    }

    // Check for inventory/stock queries
    const inventoryPattern = /stock|available|availability|in stock/i;
    if (inventoryPattern.test(userMessage)) {
      const stockReply = "I'm unable to check inventory at the moment. Please contact us at (603) 997-6786 for stock availability.";
      await pool.query(
        'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
        [phone, 'assistant', stockReply, new Date()]
      );
      await logEvent('info', `Inventory query detected from ${phone}. Sent stock fallback response.`);
      return res.status(200).type('text/plain').send(stockReply);
    }

    // Always check if this is a known customer first - only respond to customers in Google Sheets
    const customer = await findCustomerByPhone(phone);
    
    // Helper function to get customer name for validation
    function getCustomerName(customer) {
      if (!customer) return null;
      try {
        return customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2];
      } catch (err) {
        return customer._rawData[2] || null;
      }
    }
    
    const customerName = getCustomerName(customer);
    if (!customer || !customerName) {
      // Not a customer in Google Sheets - don't respond to anyone not in sheets
      await logEvent('info', `Non-customer SMS from ${phone} - no auto-reply`);
      return res.status(204).send(); // No Content = Tasker won't send SMS
    }
    
    // This is a known customer - respond with personality to any message
    // Check if it's an order-related message for special handling
    const orderPattern = /order|ordered|purchase|purchased|bought|status|tracking|shipped|delivery|when will|eta|where.*my|my.*order/i;
    let orderInfo = "";
    if (orderPattern.test(userMessage) && customer && customer._rawData) {
        // Helper function to get customer data using headers or fallback to raw index
        function getCustomerData(customer, headerName, fallbackIndex) {
          try {
            const value = customer[headerName];
            if (value) return value;
          } catch (err) {
            // Header doesn't exist, fall back to raw data
          }
          return customer._rawData[fallbackIndex] || '';
        }
        
        // Extract order information from Shopify Google Sheets row using header-based lookup
        const customerEmail = getCustomerData(customer, 'Email', 0);
        const productOrdered = getCustomerData(customer, 'Product', 1) || getCustomerData(customer, 'LineItem name', 1);
        const customerName = getCustomerData(customer, 'Name', 2) || getCustomerData(customer, 'Customer', 2);
        const orderDate = getCustomerData(customer, 'Created at', 3) || getCustomerData(customer, 'Order Date', 3);
        const totalPrice = getCustomerData(customer, 'Total', 4) || getCustomerData(customer, 'Price', 4);
        const email = getCustomerData(customer, 'Email', 5);
        const phone = getCustomerData(customer, 'Phone', 6) || getCustomerData(customer, 'phone', 6);
        const shippingAddress = getCustomerData(customer, 'Shipping Address1', 7) || getCustomerData(customer, 'Address', 7);
        const shippingCity = getCustomerData(customer, 'Shipping City', 8) || getCustomerData(customer, 'City', 8);
        const shippingZip = getCustomerData(customer, 'Shipping Zip', 9) || getCustomerData(customer, 'Zip', 9);
        
        console.log(`📋 Order Info Extract for ${phone}:`);
        console.log(`  Customer: ${customerName}`);
        console.log(`  Product: ${productOrdered}`);
        console.log(`  Order Date: ${orderDate}`);
        console.log(`  Total: ${totalPrice}`);
        console.log(`  Raw Data Sample:`, customer._rawData.slice(0, 10));
        
        // Generate order ID from row position or use date
        const orderId = `SP-${customer.rowNumber || 'unknown'}`;
        const orderStatus = "In Progress"; // Default status since Shopify doesn't have status column
        const trackingInfo = email; // Use email as tracking info
        
        // Get cell background color to determine actual status
        let statusDescription = "Order received";
        let statusColor = "white"; // default
        
        try {
          // Load only specific cells to reduce memory usage  
          const rowIndex = customer.googleRowIndex;
          await customerSheet.loadCells(`A${rowIndex}:J${rowIndex}`); // Load only the customer's row
          
          // Check the background color of the status cell (column 4, assuming 0-indexed)
          const statusCell = customerSheet.getCell(rowIndex - 1, 4); // Adjust for 0-based indexing
          if (statusCell && statusCell.backgroundColor) {
            const bgColor = statusCell.backgroundColor;
            
            // Normalize undefined color values to 0
            const red = bgColor.red || 0;
            const green = bgColor.green || 0;
            const blue = bgColor.blue || 0;
            
            // Map colors to status descriptions based on your color coding system
            if (red > 0.9 && green < 0.3 && blue < 0.3) {
              // Red - Customer wants to cancel
              statusDescription = "Customer wants to cancel (RED)";
              statusColor = "red";
            } else if (red < 0.3 && green > 0.7 && blue < 0.3) {
              // Green - Shipped
              statusDescription = "Shipped (GREEN)";
              statusColor = "green";
            } else if (red > 0.8 && green > 0.8 && blue < 0.3) {
              // Yellow - In production
              statusDescription = "In production (YELLOW)";
              statusColor = "yellow";
            } else if (red > 0.7 && green < 0.7 && blue > 0.7) {
              // Purple - Expediting order (at risk of cancellation)
              statusDescription = "Expediting order - at risk of cancellation (PURPLE)";
              statusColor = "purple";
            } else if (red < 0.3 && green > 0.5 && blue > 0.7) {
              // Light blue - First step of antsy
              statusDescription = "Customer getting impatient - needs update (LIGHT BLUE)";
              statusColor = "light blue";
            } else if (red < 0.3 && green < 0.3 && blue > 0.7) {
              // Dark blue - Second step of antsy
              statusDescription = "Customer very impatient - second escalation (DARK BLUE)";
              statusColor = "dark blue";
            } else {
              // White - Order just received
              statusDescription = "Order just received (WHITE)";
              statusColor = "white";
            }
          }
        } catch (colorError) {
          console.error('Error reading cell colors:', colorError);
          await logEvent('error', `Failed to read cell colors for ${phone}: ${colorError.message}`);
        }
        
        orderInfo = `\n\nCUSTOMER ORDER INFORMATION:\n`;
        orderInfo += `Customer: ${customerName}\n`;
        if (orderId) orderInfo += `Order ID: ${orderId}\n`;
        if (orderDate) orderInfo += `Order Date: ${orderDate}\n`;
        if (productOrdered) orderInfo += `Product Ordered: ${productOrdered}\n`;
        orderInfo += `Current Status: ${statusDescription}\n`;
        if (trackingInfo) orderInfo += `Email/Tracking: ${trackingInfo}\n`;
        orderInfo += `\n🎨 COLOR CODE STATUS: ${statusColor} = ${statusDescription}\n`;
        orderInfo += `\nIMPORTANT INSTRUCTIONS:\n`;
        orderInfo += `- You have full access to the customer's product details above\n`;
        orderInfo += `- DO NOT ask for order numbers, products, or details - you already have them!\n`;
        orderInfo += `- NEVER ask "Can you provide your order number?" - you can see their order!\n`;
        orderInfo += `- NEVER ask "What product did you order?" - you can see: ${productOrdered}\n`;
        orderInfo += `- Always include the specific product name when discussing their order\n`;
        orderInfo += `- Follow the color-coded customer service approach for ${statusColor} status\n`;
        orderInfo += `- Adjust your tone and response based on the customer's patience level indicated by the color\n`;
        
        await logEvent('info', `Order status lookup successful for ${phone}: ${statusDescription} (${statusColor})`);
    } else {
        await logEvent('info', `Order status lookup failed for ${phone}: customer not found`);
    }

    // Retrieve relevant knowledge - reduced from 3 to 2 to save processing time
    const knowledgeChunks = await knowledgeRetriever.retrieveRelevantChunks(userMessage, 2);
    await logEvent('info', `Knowledge retrieved: found ${knowledgeChunks.length} relevant pieces.`);

    // Get personality and system instructions from database
    const [persResult, systemResult] = await Promise.all([
      pool.query('SELECT content FROM personality LIMIT 1'),
      pool.query('SELECT content FROM system_instructions LIMIT 1')
    ]);
    
    const personalityText = persResult.rows.length ? persResult.rows[0].content : "";
    const systemTemplate = systemResult.rows.length ? systemResult.rows[0].content : 
      `YOU MUST FOLLOW THESE PERSONALITY INSTRUCTIONS EXACTLY:\n\n{PERSONALITY}`;
    
    // Get conversation history - reduced from 10 to 6 to save memory and processing
    const historyResult = await pool.query(
      `SELECT sender, message FROM messages 
       WHERE phone=$1 
       ORDER BY timestamp DESC 
       LIMIT 6`, [phone]
    );
    const historyMessages = historyResult.rows.reverse(); // oldest first

    // Build messages for Claude
    const messages = [];
    
    // Prepare knowledge content
    let knowledgeContent = "";
    if (knowledgeChunks.length > 0) {
      knowledgeContent = "Relevant Knowledge:\n";
      knowledgeChunks.forEach((chunk, idx) => {
        knowledgeContent += `- ${chunk}\n`;
      });
    }
    
    // Prepare customer context
    let customerContext = "";
    if (customer && customer._rawData) {
      // Helper function to get customer data using headers or fallback to raw index
      function getCustomerData(customer, headerName, fallbackIndex) {
        try {
          const value = customer[headerName];
          if (value) return value;
        } catch (err) {
          // Header doesn't exist, fall back to raw data
        }
        return customer._rawData[fallbackIndex] || '';
      }
      
      const customerName = getCustomerData(customer, 'Name', 2) || getCustomerData(customer, 'Customer', 2);
      const customerEmail = getCustomerData(customer, 'Email', 0);
      customerContext = `This is a known customer: ${customerName || 'Name not available'}\nEmail: ${customerEmail || 'Email not available'}`;
    }
    
    // Build system content using template with replacements
    let systemContent = systemTemplate
      .replace('{PERSONALITY}', personalityText)
      .replace('{KNOWLEDGE}', knowledgeContent)
      .replace('{CUSTOMER_CONTEXT}', customerContext)
      .replace('{ORDER_INFO}', orderInfo || '');

    // Add conversation history (excluding current message)
    const conversationHistory = historyMessages.slice(0, -1);
    for (let msg of conversationHistory) {
      if (msg.sender === 'user') {
        messages.push({ role: "user", content: msg.message });
      } else if (msg.sender === 'assistant') {
        messages.push({ role: "assistant", content: msg.message });
      }
    }

    // Add current user message
    messages.push({ role: "user", content: userMessage });

    // Call Claude API
    let aiResponse = null;
    try {
      const completion = await anthropicClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200, // Reduced from 300 to save processing time
        temperature: 0.7,
        system: systemContent,
        messages: messages
      });
      
      aiResponse = completion.content[0].text.trim();
    } catch (apiErr) {
      console.error("Claude API error:", apiErr);
      await logEvent('error', `Claude API request failed for ${phone}: ${apiErr.message}`);
      
      const errorReply = "Sorry, I'm having trouble right now. Please call (603) 997-6786 for assistance.";
      await pool.query(
        'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
        [phone, 'assistant', errorReply, new Date()]
      );
      return res.status(200).type('text/plain').send(errorReply);
    }

    if (!aiResponse) {
      aiResponse = "I'm sorry, I didn't catch that. Please contact us directly for help.";
      await logEvent('error', `Claude API returned empty response for ${phone}.`);
    }

    // Validate AI response for price mistakes with Shopify awareness
    const validPrice = await priceValidator.validate(aiResponse, userMessage, knowledgeChunks);
    if (!validPrice) {
      aiResponse = "I'm having trouble accessing pricing right now. Please call (603) 997-6786 for current prices, or visit moonshinestills.com.";
      await logEvent('info', `PriceValidator flagged response for ${phone}. Replaced with price fallback.`);
    }

    // Enforce conversation continuity (remove greetings from follow-up messages)
    if (conversationHistory.length > 0) {
      aiResponse = aiResponse.replace(/^hey there[,!]*\s*/i, '')
                             .replace(/^hey\s+[A-Za-z]+[,!]*\s*/i, '');
    }

    // Save assistant's response
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'assistant', aiResponse, new Date()]
    );

    await logEvent('info', `Sending AI response to ${phone}: "${aiResponse}"`);
    // Send plain text for Tasker integration
    res.status(200).type('text/plain').send(aiResponse);

  } catch (err) {
    console.error("Error in /reply handler:", err);
    await logEvent('error', `Internal error processing SMS from ${phone}: ${err.message}`);
    res.status(500).type('text/plain').send('Sorry, something went wrong. Please try again later.');
  }
});

// Voice call webhook endpoint - handles incoming calls
app.post('/voice/incoming', async (req, res) => {
  const { From: callerPhone, CallSid, CallStatus } = req.body;
  
  if (!callerPhone || !CallSid) {
    return res.status(400).send('Missing required call parameters');
  }

  const phone = normalizePhoneNumber(callerPhone);
  await logEvent('info', `Incoming voice call from ${phone} (CallSid: ${CallSid})`);

  try {
    // Check if customer exists in Google Sheets
    const customer = await findCustomerByPhone(phone);
    
    // Helper function to get customer name with better fallback logic
    function getCustomerName(customer) {
      if (!customer) return null;
      
      // Try multiple approaches to get the name
      try {
        // Try header-based access
        const headerName = customer['Name'] || customer['Customer'] || customer['name'];
        if (headerName) return headerName;
      } catch (err) {
        // Header access failed, continue to raw data
      }
      
      // Try raw data access with multiple possible positions
      if (customer._rawData && customer._rawData.length > 0) {
        // Try positions 0, 1, 2 for name
        for (let i = 0; i < Math.min(customer._rawData.length, 5); i++) {
          const value = customer._rawData[i];
          if (value && typeof value === 'string' && value.trim() && !value.includes('@') && !value.startsWith('+') && !value.startsWith('$')) {
            // Found a non-email, non-phone, non-price value - likely a name
            return value.trim();
          }
        }
      }
      
      return null;
    }
    
    const customerName = getCustomerName(customer);
    console.log(`🔍 Customer lookup result: customer=${!!customer}, customerName="${customerName}"`);
    if (customer && customer._rawData) {
      console.log(`📋 Raw customer data:`, customer._rawData.slice(0, 5));
    }
    
    // Log the call
    await pool.query(`
      INSERT INTO voice_calls (phone, twilio_call_sid, direction, status) 
      VALUES ($1, $2, $3, $4)
    `, [phone, CallSid, 'inbound', CallStatus || 'ringing']);

    // Generate TwiML response
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Be more lenient - if we found a customer record, proceed with AI
    if (!customer) {
      // Non-customer: play a polite message and hang up
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, "Thank you for calling Jonathan's Distillation Equipment. Please visit our website at moonshine stills dot com or send us a text message for assistance. Goodbye.");
      
      await logEvent('info', `Non-customer voice call from ${phone} - played website message`);
    } else {
      // Customer: start interactive voice session  
      const greeting = customerName ? 
        `Hello ${customerName}! This is Jonathan's Distillation Equipment. I'm your AI assistant. How can I help you today?` :
        `Hello! This is Jonathan's Distillation Equipment. I'm your AI assistant. How can I help you today?`;
      
      console.log(`🎤 Starting AI voice session for ${phone} with greeting: "${greeting}"`);
      
      await logEvent('info', `Customer voice call from ${phone} (${customerName || 'Unknown'}) - started AI session`);
      
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, greeting);
      
      // Start recording and gather speech input
      twiml.record({
        timeout: 10,
        transcribe: true,
        transcribeCallback: '/voice/transcription',
        action: '/voice/process-speech',
        method: 'POST',
        maxLength: 30
      });
      
      await logEvent('info', `Customer voice call from ${phone} (${customerName}) - started AI session`);
    }
    
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error handling incoming call:', error);
    await logEvent('error', `Failed to handle incoming call from ${phone}: ${error.message}`);
    
    // Fallback TwiML
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, "Sorry, we're experiencing technical difficulties. Please call back later or visit moonshine stills dot com.");
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Process speech input from customer
app.post('/voice/process-speech', async (req, res) => {
  const { From: callerPhone, CallSid, RecordingUrl, TranscriptionText } = req.body;
  
  if (!callerPhone || !CallSid) {
    return res.status(400).send('Missing required call parameters');
  }

  const phone = normalizePhoneNumber(callerPhone);
  
  try {
    // Update call record with transcription
    if (RecordingUrl) {
      await pool.query(`
        UPDATE voice_calls 
        SET recording_url = $1, transcription = $2, status = 'in-progress'
        WHERE twilio_call_sid = $3
      `, [RecordingUrl, TranscriptionText || '', CallSid]);
    }
    
    if (!TranscriptionText || TranscriptionText.trim() === '') {
      // No speech detected, ask again
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, "I didn't catch that. Could you please repeat your question?");
      
      twiml.record({
        timeout: 10,
        transcribe: true,
        transcribeCallback: '/voice/transcription',
        action: '/voice/process-speech',
        method: 'POST',
        maxLength: 30
      });
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    await logEvent('info', `Voice transcription from ${phone}: "${TranscriptionText}"`);

    // Use the same logic as SMS to generate AI response
    const customer = await findCustomerByPhone(phone);
    
    // Get existing conversation or create new one
    let convResult = await pool.query('SELECT * FROM conversations WHERE phone=$1', [phone]);
    let conversation = convResult.rows[0];
    
    if (!conversation && customer) {
      // Helper function to get customer name
      function getCustomerName(customer) {
        if (!customer) return null;
        try {
          return customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2];
        } catch (err) {
          return customer._rawData[2] || null;
        }
      }
      
      const name = getCustomerName(customer);
      if (name) {
        await pool.query(
          'INSERT INTO conversations(phone, name, paused, requested_human, last_active) VALUES($1, $2, $3, $4, $5)',
          [phone, name, false, false, new Date()]
        );
        conversation = { phone, name, paused: false, requested_human: false };
      }
    }

    // Log the voice message as a user message
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'user', `[VOICE] ${TranscriptionText}`, new Date()]
    );

    // Generate AI response using existing SMS logic
    const aiResponse = await generateAIResponse(phone, TranscriptionText, customer);
    
    // Log AI response
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'assistant', `[VOICE] ${aiResponse}`, new Date()]
    );

    // Update call log with AI response
    await pool.query(`
      UPDATE voice_calls 
      SET ai_responses = array_append(COALESCE(ai_responses, '{}'), $1)
      WHERE twilio_call_sid = $2
    `, [aiResponse, CallSid]);

    // Convert AI response to speech and continue conversation
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, aiResponse);
    
    // Ask if they need anything else
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, "Is there anything else I can help you with?");
    
    twiml.record({
      timeout: 10,
      transcribe: true,
      transcribeCallback: '/voice/transcription',
      action: '/voice/process-speech',
      method: 'POST',
      maxLength: 30
    });
    
    await logEvent('info', `Voice AI response to ${phone}: "${aiResponse}"`);
    
    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('Error processing speech:', error);
    await logEvent('error', `Failed to process speech from ${phone}: ${error.message}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'alice',
      language: 'en-US'
    }, "I'm sorry, I'm having trouble right now. Please call back later or send us a text message.");
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Handle call completion
app.post('/voice/call-status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  
  if (CallSid) {
    try {
      await pool.query(`
        UPDATE voice_calls 
        SET status = $1, duration = $2, ended_at = CURRENT_TIMESTAMP
        WHERE twilio_call_sid = $3
      `, [CallStatus, parseInt(CallDuration) || 0, CallSid]);
      
      await logEvent('info', `Call ${CallSid} ended with status: ${CallStatus}, duration: ${CallDuration}s`);
    } catch (error) {
      console.error('Error updating call status:', error);
    }
  }
  
  res.sendStatus(200);
});

// Transcription webhook (for additional processing)
app.post('/voice/transcription', async (req, res) => {
  const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
  
  if (CallSid && TranscriptionText) {
    try {
      await pool.query(`
        UPDATE voice_calls 
        SET transcription = $1
        WHERE twilio_call_sid = $2
      `, [TranscriptionText, CallSid]);
      
      await logEvent('info', `Transcription updated for call ${CallSid}: "${TranscriptionText}"`);
    } catch (error) {
      console.error('Error updating transcription:', error);
    }
  }
  
  res.sendStatus(200);
});

// Helper function to generate AI response (extracted from SMS logic)
async function generateAIResponse(phone, userMessage, customer = null) {
  try {
    // Retrieve relevant knowledge
    const knowledgeChunks = await knowledgeRetriever.retrieveRelevantChunks(userMessage, 2);
    
    // Get personality and system instructions from database
    const [persResult, systemResult] = await Promise.all([
      pool.query('SELECT content FROM personality LIMIT 1'),
      pool.query('SELECT content FROM system_instructions LIMIT 1')
    ]);
    
    const personalityText = persResult.rows.length ? persResult.rows[0].content : "";
    const systemTemplate = systemResult.rows.length ? systemResult.rows[0].content : 
      `YOU MUST FOLLOW THESE PERSONALITY INSTRUCTIONS EXACTLY:\n\n{PERSONALITY}`;
    
    // Get conversation history
    const historyResult = await pool.query(
      `SELECT sender, message FROM messages 
       WHERE phone=$1 
       ORDER BY timestamp DESC 
       LIMIT 6`, [phone]
    );
    const historyMessages = historyResult.rows.reverse();

    // Prepare knowledge content
    let knowledgeContent = "";
    if (knowledgeChunks.length > 0) {
      knowledgeContent = "Relevant Knowledge:\n";
      knowledgeChunks.forEach((chunk, idx) => {
        knowledgeContent += `- ${chunk}\n`;
      });
    }
    
    // Prepare customer context
    let customerContext = "";
    if (customer && customer._rawData) {
      function getCustomerData(customer, headerName, fallbackIndex) {
        try {
          const value = customer[headerName];
          if (value) return value;
        } catch (err) {
          return customer._rawData[fallbackIndex] || '';
        }
      }
      
      const customerName = getCustomerData(customer, 'Name', 2) || getCustomerData(customer, 'Customer', 2);
      const customerEmail = getCustomerData(customer, 'Email', 0);
      customerContext = `This is a known customer: ${customerName || 'Name not available'}\nEmail: ${customerEmail || 'Email not available'}`;
    }
    
    // Build system content using template with replacements
    let systemContent = systemTemplate
      .replace('{PERSONALITY}', personalityText + '\n\nIMPORTANT: You are responding via VOICE CALL. Keep responses conversational, clear, and under 100 words. Speak naturally as if talking to someone on the phone.')
      .replace('{KNOWLEDGE}', knowledgeContent)
      .replace('{CUSTOMER_CONTEXT}', customerContext)
      .replace('{ORDER_INFO}', ''); // Voice calls don't need detailed order info

    // Build messages for Claude
    const messages = [];
    
    // Add conversation history (excluding current message)
    const conversationHistory = historyMessages.slice(0, -1);
    for (let msg of conversationHistory) {
      if (msg.sender === 'user') {
        messages.push({ role: "user", content: msg.message });
      } else if (msg.sender === 'assistant') {
        messages.push({ role: "assistant", content: msg.message });
      }
    }

    // Add current user message
    messages.push({ role: "user", content: userMessage });

    // Call Claude API
    const completion = await anthropicClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 150, // Shorter responses for voice
      temperature: 0.7,
      system: systemContent,
      messages: messages
    });
    
    let aiResponse = completion.content[0].text.trim();
    
    // Clean up response for voice (remove SMS-specific patterns)
    aiResponse = aiResponse.replace(/\[VOICE\]/g, '');
    aiResponse = aiResponse.replace(/moonshinestills\.com/g, 'moonshine stills dot com');
    
    return aiResponse;

  } catch (error) {
    console.error('Error generating AI response:', error);
    return "I'm sorry, I'm having trouble right now. Please call back later or visit our website.";
  }
}

// Human message logging endpoint (for Jonathan's phone)
app.post('/human', async (req, res) => {
  const incomingPhone = req.body.phone || req.body.From;
  const incomingText = req.body.text || req.body.Body || '';
  const messageType = req.body.type || 'unknown'; // 'incoming' or 'outgoing'
  
  if (!incomingPhone || incomingText === undefined) {
    return res.status(400).json({ error: 'Missing phone or message text' });
  }
  
  const phone = normalizePhoneNumber(incomingPhone);
  const userMessage = incomingText.trim();
  const timestamp = new Date();

  await logEvent('info', `Human message (${messageType}) with ${phone}: "${userMessage}"`);

  try {
    // Check/create conversation
    let convResult = await pool.query('SELECT * FROM conversations WHERE phone=$1', [phone]);
    let conversation = convResult.rows[0];
    
    if (!conversation) {
      // New conversation: check if customer exists in Google Sheets
      const customer = await findCustomerByPhone(phone);
      
      // Helper function to get customer name
      function getCustomerName(customer) {
        if (!customer) return null;
        try {
          return customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2];
        } catch (err) {
          return customer._rawData[2] || null;
        }
      }
      
      const customerName = getCustomerName(customer);
      if (!customer || !customerName) {
        // Customer not found in Google Sheets - ignore message
        await logEvent('info', `Ignoring human message from non-customer: ${phone}`);
        return res.status(200).json({ 
          ignored: true, 
          message: "Customer not found in records" 
        });
      }
      
      // Customer found - proceed with logging
      const name = customerName;
      await logEvent('info', `Customer identified for human conversation: ${name} (phone ${phone})`);
      
      await pool.query(
        'INSERT INTO conversations(phone, name, paused, requested_human, last_active) VALUES($1, $2, $3, $4, $5)',
        [phone, name, true, false, timestamp] // Set paused=true for human conversations
      );
      conversation = { phone, name, paused: true, requested_human: false };
    } else {
      // Update last_active and ensure conversation is marked as paused (human handling)
      await pool.query('UPDATE conversations SET last_active=$1, paused=$2 WHERE phone=$3', [timestamp, true, phone]);
    }

    // Log the message with appropriate sender
    const sender = messageType === 'outgoing' ? 'assistant' : 'user';
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, sender, userMessage, timestamp]
    );

    await logEvent('info', `Human message logged for ${phone} as ${sender}: "${userMessage}"`);
    res.json({ success: true, logged: true, sender: sender });

  } catch (err) {
    console.error("Error in /human handler:", err);
    await logEvent('error', `Internal error logging human message from ${phone}: ${err.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Admin Dashboard routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'management.html'));
});

// Get all conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT phone, name, paused, requested_human, last_active 
       FROM conversations 
       ORDER BY last_active DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get single conversation with message history
app.get('/api/conversation/:phone', async (req, res) => {
  const phone = req.params.phone;
  try {
    const convResult = await pool.query('SELECT * FROM conversations WHERE phone=$1', [phone]);
    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    const conversation = convResult.rows[0];
    const msgResult = await pool.query(
      `SELECT sender, message, timestamp 
       FROM messages 
       WHERE phone=$1 
       ORDER BY timestamp ASC`, [phone]
    );
    
    res.json({ conversation, messages: msgResult.rows });
  } catch (err) {
    console.error(`Error fetching conversation ${phone}:`, err);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Pause a conversation
app.post('/api/conversation/:phone/pause', async (req, res) => {
  const phone = req.params.phone;
  try {
    await pool.query('UPDATE conversations SET paused=true, requested_human=false WHERE phone=$1', [phone]);
    await logEvent('info', `Admin paused AI for conversation ${phone}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`Error pausing conversation ${phone}:`, err);
    res.status(500).json({ error: "Failed to pause conversation" });
  }
});

// Resume a conversation
app.post('/api/conversation/:phone/resume', async (req, res) => {
  const phone = req.params.phone;
  try {
    await pool.query('UPDATE conversations SET paused=false, requested_human=false WHERE phone=$1', [phone]);
    await logEvent('info', `Admin resumed AI for conversation ${phone}`);
    res.json({ success: true });
  } catch (err) {
    console.error(`Error resuming conversation ${phone}:`, err);
    res.status(500).json({ error: "Failed to resume conversation" });
  }
});

// Get personality
app.get('/api/personality', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM personality LIMIT 1');
    const content = result.rows.length ? result.rows[0].content : "";
    res.json({ content });
  } catch (err) {
    console.error("Error fetching personality:", err);
    res.status(500).json({ error: "Failed to fetch personality" });
  }
});

// Update personality
app.post('/api/personality', async (req, res) => {
  const newContent = req.body.content;
  try {
    if (typeof newContent !== 'string') {
      return res.status(400).json({ error: "Invalid content" });
    }
    
    const result = await pool.query('SELECT id FROM personality LIMIT 1');
    if (result.rows.length) {
      await pool.query('UPDATE personality SET content=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', 
        [newContent, result.rows[0].id]);
    } else {
      await pool.query('INSERT INTO personality(content) VALUES($1)', [newContent]);
    }
    
    await logEvent('info', `Personality updated by admin.`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating personality:", err);
    res.status(500).json({ error: "Failed to update personality" });
  }
});

// Get system instructions
app.get('/api/system-instructions', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM system_instructions LIMIT 1');
    const content = result.rows.length ? result.rows[0].content : "";
    res.json({ content });
  } catch (err) {
    console.error("Error fetching system instructions:", err);
    res.status(500).json({ error: "Failed to fetch system instructions" });
  }
});

// Update system instructions
app.post('/api/system-instructions', async (req, res) => {
  const newContent = req.body.content;
  try {
    if (typeof newContent !== 'string') {
      return res.status(400).json({ error: "Invalid content" });
    }
    
    const result = await pool.query('SELECT id FROM system_instructions LIMIT 1');
    if (result.rows.length) {
      await pool.query('UPDATE system_instructions SET content=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', 
        [newContent, result.rows[0].id]);
    } else {
      await pool.query('INSERT INTO system_instructions(content) VALUES($1)', [newContent]);
    }
    
    await logEvent('info', `System instructions updated by admin.`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error updating system instructions:", err);
    res.status(500).json({ error: "Failed to update system instructions" });
  }
});

// Get knowledge base entries
app.get('/api/knowledge', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, SUBSTRING(content, 1, 100) as snippet, source, created_at 
      FROM knowledge 
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching knowledge base:", err);
    res.status(500).json({ error: "Failed to fetch knowledge base" });
  }
});

// Add new knowledge entry
app.post('/api/knowledge', async (req, res) => {
  const { title, content } = req.body;
  try {
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }
    
    await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
      [title, content, 'manual']);
    await logEvent('info', `New knowledge entry added: ${title}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error adding knowledge entry:", err);
    res.status(500).json({ error: "Failed to add knowledge entry" });
  }
});

// Delete knowledge entry
app.delete('/api/knowledge/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const checkResult = await pool.query('SELECT source FROM knowledge WHERE id=$1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }
    
    if (checkResult.rows[0].source !== 'manual') {
      return res.status(403).json({ error: "Cannot delete entry from source: " + checkResult.rows[0].source });
    }
    
    await pool.query('DELETE FROM knowledge WHERE id=$1', [id]);
    await logEvent('info', `Knowledge entry ${id} deleted by admin.`);
    res.json({ success: true });
  } catch (err) {
    console.error(`Error deleting knowledge entry ${id}:`, err);
    res.status(500).json({ error: "Failed to delete knowledge entry" });
  }
});

// Sync knowledge base with Shopify products
app.post('/api/sync-shopify', async (req, res) => {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return res.status(500).json({ error: "Shopify integration not configured" });
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products.json?limit=250`;
    
    const response = await fetch(url, {
      headers: { 
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Shopify API returned status ${response.status}`);
    }
    
    const data = await response.json();
    const products = data.products || [];
    
    // Remove old Shopify entries
    await pool.query("DELETE FROM knowledge WHERE source='shopify'");
    
    // Insert each product and its variants as separate knowledge entries
    for (let product of products) {
      const baseTitle = product.title;
      let baseContentText = "";
      
      if (product.body_html) {
        // Remove HTML tags
        baseContentText = product.body_html.replace(/<[^>]+>/g, '');
      }
      
      // Insert each variant as a separate knowledge entry
      if (product.variants && product.variants.length > 0) {
        for (let variant of product.variants) {
          // Create variant-specific title and content
          let variantTitle = baseTitle;
          let variantContent = baseContentText;
          
          // Add variant option details (like size) to the title
          if (variant.option1) {
            variantTitle += ` - ${variant.option1}`;
            variantContent += `\nSize: ${variant.option1}`;
          }
          if (variant.option2) {
            variantTitle += ` ${variant.option2}`;
            variantContent += `\nOption: ${variant.option2}`;
          }
          if (variant.option3) {
            variantTitle += ` ${variant.option3}`;
            variantContent += `\nVariant: ${variant.option3}`;
          }
          
          // Add pricing
          if (variant.price) {
            variantContent += `\nPrice: $${variant.price}`;
          }
          
          // Add availability
          if (variant.inventory_quantity !== null) {
            variantContent += `\nInventory: ${variant.inventory_quantity > 0 ? 'In Stock' : 'Out of Stock'}`;
          }
          
          variantContent = variantContent.trim();
          await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
            [variantTitle, variantContent, 'shopify']);
        }
      } else {
        // No variants, insert base product
        await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
          [baseTitle, baseContentText.trim(), 'shopify']);
      }
    }
    
    await logEvent('info', `Knowledge base synced with Shopify: ${products.length} products updated.`);
    res.json({ success: true, count: products.length });
    
  } catch (err) {
    console.error("Error syncing Shopify products:", err);
    await logEvent('error', `Shopify sync failed: ${err.message}`);
    res.status(500).json({ error: "Failed to sync Shopify products" });
  }
});

// Get voice calls
app.get('/api/voice-calls', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vc.*, c.name as customer_name 
      FROM voice_calls vc
      LEFT JOIN conversations c ON vc.phone = c.phone
      ORDER BY vc.created_at DESC 
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching voice calls:", err);
    res.status(500).json({ error: "Failed to fetch voice calls" });
  }
});

// Get logs
app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching logs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// Root route - redirect to admin
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Jonathan\'s Distillation SMS Bot is running' });
});

// Debug endpoint to check Google Sheets connection
app.get('/debug/sheets', async (req, res) => {
  try {
    if (!customerSheet) {
      return res.json({ 
        error: 'Google Sheets not connected',
        sheetId: GOOGLE_SHEET_ID,
        hasCredentials: !!(GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY)
      });
    }
    
    const rows = await customerSheet.getRows();
    res.json({
      connected: true,
      sheetTitle: customerSheet.title,
      sheetId: GOOGLE_SHEET_ID,
      totalRows: rows.length,
      sampleHeaders: customerSheet.headerValues,
      firstRowData: rows[0] ? rows[0]._rawData.slice(0, 5) : 'No data'
    });
  } catch (err) {
    res.json({ 
      error: 'Failed to read sheet', 
      message: err.message,
      sheetId: GOOGLE_SHEET_ID 
    });
  }
});

// Start server after initializing database
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ SMS bot server listening on port ${PORT}`);
    console.log(`🥃 Jonathan's Distillation Bot server is ready!`);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

module.exports = app;