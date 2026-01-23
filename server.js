/**
 * SMS Bot Server - Express backend
 * - Integrates with Anthropic Claude API for AI responses
 * - Uses PostgreSQL for data storage (conversations, messages, knowledge, personality, logs)
 * - Integrates with Google Sheets for customer data lookup
 * - Integrates with Shopify for product catalog syncing
 */

const { Blob: NodeBlob } = require('buffer');

// Render/Node 18 environments sometimes lack a global File constructor which undici expects.
if (typeof globalThis.File === 'undefined') {
  const BlobImpl = globalThis.Blob || NodeBlob;
  if (BlobImpl) {
    globalThis.File = class File extends BlobImpl {
      constructor(bits = [], name = '', options = {}) {
        super(bits, options);
        this.name = name;
        this.lastModified = options?.lastModified || Date.now();
      }
    };
  } else {
    globalThis.File = class File {
      constructor(bits = [], name = '', options = {}) {
        this.name = name;
        this.lastModified = options?.lastModified || Date.now();
        this.size = bits?.reduce((total, chunk) => total + (chunk?.length || 0), 0) || 0;
        this.type = options?.type || '';
      }
    };
  }
}

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { Pool } = require('pg');
const path = require('path');
const redis = require('redis');
const nodemailer = require('nodemailer');

const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const PriceValidator = require('./price-validator');
const enhancedShopifySync = require('./enhanced-shopify-sync');
const EmailMonitor = require('./email-monitor');

require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Load environment variables
const {
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = 'claude-3-haiku-20240307', // Stable default model
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
  PORT = 3000
} = process.env;
const HOST = process.env.HOST || '0.0.0.0';

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

