const express = require('express');
const cors = require('cors');
const session = require('express-session');
const crypto = require('crypto');
const cron = require('node-cron');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const ShopifyService = require('./shopify-service');
const EnhancedSheetsService = require('./enhanced-sheets-service');
const logger = require('./logger');
const EnhancedRateLimiter = require('./enhanced-rate-limiter');
// Use PostgreSQL knowledge retriever on Render, file-based locally
const KnowledgeRetrieverPostgres = require('./knowledge-retriever-postgres');
const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const BatchProcessor = require('./batch-processor');
const MultiTierCache = require('./multi-tier-cache');
const ContextualIntentRouter = require('./intent-router');
const ConversationGraph = require('./conversation-graph');
const HybridVectorRetriever = require('./hybrid-vector-retriever');
const EnterpriseMonitoring = require('./enterprise-monitoring');

// Use PostgreSQL storage only
const EnterpriseChatStorage = require('./enterprise-chat-storage-postgres');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Authentication configuration
let ADMIN_PIN = process.env.ADMIN_PIN || '1234'; // Default PIN, can be overridden from admin.json
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// Session middleware
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    logger.request(req, res, responseTime);
    originalEnd.apply(this, args);
  };
  
  next();
});

// Serve static files without authentication
app.use(express.static('.', {
  index: false // Disable directory indexing for security
}));

// File upload configuration
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Ensure uploads directory exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Ensure data directory exists
const dataDir = 'data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// File paths for persistent storage
const KNOWLEDGE_FILE = path.join(dataDir, 'knowledge.json');
const PERSONALITY_FILE = path.join(dataDir, 'personality.json');
const ADMIN_FILE = path.join(dataDir, 'admin.json');

// File system utilities for persistent storage
function saveKnowledgeToFile() {
  try {
    fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledgeHistory, null, 2));
    console.log('Knowledge saved to file');
  } catch (error) {
    console.error('Error saving knowledge:', error);
  }
}

function loadKnowledgeFromFile() {
  try {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      const data = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
      const loadedHistory = JSON.parse(data);
      knowledgeHistory = loadedHistory;
      knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
      console.log(`Loaded ${knowledgeHistory.length} knowledge entries from file`);
    }
  } catch (error) {
    console.error('Error loading knowledge:', error);
    knowledgeHistory = [];
    knowledgeBase = '';
  }
}

function savePersonalityToFile() {
  try {
    const personalityData = {
      text: personalityText,
      source: personalityText ? 'uploaded' : 'default',
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(PERSONALITY_FILE, JSON.stringify(personalityData, null, 2));
    console.log('Personality saved to file');
  } catch (error) {
    console.error('Error saving personality:', error);
  }
}

function loadPersonalityFromFile() {
  try {
    if (fs.existsSync(PERSONALITY_FILE)) {
      const data = fs.readFileSync(PERSONALITY_FILE, 'utf8');
      const personalityData = JSON.parse(data);
      personalityText = personalityData.text || '';
      console.log('Loaded personality from file');
    }
  } catch (error) {
    console.error('Error loading personality:', error);
    personalityText = '';
  }
}

// PIN management functions
function savePinToFile() {
  try {
    const adminData = {
      pin: ADMIN_PIN,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminData, null, 2));
    console.log('Admin PIN saved to file');
  } catch (error) {
    console.error('Error saving admin PIN:', error);
  }
}

function loadPinFromFile() {
  try {
    if (fs.existsSync(ADMIN_FILE)) {
      const data = fs.readFileSync(ADMIN_FILE, 'utf8');
      const adminData = JSON.parse(data);
      ADMIN_PIN = adminData.pin || ADMIN_PIN;
      console.log('Loaded admin PIN from file');
    }
  } catch (error) {
    console.error('Error loading admin PIN:', error);
  }
}

// Authentication removed - all endpoints are now public

// Generate session token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Authentication routes
app.post('/admin/login', (req, res) => {
  const { pin } = req.body;
  
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }
  
  if (pin === ADMIN_PIN) {
    req.session.authenticated = true;
    req.session.loginTime = new Date().toISOString();
    const token = generateToken();
    req.session.token = token;
    
    logger.success('Admin login successful', { 
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      loginTime: req.session.loginTime
    });
    
    res.json({
      success: true,
      message: 'Login successful',
      token: token
    });
  } else {
    logger.warn('Failed admin login attempt', {
      attemptedPin: pin.substring(0, 2) + '***', // Log partial PIN for security
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });
    res.status(401).json({
      success: false,
      message: 'Invalid PIN'
    });
  }
});

app.get('/admin/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer token
  
  if (req.session && req.session.authenticated && req.session.token === token) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

app.post('/admin/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Could not log out' });
      }
      res.json({ message: 'Logout successful' });
    });
  } else {
    res.json({ message: 'No active session' });
  }
});

// PIN management routes
app.get('/admin/pin', (req, res) => {
  res.json({
    hasCustomPin: fs.existsSync(ADMIN_FILE),
    lastUpdated: fs.existsSync(ADMIN_FILE) ? 
      JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).updatedAt : null
  });
});

app.post('/admin/pin', (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    
    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'Current PIN and new PIN are required' });
    }
    
    if (currentPin !== ADMIN_PIN) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }
    
    if (newPin.length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 characters long' });
    }
    
    // Update PIN
    ADMIN_PIN = newPin;
    savePinToFile();
    
    console.log(`Admin PIN changed at ${new Date().toISOString()}`);
    
    res.json({
      message: 'PIN updated successfully',
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('PIN change error:', error);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// SHOPIFY INTEGRATION ENDPOINTS

// Get Shopify sync status
app.get('/admin/shopify/status', (req, res) => {
  const status = shopifyService.getSyncStatus();
  res.json(status);
});

// Enhanced Shopify sync endpoint using automated function
app.post('/admin/shopify/sync', async (req, res) => {
  try {
    if (!shopifyService.enabled) {
      return res.status(400).json({ error: 'Shopify integration not configured' });
    }

    logger.info('Manual Shopify sync triggered via admin dashboard');
    
    // Use the enhanced sync function with retry logic
    const result = await performAutomaticShopifySync('manual');
    
    if (result.success) {
      res.json({
        message: 'Shopify sync completed successfully',
        data: result.data,
        syncedAt: new Date().toISOString()
      });
    } else if (result.retrying) {
      res.status(202).json({
        message: 'Shopify sync failed but retrying...',
        error: result.error,
        nextAttemptIn: result.nextAttemptIn
      });
    } else {
      res.status(500).json({
        error: 'Shopify sync failed after all retries',
        details: result.error
      });
    }
    
  } catch (error) {
    logger.error('Manual Shopify sync endpoint error', { error: error.message });
    res.status(500).json({ 
      error: 'Failed to initiate Shopify sync', 
      details: error.message 
    });
  }
});

// Get order status (for customer inquiries)
app.post('/admin/shopify/order', async (req, res) => {
  try {
    const { orderNumber } = req.body;
    
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }
    
    const order = await shopifyService.getOrderByNumber(orderNumber);
    
    if (!order) {
      return res.json({ found: false, message: 'Order not found' });
    }
    
    res.json({ 
      found: true, 
      order: order 
    });
    
  } catch (error) {
    console.error('Order lookup error:', error);
    res.status(500).json({ error: 'Failed to look up order' });
  }
});

// ENHANCED GOOGLE SHEETS ENDPOINTS

// Get sheets info with formatting capabilities
app.get('/admin/sheets/info', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }

    const sheetsInfo = await enhancedSheetsService.getSheetsInfo();
    res.json(sheetsInfo);

  } catch (error) {
    console.error('Sheets info error:', error);
    res.status(500).json({ error: 'Failed to get sheets information' });
  }
});

// Get sheet data with formatting
app.get('/admin/sheets/formatting/:sheetName?', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }

    const sheetName = req.params.sheetName || null;
    const sheetData = await enhancedSheetsService.getSheetWithFormatting(sheetName);
    const summary = enhancedSheetsService.generateFormattingSummary(sheetData);

    res.json({
      sheetData: sheetData,
      formattingSummary: summary,
      status: 'success'
    });

  } catch (error) {
    console.error('Sheet formatting error:', error);
    res.status(500).json({ 
      error: 'Failed to get sheet formatting', 
      details: error.message 
    });
  }
});

