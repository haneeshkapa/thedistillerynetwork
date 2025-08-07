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

// Custom static file serving with authentication for management.html
app.use((req, res, next) => {
  if (req.path === '/management.html') {
    return requireAuth(req, res, next);
  }
  next();
});

app.use(express.static('.'));

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

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

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
    
    console.log(`Admin login successful at ${req.session.loginTime}`);
    
    res.json({
      success: true,
      message: 'Login successful',
      token: token
    });
  } else {
    console.log(`Failed login attempt with PIN: ${pin} at ${new Date().toISOString()}`);
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
app.get('/admin/pin', requireAuth, (req, res) => {
  res.json({
    hasCustomPin: fs.existsSync(ADMIN_FILE),
    lastUpdated: fs.existsSync(ADMIN_FILE) ? 
      JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).updatedAt : null
  });
});

app.post('/admin/pin', requireAuth, (req, res) => {
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
app.get('/admin/shopify/status', requireAuth, (req, res) => {
  const status = shopifyService.getSyncStatus();
  res.json(status);
});

// Sync data from Shopify
app.post('/admin/shopify/sync', requireAuth, async (req, res) => {
  try {
    if (!shopifyService.enabled) {
      return res.status(400).json({ error: 'Shopify integration not configured' });
    }

    console.log('Starting Shopify sync...');
    
    // Fetch all data in parallel
    const [products, collections, shopInfo, pages, blogPosts] = await Promise.all([
      shopifyService.getProducts(),
      shopifyService.getCollections(), 
      shopifyService.getShopInfo(),
      shopifyService.getPages(),
      shopifyService.getBlogPosts()
    ]);

    // Format for knowledge base
    const knowledgeContent = shopifyService.formatForKnowledgeBase(
      products, collections, shopInfo, pages, blogPosts
    );

    // Create knowledge entry
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
        shopName: shopInfo?.name || 'Unknown'
      }
    };

    // Remove existing Shopify entries
    knowledgeHistory = knowledgeHistory.filter(entry => entry.source !== 'shopify-sync');
    
    // Add new entry
    knowledgeHistory.push(knowledgeEntry);
    knowledgeBase = knowledgeHistory.map(k => `[${k.fileName}]\n${k.content}`).join('\n\n---\n\n');
    
    // Save to persistent storage
    saveKnowledgeToFile();
    
    console.log(`✅ Shopify sync completed: ${products.length} products, ${collections.length} collections, ${pages.length} pages`);
    
    res.json({
      message: 'Shopify sync completed successfully',
      data: {
        productsCount: products.length,
        collectionsCount: collections.length,
        pagesCount: pages.length,
        blogPostsCount: blogPosts.length,
        totalSize: knowledgeContent.length,
        shopName: shopInfo?.name
      },
      syncedAt: timestamp
    });

  } catch (error) {
    console.error('Shopify sync error:', error);
    res.status(500).json({ 
      error: 'Failed to sync Shopify data', 
      details: error.message 
    });
  }
});