// Add error handler to pool to prevent crashes
pool.on('error', (err, client) => {
  console.error('❌ Unexpected database pool error:', err);
  // Don't crash the app on pool errors
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

// Initialize email transporter (using Gmail SMTP)
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  console.log('✅ Email transporter configured for Gmail');
} else {
  console.warn('⚠️ Email credentials not found in environment variables');
}


// Google Sheets setup for customer data
let customerSheetDoc = null;
let customerSheet = null;

// Create reusable auth object for initial connection and retries
const googleAuth = GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY ? {
  client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
} : null;

if (googleAuth && GOOGLE_SHEET_ID) {
  customerSheetDoc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

  customerSheetDoc.useServiceAccountAuth(googleAuth).then(() => customerSheetDoc.loadInfo())
    .then(() => {
      // Find sheet by title for robustness (fallback to env var or index)
      const targetSheetTitle = process.env.GOOGLE_SHEET_TAB_NAME || 'Shopify';
      customerSheet = customerSheetDoc.sheetsByTitle[targetSheetTitle] || customerSheetDoc.sheetsByIndex[1];

      if (customerSheet && customerSheet.title === targetSheetTitle) {
        console.log(`✅ Google Sheet "${targetSheetTitle}" tab loaded successfully`);
        statusColumnIndexCache = null; // Reset cache when sheet is loaded
      } else if (customerSheet) {
        console.log(`⚠️ Using fallback sheet: ${customerSheet.title} (target was "${targetSheetTitle}")`);
      } else {
        console.error(`❌ No sheet found with title "${targetSheetTitle}" or at index 1`);
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
          // Find sheet by title for robustness (same logic as initial load)
          const targetSheetTitle = process.env.GOOGLE_SHEET_TAB_NAME || 'Shopify';
          customerSheet = customerSheetDoc.sheetsByTitle[targetSheetTitle] || customerSheetDoc.sheetsByIndex[1];
          console.log(`✅ Google Sheet loaded on retry: ${customerSheet ? customerSheet.title : 'NOT FOUND'}`);
          statusColumnIndexCache = null; // Reset cache when sheet is reloaded
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
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      selected_order_index INTEGER DEFAULT NULL
    )`);

    // Add selected_order_index column if it doesn't exist (for existing databases)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='conversations' AND column_name='selected_order_index') THEN
          ALTER TABLE conversations ADD COLUMN selected_order_index INTEGER DEFAULT NULL;
        END IF;
      END $$;
    `);
    
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
      source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'shopify', 'shopify-meta', 'shopify-policy', 'shopify-page', 'website', 'website-blog', 'website-page', 'website-collection')),
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
    
    // System settings table for AI control and other settings
    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Action items table for tracking bot promises that need manual fulfillment
    await pool.query(`CREATE TABLE IF NOT EXISTS action_items (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      customer_name VARCHAR(255),
      type VARCHAR(50) NOT NULL,
      description TEXT NOT NULL,
      priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP,
      completed_by VARCHAR(100),
      notes TEXT
    )`);
    
    // Indexes for action items
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_items_phone ON action_items(phone)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_items_created ON action_items(created_at DESC)`);

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

// Helper function to check if AI is enabled
async function isAIEnabled() {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['ai_enabled']);
    return result.rows.length > 0 ? result.rows[0].value === 'true' : true; // Default to enabled
  } catch (err) {
    console.error('Error checking AI status:', err);
    return true; // Default to enabled on error
  }
}

// Helper function to check if respond-to-all mode is enabled
async function isRespondToAllEnabled() {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['respond_to_all']);
    return result.rows.length > 0 ? result.rows[0].value === 'true' : false; // Default to sheets-only
  } catch (err) {
    console.error('Error checking respond-to-all status:', err);
    return false; // Default to sheets-only on error
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

// Cache for status column index to avoid repeated header lookups
let statusColumnIndexCache = null;

// Helper function to find status column index by header name
function getStatusColumnIndex() {
  if (statusColumnIndexCache !== null) {
    return statusColumnIndexCache;
  }

  if (!customerSheet || !customerSheet.headerValues) {
    console.warn('⚠️ No sheet headers available, using fallback status column index 4');
    return 4; // Fallback to original hardcoded index
  }

  // Try common status header variations (with env var override)
  const envStatusHeader = process.env.GOOGLE_SHEET_STATUS_COLUMN;
  const statusHeaders = envStatusHeader ?
    [envStatusHeader, 'Status', 'Order Status', 'status', 'ORDER STATUS', 'Shipping Status', 'Order State'] :
    ['Status', 'Order Status', 'status', 'ORDER STATUS', 'Shipping Status', 'Order State'];
  const headers = customerSheet.headerValues;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (statusHeaders.some(statusHeader =>
      header && header.toString().toLowerCase().includes(statusHeader.toLowerCase())
    )) {
      console.log(`✅ Found status column "${header}" at index ${i}`);
      statusColumnIndexCache = i;
      return i;
    }
  }

  console.warn(`⚠️ No status column found in headers: [${headers.slice(0, 10).join(', ')}], using fallback index 4`);
  statusColumnIndexCache = 4; // Cache the fallback
  return 4;
}

// Response validator to prevent AI hallucinations
function validateAndSanitizeResponse(response, orderInfo = '', customer = null) {
  if (!response) return response;

  let validated = response;
  let flagged = false;

  // 1. Check for fabricated order numbers (SP-### patterns) not in orderInfo
  const orderNumberPattern = /(order\s*#?\s*|#)\s*(sp-\d+|ms\d+|\d{3,6})/gi;
  const orderMatches = validated.match(orderNumberPattern);
  if (orderMatches) {
    // Check if any order numbers are NOT in the actual orderInfo
    const hasValidOrderRef = orderMatches.some(match =>
      orderInfo && orderInfo.toLowerCase().includes(match.toLowerCase())
    );
    if (!hasValidOrderRef) {
      flagged = true;
      console.warn(`⚠️ Response validation: Blocked fabricated order number - ${orderMatches.join(', ')}`);
    }
  }

  // 2. Check for specific date claims not in orderInfo
  const datePattern = /(before|after|since|on|from)\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|\d{4})/gi;
  const dateMatches = validated.match(datePattern);
  if (dateMatches) {
    const hasValidDateRef = dateMatches.some(match =>
      orderInfo && orderInfo.toLowerCase().includes(match.toLowerCase())
    );
    if (!hasValidDateRef) {
      flagged = true;
      console.warn(`⚠️ Response validation: Blocked fabricated date reference - ${dateMatches.join(', ')}`);
    }
  }

  // 3. Check for "expedited" without PURPLE status confirmation
  const expeditePattern = /expedite|expedited|expediting/gi;
  if (expeditePattern.test(validated)) {
    // Only allow if we have explicit expedited status (would need status color context)
    // For now, flag all expedited claims unless specifically verified
    const hasValidExpediteStatus = orderInfo && orderInfo.toLowerCase().includes('expedit');
    if (!hasValidExpediteStatus) {
      flagged = true;
      console.warn(`⚠️ Response validation: Blocked unverified expedited claim`);
    }
  }

  // 4. Check for fabricated delivery status claims (we don't have tracking data)
  // Allow general statements like "has shipped" or "is on the way" if we have order status
  // Block SPECIFIC claims like "arriving today" or "out for delivery" that require real-time tracking
  const specificDeliveryPattern = /out for delivery|arriving (today|tomorrow|this week)|delivered today|will arrive (today|tomorrow|this week)|be there (today|tomorrow)|expected delivery (today|tomorrow)|delivery date.*\d|tracking shows/gi;
  if (specificDeliveryPattern.test(validated)) {
    flagged = true;
    console.warn(`⚠️ Response validation: Blocked specific delivery timeframe claim`);
  }

  // 4c. Block "shipped" claims unless sheet status is actually Shipped
  // This prevents the model from confirming shipment when the row is not green.
  const positiveShippedPattern = /\b(has shipped|have shipped|been shipped|shipped out|already shipped|is on (?:its|the) way|in transit)\b/i;
  const negativeShippedPattern = /\b(not shipped|hasn't shipped|has not shipped|haven't shipped|have not shipped|not yet shipped)\b/i;
  if (positiveShippedPattern.test(validated) && !negativeShippedPattern.test(validated)) {
    const orderShowsShipped = orderInfo && /Current Status:\s*Shipped\b/i.test(orderInfo);
    if (!orderShowsShipped) {
      flagged = true;
      console.warn(`⚠️ Response validation: Blocked unverified shipped claim`);
    }
  }

  // 4b. Check for any mention of tracking numbers (we don't provide tracking numbers)
  // Block if response explicitly mentions "tracking number" or shows tracking number patterns
  const trackingMentionPattern = /tracking\s+number|tracking\s*#|tracking\s*code/i;
  const trackingNumberPattern = /\b1Z[A-Z0-9]{16,18}\b/i;  // UPS format specifically
  
  if (trackingMentionPattern.test(validated) || trackingNumberPattern.test(validated)) {
    // Check if the tracking info is actually in the customer data
    const hasValidTracking = orderInfo && (trackingMentionPattern.test(orderInfo) || trackingNumberPattern.test(orderInfo));
    if (!hasValidTracking) {
      flagged = true;
      const match = validated.match(trackingNumberPattern);
      console.warn(`⚠️ Response validation: Blocked fabricated tracking number${match ? ': ' + match[0] : ''}`);
    }
  }

  // 5. Check for product size mismatches (if orderInfo has gallon size, response should match)
  if (orderInfo && customer) {
    // Extract gallon size from orderInfo
    const orderGallonMatch = orderInfo.match(/(\d+)\s*gallon/i);
    if (orderGallonMatch) {
      const correctGallonSize = orderGallonMatch[1];
      // Check if response mentions a DIFFERENT gallon size
      const responseGallonMatches = validated.match(/(\d+)\s*gallon/gi);
      if (responseGallonMatches) {
        const hasMismatch = responseGallonMatches.some(match => {
          const responseSize = match.match(/(\d+)/)[1];
          return responseSize !== correctGallonSize;
        });
        if (hasMismatch) {
          flagged = true;
          console.warn(`⚠️ Response validation: Blocked product size mismatch - order is ${correctGallonSize} gallon`);
        }
      }
    }
  }

  // If flagged, replace with safe fallback
  if (flagged) {
    console.log(`🚫 Response validation triggered - replacing with safe fallback`);
    return "Let me check your order details and get back to you shortly. Please call (603) 997-6786 if you need immediate assistance.";
  }

  return validated;
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
    // Load all rows with pagination to ensure complete customer coverage
    // Reduced batch size to prevent memory issues on free hosting
    const allRows = [];
    let offset = 0;
    const batchSize = 500; // Reduced from 1000 to 500

    while (true) {
      const batch = await customerSheet.getRows({ limit: batchSize, offset });
      if (batch.length === 0) break;
      allRows.push(...batch);
      if (batch.length < batchSize) break; // No more rows
      offset += batchSize;

      // Add memory check and early exit if too many rows
      if (allRows.length > 5000) {
        console.warn(`⚠️ Sheet has too many rows (${allRows.length}+), limiting to first 5000 for memory`);
        break;
      }
    }

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
    
    allRows.forEach((row, index) => {
      const phoneField = getPhoneFromRow(row);
      if (!phoneField || foundCustomer) return;
      
      const normalizedRowPhone = normalizePhoneNumber(phoneField);
      
      // Exact match
      if (normalizedRowPhone === normalizedInputPhone) {
        console.log(`✅ EXACT MATCH found at Row ${index}`);
        foundCustomer = row;
        // google-spreadsheet rows start at sheet row 2 (row 1 is headers)
        foundRowIndex = row.rowNumber || (index + 2);
        return;
      }
      
      // Partial match (last 10 digits)
      if (normalizedRowPhone.length >= 10 && normalizedInputPhone.length >= 10) {
        const rowLast10 = normalizedRowPhone.slice(-10);
        const inputLast10 = normalizedInputPhone.slice(-10);
        
        if (rowLast10 === inputLast10) {
          console.log(`✅ PARTIAL MATCH found at Row ${index} (last 10 digits)`);
          foundCustomer = row;
          // google-spreadsheet rows start at sheet row 2 (row 1 is headers)
          foundRowIndex = row.rowNumber || (index + 2);
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

// Helper function to find ALL orders for a customer by phone
async function findAllOrdersByPhone(phone) {
  if (!customerSheet) return [];

  const normalizedPhone = normalizePhoneNumber(phone);
  const cacheKey = `all_orders_${normalizedPhone}`;

  // Check cache first
  const cached = await getCachedCustomer(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const allRows = [];
    let offset = 0;
    const batchSize = 500;

    while (true) {
      const batch = await customerSheet.getRows({ limit: batchSize, offset });
      if (batch.length === 0) break;
      allRows.push(...batch);
      if (batch.length < batchSize) break;
      offset += batchSize;

      if (allRows.length > 5000) {
        console.warn(`⚠️ Sheet has too many rows (${allRows.length}+), limiting to first 5000`);
        break;
      }
    }

    const normalizedInputPhone = normalizePhoneNumber(phone);
    console.log(`🔍 Looking for ALL orders for phone: ${phone} -> normalized: ${normalizedInputPhone}`);

    // Helper function to get phone field from row
    function getPhoneFromRow(row) {
      const phoneHeaders = ['Phone', 'phone', 'Phone Number', 'phone_number', 'PhoneNumber', 'PHONE', 'Tel', 'Mobile'];
      for (const header of phoneHeaders) {
        const value = row[header];
        if (value) return value;
      }
      return row._rawData[6];
    }

    // Helper to get product from row
    function getProductFromRow(row) {
      const productHeaders = ['items', 'Items', 'B items', 'Product', 'LineItem name', 'Item', 'product', 'Product Name'];
      for (const header of productHeaders) {
        const value = row[header];
        if (value) return value;
      }
      return row._rawData[1] || row._rawData[8] || 'Unknown Product';
    }

    // Helper to get order date from row
    function getOrderDateFromRow(row) {
      const dateHeaders = ['Created at', 'Order Date', 'Date', 'created_at', 'order_date'];
      for (const header of dateHeaders) {
        const value = row[header];
        if (value) return value;
      }
      return row._rawData[3] || 'Unknown Date';
    }

    const matchingOrders = [];

    allRows.forEach((row, index) => {
      const phoneField = getPhoneFromRow(row);
      if (!phoneField) return;

      const normalizedRowPhone = normalizePhoneNumber(phoneField);

      // Check for exact or partial match
      let isMatch = (normalizedRowPhone === normalizedInputPhone);
      if (!isMatch && normalizedRowPhone.length >= 10 && normalizedInputPhone.length >= 10) {
        const rowLast10 = normalizedRowPhone.slice(-10);
        const inputLast10 = normalizedInputPhone.slice(-10);
        isMatch = (rowLast10 === inputLast10);
      }

      if (isMatch) {
        // google-spreadsheet rows start at sheet row 2 (row 1 is headers)
        const sheetRowIndex = row.rowNumber || (index + 2);
        row.googleRowIndex = sheetRowIndex;
        row.orderSummary = {
          product: getProductFromRow(row),
          date: getOrderDateFromRow(row),
          rowIndex: sheetRowIndex
        };
        matchingOrders.push(row);
        console.log(`✅ Found order ${matchingOrders.length} at Row ${sheetRowIndex}: ${row.orderSummary.product}`);
      }
    });

    console.log(`📋 Total orders found for ${phone}: ${matchingOrders.length}`);

    // Cache the results
    if (matchingOrders.length > 0) {
      await setCachedCustomer(cacheKey, matchingOrders);
    }

    return matchingOrders;
  } catch (error) {
    console.error('Google Sheets multi-order lookup error:', error.message);
    await logEvent('error', `Google Sheets multi-order lookup failed for ${phone}: ${error.message}`);
    return [];
  }
}

// Helper function to create action items
async function createActionItem(phone, customerName, type, description, priority = 'normal') {
  try {
    await pool.query(
      'INSERT INTO action_items(phone, customer_name, type, description, priority, status) VALUES($1, $2, $3, $4, $5, $6)',
      [phone, customerName, type, description, priority, 'pending']
    );
    await logEvent('info', `Action item created: ${type} for ${phone}`);
    console.log(`📋 Action item created: ${type} - ${description.substring(0, 50)}...`);
  } catch (err) {
    console.error('Error creating action item:', err);
    await logEvent('error', `Failed to create action item: ${err.message}`);
  }
}

// Detect action items from customer messages
function detectActionItems(userMessage) {
  const items = [];
  const msg = userMessage.toLowerCase();
  
  // Address change detection
  const addressPatterns = [
    /(?:change|update|send|ship).*(?:address|to|location)/i,
    /(?:can you (?:send|ship) (?:it |this )?to)/i,
    /(?:new address|different address)/i
  ];
  
  if (addressPatterns.some(pattern => pattern.test(userMessage))) {
    items.push({
      type: 'address_change',
      priority: 'high',
      addressInfo: userMessage
    });
  }
  
  // Tracking number request
  if (msg.includes('tracking') && (msg.includes('number') || msg.includes('info'))) {
    items.push({
      type: 'tracking_request',
      priority: 'normal'
    });
  }
  
  // Expedite request
  if (msg.includes('expedite') || msg.includes('rush') || msg.includes('asap') || msg.includes('faster')) {
    items.push({
      type: 'expedite_order',
      priority: 'high'
    });
  }
  
  // Cancellation
  if (msg.includes('cancel') && !msg.includes("don't cancel") && !msg.includes("not cancel")) {
    items.push({
      type: 'cancellation',
      priority: 'urgent'
    });
  }
  
  // Callback request
  if (msg.includes('call me') || msg.includes('give me a call') || msg.includes('please call')) {
    items.push({
      type: 'callback_request',
      priority: 'normal'
    });
  }
  
  return items;
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
    
    // Clear Redis cache if available - use SCAN to avoid blocking
    if (redisClient) {
      try {
        const pipeline = redisClient.multi();
        let deletedCount = 0;

        for await (const key of redisClient.scanIterator({ MATCH: 'customer:*', COUNT: 100 })) {
          pipeline.del(key);
          deletedCount++;
        }

        if (deletedCount > 0) {
          await pipeline.exec();
          console.log(`🗑️ Cleared ${deletedCount} Redis cache entries using SCAN`);
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

// Email response endpoint for customer emails to owner@thedistillerynetwork.com
app.post('/email-notify', async (req, res) => {
  try {
    const { from_email, subject, body, to_email } = req.body;
    
    if (!from_email || !subject || !body) {
      return res.status(400).json({ error: 'from_email, subject, and body are required' });
    }

    // Normalize email address
    const normalizedEmail = from_email.toLowerCase().trim();
    
    // Look up customer by email address
    const customer = await findCustomerByEmail(normalizedEmail);
    
    if (!customer) {
      console.log(`❌ Email from non-customer: ${from_email}`);
      await logEvent('info', `Non-customer email from ${from_email}: ${subject}`);
      return res.json({ 
        message: 'Email received but sender not in customer database',
        customer_found: false 
      });
    }

    // Found a customer - check if AI is enabled
    const aiEnabled = await isAIEnabled();
    if (!aiEnabled) {
      await logEvent('info', `AI disabled - Email from ${from_email} logged but no response sent`);
      return res.json({
        success: true,
        message: 'Email processed but AI responses are disabled',
        customer_found: true,
        customer_name: customer.name || 'Unknown Customer',
        ai_response: null,
        email_sent: false,
        ai_disabled: true
      });
    }

    // Process like SMS conversation
    const customerName = customer.name || 'Unknown Customer';
    const customerPhone = customer.phone || 'No phone';
    
    await logEvent('info', `📧 Customer email from ${customerName} (${from_email}): "${subject}"`);
    
    // Create or update conversation record using email as identifier
    const emailId = `email:${normalizedEmail}`;
    const convResult = await pool.query(
      'SELECT * FROM conversations WHERE phone = $1', 
      [emailId]
    );
    
    let conversation;
    if (convResult.rows.length === 0) {
      // Create new conversation record for email
      await pool.query(
        'INSERT INTO conversations (phone, name, paused, requested_human, last_active) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
        [emailId, customerName, false, false]
      );
      conversation = { phone: emailId, name: customerName };
    } else {
      conversation = convResult.rows[0];
      // Update last active
      await pool.query(
        'UPDATE conversations SET last_active = CURRENT_TIMESTAMP WHERE phone = $1',
        [emailId]
      );
    }

    // Log the email as an incoming message
    const emailMessage = `📧 ${subject}\n\n${body}`;
    await pool.query(
      'INSERT INTO messages (phone, sender, message) VALUES ($1, $2, $3)',
      [emailId, 'user', emailMessage]
    );

    // Generate AI response using the same logic as SMS
    const aiResponse = await generateAIResponse(emailId, emailMessage, customer);
    
    // Log the AI response
    await pool.query(
      'INSERT INTO messages (phone, sender, message) VALUES ($1, $2, $3)',
      [emailId, 'assistant', aiResponse]
    );

    // Send email response if email transporter is configured
    let emailSent = false;
    let emailError = null;
    
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: `"The Distillery Network" <${process.env.EMAIL_USER}>`,
          to: from_email,
          subject: `Re: ${subject}`,
          text: aiResponse,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
                <p>Hi ${customerName},</p>
                <div style="white-space: pre-wrap; line-height: 1.6;">${aiResponse.replace(/\n/g, '<br>')}</div>
                <br>
                <p style="color: #6c757d; font-size: 14px;">
                  Best regards,<br>
                  The Distillery Network Team<br>
                  <a href="https://thedistillerynetwork.com">thedistillerynetwork.com</a>
                </p>
              </div>
            </div>
          `
        });
        
        emailSent = true;
        console.log(`✅ Email response sent to ${customerName} (${from_email})`);
        await logEvent('info', `📧 Email response sent to ${customerName}: "${aiResponse.substring(0, 100)}..."`);
        
      } catch (error) {
        emailError = error.message;
        console.error('❌ Failed to send email response:', error);
        await logEvent('error', `Failed to send email to ${from_email}: ${error.message}`);
      }
    }

    return res.json({
      success: true,
      message: emailSent ? 'Email processed and AI response sent' : 'Email processed but failed to send response',
      customer_found: true,
      customer_name: customerName,
      ai_response: aiResponse,
      email_sent: emailSent,
      email_error: emailError,
      email_configured: !!emailTransporter
    });

  } catch (error) {
    console.error('❌ Email processing error:', error);
    await logEvent('error', `Email processing failed: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to find customer by email address
async function findCustomerByEmail(email) {
  if (!customerSheet) return null;

  try {
    // Load all rows with pagination to ensure complete customer coverage
    // Reduced batch size to prevent memory issues on free hosting
    const allRows = [];
    let offset = 0;
    const batchSize = 500; // Reduced from 1000 to 500

    while (true) {
      const batch = await customerSheet.getRows({ limit: batchSize, offset });
      if (batch.length === 0) break;
      allRows.push(...batch);
      if (batch.length < batchSize) break; // No more rows
      offset += batchSize;

      // Add memory check and early exit if too many rows
      if (allRows.length > 5000) {
        console.warn(`⚠️ Sheet has too many rows (${allRows.length}+), limiting to first 5000 for memory`);
        break;
      }
    }

    for (const row of allRows) {
      const rowData = row._rawData;
      if (!rowData || rowData.length === 0) continue;
      
      // Check multiple email fields (usually in columns 0, 5, or other email columns)
      for (let i = 0; i < Math.min(10, rowData.length); i++) {
        const cellValue = String(rowData[i] || '').toLowerCase().trim();
        
        // Check if this cell contains an email that matches
        if (cellValue.includes('@') && cellValue === email) {
          return {
            name: rowData[2] || rowData[1] || 'Unknown Customer',
            email: cellValue,
            phone: rowData[6] || rowData[7] || 'No phone',
            _rawData: rowData
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Email customer lookup error:', error);
    return null;
  }
}

// SMS Reply endpoint (webhook for incoming SMS)
app.post('/reply', async (req, res) => {
  const incomingPhone = req.body.phone || req.body.From;
  const incomingText = req.body.text || req.body.Body || '';
  const mediaUrl = req.body.MediaUrl || req.body.mediaUrl || '';

  if (!incomingPhone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  const phone = normalizePhoneNumber(incomingPhone);
  let userMessage = incomingText.trim();
  const timestamp = new Date();

  // Handle image/media messages
  if (mediaUrl && mediaUrl !== '') {
    // Customer sent an image/media
    if (userMessage === '' || userMessage.length < 5) {
      userMessage = "I sent you a picture/image";
    } else {
      userMessage = userMessage + " (with attached image)";
    }
    await logEvent('info', `Received SMS with media from ${phone}: "${userMessage}" MediaURL: ${mediaUrl}`);
  } else if (userMessage === '' || userMessage === undefined) {
    // Empty message with no media
    await logEvent('info', `Received empty SMS from ${phone} - ignoring`);
    return res.status(204).send(); // No Content - ignore empty messages
  }

  await logEvent('info', `Received SMS from ${phone}: "${userMessage}"`);

  // Check if AI is enabled
  const aiEnabled = await isAIEnabled();
  if (!aiEnabled) {
    await logEvent('info', `AI disabled - SMS from ${phone} logged but no response sent`);
    return res.status(204).send(); // No Content - Tasker won't send SMS
  }

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
        // Customer not found in Google Sheets - check respond-to-all mode
        const respondToAll = await isRespondToAllEnabled();
        if (!respondToAll) {
          // Sheets-only mode - return no content so Tasker ignores
          await logEvent('info', `Non-customer SMS from ${phone} - no auto-reply (sheets-only mode)`);
          return res.status(204).send(); // No Content = Tasker won't send SMS
        }

        // Respond-to-all mode - create conversation as Jonathan (no customer data access)
        await logEvent('info', `Non-customer SMS from ${phone} - responding as Jonathan (respond-to-all mode)`);
        await pool.query(
          'INSERT INTO conversations(phone, name, paused, requested_human, last_active) VALUES($1, $2, $3, $4, $5)',
          [phone, 'Non-customer', false, false, timestamp]
        );
        conversation = { phone, name: 'Non-customer', paused: false, requested_human: false };
      } else {
        // Customer found - proceed with conversation
        const name = customerName;
        await logEvent('info', `Customer identified: ${name} (phone ${phone})`);

        await pool.query(
          'INSERT INTO conversations(phone, name, paused, requested_human, last_active) VALUES($1, $2, $3, $4, $5)',
          [phone, name, false, false, timestamp]
        );
        conversation = { phone, name, paused: false, requested_human: false };
      }
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
          // Customer no longer in Google Sheets - check respond-to-all mode
          const respondToAll = await isRespondToAllEnabled();
          if (!respondToAll) {
            // Sheets-only mode - return no content so Tasker ignores
            await logEvent('info', `Non-customer SMS from removed customer ${phone} - no auto-reply (sheets-only mode)`);
            return res.status(204).send(); // No Content = Tasker won't send SMS
          }

          // Respond-to-all mode - update conversation name to indicate non-customer
          await logEvent('info', `Non-customer SMS from removed customer ${phone} - responding as Jonathan (respond-to-all mode)`);
          await pool.query('UPDATE conversations SET name = $1 WHERE phone = $2', ['Non-customer', phone]);
          conversation.name = 'Non-customer';
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

    // Human takeover detection is now handled in generateAIResponse function

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
    // Use findAllOrdersByPhone to support multiple orders per customer
    const allOrders = await findAllOrdersByPhone(phone);
    const hasMultipleOrders = allOrders.length > 1;

    // Get selected order index from conversation (if previously selected)
    let selectedOrderIndex = conversation.selected_order_index;

    // Check if user is selecting an order by number (e.g., "1", "2", "order 1", "first one")
    const orderSelectionPattern = /^(?:order\s*)?(\d+)$|^(?:the\s*)?(first|second|third|1st|2nd|3rd|one|two|three)(?:\s+one)?$/i;
    const selectionMatch = userMessage.trim().match(orderSelectionPattern);

    if (hasMultipleOrders && selectionMatch) {
      let selectedNum = null;
      const numWord = (selectionMatch[1] || selectionMatch[2] || '').toLowerCase();

      if (/^1$|first|1st|one/.test(numWord)) selectedNum = 0;
      else if (/^2$|second|2nd|two/.test(numWord)) selectedNum = 1;
      else if (/^3$|third|3rd|three/.test(numWord)) selectedNum = 2;
      else if (/^\d+$/.test(numWord)) selectedNum = parseInt(numWord) - 1;

      if (selectedNum !== null && selectedNum >= 0 && selectedNum < allOrders.length) {
        selectedOrderIndex = selectedNum;
        await pool.query('UPDATE conversations SET selected_order_index = $1 WHERE phone = $2', [selectedOrderIndex, phone]);
        await logEvent('info', `Customer ${phone} selected order ${selectedNum + 1}: ${allOrders[selectedNum].orderSummary?.product}`);

        // Confirm selection and continue conversation
        const selectedOrder = allOrders[selectedNum];
        const confirmMsg = `Got it! I'm now looking at your order for the ${selectedOrder.orderSummary?.product || 'selected product'} from ${selectedOrder.orderSummary?.date || 'your order date'}. How can I help you with this order?`;

        await pool.query(
          'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
          [phone, 'assistant', confirmMsg, new Date()]
        );
        await logEvent('info', `Sending order selection confirmation to ${phone}`);
        return res.status(200).type('text/plain').send(confirmMsg);
      }
    }

    // Check if customer is identifying themselves by name (e.g., "This is Greg French", "I'm John Smith")
    const nameIdentificationPattern = /(?:this is|i'm|i am|my name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i;
    const nameMatch = userMessage.match(nameIdentificationPattern);
    
    if (nameMatch && allOrders.length > 0) {
      const providedName = nameMatch[1].trim();
      console.log(`🔍 Customer identifying as: ${providedName}`);
      
      // Search for order matching this name
      let matchedOrderIndex = null;
      allOrders.forEach((order, idx) => {
        const orderName = order._rawData[2] || order['Name'] || order['Customer'] || order['shipping_name'] || '';
        // Check if provided name matches (case-insensitive, partial match for first/last name)
        if (orderName.toLowerCase().includes(providedName.toLowerCase()) || 
            providedName.toLowerCase().includes(orderName.toLowerCase())) {
          matchedOrderIndex = idx;
          console.log(`✅ Found matching order at index ${idx}: ${orderName}`);
        }
      });
      
      if (matchedOrderIndex !== null) {
        // Found a match - update selected order
        selectedOrderIndex = matchedOrderIndex;
        await pool.query('UPDATE conversations SET selected_order_index = $1 WHERE phone = $2', [selectedOrderIndex, phone]);
        await logEvent('info', `Customer ${phone} identified as ${providedName}, matched to order ${matchedOrderIndex + 1}`);
        
        // Update conversation name to match
        await pool.query('UPDATE conversations SET name = $1 WHERE phone = $2', [providedName, phone]);
        
        // Confirm identification
        const matchedOrder = allOrders[matchedOrderIndex];
        const confirmMsg = `Thanks for clarifying, ${providedName}! I've got your order details now. How can I help you today?`;
        
        await pool.query(
          'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
          [phone, 'assistant', confirmMsg, new Date()]
        );
        await logEvent('info', `Confirmed identity for ${phone} as ${providedName}`);
        return res.status(200).type('text/plain').send(confirmMsg);
      }
    }

    // If multiple orders and none selected yet, and user is asking about orders, ask which one
    const orderPattern = /(\b(order|ordered|purchase|purchased|bought|status|tracking|ship|shipped|shipping|shipment|deliver|delivered|delivering|delivery|arrive|arrival|arriving|eta)\b|when will|where.*my|my.*order)/i;
    if (hasMultipleOrders && selectedOrderIndex === null && orderPattern.test(userMessage)) {
      let orderListMsg = `I see you have ${allOrders.length} orders with us! Which one would you like to discuss?\n\n`;

      allOrders.forEach((order, idx) => {
        const product = order.orderSummary?.product || 'Unknown Product';
        const date = order.orderSummary?.date || 'Unknown Date';
        orderListMsg += `${idx + 1}. ${product} (ordered ${date})\n`;
      });

      orderListMsg += `\nJust reply with the number (1, 2, etc.) of the order you'd like to discuss.`;

      await pool.query(
        'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
        [phone, 'assistant', orderListMsg, new Date()]
      );
      await logEvent('info', `Asked ${phone} to select from ${allOrders.length} orders`);
      return res.status(200).type('text/plain').send(orderListMsg);
    }

    // Get the customer object - either the selected order or the first/only order
    let customer = null;
    if (allOrders.length > 0) {
      if (selectedOrderIndex !== null && selectedOrderIndex < allOrders.length) {
        customer = allOrders[selectedOrderIndex];
      } else {
        customer = allOrders[0]; // Default to first order if only one or none selected
      }
    }

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
    const isCustomer = customer && customerName;
    
    // Detect action items from customer message
    if (isCustomer) {
      const actionItems = detectActionItems(userMessage);
      if (actionItems.length > 0) {
        for (const item of actionItems) {
          let description = '';
          
          if (item.type === 'address_change') {
            description = `Update shipping address: ${item.addressInfo}`;
          } else if (item.type === 'tracking_request') {
            description = `Customer requesting tracking number`;
          } else if (item.type === 'expedite_order') {
            description = `Customer requesting expedited shipping`;
          } else if (item.type === 'cancellation') {
            description = `Customer requesting order cancellation`;
          } else if (item.type === 'callback_request') {
            description = `Customer requesting callback`;
          }
          
          await createActionItem(phone, customerName, item.type, description, item.priority);
        }
      }
    }

    if (!isCustomer) {
      // Not a customer in Google Sheets - check respond-to-all mode
      const respondToAll = await isRespondToAllEnabled();
      if (!respondToAll) {
        // Sheets-only mode - don't respond to anyone not in sheets
        await logEvent('info', `Non-customer SMS from ${phone} - no auto-reply (sheets-only mode)`);
        return res.status(204).send(); // No Content = Tasker won't send SMS
      }

      // Respond-to-all mode - respond as Jonathan but WITHOUT customer data
      await logEvent('info', `Non-customer SMS from ${phone} - responding as Jonathan without customer data`);
    }

    // Handle order-related messages for customers only (not non-customers)
    // Note: orderPattern is already defined above for multi-order selection
    let orderInfo = "";
    if (isCustomer && orderPattern.test(userMessage) && customer && customer._rawData) {
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
        const productOrdered = getCustomerData(customer, 'items', 1) || getCustomerData(customer, 'Items', 1) || getCustomerData(customer, 'B items', 1) || getCustomerData(customer, 'Product', 1) || getCustomerData(customer, 'LineItem name', 1);
        const customerName = getCustomerData(customer, 'Name', 2) || getCustomerData(customer, 'Customer', 2);
        const orderDate = getCustomerData(customer, 'Created at', 3) || getCustomerData(customer, 'Order Date', 3) || getCustomerData(customer, 'Date', 3);
        const totalPrice = getCustomerData(customer, 'Total', 4) || getCustomerData(customer, 'Price', 4);

        // Flag for missing date information
        const hasOrderDate = Boolean(orderDate && orderDate.trim() && orderDate !== 'N/A');
        const email = getCustomerData(customer, 'Email', 5);
        const customerPhone = getCustomerData(customer, 'Phone', 6) || getCustomerData(customer, 'phone', 6);
        const shippingAddress = getCustomerData(customer, 'Shipping Address1', 7) || getCustomerData(customer, 'Address', 7);
        const shippingCity = getCustomerData(customer, 'Shipping City', 8) || getCustomerData(customer, 'City', 8);
        const shippingZip = getCustomerData(customer, 'Shipping Zip', 9) || getCustomerData(customer, 'Zip', 9);

        console.log(`📋 Order Info Extract for ${phone} (customer phone: ${customerPhone}):`);
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
          // Prefer the real sheet row number if available; googleRowIndex may be cached/derived.
          const rowIndex = customer.rowNumber || customer.googleRowIndex;

          // Make color column configurable and expandable
          const colorColumnIndex = process.env.GOOGLE_SHEET_COLOR_COLUMN ?
            parseInt(process.env.GOOGLE_SHEET_COLOR_COLUMN) : getStatusColumnIndex();
          const maxColumnIndex = Math.max(10, colorColumnIndex + 1); // Ensure we include the color column
          const columnLetter = String.fromCharCode(65 + maxColumnIndex - 1); // Convert to letter (A=0, B=1, etc.)

          await customerSheet.loadCells(`A${rowIndex}:${columnLetter}${rowIndex}`);
          console.log(`📋 Loading cells A${rowIndex}:${columnLetter}${rowIndex} for status check`);

          // Since entire row is colored for status, read from first few columns to detect row color.
          // Avoid the library's `cell.backgroundColor` getter because it throws when `userEnteredFormat`
          // is undefined (unformatted cells).
          const isWhite = (color) => {
            if (!color) return true;
            const red = color.red ?? 0;
            const green = color.green ?? 0;
            const blue = color.blue ?? 0;
            return red > 0.95 && green > 0.95 && blue > 0.95;
          };

          let statusColIndex = 0;
          let bgColor = null;

          // Try columns A through F to find one with an explicit or non-white effective background.
          for (let colIndex = 0; colIndex < 6; colIndex++) {
            const testCell = customerSheet.getCell(rowIndex - 1, colIndex);
            if (!testCell) continue;

            const userBg = testCell.userEnteredFormat?.backgroundColor;
            const effectiveBg = testCell.effectiveFormat?.backgroundColor;
            const candidateBg = userBg || (!isWhite(effectiveBg) ? effectiveBg : null);

            if (candidateBg) {
              statusColIndex = colIndex;
              bgColor = candidateBg;
              break;
            }
          }

          // Log the cell position and color for audit
          console.log(`🎨 Row color detected from Column ${statusColIndex} (${String.fromCharCode(65 + statusColIndex)}) at Row ${rowIndex}`);
          if (bgColor) {
            // Normalize undefined color values to 0
            const red = bgColor.red || 0;
            const green = bgColor.green || 0;
            const blue = bgColor.blue || 0;

            // Log RGB values for audit
            console.log(`🎨 RGB values for ${phone}: R=${red.toFixed(3)} G=${green.toFixed(3)} B=${blue.toFixed(3)}`);

            // Map colors to status descriptions based on your color coding system
            // Internal status for logging vs. customer-facing status
            let internalStatus = "";
            let customerFacingStatus = "";
            
            if (red > 0.9 && green < 0.3 && blue < 0.3) {
              // Red - Customer wants to cancel
              internalStatus = "Customer wants to cancel (RED)";
              customerFacingStatus = "In production";
              statusColor = "red";
            } else if (red < 0.3 && green > 0.7 && blue < 0.3) {
              // Green - Shipped
              internalStatus = "Shipped (GREEN)";
              customerFacingStatus = "Shipped";
              statusColor = "green";
            } else if (red > 0.8 && green > 0.8 && blue < 0.3) {
              // Yellow - In production
              internalStatus = "In production (YELLOW)";
              customerFacingStatus = "In production";
              statusColor = "yellow";
            } else if (red > 0.45 && green < 0.6 && blue > 0.7) {
              // Purple - Expediting order (at risk of cancellation)
              internalStatus = "Expediting order - at risk of cancellation (PURPLE)";
              customerFacingStatus = "In production - being expedited";
              statusColor = "purple";
            } else if (red < 0.3 && green > 0.5 && blue > 0.7) {
              // Light blue - First step of antsy
              internalStatus = "Customer getting impatient - needs update (LIGHT BLUE)";
              customerFacingStatus = "In production";
              statusColor = "light blue";
            } else if (red < 0.3 && green < 0.3 && blue > 0.7) {
              // Dark blue - Second step of antsy
              internalStatus = "Customer very impatient - second escalation (DARK BLUE)";
              customerFacingStatus = "In production";
              statusColor = "dark blue";
            } else {
              // White - Order just received
              internalStatus = "Order just received (WHITE)";
              customerFacingStatus = "Order received";
              statusColor = "white";
            }
            
            statusDescription = customerFacingStatus;

            // Log the final mapped status for audit (use internal status for logging)
            console.log(`🎨 Mapped status for ${phone}: ${statusColor.toUpperCase()} = ${internalStatus}`);
          }
        } catch (colorError) {
          console.error('Error reading cell colors:', colorError);
          await logEvent('error', `Failed to read cell colors for ${phone}: ${colorError.message}`);
        }
        
        orderInfo = `\n\n🚨🚨🚨 THIS CUSTOMER'S SPECIFIC ORDER DATA - USE ONLY THIS INFO 🚨🚨🚨\n`;
        orderInfo += `⚠️ CRITICAL: The product information below is from THIS CUSTOMER'S actual order in our database.\n`;
        orderInfo += `⚠️ DO NOT use any other product names from your knowledge - ONLY use what's listed here.\n\n`;
        orderInfo += `Customer: ${customerName}\n`;
        // Note: Internal row reference ${orderId} - DO NOT mention to customer unless they have a real order number
        if (hasOrderDate) {
          orderInfo += `Order Date: ${orderDate}\n`;
        } else {
          orderInfo += `⚠️ ORDER DATE NOT AVAILABLE - Do not guess or estimate dates. If asked about order dates, say "Let me check your order date and get back to you."\n`;
        }
        orderInfo += `\n✅ EXACT PRODUCT ORDERED: ${productOrdered || 'Product info not available - ask customer to clarify'}\n`;
        orderInfo += `⚠️ USE THIS EXACT PRODUCT NAME ABOVE - do not substitute with any other product!\n\n`;
        orderInfo += `Current Status: ${statusDescription}\n`;
        if (trackingInfo) orderInfo += `Email/Tracking: ${trackingInfo}\n`;
        orderInfo += `\n🎨 STATUS HANDLING INSTRUCTIONS:\n`;
        
        // Add color-specific handling instructions
        if (statusColor === "red") {
          orderInfo += `⚠️ RED STATUS - Customer wants to cancel:\n`;
          orderInfo += `- Be empathetic and understanding\n`;
          orderInfo += `- Acknowledge the delay/frustration\n`;
          orderInfo += `\n🚫 REFUND/CANCELLATION HANDLING - CRITICAL:\n`;
          orderInfo += `- DO NOT promise to process refunds - you cannot process them\n`;
          orderInfo += `- DO NOT say things like "I'll process your refund" or "I'll get that refund taken care of"\n`;
          orderInfo += `- INSTEAD, ask understanding questions:\n`;
          orderInfo += `  * "I understand you want to cancel - can I ask what's prompting this decision?"\n`;
          orderInfo += `  * "Is it the delay that's causing the issue, or something else?"\n`;
          orderInfo += `  * "Would you prefer if we expedited this, or would you rather cancel?"\n`;
          orderInfo += `- Offer options:\n`;
          orderInfo += `  * "I can have our team reach out to you about expediting your order"\n`;
          orderInfo += `  * "I can have someone call you to discuss cancellation options"\n`;
          orderInfo += `  * "Would you like to speak with someone about this directly?"\n`;
          orderInfo += `- Be considerate: Show you care about their experience and want to help\n`;
          orderInfo += `- Let them know someone from the team will reach out to resolve this\n`;
        } else if (statusColor === "light blue" || statusColor === "dark blue") {
          orderInfo += `⚠️ ${statusColor.toUpperCase()} STATUS - Customer is getting impatient:\n`;
          orderInfo += `- Be proactive and reassuring\n`;
          orderInfo += `- Status shown to customer is "In production"\n`;
          orderInfo += `- Acknowledge they've been waiting and thank them for patience\n`;
          orderInfo += `- Offer to have someone call with a specific update\n`;
          orderInfo += `- Don't give vague timelines - offer direct contact instead\n`;
        } else if (statusColor === "purple") {
          orderInfo += `⚠️ PURPLE STATUS - Order being expedited:\n`;
          orderInfo += `- Tell customer their order is being expedited/prioritized\n`;
          orderInfo += `- Do NOT say it has shipped yet (it's still in production)\n`;
          orderInfo += `- Show appreciation for their patience\n`;
          orderInfo += `- Offer to call with specific timeline update\n`;
        } else if (statusColor === "yellow") {
          orderInfo += `✅ YELLOW STATUS - In production:\n`;
          orderInfo += `- Confirm order is being crafted/assembled\n`;
          orderInfo += `- Be positive and helpful\n`;
        } else if (statusColor === "green") {
          orderInfo += `✅ GREEN STATUS - Shipped:\n`;
          orderInfo += `- Confirm order has shipped\n`;
          orderInfo += `- Mention tracking was sent to their email\n`;
          orderInfo += `- Offer to look up tracking if needed\n`;
        }
        
        orderInfo += `\n`;
        orderInfo += `IMPORTANT INSTRUCTIONS:\n`;
        orderInfo += `- You have full access to the customer's product details above\n`;
        orderInfo += `- DO NOT ask for order numbers, products, or details - you already have them!\n`;
        orderInfo += `- NEVER ask "Can you provide your order number?" - you can see their order!\n`;
        orderInfo += `- NEVER ask "What product did you order?" - you can see: ${productOrdered}\n`;
        orderInfo += `- Always include the specific product name when discussing their order\n`;
        orderInfo += `- Follow the color-coded customer service approach for ${statusColor} status\n`;
        orderInfo += `- Adjust your tone and response based on the customer's patience level indicated by the color\n`;
        orderInfo += `\n🚫 REFUND/CANCELLATION POLICY (APPLIES TO ALL STATUSES):\n`;
        orderInfo += `- You CANNOT process refunds or cancellations - only the backend team can\n`;
        orderInfo += `- NEVER say "I'll process your refund" or "I'll get that refund taken care of"\n`;
        orderInfo += `- NEVER promise specific refund amounts or timelines\n`;
        orderInfo += `- INSTEAD: Be understanding, ask why they want to cancel, and offer options\n`;
        orderInfo += `- Ask: "Can I ask what's prompting this decision?" or "Is there anything we can do to help?"\n`;
        orderInfo += `- Offer alternatives: expediting the order, speaking with the team, etc.\n`;
        orderInfo += `- Let them know someone from the team will reach out to handle their request\n`;
        orderInfo += `- Be considerate and empathetic - show you care about their experience\n`;
        orderInfo += `\n🚫 DELIVERY TRACKING RULES:\n`;
        orderInfo += `- We do NOT have real-time delivery tracking data in this system\n`;
        orderInfo += `- NEVER provide specific tracking numbers - they are not in our database\n`;
        if (statusColor === "green") {
          orderInfo += `- You CAN say general things like "has shipped", "is on the way", "in transit"\n`;
        } else {
          orderInfo += `- Do NOT say "has shipped"/"on the way"/"in transit" unless Current Status is "Shipped"\n`;
        }
        orderInfo += `- NEVER say SPECIFIC timeframes: "arriving today", "out for delivery", "will arrive tomorrow"\n`;
        orderInfo += `- If status is "Shipped", confirm it shipped and say it's on the way - that's fine\n`;
        orderInfo += `- For tracking questions, say you can "look that up" and offer to call back or provide (603) 997-6786\n`;

        await logEvent('info', `Order status lookup successful for ${phone}: ${statusDescription} (${statusColor})`);
    } else {
        await logEvent('info', `Order status lookup failed for ${phone}: customer not found`);
    }

    // Retrieve relevant knowledge - BUT skip for order queries when we have customer data
    // This prevents the AI from pulling generic product info instead of using the customer's actual order
    let knowledgeChunks = [];
    const isOrderQuery = orderPattern.test(userMessage);

    if (isOrderQuery && isCustomer && orderInfo) {
      // Skip knowledge retrieval for order queries - use only customer's actual order data
      await logEvent('info', `Skipping knowledge retrieval for order query - using customer's order data only`);
    } else {
      // Normal knowledge retrieval for non-order queries
      knowledgeChunks = await knowledgeRetriever.retrieveRelevantChunks(userMessage, 2);
      await logEvent('info', `Knowledge retrieved: found ${knowledgeChunks.length} relevant pieces.`);
    }

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
      // This is a customer from Google Sheets - provide customer data
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
      customerContext = `This is a known customer: ${customerName || 'Name not available'}\nEmail: ${customerEmail || 'Email not available'}

🚫 CRITICAL: Do NOT make up specific order numbers, dates, expedited status, or tracking details unless you have explicit order information. If asked about order status, say "Let me check your order details" and offer to call back with specifics.`;
    } else {
      // This is NOT a customer from Google Sheets - respond as Jonathan without customer data
      const respondToAll = await isRespondToAllEnabled();
      if (respondToAll) {
        customerContext = `This person is NOT in your customer database. You are Jonathan responding personally. DO NOT access or reference any customer data, orders, or Google Sheets information. Respond naturally as Jonathan from The Distillery Network.`;
      }
    }
    
    // Get current date and time
    const currentDateTime = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Build system content using template with replacements
    let systemContent = `Current date and time: ${currentDateTime}\n\n` +
      `🚫 CRITICAL: ONLY refer to information from THIS conversation's message history below. NEVER mention details, promises, or plans that are not explicitly stated in the message history for THIS phone number. Do not confabulate or assume previous interactions.\n\n` +
      `🚫🚫🚫 REFUND/CANCELLATION POLICY - HIGHEST PRIORITY 🚫🚫🚫\n` +
      `YOU CANNOT PROCESS REFUNDS OR CANCELLATIONS - ONLY THE BACKEND TEAM CAN\n` +
      `NEVER say these phrases:\n` +
      `❌ "I'll process your refund"\n` +
      `❌ "I can get that refund processed for you"\n` +
      `❌ "I'll get that refund taken care of"\n` +
      `❌ "I'll initiate the refund"\n` +
      `❌ "Let me get that money back to you"\n` +
      `❌ "I'll get started on that refund"\n\n` +
      `INSTEAD, when customers ask for refunds/cancellations:\n` +
      `✅ Ask understanding questions: "Can I ask what's prompting this decision?"\n` +
      `✅ Offer alternatives: "Would you prefer if we expedited this?"\n` +
      `✅ Direct to team: "Let me have someone from our team reach out to discuss this with you"\n` +
      `✅ Be empathetic: "I understand your frustration - let me see how we can help"\n\n` +
      systemTemplate
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

    // Add current user message - sanitize for Claude API
    const sanitizedMessage = userMessage.replace(/[^\x20-\x7E\s]/g, '').trim(); // Remove non-printable characters
    if (sanitizedMessage === '' && mediaUrl) {
      // If message is empty but there's media, provide context
      messages.push({ role: "user", content: "I sent you a picture/image" });
    } else {
      messages.push({ role: "user", content: sanitizedMessage || userMessage });
    }

    // Call Claude API
    let aiResponse = null;
    try {
      const completion = await anthropicClient.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 180,
        temperature: 0.1, // Very low temp to minimize creative/roleplay behavior
        system: systemContent,
        messages: messages
      });

      aiResponse = completion.content[0].text.trim();
      
      // Clean up response - remove all roleplaying actions and stage directions
      aiResponse = aiResponse.replace(/\[VOICE\]/g, '');
      
      // Remove asterisk-based actions: *checks*, *pauses*, *smiles*, etc.
      aiResponse = aiResponse.replace(/\*[^*]+\*/g, '');
      
      // Remove parenthetical stage directions
      aiResponse = aiResponse.replace(/\([^)]*(?:pauses|checks|looks|smiles|grins|chuckles|laughs|nods|shrugs)[^)]*\)/gi, '');
      
      // Clean up any double spaces or weird formatting from removals
      aiResponse = aiResponse.replace(/\s{2,}/g, ' ').trim();
      
      // Remove leading/trailing spaces from each line
      aiResponse = aiResponse.split('\n').map(line => line.trim()).filter(line => line).join('\n\n');

      // Handle image messages specially
      if (mediaUrl && mediaUrl !== '') {
        if (aiResponse && !aiResponse.toLowerCase().includes('picture') && !aiResponse.toLowerCase().includes('image')) {
          aiResponse += "\n\nI see you sent a picture - I can't view images directly, but feel free to describe what you're showing me and I'll help however I can!";
        }
      }

    } catch (apiErr) {
      console.error("Claude API error:", apiErr);
      console.error("Error details:", {
        phone,
        userMessage: userMessage.substring(0, 100),
        messageLength: userMessage.length,
        hasMedia: !!mediaUrl,
        sanitizedMessage: sanitizedMessage.substring(0, 100),
        statusCode: apiErr.status,
        errorType: apiErr.error?.type,
        errorMessage: apiErr.error?.message
      });

      // Log detailed error for debugging
      const errorDetail = `Claude API error: ${apiErr.status || 'unknown'} - ${apiErr.error?.type || 'unknown'} - ${apiErr.error?.message || apiErr.message}`;
      await logEvent('error', `Claude API request failed for ${phone}: ${errorDetail} - Message: "${userMessage.substring(0, 50)}"`);

      // Special handling for image messages
      let errorReply;
      if (mediaUrl && mediaUrl !== '') {
        errorReply = "Thanks for the picture! I'm having trouble processing it right now. Can you describe what you're showing me? Or call (603) 997-6786 for direct assistance.";
      } else {
        errorReply = "Sorry, I'm having trouble right now. Please call (603) 997-6786 for assistance.";
      }

      // Add retry logic for transient errors
      if (apiErr.status === 429 || apiErr.status === 503 || apiErr.status === 502) {
        errorReply = "I'm experiencing high load right now. Please try again in a moment or call (603) 997-6786 for immediate assistance.";
      }

      try {
        await pool.query(
          'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
          [phone, 'assistant', errorReply, new Date()]
        );
      } catch (dbErr) {
        console.error('Failed to log error message to database:', dbErr);
      }
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
      aiResponse = aiResponse
                             .replace(/^hey( there)?[,!]*\s*/i, '')
                             .replace(/^hi[,!]*\s*/i, '')
                             .replace(/^hello[,!]*\s*/i, '')
                             .replace(/^good (morning|afternoon|evening)[,!]*\s*/i, '')
                             .replace(/^hey\s+[A-Za-z]+[,!]*\s*/i, '')
                             .replace(/^hi\s+[A-Za-z]+[,!]*\s*/i, '');
    }

    // Response validator to block timeline/number hallucinations
    aiResponse = validateAndSanitizeResponse(aiResponse, orderInfo, customer);

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