// Get formatting summary only (lighter response)
app.get('/admin/sheets/summary/:sheetName?', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }

    const sheetName = req.params.sheetName || null;
    const sheetData = await enhancedSheetsService.getSheetWithFormatting(sheetName);
    const summary = enhancedSheetsService.generateFormattingSummary(sheetData);

    res.json(summary);

  } catch (error) {
    console.error('Sheet summary error:', error);
    res.status(500).json({ 
      error: 'Failed to get sheet summary', 
      details: error.message 
    });
  }
});

// Get enhanced sheets service status
app.get('/admin/sheets/status', (req, res) => {
  const status = enhancedSheetsService.getStatus();
  res.json(status);
});

// Get sheet data with order status interpretation
app.get('/admin/sheets/orders/:sheetName?', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }
    const sheetName = req.params.sheetName || null;
    const sheetData = await enhancedSheetsService.getSheetWithOrderStatus(sheetName);
    const statusSummary = enhancedSheetsService.generateStatusSummary(sheetData);
    res.json({
      sheetData: sheetData,
      statusSummary: statusSummary,
      status: 'success'
    });
  } catch (error) {
    console.error('Sheet orders error:', error);
    res.status(500).json({ 
      error: 'Failed to get sheet order status data', 
      details: error.message 
    });
  }
});

// Get order status summary only
app.get('/admin/sheets/status-summary/:sheetName?', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }
    const sheetName = req.params.sheetName || null;
    const sheetData = await enhancedSheetsService.getSheetWithOrderStatus(sheetName);
    const statusSummary = enhancedSheetsService.generateStatusSummary(sheetData);
    res.json(statusSummary);
  } catch (error) {
    console.error('Status summary error:', error);
    res.status(500).json({ 
      error: 'Failed to get status summary', 
      details: error.message 
    });
  }
});

// Find customer order status by phone number
app.post('/admin/sheets/customer-status', async (req, res) => {
  try {
    if (!enhancedSheetsService.enabled) {
      return res.status(400).json({ error: 'Enhanced Google Sheets service not configured' });
    }
    const { phoneNumber, sheetName } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    
    const sheetData = await enhancedSheetsService.getSheetWithOrderStatus(sheetName || null);
    const customerStatus = enhancedSheetsService.findCustomerStatus(sheetData, phoneNumber);
    
    res.json({
      phoneNumber: phoneNumber,
      customerStatus: customerStatus,
      found: !!customerStatus,
      status: 'success'
    });
  } catch (error) {
    console.error('Customer status error:', error);
    res.status(500).json({ 
      error: 'Failed to find customer status', 
      details: error.message 
    });
  }
});

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Test Claude API on startup
async function testClaudeAPI() {
  try {
    console.log('Testing Claude API connection...');
    const testResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say hello' }]
    });
    console.log('✅ Claude API connected successfully:', testResponse.content[0].text);
  } catch (error) {
    console.error('❌ Claude API test failed:', error.message);
    if (error.status) console.error('Status:', error.status);
    if (error.error) console.error('Error details:', error.error);
  }
}

// Initialize services
const shopifyService = new ShopifyService();
const enhancedSheetsService = new EnhancedSheetsService();
const claudeRateLimiter = new EnhancedRateLimiter();
// Initialize knowledge retriever based on environment
const knowledgeRetriever = process.env.DATABASE_URL ? 
    new KnowledgeRetrieverPostgres() : 
    new AdvancedKnowledgeRetriever();
const batchProcessor = new BatchProcessor(anthropic);

// Enhanced components
const multiTierCache = new MultiTierCache();
const intentRouter = new ContextualIntentRouter();
const conversationGraph = new ConversationGraph();
const hybridVectorRetriever = new HybridVectorRetriever();

// Enterprise chat storage
const enterpriseChatStorage = new EnterpriseChatStorage({
    maxActiveConversations: parseInt(process.env.MAX_ACTIVE_CONVERSATIONS) || 1000,
    maxMessagesPerCustomer: parseInt(process.env.MAX_MESSAGES_PER_CUSTOMER) || 50,
    archiveAfterDays: parseInt(process.env.ARCHIVE_AFTER_DAYS) || 30,
    compressionEnabled: process.env.COMPRESSION_ENABLED === 'true'
});

// Enterprise monitoring
const enterpriseMonitoring = new EnterpriseMonitoring({
    serviceName: 'distillation-sms-bot',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    elasticsearch: {
        enabled: process.env.ELASTIC_ENABLED === 'true',
        host: process.env.ELASTIC_HOST || 'localhost:9200',
        auth: {
            username: process.env.ELASTIC_USER,
            password: process.env.ELASTIC_PASSWORD
        }
    },
    prometheus: {
        enabled: process.env.PROMETHEUS_ENABLED === 'true',
        gateway: process.env.PROMETHEUS_GATEWAY || 'localhost:9091'
    },
    datadog: {
        enabled: process.env.DATADOG_ENABLED === 'true',
        apiKey: process.env.DATADOG_API_KEY
    },
    webhooks: process.env.MONITORING_WEBHOOKS ? JSON.parse(process.env.MONITORING_WEBHOOKS) : []
});

// Google Sheets setup
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

async function initializeGoogleSheets() {
  try {
    const creds = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    
    console.log('🔐 Authenticating with Google Sheets...');
    
    // Add timeout to Google Sheets initialization
    await Promise.race([
      (async () => {
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Google Sheets initialization timeout after 10 seconds')), 10000)
      )
    ]);
    
    console.log('✅ Google Sheets connected successfully');
    console.log('📊 Sheet title:', doc.title);
    console.log('📋 Sheet ID:', process.env.GOOGLE_SHEET_ID);
    
  } catch (error) {
    console.error('❌ Failed to connect to Google Sheets:', error.message);
    console.log('🔍 Troubleshooting checklist:');
    console.log('  1. Sheet shared with:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('  2. Service account key valid?');
    console.log('  3. Sheet ID correct?', process.env.GOOGLE_SHEET_ID);
    
    // Don't throw - allow service to start without sheets
    console.log('⚠️  Service will continue without Google Sheets integration');
  }
}

// Add customer cache to avoid repeated Google Sheets calls
const customerCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to normalize phone numbers
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  
  let phoneStr = phone.toString();
  
  // Convert scientific notation to regular number if needed
  if (phoneStr.includes('E+')) {
    phoneStr = Number(phone).toString();
  }
  
  // Remove all non-digit characters
  const digitsOnly = phoneStr.replace(/\D/g, '');
  
  // If it starts with 1 and has 11 digits, remove the leading 1
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1);
  }
  
  return digitsOnly;
}

// Helper function to find customer by phone
async function findCustomerByPhone(phone) {
  const normalizedInputPhone = normalizePhoneNumber(phone);
  const cacheKey = `customer_${normalizedInputPhone}`;
  
  // Check cache first
  const cached = customerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`📋 Cache hit for phone: ${phone}`);
    return cached.customer;
  }
  
  try {
    const sheet = doc.sheetsByIndex[0]; // Use first sheet
    
    // Add 3-second timeout to Google Sheets API call for faster debugging
    console.log(`🔍 Fetching customer data from Google Sheets for: ${phone}`);
    const startTime = Date.now();
    
    const rows = await Promise.race([
      sheet.getRows(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Google Sheets timeout after 3 seconds')), 3000)
      )
    ]);
    
    console.log(`📊 Google Sheets fetch completed in ${Date.now() - startTime}ms (${rows.length} rows)`);
    
    // Normalize the input phone number
    
    console.log(`🔍 Looking for phone: ${phone} -> normalized: ${normalizedInputPhone}`);
    
    // Log first row to understand structure (only once)
    if (rows.length > 0) {
      console.log('📋 Sheet structure - Headers:', Object.keys(rows[0]));
      console.log('📋 First row data:', rows[0]._rawData);
    }
    
    // Search through all rows
    const foundCustomer = rows.find((row, index) => {
      // Check multiple possible phone columns (6 is expected, but let's be flexible)
      const possiblePhoneColumns = [6, 5, 7, 4]; // Common phone column positions
      
      for (const colIndex of possiblePhoneColumns) {
        const phoneField = row._rawData[colIndex];
        
        if (!phoneField) continue;
        
        const normalizedRowPhone = normalizePhoneNumber(phoneField);
        
        // Debug log for the expected column (6)
        if (colIndex === 6) {
          console.log(`Row ${index}, Col ${colIndex}: "${phoneField}" -> "${normalizedRowPhone}"`);
        }
        
        // Check for exact match
        if (normalizedRowPhone === normalizedInputPhone) {
          console.log(`✅ EXACT MATCH found at Row ${index}, Column ${colIndex}!`);
          return true;
        }
        
        // Check for partial matches (in case of formatting differences)
        if (normalizedRowPhone.length >= 10 && normalizedInputPhone.length >= 10) {
          const rowLast10 = normalizedRowPhone.slice(-10);
          const inputLast10 = normalizedInputPhone.slice(-10);
          
          if (rowLast10 === inputLast10) {
            console.log(`✅ PARTIAL MATCH found at Row ${index}, Column ${colIndex}! (last 10 digits)`);
            return true;
          }
        }
      }
      
      return false;
    });
    
    if (foundCustomer) {
      console.log('🎉 Customer found!', foundCustomer._rawData);
    } else {
      console.log('❌ Customer not found in any column');
      // Show all phone numbers in the sheet for debugging
      console.log('📱 All phone numbers in sheet (Column 6):');
      rows.slice(0, 10).forEach((row, index) => { // Show first 10 rows
        const phoneField = row._rawData[6];
        if (phoneField) {
          console.log(`  Row ${index}: "${phoneField}" -> "${normalizePhoneNumber(phoneField)}"`);
        }
      });
    }
    
    // Cache the result (both found and not found)
    customerCache.set(cacheKey, {
      customer: foundCustomer,
      timestamp: Date.now()
    });
    
    return foundCustomer;
    
  } catch (error) {
    console.error('Error finding customer (Google Sheets API):', error.message);
    
    // Cache null result for 1 minute to avoid repeated failures
    customerCache.set(cacheKey, {
      customer: null,
      timestamp: Date.now()
    });
    
    return null;
  }
}