// Get order status (for customer inquiries)
app.post('/admin/shopify/order', requireAuth, async (req, res) => {
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
app.get('/admin/sheets/info', requireAuth, async (req, res) => {
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
app.get('/admin/sheets/formatting/:sheetName?', requireAuth, async (req, res) => {
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
app.get('/admin/sheets/summary/:sheetName?', requireAuth, async (req, res) => {
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
app.get('/admin/sheets/status', requireAuth, (req, res) => {
  const status = enhancedSheetsService.getStatus();
  res.json(status);
});

// Get sheet data with order status interpretation
app.get('/admin/sheets/orders/:sheetName?', requireAuth, async (req, res) => {
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
app.get('/admin/sheets/status-summary/:sheetName?', requireAuth, async (req, res) => {
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
app.post('/admin/sheets/customer-status', requireAuth, async (req, res) => {
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

// Google Sheets setup
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

async function initializeGoogleSheets() {
  try {
    const creds = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    console.log('Google Sheets connected successfully');
    console.log('Sheet title:', doc.title);
  } catch (error) {
    console.error('Failed to connect to Google Sheets:', error.message);
    console.log('Make sure your sheet is shared with:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  }
}

// Helper function to find customer by phone
async function findCustomerByPhone(phone) {
  try {
    const sheet = doc.sheetsByIndex[0]; // Use first sheet
    const rows = await sheet.getRows();
    
    // Clean phone number (remove spaces, dashes, parentheses)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    // Log first row to understand structure
    if (rows.length > 0) {
      console.log('Sheet headers:', Object.keys(rows[0]));
      console.log('First row data:', rows[0]._rawData);
    }
    
    return rows.find(row => {
      // Phone is in position 6 (7th column) based on your data
      const phoneField = row._rawData[6];
      
      if (!phoneField) return false;
      
      // Convert scientific notation to regular number if needed
      let phoneStr = phoneField.toString();
      if (phoneStr.includes('E+')) {
        phoneStr = Number(phoneField).toString();
      }
      
      const rowPhone = phoneStr.replace(/[\s\-\(\)\.]/g, '');
      return rowPhone === cleanPhone || rowPhone.includes(cleanPhone) || cleanPhone.includes(rowPhone);
    });
  } catch (error) {
    console.error('Error finding customer:', error);
    return null;
  }
}

// Main SMS reply endpoint
app.post('/reply', async (req, res) => {
  try {
    const { phone, message, sender } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone and message are required' });
    }

    console.log(`Received message from ${phone}: ${message}`);

    // Find customer in Google Sheets
    const customer = await findCustomerByPhone(phone);
    
    // Get conversation history for context
    const conversationHistory = getConversationHistory(phone, 5); // Last 5 messages
    
    let prompt;
    let customerStatusInfo = null;
    
    if (customer) {
      // Map data based on your sheet structure
      const name = customer._rawData[2] || customer.shipping_name || 'N/A';
      const orderId = customer._rawData[0] || 'N/A';
      const product = customer._rawData[1] || 'N/A';
      const email = customer._rawData[5] || 'N/A';
      const customerPhone = customer._rawData[6] || 'N/A';
      const created = customer._rawData[3] || 'N/A';
      
      // Try to get enhanced status information using color-based detection
      try {
        if (enhancedSheetsService.enabled) {
          console.log(`🔍 Looking up enhanced status for original phone: ${phone}, customer phone: ${customerPhone}`);
          const sheetData = await enhancedSheetsService.getSheetWithOrderStatus();
          // Try original phone first, then customer phone from database
          let customerStatus = enhancedSheetsService.findCustomerStatus(sheetData, phone);
          if (!customerStatus) {
            customerStatus = enhancedSheetsService.findCustomerStatus(sheetData, customerPhone);
          }
          if (customerStatus) {
            customerStatusInfo = customerStatus;
            console.log(`✅ Enhanced status found:`, customerStatus.status);
          } else {
            console.log(`❌ No enhanced status found for phone: ${phone}`);
          }
        } else {
          console.log('❌ Enhanced sheets service not enabled');
        }
      } catch (statusError) {
        console.error('Enhanced status lookup failed:', statusError.message);
      }
      
      // Get personality and knowledge from environment and uploaded files
      const personality = personalityText || process.env.CLAUDE_PERSONALITY || "You are a helpful customer service representative";
      const envKnowledge = process.env.CLAUDE_KNOWLEDGE || "";
      const fileKnowledge = knowledgeBase || "";
      const combinedKnowledge = [envKnowledge, fileKnowledge].filter(k => k).join('\n\n');
      
      // Format conversation history
      let historyContext = '';
      if (conversationHistory.length > 0) {
        historyContext = '\n\nPREVIOUS CONVERSATION:\n';
        conversationHistory.forEach((msg, i) => {
          historyContext += `[${new Date(msg.timestamp).toLocaleString()}]\n`;
          historyContext += `Customer: ${msg.customerMessage}\n`;
          historyContext += `You: ${msg.botResponse}\n\n`;
        });
        historyContext += 'CURRENT MESSAGE:\n';
      }
      
      // Enhanced status information for better customer service responses
      let statusContext = '';
      if (customerStatusInfo && customerStatusInfo.status) {
        const status = customerStatusInfo.status;
        statusContext = `\n\nORDER STATUS INFORMATION:
- Current Status: ${status.label}
- Priority Level: ${status.priority}
- Recommended Action: ${status.action}
- Status Color: ${customerStatusInfo.statusColor || 'N/A'}`;
        
        // Add specific guidance based on status
        switch (status.status) {
          case 'wants_cancel':
            statusContext += '\n- IMPORTANT: Customer wants to cancel - handle with urgency and empathy';
            break;
          case 'important_antsy':
            statusContext += '\n- IMPORTANT: Customer is anxious and calling frequently - provide reassurance and detailed updates';
            break;
          case 'call_for_update':
            statusContext += '\n- NOTE: Customer needs an update - provide clear status information';
            break;
          case 'in_process':
            statusContext += '\n- NOTE: Order is being processed - provide timeline if available';
            break;
          case 'shipped':
            statusContext += '\n- NOTE: Order has shipped - provide tracking information if available';
            break;
        }
      }

      prompt = `${personality}

${combinedKnowledge ? `COMPANY KNOWLEDGE:\n${combinedKnowledge}\n\n` : ""}Customer Information:
- Name: ${name}
- Phone: ${customerPhone}  
- Order ID: ${orderId}
- Product: ${product}
- Order Date: ${created}
- Email: ${email}${statusContext}${historyContext}
Customer has sent: "${message}"

Respond in your natural style, keeping it concise like an SMS. Use the customer info, company knowledge, conversation history, and order status to provide helpful, contextual assistance. Pay special attention to the order status information above when crafting your response.`;
    } else {
      // Get personality and knowledge from environment and uploaded files
      const personality = personalityText || process.env.CLAUDE_PERSONALITY || "You are a helpful customer service representative";
      const envKnowledge = process.env.CLAUDE_KNOWLEDGE || "";
      const fileKnowledge = knowledgeBase || "";
      const combinedKnowledge = [envKnowledge, fileKnowledge].filter(k => k).join('\n\n');
      
      // Format conversation history
      let historyContext = '';
      if (conversationHistory.length > 0) {
        historyContext = '\n\nPREVIOUS CONVERSATION:\n';
        conversationHistory.forEach((msg, i) => {
          historyContext += `[${new Date(msg.timestamp).toLocaleString()}]\n`;
          historyContext += `Customer: ${msg.customerMessage}\n`;
          historyContext += `You: ${msg.botResponse}\n\n`;
        });
        historyContext += 'CURRENT MESSAGE:\n';
      }
      
      prompt = `${personality}

${combinedKnowledge ? `COMPANY KNOWLEDGE:\n${combinedKnowledge}\n\n` : ""}${historyContext}
Customer has sent: "${message}"

I don't have their order information in our system. Respond in your natural style, using the conversation history to provide context. Ask them to provide their order number or contact information so you can assist them better. Keep it concise like an SMS.`;
    }

    // Get response from Claude
    console.log('Sending prompt to Claude...');
    console.log('API Key exists:', !!process.env.ANTHROPIC_API_KEY);
    console.log('API Key starts with:', process.env.ANTHROPIC_API_KEY?.substring(0, 10));
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const reply = response.content[0].text;
    console.log('Claude response received:', reply);
    
    console.log(`Generated reply: ${reply}`);
    
    // Log this conversation
    const customerInfo = customer ? {
      name: customer._rawData[2],
      orderId: customer._rawData[0],
      product: customer._rawData[1]
    } : null;
    
    logChatMessage(phone, message, reply, customerInfo);

    // Push reply back to Tasker (if configured)
    if (process.env.TASKER_PUSH_URL) {
      try {
        const pushResponse = await fetch(process.env.TASKER_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone,
            message: reply,
            action: 'send_sms'
          })
        });
        console.log('Pushed reply to Tasker:', pushResponse.ok);
      } catch (pushError) {
        console.error('Failed to push to Tasker:', pushError.message);
      }
    }

    res.json({ 
      reply: reply,
      customerFound: !!customer,
      customerInfo: customer ? {
        name: customer._rawData[2],
        orderId: customer._rawData[0],
        product: customer._rawData[1],
        enhancedStatus: customerStatusInfo ? {
          status: customerStatusInfo.status,
          statusColor: customerStatusInfo.statusColor,
          rowNumber: customerStatusInfo.rowNumber
        } : null
      } : null
    });

  } catch (error) {
    console.error('Error processing request:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      type: error.type,
      stack: error.stack
    });
    
    res.status(500).json({ 
      error: 'Internal server error',
      reply: 'Sorry, I\'m having trouble processing your request right now. Please try again later or call our support line.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Claude SMS Bot is running!',
    endpoints: {
      health: '/health',
      customer: '/customer/:phone',
      sms_reply: 'POST /reply',
      management: '/management.html',
      upload: '/upload.html'
    },
    status: 'OK'
  });
});

// Explicit route for management dashboard
app.get('/management.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'management.html'));
});

// Explicit route for upload page
app.get('/upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Claude SMS Bot is running' });
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
app.post('/upload-knowledge', requireAuth, upload.single('file'), async (req, res) => {
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
app.get('/knowledge', requireAuth, (req, res) => {
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
app.post('/knowledge/text', requireAuth, (req, res) => {
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
app.put('/knowledge/:id', requireAuth, (req, res) => {
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
app.delete('/knowledge/:id', requireAuth, (req, res) => {
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
app.delete('/knowledge', requireAuth, (req, res) => {
  knowledgeHistory = [];
  knowledgeBase = '';
  
  // Save to persistent storage
  saveKnowledgeToFile();
  
  console.log('All knowledge cleared');
  
  res.json({ message: 'All knowledge cleared successfully' });
});

// PERSONALITY MANAGEMENT

// Get current personality
app.get('/personality', requireAuth, (req, res) => {
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
app.post('/personality', requireAuth, (req, res) => {
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
app.post('/personality/upload', requireAuth, upload.single('file'), async (req, res) => {
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
app.delete('/personality', requireAuth, (req, res) => {
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
app.get('/management.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'management.html'));
});

// Serve login page (unprotected)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// CHAT HISTORY MANAGEMENT

// Get all chat logs
app.get('/chat-logs', requireAuth, (req, res) => {
  const logs = Object.values(chatHistory).map(chat => ({
    phone: chat.phone,
    customerInfo: chat.customerInfo,
    firstContact: chat.firstContact,
    lastContact: chat.lastContact,
    totalMessages: chat.totalMessages,
    recentMessage: chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null
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

// Automatic Shopify sync function
async function performAutomaticShopifySync() {
  if (!shopifyService.enabled) {
    console.log('Shopify sync skipped - not configured');
    return;
  }
  
  try {
    console.log('🔄 Starting scheduled Shopify sync...');
    
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
    
    console.log(`✅ Automatic Shopify sync completed: ${products.length} products, ${collections.length} collections`);
    
  } catch (error) {
    console.error('❌ Automatic Shopify sync failed:', error.message);
  }
}

// Schedule automatic Shopify sync (daily at 6 AM)
if (shopifyService.enabled) {
  console.log('📅 Scheduling automatic Shopify sync for daily at 6:00 AM');
  cron.schedule('0 6 * * *', performAutomaticShopifySync);
}

// Start server
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  loadChatLogs(); // Load existing chat logs
  await initializeGoogleSheets();
  await testClaudeAPI();
  
  // Perform initial Shopify sync if enabled and no existing data
  if (shopifyService.enabled) {
    const existingShopifyData = knowledgeHistory.find(entry => entry.source === 'shopify-sync');
    if (!existingShopifyData) {
      console.log('🔄 No existing Shopify data found, performing initial sync...');
      setTimeout(performAutomaticShopifySync, 5000); // Wait 5 seconds for server to fully start
    }
  }
});

module.exports = app;