// Helper function to generate AI response (extracted from SMS logic)
async function generateAIResponse(phone, userMessage, customer = null) {
  try {
    // Check for human takeover requests
    const lowerMessage = userMessage.toLowerCase();
    const humanTakeoverTriggers = [
      // Direct AI/Bot stop requests
      'stop ai', 'stop bot', 'stop robot', 'shut off ai', 'turn off ai', 'disable ai',
      'stop the ai', 'stop this ai', 'shut down ai', 'shut down bot',
      'no more ai', 'turn off bot', 'disable bot', 'shut off bot', 'shut off the ai',
      'shut down the ai', 'shut down the bot', 'turn off the bot', 'disable the bot',
      'stop responding', 'stop replying', 'stop automatic', 'stop auto',
      'ai talk', 'letting your ai', 'your ai talk', 'stop letting',
      'ai off', 'shut ai', 'shut your ai', 'turn ai off', 'shut off your ai',
      
      // Human requests
      'talk to human', 'speak to human', 'human help', 'real person', 'actual person',
      'talk to someone', 'speak to someone', 'human representative', 'customer service',
      'live chat', 'human support', 'real help', 'person help', 'human agent',
      'transfer to human', 'connect to human', 'get human', 'need human',
      'talk to a human', 'speak to a human', 'need to talk to',
      'i want human', 'get me human', 'human please', 'human support',
      
      // Stop communication requests  
      'stop texting', 'stop messaging', 'stop responding', 'stop talking', 'shut up',
      'stop sending', 'stop contacting', 'dont text', "don't text", 'no more texts',
      'no more messages', 'stop spam', 'quit messaging', 'quit texting',
      'texting off', 'messaging off', 'fucking texting',
      'stop this', 'make it stop', 'turn this off',
      
      // Frustration with AI
      'this is annoying', "you're annoying", 'stop spamming', 'leave me alone',
      'go away', 'piss off', 'bug off', 'screw off', 'get lost',
      'fuck off', 'shut the fuck up', 'fucking ai', 'fucking bot', 'fucking robot',
      'stupid ai', 'stupid bot', 'useless ai', 'useless bot', 'dumb ai', 'dumb bot',
      'fucking annoying', 'so annoying', 'really annoying',
      
      // Explicit opt-out language
      'unsubscribe', 'opt out', 'remove me', 'delete me', 'take me off',
      'remove from list', 'stop subscription', 'cancel texts', 'end service'
    ];
    
    const shouldTriggerHuman = humanTakeoverTriggers.some(trigger => lowerMessage.includes(trigger));
    
    if (shouldTriggerHuman) {
      // Immediately pause conversation and request human
      await pool.query(
        'UPDATE conversations SET paused = true, requested_human = true WHERE phone = $1',
        [phone]
      );
      
      await logEvent('info', `Human takeover triggered for ${phone}: "${userMessage}"`);
      
      // Send email notification if email transporter is configured
      if (emailTransporter) {
        try {
          const customerInfo = customer ? `${customer.name} (${phone})` : phone;
          await emailTransporter.sendMail({
            from: process.env.EMAIL_USER,
            to: 'universalstills@gmail.com',
            subject: `🚨 Human Takeover Required - Customer ${customerInfo}`,
            html: `
              <h2>Human Takeover Request</h2>
              <p><strong>Customer:</strong> ${customerInfo}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Trigger Message:</strong> "${userMessage}"</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <hr>
              <p>Customer has requested to stop AI responses. Please contact them directly at ${phone} or call (603) 997-6786.</p>
              <p><em>Conversation has been automatically paused.</em></p>
            `
          });
          await logEvent('info', `Human takeover email sent for ${phone}`);
        } catch (emailError) {
          await logEvent('error', `Failed to send human takeover email for ${phone}: ${emailError.message}`);
        }
      }
      
      // Return human handoff message
      return "I understand you'd prefer to speak with someone directly. I've paused our AI responses and notified our team. Please call (603) 997-6786 to speak with a real person, or someone will follow up with you soon.";
    }

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
      const customerPhone = getCustomerData(customer, 'Phone', 1);
      
      // Parse customer data into more readable format
      const rawData = customer._rawData || [];
      let orderDetails = '';
      if (rawData.length > 0) {
        orderDetails = `
Customer Details from Database:
- Name: ${rawData[2] || 'N/A'}
- Email: ${rawData[0] || 'N/A'} 
- Phone: ${rawData[1] || rawData[6] || rawData[7] || 'N/A'}
- Order Status: ${rawData[3] || rawData[4] || rawData[5] || 'N/A'}
- Product/Order Info: ${rawData.slice(8, 12).filter(x => x).join(', ') || 'N/A'}
- Additional Info: ${rawData.slice(12, 15).filter(x => x).join(', ') || 'N/A'}
- Raw Data: ${rawData.slice(0, 15).join(' | ')}`;
      }
      
      customerContext = `This is a known customer with the following information:
${orderDetails}

🚫 CRITICAL ORDER DATA RULES:
- ONLY reference order details if they are CLEARLY readable and specific in the data above
- If order status shows "N/A" or unclear data, do NOT make up order numbers, dates, or status
- Do NOT invent expedited status, specific dates, or order numbers unless explicitly clear in the data
- If data is unclear, say "Let me check your order details for you" and offer to call back
- NEVER make up timeline references like "before July 17th" or specific order numbers unless they appear clearly above

🚫 DELIVERY TRACKING RULES:
- We do NOT have real-time delivery tracking data
- NEVER provide tracking numbers - we don't have them in our system
- You CAN say general things: "has shipped", "is on the way", "in transit" when status shows shipped
- NEVER say specific timeframes: "arriving today", "out for delivery", "will arrive tomorrow"
- If order shows "Shipped", confirm it shipped and say it's on the way - that's allowed
- If asked about tracking, say "I can look that up for you" and offer to call back or provide phone (603) 997-6786`;
    }
    
    // Add current date and time context to prevent date/time confusion
    const currentDateTime = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const dateContext = `\n\n⚠️ CURRENT DATE & TIME CONTEXT ⚠️\nRight now it is: ${currentDateTime}\nAlways use this current date and time for any date/time calculations or comparisons.\nDo not reference outdated information or incorrect dates/times.\n\n⚠️ CRITICAL ERROR PREVENTION ⚠️\n- If you make a mistake, acknowledge it immediately and correct it\n- Do not make up order information if you're unsure\n- Do not repeat incorrect information - fix it right away\n- If a customer corrects you, thank them and use the correct information\n- Stay consistent with dates and order details throughout the conversation\n`;

    // Build system content using template with replacements
    let systemContent = `🚫 CRITICAL: ONLY refer to information from THIS conversation's message history below. NEVER mention details, promises, or plans that are not explicitly stated in the message history for THIS phone number. Do not confabulate or assume previous interactions.\n\n` +
      systemTemplate
      .replace('{PERSONALITY}', personalityText + dateContext)
      .replace('{KNOWLEDGE}', knowledgeContent)
      .replace('{CUSTOMER_CONTEXT}', customerContext)
      .replace('{ORDER_INFO}', '');

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
      model: ANTHROPIC_MODEL,
      max_tokens: 180,
      temperature: 0.1, // Very low temp to minimize creative/roleplay behavior
      system: systemContent,
      messages: messages
    });
    
    let aiResponse = completion.content[0].text.trim();

    // Clean up response - remove all roleplaying actions and stage directions
    aiResponse = aiResponse.replace(/\[VOICE\]/g, '');
    
    // Remove asterisk-based actions: *checks*, *pauses*, *smiles*, etc.
    aiResponse = aiResponse.replace(/\*[^*]+\*/g, '');
    
    // Remove parenthetical stage directions
    aiResponse = aiResponse.replace(/\([^)]*(?:pauses|checks|looks|smiles|grins|chuckles|laughs|nods|shrugs)[^)]*\)/gi, '');
    
    // Clean up any double spaces or weird formatting from removals
    aiResponse = aiResponse.replace(/\s{2,}/g, ' ').trim();
    
    // Remove leading/trailing spaces from each line
    aiResponse = aiResponse.split('\n').map(line => line.trim()).filter(line => line).join('\n\n');

    // Build orderInfo from customer data for validation
    let orderInfo = '';
    if (customer && customer._rawData) {
      const rawData = customer._rawData || [];
      orderInfo = `Product: ${rawData.slice(8, 12).filter(x => x).join(', ') || 'N/A'}`;
    }

    // Validate response to catch hallucinations
    aiResponse = validateAndSanitizeResponse(aiResponse, orderInfo, customer);

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
// Get recent email alerts
app.get('/api/email-alerts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT level, message, timestamp 
       FROM logs 
       WHERE message LIKE '%Customer email from%'
       ORDER BY timestamp DESC 
       LIMIT 50`
    );
    
    const emailAlerts = result.rows.map(log => {
      // Parse the log message to extract email info
      const match = log.message.match(/Customer email from (.*?) \((.*?)\): "(.*?)"/);
      if (match) {
        return {
          customer_name: match[1],
          email: match[2], 
          subject: match[3],
          timestamp: log.timestamp,
          level: log.level
        };
      }
      return {
        raw_message: log.message,
        timestamp: log.timestamp,
        level: log.level
      };
    });
    
    res.json(emailAlerts);
  } catch (err) {
    console.error("Error fetching email alerts:", err);
    res.status(500).json({ error: "Failed to fetch email alerts" });
  }
});

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

// Get action items (pending, completed, or all)
app.get('/api/action-items', async (req, res) => {
  try {
    const status = req.query.status || 'pending'; // pending, completed, all
    
    let query = `
      SELECT id, phone, customer_name, type, description, priority, status, 
             created_at, completed_at, completed_by, notes
      FROM action_items
    `;
    
    if (status !== 'all') {
      query += ` WHERE status = $1`;
    }
    
    query += ` ORDER BY 
      CASE priority 
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        ELSE 4
      END,
      created_at DESC
    `;
    
    const result = status !== 'all' 
      ? await pool.query(query, [status])
      : await pool.query(query);
    
    res.json({ actionItems: result.rows });
  } catch (err) {
    console.error('Error fetching action items:', err);
    res.status(500).json({ error: 'Failed to fetch action items' });
  }
});

// Mark action item as completed
app.post('/api/action-items/:id/complete', async (req, res) => {
  const itemId = req.params.id;
  const { notes, completedBy } = req.body;
  
  try {
    await pool.query(
      `UPDATE action_items 
       SET status = $1, completed_at = $2, completed_by = $3, notes = $4 
       WHERE id = $5`,
      ['completed', new Date(), completedBy || 'Admin', notes || '', itemId]
    );
    
    await logEvent('info', `Action item ${itemId} marked as completed`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error completing action item:', err);
    res.status(500).json({ error: 'Failed to complete action item' });
  }
});

// Delete action item
app.delete('/api/action-items/:id', async (req, res) => {
  const itemId = req.params.id;
  
  try {
    await pool.query('DELETE FROM action_items WHERE id = $1', [itemId]);
    await logEvent('info', `Action item ${itemId} deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting action item:', err);
    res.status(500).json({ error: 'Failed to delete action item' });
  }
});