// Main SMS reply endpoint
app.post('/reply', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { phone, message, sender } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    logger.info(`SMS received from ${phone}`, { 
      phone,
      message: message.substring(0, 100) + (message.length > 100 ? '...' : ''), // Truncate long messages
      sender 
    });

    // Track SMS received
    enterpriseMonitoring.trackSMS('received', { phone, messageLength: message.length, sender });

    // FIRST: Check if customer exists in database - BLOCK unknown numbers
    // Add 5-second timeout to customer lookup to prevent hanging
    console.log(`🔍 Looking up customer: ${phone}`);
    const customerLookupStart = Date.now();
    
    const customer = await Promise.race([
      findCustomerByPhone(phone),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Customer lookup timeout after 5 seconds')), 5000)
      )
    ]).catch(error => {
      console.log(`❌ Customer lookup failed: ${error.message} (${Date.now() - customerLookupStart}ms)`);
      return null;
    });
    
    console.log(`📊 Customer lookup completed in ${Date.now() - customerLookupStart}ms`);
    if (!customer) {
      logger.info('SMS ignored - phone number not found in customer database', { phone });
      enterpriseMonitoring.info('SMS ignored - unknown customer', { phone, reason: 'not_in_database' });
      
      // Do NOT respond to unknown numbers - just log and ignore
      return res.json({ 
        message: 'Phone number not in customer database - no response sent',
        customerFound: false,
        ignored: true
      });
    }

    // ENHANCED FEATURE 1: Intent Routing (bypass AI for simple queries) - ONLY for verified customers
    console.log('🔍 Checking intent routing...');
    const intentResponse = await Promise.race([
      intentRouter.routeQuery(message, phone),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Intent router timeout')), 2000)
      )
    ]).catch(error => {
      console.log(`⚠️ Intent router failed: ${error.message}`);
      return null;
    });
    
    if (intentResponse) {
      logger.info('Intent routing provided response', { phone, intent: 'detected' });
      enterpriseMonitoring.trackCacheOperation('intent_router', true);
      
      // Store in conversation graph (with timeout)
      Promise.race([
        conversationGraph.addConversationNode(phone, message, [], intentResponse, {
          provider: 'intent_router',
          processingTime: Date.now() - startTime,
          cacheHit: true
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Conversation graph timeout')), 2000)
        )
      ]).catch(error => {
        console.log(`⚠️ Conversation graph storage failed: ${error.message}`);
      });
      
      // Track successful SMS response
      enterpriseMonitoring.trackSMS('responded', { phone, provider: 'intent_router', responseTime: Date.now() - startTime });
      
      return res.json({ response: intentResponse });
    }

    // ENHANCED FEATURE 2: Multi-tier cache check
    console.log('🔍 Checking multi-tier cache...');
    const cacheKey = `${phone}:${message}`;
    const cachedResponse = await Promise.race([
      multiTierCache.get(cacheKey, 'conversation'),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Cache timeout')), 3000)
      )
    ]).catch(error => {
      console.log(`⚠️ Cache check failed: ${error.message}`);
      return null;
    });
    
    if (cachedResponse) {
      logger.info('Cache hit - serving cached response', { phone });
      enterpriseMonitoring.trackCacheOperation('multi_tier_cache', true);
      enterpriseMonitoring.trackSMS('responded', { phone, provider: 'cache', responseTime: Date.now() - startTime });
      return res.json({ response: cachedResponse });
    }
    
    enterpriseMonitoring.trackCacheOperation('multi_tier_cache', false);
    
    // Try enterprise storage first, fallback to local if needed
    console.log('🔍 Getting conversation history...');
    let conversationHistory = [];
    try {
      conversationHistory = await Promise.race([
        enterpriseChatStorage.getConversationHistory(phone, 5),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Enterprise storage timeout')), 12000)
        )
      ]);
      console.log(`📚 Retrieved ${conversationHistory.length} messages from enterprise storage`);
      if (conversationHistory.length > 0) {
        console.log(`📋 Sample conversation:`, conversationHistory[0]);
      }
    } catch (error) {
      console.log(`⚠️  Enterprise storage retrieval failed, using local: ${error.message}`);
      conversationHistory = getConversationHistory(phone, 5); // Fallback to local storage
    }
    
    // Use the existing processIncomingSMS function for message processing
    const result = await processIncomingSMS(phone, message, 'twilio');
    
    // Respond with the processed message
    res.json({
      reply: result.message,
      customerFound: !!customer,
      customerInfo: result.customerInfo,
      context: result.context
    });

  } catch (error) {
    logger.error('Error processing SMS reply request', {
      phone: req.body.phone,
      error: error.message
    });
    
    res.status(500).json({ 
      error: 'Internal server error',
      reply: 'Sorry, I\'m having trouble processing your request right now. Please try again later.',
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  // Redirect to appropriate page based on authentication
  if (req.session && req.session.authenticated) {
    res.redirect('/management.html');
  } else {
    res.redirect('/login.html');
  }
});

// Explicit route for management dashboard
// management.html now served via static files

// Explicit route for upload page
app.get('/upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Jonathan\'s Distillation SMS Bot is running' });
});

// Chat endpoint removed

// Handle GET requests to Tasker endpoint (provide helpful info)
app.get('/tasker/sms', (req, res) => {
  logger.warn('GET request to /tasker/sms endpoint', { 
    userAgent: req.get('User-Agent'),
    ip: req.ip 
  });
  
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'This endpoint only accepts POST requests',
    documentation: 'See TASKER_INTEGRATION_GUIDE.md for proper usage',
    example: {
      method: 'POST',
      url: '/tasker/sms',
      headers: { 'Content-Type': 'application/json' },
      body: {
        phone: '+15551234567',
        message: 'Your SMS message here',
        sender_name: 'Optional sender name'
      }
    }
  });
});

// Simple test endpoint for Tasker SMS integration
app.post('/tasker/test', async (req, res) => {
  const { phone, message } = req.body;
  
  if (!phone || !message) {
    return res.status(400).json({ 
      error: 'Phone and message are required',
      required: ['phone', 'message']
    });
  }
  
  // Simple test response
  const testResponse = `Hello! I received your message: "${message}". This is a test response from your SMS bot. The advanced AI processing is being worked on.`;
  
  res.json({
    success: true,
    response: testResponse,
    customer: null,
    conversation_context: 'Test mode',
    processing_time: 10,
    timestamp: new Date().toISOString()
  });
});

// Tasker integration endpoint for SMS forwarding
app.post('/tasker/sms', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { phone, message, sender_name } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ 
        error: 'Phone and message are required',
        required: ['phone', 'message'],
        optional: ['sender_name']
      });
    }
    
    logger.info('Tasker SMS received', { 
      phone: phone.substring(0, 6) + '***',
      messageLength: message.length,
      sender_name: sender_name || 'Unknown'
    });
    
    // Use the existing SMS processing logic with extra error handling
    const response = await processIncomingSMS(phone, message, 'tasker');
    
    // Check if processIncomingSMS returned an error
    if (!response.success) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ processIncomingSMS failed for ${phone}: ${response.error || 'Unknown error'}`);
      
      return res.status(500).json({
        success: false,
        error: 'Failed to process SMS', 
        message: response.message || 'Sorry, I\'m having trouble right now. Please try again in a moment.',
        processing_time: processingTime,
        details: response.errorDetails || 'Internal processing error',
        debug_info: {
          has_customer: !!response.customerInfo,
          provider: response.provider || 'unknown',
          context: response.context || 'unknown',
          step_failed: response.error || 'unknown step'
        }
      });
    }
    
    const processingTime = Date.now() - startTime;
    
    // Return structured response for Tasker
    res.json({
      success: true,
      response: response.message,
      customer: response.customerInfo,
      conversation_context: response.context || 'New conversation',
      processing_time: processingTime,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Tasker SMS processing failed', { 
      error: error.message,
      processing_time: processingTime
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to process SMS',
      message: 'Sorry, I\'m having trouble right now. Please try again in a moment.',
      processing_time: processingTime
    });
  }
});

// Helper function to process SMS (reused from /reply endpoint)
async function processIncomingSMS(phone, message, source = 'twilio') {
  console.log(`🚀 Starting processIncomingSMS for phone: ${phone}, message: "${message.substring(0, 50)}..."`);
  
  let customerInfo = null;
  let conversationHistory = [];
  let combinedKnowledge = '';
  
  try {
    console.log(`🔍 Step 1: Customer lookup starting for ${phone}`);
    
    // Temporary bypass for problematic customer to test if issue is in lookup
    if (phone === '9786778131' || phone === '+19786778131') {
      console.log(`🔧 TEMPORARILY BYPASSING CUSTOMER LOOKUP FOR 9786778131`);
      customerInfo = null; // Skip lookup to test if that's the issue
    } else {
      // Customer lookup with reduced timeout for faster fallback
      customerInfo = await Promise.race([
        findCustomerByPhone(phone),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Customer lookup timeout')), 5000)
        )
      ]);
    }
    
    // Special debugging for the problematic customer
    if (phone === '9786778131' || phone === '+19786778131') {
      console.log(`🐛 DEBUGGING CUSTOMER 9786778131:`, {
        customerFound: !!customerInfo,
        hasRawData: !!customerInfo?._rawData,
        rawDataType: typeof customerInfo?._rawData,
        rawDataLength: customerInfo?._rawData?.length,
        rawDataSample: customerInfo?._rawData?.slice(0, 5), // First 5 columns
        customerStructure: Object.keys(customerInfo || {})
      });
    }
    
    // Validate customer data structure to catch corrupted records
    if (customerInfo && (!customerInfo._rawData || !Array.isArray(customerInfo._rawData))) {
      console.log(`⚠️ Customer data validation failed - corrupted record for ${phone}`);
      if (phone === '9786778131' || phone === '+19786778131') {
        console.log(`🐛 CORRUPTED DATA DETAILS:`, customerInfo);
      }
      // Don't null out the customer - let it continue and see what breaks
      // customerInfo = null; 
    }
    
    console.log(`📞 Step 1 Complete: Customer lookup result for ${phone}:`, {
      found: !!customerInfo,
      hasRawData: !!customerInfo?._rawData,
      rawDataLength: customerInfo?._rawData?.length || 0,
      customerName: customerInfo?._rawData?.[2] || 'N/A',
      orderId: customerInfo?._rawData?.[0] || 'N/A'
    });
  } catch (error) {
    console.log(`⚠️ Step 1 Failed: Customer lookup failed for ${phone}: ${error.message}`);
    // Continue processing as unknown customer rather than failing completely
    customerInfo = null;
  }
  
  try {
    console.log(`🔍 Step 2: Conversation history lookup starting for ${phone}`);
    // Get conversation history with timeout
    conversationHistory = await Promise.race([
      enterpriseChatStorage.getConversationHistory(phone, 5),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Enterprise storage timeout')), 12000)
      )
    ]);
    console.log(`📚 Step 2 Complete: Retrieved ${conversationHistory.length} messages from enterprise storage`);
  } catch (error) {
    console.log(`⚠️ Step 2 Failed: Enterprise storage retrieval failed, using local: ${error.message}`);
    conversationHistory = getConversationHistory(phone, 5);
  }
  
  try {
    console.log(`🔍 Step 3: Knowledge retrieval starting for message: "${message.substring(0, 30)}..."`);
    // Get knowledge base context with timeout
    combinedKnowledge = await Promise.race([
      knowledgeRetriever.getRelevantKnowledge(message, 3),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Knowledge retrieval timeout')), 5000)
      )
    ]);
    console.log(`📚 Step 3 Complete: Knowledge retrieved, length: ${combinedKnowledge.length} chars`);
  } catch (error) {
    console.log(`⚠️ Step 3 Failed: Knowledge retrieval failed: ${error.message}`);
    combinedKnowledge = 'Basic product information available on request.';
  }
  
  // Format conversation history
  let historyContext = '';
  if (conversationHistory.length > 0) {
    console.log(`🔄 Building conversation context from ${conversationHistory.length} messages`);
    historyContext = '\n\nPREVIOUS CONVERSATION:\n';
    conversationHistory.forEach((msg, i) => {
      historyContext += `[${new Date(msg.timestamp).toLocaleString()}]\n`;
      historyContext += `Customer: ${msg.customerMessage}\n`;
      historyContext += `You: ${msg.botResponse}\n\n`;
    });
    historyContext += 'CURRENT MESSAGE:\n';
    console.log(`📝 History context length: ${historyContext.length} characters`);
  } else {
    console.log(`📭 No conversation history found for phone: ${phone}`);
  }
  
  // Generate AI response using Anthropic Claude
  try {
    console.log(`🔍 Step 4: AI response generation starting`);
    
    // Sanitize customer data to prevent prompt injection or formatting issues
    const sanitizeText = (text) => {
      if (!text || typeof text !== 'string') return 'Unknown';
      return text
        .replace(/[\r\n\t]/g, ' ')  // Replace newlines and tabs with spaces
        .replace(/[^\x20-\x7E]/g, '') // Remove non-printable ASCII characters  
        .substring(0, 100) // Limit length to prevent extremely long fields
        .trim();
    };
    
    const customerName = customerInfo?._rawData?.[2] ? sanitizeText(customerInfo._rawData[2]) : 'Unknown';
    const orderId = customerInfo?._rawData?.[0] ? sanitizeText(customerInfo._rawData[0]) : 'No Order';
    
    const prompt = `You are Jonathan, owner of a moonshine distillation equipment business. You are knowledgeable, friendly, and casual in your communication style.

CUSTOMER INFO: ${customerInfo ? `${customerName} (${orderId})` : 'Unknown customer'}
CONVERSATION HISTORY: ${historyContext}
KNOWLEDGE BASE: ${combinedKnowledge}

Customer message: "${message}"