// Get knowledge base entries
app.get('/api/knowledge', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, LEFT(content, 100) as snippet, source, created_at 
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

// Sync knowledge base with Shopify products, metafields, policies, and website content
app.post('/api/sync-shopify', async (req, res) => {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ACCESS_TOKEN) {
    return res.status(500).json({ error: "Shopify integration not configured" });
  }
  
  try {
    console.log('🔄 Starting enhanced Shopify sync...');
    const syncResults = await enhancedShopifySync(pool, SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN);
    
    const totalSynced = syncResults.products + syncResults.metafields + syncResults.policies + syncResults.pages;
    const message = `Enhanced Shopify sync complete: ${syncResults.products} products, ${syncResults.metafields} metafields, ${syncResults.policies} policies, ${syncResults.pages} pages synced.`;
    
    await logEvent('info', message);
    
    if (syncResults.errors.length > 0) {
      await logEvent('warning', `Sync completed with errors: ${syncResults.errors.join('; ')}`);
    }
    
    res.json({ 
      success: true, 
      totalSynced,
      details: syncResults
    });
    
  } catch (err) {
    console.error("Error in enhanced Shopify sync:", err);
    await logEvent('error', `Enhanced Shopify sync failed: ${err.message}`);
    res.status(500).json({ error: "Failed to sync Shopify data" });
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
  res.json({
    status: 'OK',
    message: 'Jonathan\'s Distillation SMS Bot is running',
    render: {
      gitCommit: process.env.RENDER_GIT_COMMIT || null,
      gitBranch: process.env.RENDER_GIT_BRANCH || null,
      serviceId: process.env.RENDER_SERVICE_ID || null,
    },
  });
});

// Debug endpoint to confirm running build on Render
app.get('/debug/version', (req, res) => {
  res.json({
    node: process.version,
    render: {
      gitCommit: process.env.RENDER_GIT_COMMIT || null,
      gitBranch: process.env.RENDER_GIT_BRANCH || null,
      serviceId: process.env.RENDER_SERVICE_ID || null,
    },
    markers: {
      sheetRowIndexUsesRowNumber: true,
      colorDetectionAvoidsBackgroundColorGetter: true,
    },
  });
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
    
    // Get just the first few rows for debug info (don't need all rows)
    const sampleRows = await customerSheet.getRows({ limit: 10, offset: 0 });
    const totalRowsEstimate = customerSheet.rowCount || 'Unknown';

    res.json({
      connected: true,
      sheetTitle: customerSheet.title,
      sheetId: GOOGLE_SHEET_ID,
      totalRows: totalRowsEstimate,
      sampleHeaders: customerSheet.headerValues,
      firstRowData: sampleRows[0] ? sampleRows[0]._rawData.slice(0, 5) : 'No data'
    });
  } catch (err) {
    res.json({ 
      error: 'Failed to read sheet', 
      message: err.message,
      sheetId: GOOGLE_SHEET_ID 
    });
  }
});

// AI Control endpoints
app.get('/api/ai-status', async (req, res) => {
  try {
    // Check if AI is enabled (default to enabled if no record exists)
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['ai_enabled']);
    const enabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
    res.json({ enabled });
  } catch (err) {
    console.error('Error getting AI status:', err);
    res.json({ enabled: true }); // Default to enabled on error
  }
});

app.post('/api/ai-toggle', async (req, res) => {
  try {
    // Get current status
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['ai_enabled']);
    const currentEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
    const newEnabled = !currentEnabled;
    
    // Update or insert the setting
    if (result.rows.length > 0) {
      await pool.query('UPDATE system_settings SET value = $1 WHERE key = $2', [newEnabled.toString(), 'ai_enabled']);
    } else {
      await pool.query('INSERT INTO system_settings (key, value) VALUES ($1, $2)', ['ai_enabled', newEnabled.toString()]);
    }
    
    await logEvent('info', `AI ${newEnabled ? 'enabled' : 'disabled'} by admin`);
    res.json({ enabled: newEnabled });
  } catch (err) {
    console.error('Error toggling AI:', err);
    res.status(500).json({ error: 'Failed to toggle AI' });
  }
});

// Respond-to-all Control endpoints
app.get('/api/respond-all-status', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['respond_to_all']);
    const enabled = result.rows.length > 0 ? result.rows[0].value === 'true' : false;
    res.json({ enabled });
  } catch (err) {
    console.error('Error getting respond-to-all status:', err);
    res.json({ enabled: false }); // Default to sheets-only on error
  }
});