Respond in a conversational, helpful manner. Keep responses concise and SMS-friendly. If you need clarification, ask specific questions.`;

    console.log(`📝 Prompt length: ${prompt.length} chars. Customer info: ${customerInfo ? 'Found' : 'Not found'}`);
    
    // Special debugging for the problematic customer
    if (phone === '9786778131' || phone === '+19786778131') {
      console.log(`🐛 DEBUGGING PROMPT FOR 9786778131:`, prompt.substring(0, 500) + '...');
    }
    
    const claudeResponse = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    });

    const reply = claudeResponse.content[0].text;
    console.log(`🎯 Step 4 Complete: AI response generated, length: ${reply.length} chars`);
    
    // Special debugging for the problematic customer
    if (phone === '9786778131' || phone === '+19786778131') {
      console.log(`🐛 AI RESPONSE FOR 9786778131:`, reply.substring(0, 200) + '...');
    }

    // Store the conversation
    try {
      console.log(`🔍 Step 5: Message storage starting`);
      await enterpriseChatStorage.storeMessage(phone, message, reply, {
        customerName: customerName, // Use sanitized version
        orderId: orderId, // Use sanitized version  
        provider: 'claude',
        source: source
      });
      console.log(`💾 Step 5 Complete: Message stored successfully`);
    } catch (storageError) {
      console.log(`⚠️ Step 5 Failed: Storage failed: ${storageError.message}`);
    }

    return {
      message: reply,
      customerInfo: customerInfo,
      provider: 'claude',
      success: true,
      context: 'AI processed'
    };

  } catch (error) {
    console.error(`❌ AI processing failed: ${error.message}`);
    console.error(`❌ Error details:`, error);
    return {
      message: "I apologize, but I'm experiencing technical difficulties right now. Please call us at (603) 997-6786 for immediate assistance with your distillation equipment questions!",
      customerInfo: customerInfo,
      provider: 'fallback',
      success: false,
      error: error.message,
      errorDetails: process.env.NODE_ENV === 'development' ? error.stack : error.message,
      context: 'Error fallback'
    };
  }
  
}

// Enhanced system stats endpoint
app.get('/stats', async (req, res) => {
  try {
    const stats = {
      cache: multiTierCache.getHitRatio(),
      conversationGraph: await conversationGraph.getGraphStats(),
      intentRouter: intentRouter.getBypassStats(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get customer info endpoint (for testing)
app.get('/customer/:phone', async (req, res) => {
  try {
    const customer = await findCustomerByPhone(req.params.phone);
    
    // Debug logging
    console.log('Looking for phone:', req.params.phone);
    
    if (customer) {
      console.log('Found customer:', customer._rawData);
      res.json({ 
        found: true, 
        customer: customer._rawData,
        customerInfo: {
          name: customer._rawData[2],
          orderId: customer._rawData[0],
          product: customer._rawData[1],
          phone: customer._rawData[6],
          email: customer._rawData[5]
        }
      });
    } else {
      console.log('Customer not found');
      res.json({ found: false, message: 'Customer not found' });
    }
  } catch (error) {
    console.error('Customer lookup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Knowledge base and personality storage
let knowledgeBase = '';
let knowledgeHistory = []; // Track uploaded files
let personalityText = '';

// Load existing data on startup
loadKnowledgeFromFile();
loadPersonalityFromFile();
loadPinFromFile();

// Chat logging system
const chatLogFile = path.join(__dirname, 'chat_logs.json');
let chatHistory = {};

// Load existing chat logs on startup
function loadChatLogs() {
  try {
    if (fs.existsSync(chatLogFile)) {
      const data = fs.readFileSync(chatLogFile, 'utf8');
      chatHistory = JSON.parse(data);
      console.log(`Loaded chat history for ${Object.keys(chatHistory).length} customers`);
    }
  } catch (error) {
    console.error('Failed to load chat logs:', error);
    chatHistory = {};
  }
}

// Save chat logs to file
function saveChatLogs() {
  try {
    fs.writeFileSync(chatLogFile, JSON.stringify(chatHistory, null, 2));
  } catch (error) {
    console.error('Failed to save chat logs:', error);
  }
}

// Add chat message to history
function logChatMessage(phone, message, response, customerInfo = null) {
  if (!chatHistory[phone]) {
    chatHistory[phone] = {
      phone: phone,
      customerInfo: customerInfo,
      messages: [],
      firstContact: new Date().toISOString(),
      lastContact: new Date().toISOString(),
      totalMessages: 0
    };
  }
  
  const chatEntry = {
    timestamp: new Date().toISOString(),
    customerMessage: message,
    botResponse: response,
    customerFound: !!customerInfo
  };
  
  chatHistory[phone].messages.push(chatEntry);
  chatHistory[phone].lastContact = new Date().toISOString();
  chatHistory[phone].totalMessages = chatHistory[phone].messages.length;
  
  // Update customer info if found
  if (customerInfo) {
    chatHistory[phone].customerInfo = customerInfo;
  }
  
  // Keep only last 50 messages per customer to prevent excessive memory usage
  if (chatHistory[phone].messages.length > 50) {
    chatHistory[phone].messages = chatHistory[phone].messages.slice(-50);
  }
  
  // Save to file (async)
  setTimeout(saveChatLogs, 100);
}

// Get conversation history for a customer
function getConversationHistory(phone, limit = 10) {
  if (!chatHistory[phone]) return [];
  
  return chatHistory[phone].messages.slice(-limit);
}

// File processing functions
async function processPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF processing error:', error);
    throw error;
  }
}

function processExcel(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    let allText = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      allText += `Sheet: ${sheetName}\n`;
      data.forEach(row => {
        if (row.length > 0) {
          allText += row.join(' | ') + '\n';
        }
      });
      allText += '\n';
    });
    
    return allText;
  } catch (error) {
    console.error('Excel processing error:', error);
    throw error;
  }
}

// Upload knowledge base file endpoint
app.post('/upload-knowledge', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();
    
    console.log(`Processing knowledge file: ${fileName}`);
    
    let extractedText = '';
    
    if (fileExt === '.pdf') {
      extractedText = await processPDF(filePath);
    } else if (['.xlsx', '.xls', '.csv'].includes(fileExt)) {
      extractedText = processExcel(filePath);
    } else {
      // Plain text files
      extractedText = fs.readFileSync(filePath, 'utf8');
    }
    
    // Store in memory and track history
    const timestamp = new Date().toISOString();
    const knowledgeEntry = {
      id: Date.now(),
      fileName: fileName,
      fileType: fileExt,
      content: extractedText,
      uploadedAt: timestamp,
      size: extractedText.length
    };
    
    knowledgeHistory.push(knowledgeEntry);
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    // Clean up uploaded file
    fs.unlinkSync(filePath);
    
    console.log(`Knowledge base updated with ${extractedText.length} characters from ${fileName}`);
    
    res.json({ 
      message: 'Knowledge base updated successfully',
      fileName: fileName,
      size: extractedText.length,
      preview: extractedText.substring(0, 200) + '...'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Get current knowledge base with full details
app.get('/knowledge', (req, res) => {
  res.json({
    hasKnowledge: !!knowledgeBase,
    size: knowledgeBase.length,
    preview: knowledgeBase.substring(0, 500) + (knowledgeBase.length > 500 ? '...' : ''),
    history: knowledgeHistory.map(k => ({
      id: k.id,
      fileName: k.fileName,
      fileType: k.fileType,
      uploadedAt: k.uploadedAt,
      size: k.size,
      preview: k.content.substring(0, 200) + (k.content.length > 200 ? '...' : '')
    })),
    totalFiles: knowledgeHistory.length
  });
});

// Add text-based knowledge
app.post('/knowledge/text', (req, res) => {
  try {
    const { text, title } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const timestamp = new Date().toISOString();
    const knowledgeEntry = {
      id: Date.now(),
      fileName: title || `Text Entry ${knowledgeHistory.length + 1}`,
      fileType: '.txt',
      content: text,
      uploadedAt: timestamp,
      size: text.length
    };
    
    knowledgeHistory.push(knowledgeEntry);
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    console.log(`Added text knowledge: ${knowledgeEntry.fileName} (${text.length} chars)`);
    
    res.json({
      message: 'Text knowledge added successfully',
      id: knowledgeEntry.id,
      fileName: knowledgeEntry.fileName,
      size: text.length
    });
    
  } catch (error) {
    console.error('Text knowledge error:', error);
    res.status(500).json({ error: 'Failed to add text knowledge' });
  }
});

// Update knowledge entry
app.put('/knowledge/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { content, title } = req.body;
    
    const entryIndex = knowledgeHistory.findIndex(k => k.id === id);
    if (entryIndex === -1) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }
    
    if (content !== undefined) knowledgeHistory[entryIndex].content = content;
    if (title !== undefined) knowledgeHistory[entryIndex].fileName = title;
    knowledgeHistory[entryIndex].size = knowledgeHistory[entryIndex].content.length;
    
    // Rebuild knowledge base
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    res.json({
      message: 'Knowledge updated successfully',
      entry: knowledgeHistory[entryIndex]
    });
    
  } catch (error) {
    console.error('Update knowledge error:', error);
    res.status(500).json({ error: 'Failed to update knowledge' });
  }
});

// Delete knowledge entry
app.delete('/knowledge/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const entryIndex = knowledgeHistory.findIndex(k => k.id === id);
    
    if (entryIndex === -1) {
      return res.status(404).json({ error: 'Knowledge entry not found' });
    }
    
    const deletedEntry = knowledgeHistory.splice(entryIndex, 1)[0];
    
    // Rebuild knowledge base
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    console.log(`Deleted knowledge: ${deletedEntry.fileName}`);
    
    res.json({
      message: 'Knowledge deleted successfully',
      deletedEntry: deletedEntry.fileName
    });
    
  } catch (error) {
    console.error('Delete knowledge error:', error);
    res.status(500).json({ error: 'Failed to delete knowledge' });
  }
});

// Clear all knowledge
app.delete('/knowledge', (req, res) => {
  knowledgeHistory = [];
  knowledgeBase = '';
  
  // Save to persistent storage
  saveKnowledgeToFile();
  
  console.log('All knowledge cleared');
  
  res.json({ message: 'All knowledge cleared successfully' });
});

// PERSONALITY MANAGEMENT

// Get current personality
app.get('/personality', (req, res) => {
  const envPersonality = process.env.CLAUDE_PERSONALITY || '';
  const currentPersonality = personalityText || envPersonality || "You are a helpful customer service representative";
  
  res.json({
    current: currentPersonality,
    source: personalityText ? 'uploaded' : (envPersonality ? 'environment' : 'default'),
    hasCustom: !!personalityText,
    size: currentPersonality.length
  });
});

// Update personality via text
app.post('/personality', (req, res) => {
  try {
    const { personality } = req.body;
    
    if (!personality) {
      return res.status(400).json({ error: 'Personality text is required' });
    }
    
    personalityText = personality;
    
    // Save to persistent storage
    savePersonalityToFile();
    
    console.log(`Personality updated (${personality.length} chars)`);
    
    res.json({
      message: 'Personality updated successfully',
      size: personality.length,
      preview: personality.substring(0, 200) + (personality.length > 200 ? '...' : '')
    });
    
  } catch (error) {
    console.error('Personality update error:', error);
    res.status(500).json({ error: 'Failed to update personality' });
  }
});

// Upload personality file
app.post('/personality/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileExt = path.extname(fileName).toLowerCase();
    
    let extractedText = '';
    
    if (fileExt === '.pdf') {
      extractedText = await processPDF(filePath);
    } else if (['.xlsx', '.xls', '.csv'].includes(fileExt)) {
      extractedText = processExcel(filePath);
    } else {
      // Plain text files
      extractedText = fs.readFileSync(filePath, 'utf8');
    }
    
    personalityText = extractedText;
    
    // Save to persistent storage
    savePersonalityToFile();
    
    // Clean up uploaded file
    fs.unlinkSync(filePath);
    
    console.log(`Personality uploaded from file: ${fileName} (${extractedText.length} chars)`);
    
    res.json({
      message: 'Personality uploaded successfully',
      fileName: fileName,
      size: extractedText.length,
      preview: extractedText.substring(0, 200) + (extractedText.length > 200 ? '...' : '')
    });
    
  } catch (error) {
    console.error('Personality upload error:', error);
    res.status(500).json({ error: 'Failed to upload personality file' });
  }
});

// Reset personality to default/environment
app.delete('/personality', (req, res) => {
  personalityText = '';
  
  // Save to persistent storage
  savePersonalityToFile();
  
  console.log('Personality reset to default/environment');
  
  res.json({
    message: 'Personality reset to default/environment',
    current: process.env.CLAUDE_PERSONALITY || "You are a helpful customer service representative"
  });
});

// Protected route for management dashboard
// management.html now served via static files

// Serve login page (unprotected)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Test page for client error logging
app.get('/test-errors', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-client-errors.html'));
});

// CHAT HISTORY MANAGEMENT

// Get all chat logs
app.get('/chat-logs', (req, res) => {
  const logs = Object.values(chatHistory).map(chat => ({
    phone: chat.phone || 'Unknown',
    customerInfo: chat.customerInfo || null,
    firstContact: chat.firstContact || (chat.messages && chat.messages.length > 0 ? chat.messages[0].timestamp : new Date().toISOString()),
    lastContact: chat.lastContact || (chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1].timestamp : new Date().toISOString()),
    totalMessages: chat.totalMessages || (chat.messages ? chat.messages.length : 0),
    recentMessage: chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null
  })).sort((a, b) => new Date(b.lastContact) - new Date(a.lastContact));
  
  res.json({
    totalCustomers: logs.length,
    logs: logs
  });
});

// Get detailed conversation for specific customer
app.get('/chat-logs/:phone', (req, res) => {
  const phone = req.params.phone;
  const chat = chatHistory[phone];
  
  if (!chat) {
    return res.status(404).json({ error: 'No conversation found for this phone number' });
  }
  
  res.json(chat);
});

// Delete conversation history for specific customer
app.delete('/chat-logs/:phone', (req, res) => {
  const phone = req.params.phone;
  
  if (!chatHistory[phone]) {
    return res.status(404).json({ error: 'No conversation found for this phone number' });
  }
  
  delete chatHistory[phone];
  saveChatLogs();
  
  res.json({ message: 'Conversation history deleted successfully' });
});

// Clear all chat logs
app.delete('/chat-logs', (req, res) => {
  chatHistory = {};
  saveChatLogs();
  
  res.json({ message: 'All chat logs cleared successfully' });
});

// Export chat logs as JSON
app.get('/chat-logs/export/json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=chat_logs_export.json');
  res.json(chatHistory);
});

// Enhanced automatic Shopify sync function with retry logic
async function performAutomaticShopifySync(syncType = 'scheduled', retryCount = 0) {
  if (!shopifyService.enabled) {
    logger.warn('Shopify sync skipped - service not configured', { syncType });
    return { success: false, reason: 'not_configured' };
  }
  
  try {
    logger.info(`Starting ${syncType} Shopify sync (attempt ${retryCount + 1})`, { syncType, retryCount });
    
    const [products, collections, shopInfo, pages, blogPosts] = await Promise.all([
      shopifyService.getProducts(),
      shopifyService.getCollections(), 
      shopifyService.getShopInfo(),
      shopifyService.getPages(),
      shopifyService.getBlogPosts()
    ]);

    const knowledgeContent = shopifyService.formatForKnowledgeBase(
      products, collections, shopInfo, pages, blogPosts
    );

    const timestamp = new Date().toISOString();
    const knowledgeEntry = {
      id: Date.now(),
      fileName: `Shopify Store Data (${new Date().toLocaleDateString()})`,
      fileType: '.shopify',
      content: knowledgeContent,
      uploadedAt: timestamp,
      size: knowledgeContent.length,
      source: 'shopify-sync',
      metadata: {
        productsCount: products.length,
        collectionsCount: collections.length,
        pagesCount: pages.length,
        blogPostsCount: blogPosts.length,
        shopName: shopInfo?.name || 'Unknown',
        syncType: 'automatic'
      }
    };

    // Remove existing Shopify entries
    knowledgeHistory = knowledgeHistory.filter(entry => entry.source !== 'shopify-sync');
    
    // Add new entry
    knowledgeHistory.push(knowledgeEntry);
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    logger.success(`${syncType} Shopify sync completed`, {
      syncType,
      productsCount: products.length,
      collectionsCount: collections.length,
      pagesCount: pages.length,
      blogPostsCount: blogPosts.length,
      totalSize: knowledgeContent.length
    });
    
    return { success: true, data: knowledgeEntry.metadata };
    
  } catch (error) {
    logger.error(`${syncType} Shopify sync failed (attempt ${retryCount + 1})`, {
      syncType,
      retryCount,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Retry logic: up to 3 attempts with exponential backoff
    const maxRetries = 3;
    if (retryCount < maxRetries) {
      const delay = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
      logger.warn(`Retrying ${syncType} Shopify sync in ${delay/1000}s`, { retryCount, delay });
      
      setTimeout(() => {
        performAutomaticShopifySync(syncType, retryCount + 1);
      }, delay);
      
      return { success: false, error: error.message, retrying: true, nextAttemptIn: delay };
    }
    
    return { success: false, error: error.message, finalFailure: true };
  }
}

// Enhanced automated Shopify sync scheduling
if (shopifyService.enabled) {
  logger.info('Setting up automated Shopify sync schedules');
  
  // 1. Daily sync at 6 AM (existing)
  cron.schedule('0 6 * * *', () => performAutomaticShopifySync('daily'));
  
  // 2. Every 4 hours during business hours (8 AM, 12 PM, 4 PM, 8 PM)
  cron.schedule('0 8,12,16,20 * * *', () => performAutomaticShopifySync('periodic'));
  
  // 3. Startup sync with delay for server initialization
  setTimeout(() => performAutomaticShopifySync('startup'), 10000);
  
  logger.success('Automated Shopify sync schedules configured', {
    schedules: ['daily at 6:00 AM', 'every 4 hours (8,12,16,20)', 'on startup']
  });
}

// Shopify Webhook Endpoint for Real-time Product Updates
app.post('/webhook/shopify', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      logger.warn('Shopify webhook received but no webhook secret configured');
      return res.status(400).send('Webhook secret not configured');
    }
    
    // Verify webhook authenticity
    const crypto = require('crypto');
    const calculatedHmac = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body)
      .digest('base64');
    
    if (hmac !== calculatedHmac) {
      logger.warn('Shopify webhook authentication failed', { 
        receivedHmac: hmac?.substring(0, 10) + '...',
        calculatedHmac: calculatedHmac?.substring(0, 10) + '...'
      });
      return res.status(401).send('Unauthorized');
    }
    
    // Parse webhook data
    const webhookData = JSON.parse(req.body);
    const topic = req.get('X-Shopify-Topic');
    
    logger.info('Shopify webhook received', { topic, id: webhookData.id });
    
    // Trigger sync for relevant product/inventory changes
    if (['products/create', 'products/update', 'inventory_levels/update'].includes(topic)) {
      // Debounced sync to avoid too many rapid updates
      clearTimeout(global.webhookSyncTimeout);
      global.webhookSyncTimeout = setTimeout(() => {
        performAutomaticShopifySync('webhook').then(result => {
          logger.info('Webhook-triggered Shopify sync completed', result);
        });
      }, 30000); // Wait 30 seconds to batch multiple webhook updates
    }
    
    res.status(200).send('OK');
    
  } catch (error) {
    logger.error('Shopify webhook processing failed', { 
      error: error.message,
      headers: req.headers 
    });
    res.status(500).send('Internal Server Error');
  }
});

// Claude API Rate Limiter Management Endpoints
app.get('/admin/claude/status', (req, res) => {
  try {
    const status = claudeRateLimiter.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Failed to get Claude API status', { error: error.message });
    res.status(500).json({ error: 'Failed to get Claude API status' });
  }
});

app.delete('/admin/claude/cache', (req, res) => {
  try {
    const clearedCount = claudeRateLimiter.clearCache();
    logger.success('Claude API cache cleared by admin', { 
      clearedEntries: clearedCount,
      ip: req.ip || req.connection.remoteAddress
    });
    res.json({ 
      success: true, 
      message: `Cleared ${clearedCount} cached responses` 
    });
  } catch (error) {
    logger.error('Failed to clear Claude API cache', { error: error.message });
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Logging Management API Endpoints
app.get('/admin/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const logs = logger.getRecentLogs(limit);
    
    res.json({
      success: true,
      logs,
      total: logs.length
    });
  } catch (error) {
    logger.error('Failed to fetch logs', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/admin/logs/stats', (req, res) => {
  try {
    const stats = logger.getStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Failed to fetch log stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch log stats' });
  }
});

// CLIENT-SIDE ERROR LOGGING ENDPOINT
app.post('/admin/client-error', (req, res) => {
  try {
    const { message, source, lineno, colno, stack, userAgent, url } = req.body;
    
    logger.error('Client-side JavaScript error', {
      error: message,
      source: source || 'unknown',
      line: lineno || 'unknown',
      column: colno || 'unknown',
      stack: stack || 'not provided',
      userAgent: userAgent || req.get('User-Agent'),
      page: url || 'unknown',
      ip: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    });
    
    res.json({ success: true, message: 'Error logged successfully' });
  } catch (error) {
    console.error('Failed to log client error:', error);
    res.status(500).json({ error: 'Failed to log client error' });
  }
});

// BATCH PROCESSING ENDPOINTS

// Get batch processing analytics
app.get('/admin/batch/analytics', (req, res) => {
  try {
    const analytics = batchProcessor.getBatchAnalytics();
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    logger.error('Failed to fetch batch analytics', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch batch analytics' });
  }
});

// Create knowledge sync batch job
app.post('/admin/batch/knowledge-sync', async (req, res) => {
  try {
    // Get current products and collections for batch processing
    const products = await shopifyService.getProducts();
    const collections = await shopifyService.getCollections();
    const shopInfo = await shopifyService.getShopInfo();
    
    const batch = await batchProcessor.createKnowledgeSyncBatch(products, collections, shopInfo);
    
    logger.info('Knowledge sync batch created', { 
      batchId: batch.id,
      requestCount: batch.request_counts.total,
      estimatedCost: batch.metadata.estimated_cost
    });
    
    res.json({
      success: true,
      batch: {
        id: batch.id,
        status: batch.status,
        requestCount: batch.request_counts.total,
        estimatedCost: batch.metadata.estimated_cost,
        costSavings: batch.metadata.cost_savings
      }
    });
  } catch (error) {
    logger.error('Failed to create knowledge sync batch', { error: error.message });
    res.status(500).json({ error: 'Failed to create knowledge sync batch' });
  }
});

// Create support content batch job
app.post('/admin/batch/support-content', async (req, res) => {
  try {
    const { queries, productData } = req.body;
    
    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: 'queries array is required' });
    }
    
    const batch = await batchProcessor.createSupportContentBatch(queries, productData || []);
    
    logger.info('Support content batch created', { 
      batchId: batch.id,
      queryCount: queries.length
    });
    
    res.json({
      success: true,
      batch: {
        id: batch.id,
        status: batch.status,
        requestCount: batch.request_counts.total,
        estimatedCost: batch.metadata.estimated_cost
      }
    });
  } catch (error) {
    logger.error('Failed to create support content batch', { error: error.message });
    res.status(500).json({ error: 'Failed to create support content batch' });
  }
});

// Check batch job status
app.get('/admin/batch/:batchId/status', async (req, res) => {
  try {
    const { batchId } = req.params;
    const status = await batchProcessor.checkBatchStatus(batchId);
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Failed to check batch status', { 
      error: error.message,
      batchId: req.params.batchId
    });
    res.status(500).json({ error: 'Failed to check batch status' });
  }
});

// Get batch job results
app.get('/admin/batch/:batchId/results', async (req, res) => {
  try {
    const { batchId } = req.params;
    const results = await batchProcessor.getBatchResults(batchId);
    
    res.json({
      success: true,
      results
    });
  } catch (error) {
    logger.error('Failed to get batch results', { 
      error: error.message,
      batchId: req.params.batchId
    });
    res.status(500).json({ error: 'Failed to get batch results' });
  }
});

// Process batch results into knowledge updates
app.post('/admin/batch/:batchId/process', async (req, res) => {
  try {
    const { batchId } = req.params;
    const { batchType } = req.body;
    
    if (!batchType) {
      return res.status(400).json({ error: 'batchType is required' });
    }
    
    const processed = await batchProcessor.processBatchResults(batchId, batchType);
    
    logger.info('Batch results processed', { 
      batchId,
      batchType,
      processed: processed.processed
    });
    
    res.json({
      success: true,
      processed
    });
  } catch (error) {
    logger.error('Failed to process batch results', { 
      error: error.message,
      batchId: req.params.batchId
    });
    res.status(500).json({ error: 'Failed to process batch results' });
  }
});

// List all active batch jobs
app.get('/admin/batch/active', (req, res) => {
  try {
    const batches = batchProcessor.getActiveBatches();
    res.json({
      success: true,
      batches
    });
  } catch (error) {
    logger.error('Failed to get active batches', { error: error.message });
    res.status(500).json({ error: 'Failed to get active batches' });
  }
});

// Vector embeddings management endpoints
app.get('/admin/vector/analytics', async (req, res) => {
  try {
    const analytics = await hybridVectorRetriever.getSearchAnalytics();
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    logger.error('Failed to get vector analytics', { error: error.message });
    res.status(500).json({ error: 'Failed to get vector analytics' });
  }
});

app.post('/admin/vector/rebuild-embeddings', async (req, res) => {
  try {
    logger.info('Starting bulk embedding rebuild', { 
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });
    
    const result = await hybridVectorRetriever.updateAllEmbeddings();
    
    res.json({
      success: true,
      message: 'Embedding rebuild completed',
      processed: result.processed,
      errors: result.errors
    });
  } catch (error) {
    logger.error('Failed to rebuild embeddings', { error: error.message });
    res.status(500).json({ error: 'Failed to rebuild embeddings' });
  }
});

app.get('/admin/vector/test-search', async (req, res) => {
  try {
    const { query = 'test query' } = req.query;
    
    const [semanticResults, bm25Results, hybridResults] = await Promise.all([
      hybridVectorRetriever.semanticSearch(query, 3),
      hybridVectorRetriever.bm25Search(query, 3),
      hybridVectorRetriever.hybridSearch(query, { limit: 5 })
    ]);
    
    res.json({
      success: true,
      query,
      results: {
        semantic: semanticResults,
        bm25: bm25Results,
        hybrid: hybridResults
      }
    });
  } catch (error) {
    logger.error('Failed to test search', { error: error.message });
    res.status(500).json({ error: 'Failed to test search' });
  }
});

// Enterprise monitoring endpoints
app.get('/admin/monitoring/dashboard', (req, res) => {
  try {
    const dashboardData = enterpriseMonitoring.getDashboardData();
    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    logger.error('Failed to get monitoring dashboard', { error: error.message });
    res.status(500).json({ error: 'Failed to get monitoring dashboard' });
  }
});

app.post('/admin/monitoring/alert', (req, res) => {
  try {
    const { message, severity = 'medium', metadata = {} } = req.body;
    
    enterpriseMonitoring.alert(`Admin alert: ${message}`, {
      severity,
      admin_triggered: true,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      ...metadata
    });
    
    res.json({ success: true, message: 'Alert sent successfully' });
  } catch (error) {
    logger.error('Failed to send admin alert', { error: error.message });
    res.status(500).json({ error: 'Failed to send alert' });
  }
});

app.post('/admin/monitoring/reset-metrics', (req, res) => {
  try {
    enterpriseMonitoring.resetMetrics();
    
    logger.info('Monitoring metrics reset by admin', { 
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });
    
    res.json({ success: true, message: 'Metrics reset successfully' });
  } catch (error) {
    logger.error('Failed to reset metrics', { error: error.message });
    res.status(500).json({ error: 'Failed to reset metrics' });
  }
});

// Enterprise chat storage management endpoints
app.get('/admin/storage/stats', async (req, res) => {
  try {
    const stats = await enterpriseChatStorage.getStorageStats();
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    logger.error('Failed to get storage stats', { error: error.message });
    res.status(500).json({ error: 'Failed to get storage stats' });
  }
});

app.post('/admin/storage/migrate', async (req, res) => {
  try {
    const jsonFilePath = req.body.jsonFilePath || './chat_logs.json';
    
    logger.info('Starting chat storage migration', { 
      file: jsonFilePath,
      admin: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });
    
    const migratedCount = await enterpriseChatStorage.migrateFromJsonStorage(jsonFilePath);
    
    res.json({
      success: true,
      message: 'Migration completed successfully',
      migratedMessages: migratedCount
    });
    
  } catch (error) {
    logger.error('Chat storage migration failed', { error: error.message });
    res.status(500).json({ error: 'Migration failed: ' + error.message });
  }
});

app.get('/admin/storage/conversations/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const conversations = await enterpriseChatStorage.getConversationHistory(phone, limit);
    
    res.json({
      success: true,
      phone: phone,
      conversations: conversations,
      count: conversations.length
    });
    
  } catch (error) {
    logger.error('Failed to get conversation history', { error: error.message });
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

app.post('/admin/storage/archive', async (req, res) => {
  try {
    logger.info('Manual archive process started', { 
      admin: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    });
    
    await enterpriseChatStorage.archiveOldConversations();
    
    res.json({
      success: true,
      message: 'Archive process completed'
    });
    
  } catch (error) {
    logger.error('Manual archive failed', { error: error.message });
    res.status(500).json({ error: 'Archive process failed' });
  }
});

app.delete('/admin/logs', (req, res) => {
  try {
    const success = logger.clearLogs();
    if (success) {
      logger.success('Logs cleared by admin', { 
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      });
      res.json({ success: true, message: 'Logs cleared successfully' });
    } else {
      res.status(500).json({ error: 'Failed to clear logs' });
    }
  } catch (error) {
    logger.error('Failed to clear logs', { error: error.message });
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// Knowledge Base Management API Endpoints (PostgreSQL)
// Only available when using PostgreSQL knowledge retriever
if (process.env.DATABASE_URL) {
  
  // Get all knowledge base entries
  app.get('/admin/knowledge', async (req, res) => {
    try {
      const { includeInactive } = req.query;
      const knowledge = await knowledgeRetriever.getAllKnowledge(includeInactive === 'true');
      res.json({
        success: true,
        knowledge
      });
    } catch (error) {
      logger.error('Failed to get knowledge base', { error: error.message });
      res.status(500).json({ error: 'Failed to retrieve knowledge base' });
    }
  });
  
  // Add new knowledge entry
  app.post('/admin/knowledge', async (req, res) => {
    try {
      const { category, title, content, keywords = [], priority = 5 } = req.body;
      
      if (!category || !title || !content) {
        return res.status(400).json({ error: 'Category, title, and content are required' });
      }
      
      const result = await knowledgeRetriever.addKnowledge(
        category, 
        title, 
        content, 
        Array.isArray(keywords) ? keywords : keywords.split(',').map(k => k.trim()),
        parseInt(priority) || 5,
        'admin'
      );
      
      logger.info('Knowledge added via dashboard', { id: result.id, title, category });
      
      res.json({
        success: true,
        id: result.id,
        created_at: result.created_at
      });
    } catch (error) {
      logger.error('Failed to add knowledge', { error: error.message });
      res.status(500).json({ error: 'Failed to add knowledge entry' });
    }
  });
  
  // Update knowledge entry
  app.put('/admin/knowledge/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Clean up keywords if provided
      if (updates.keywords && !Array.isArray(updates.keywords)) {
        updates.keywords = updates.keywords.split(',').map(k => k.trim());
      }
      
      const result = await knowledgeRetriever.updateKnowledge(
        parseInt(id), 
        updates, 
        'admin'
      );
      
      logger.info('Knowledge updated via dashboard', { id, updates: Object.keys(updates) });
      
      res.json({
        success: true,
        id: result.id,
        updated_at: result.updated_at
      });
    } catch (error) {
      logger.error('Failed to update knowledge', { error: error.message, id: req.params.id });
      res.status(500).json({ error: error.message });
    }
  });
  
  // Delete knowledge entry (soft delete)
  app.delete('/admin/knowledge/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await knowledgeRetriever.deleteKnowledge(parseInt(id), 'admin');
      
      logger.info('Knowledge deleted via dashboard', { id, title: result.title });
      
      res.json({
        success: true,
        id: result.id,
        title: result.title
      });
    } catch (error) {
      logger.error('Failed to delete knowledge', { error: error.message, id: req.params.id });
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get knowledge base statistics
  app.get('/admin/knowledge/stats', async (req, res) => {
    try {
      const stats = await knowledgeRetriever.getKnowledgeStats();
      res.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error('Failed to get knowledge stats', { error: error.message });
      res.status(500).json({ error: 'Failed to get knowledge statistics' });
    }
  });
  
  // Test knowledge search
  app.post('/admin/knowledge/search', async (req, res) => {
    try {
      const { query, maxResults = 5 } = req.body;
      
      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }
      
      const results = await knowledgeRetriever.getRelevantKnowledge(query, maxResults);
      
      res.json({
        success: true,
        query,
        results
      });
    } catch (error) {
      logger.error('Failed to search knowledge', { error: error.message });
      res.status(500).json({ error: 'Failed to search knowledge base' });
    }
  });
}

// Initialize enterprise chat storage for distillation conversations
// Enterprise chat storage already initialized above

// Enterprise storage initialization removed - already initialized above

// Start server
app.listen(port, () => {
  logger.success(`Jonathan's Distillation SMS Bot server started on port ${port}`);
  
  // Initialize core components asynchronously (don't block startup)
  (async () => {
    try {
      console.log('🚀 Starting background initialization...');
      
      // Load existing chat logs (fallback) - synchronous
      loadChatLogs();
      
      // Initialize Google Sheets with timeout
      await Promise.race([
        initializeGoogleSheets(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Google Sheets init timeout')), 15000)
        )
      ]).catch(err => console.log('⚠️ Google Sheets init failed:', err.message));
      
      // Test Claude API with timeout
      await Promise.race([
        testClaudeAPI(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Claude API test timeout')), 10000)
        )
      ]).catch(err => console.log('⚠️ Claude API test failed:', err.message));
      
      console.log('✅ Background initialization completed');
      
    } catch (error) {
      console.error('❌ Background initialization error:', error.message);
    }
  })();
  
  // Server is ready immediately
  logger.info('🥃 Jonathan\'s Distillation Bot server is ready - ready to help with stills and spirits!');
});

module.exports = app;