app.post('/api/respond-all-toggle', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings WHERE key = $1', ['respond_to_all']);
    const currentEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : false;
    const newEnabled = !currentEnabled;

    // Update or insert the setting
    if (result.rows.length > 0) {
      await pool.query('UPDATE system_settings SET value = $1 WHERE key = $2', [newEnabled.toString(), 'respond_to_all']);
    } else {
      await pool.query('INSERT INTO system_settings (key, value) VALUES ($1, $2)', ['respond_to_all', newEnabled.toString()]);
    }

    await logEvent('info', `Respond-to-all mode ${newEnabled ? 'enabled (responding to all messages as Jonathan)' : 'disabled (sheets-only mode)'} by admin`);
    res.json({ enabled: newEnabled });
  } catch (err) {
    console.error('Error toggling respond-to-all:', err);
    res.status(500).json({ error: 'Failed to toggle respond-to-all mode' });
  }
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  console.error('Stack:', err.stack);
  // Don't exit - log and continue to prevent total server crash
  logEvent('error', `Uncaught exception: ${err.message}`).catch(console.error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit - log and continue to prevent total server crash
  logEvent('error', `Unhandled rejection: ${reason}`).catch(console.error);
});

// Start server after initializing database
initDatabase().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log(`✅ SMS bot server listening on port ${PORT}`);
    console.log(`🥃 Jonathan's Distillation Bot server is ready!`);

    // Start email monitoring if email transporter is configured
    if (emailTransporter) {
      console.log('📧 Starting email monitor...');
      const emailMonitor = new EmailMonitor();
      emailMonitor.start();

      // Graceful shutdown
      process.on('SIGTERM', () => {
        console.log('📧 Stopping email monitor...');
        emailMonitor.stop();

        // Close database connections gracefully
        pool.end().catch(err => console.error('Error closing pool:', err));
        if (redisClient) {
          redisClient.quit().catch(err => console.error('Error closing Redis:', err));
        }
      });
    }
  });

  // Handle server errors
  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    logEvent('error', `Server error: ${err.message}`).catch(console.error);
  });

}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
