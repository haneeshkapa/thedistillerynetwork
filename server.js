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
  PORT = 3000
} = process.env;

// Set up PostgreSQL connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Initialize Anthropic Claude client
const anthropicClient = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

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
      customerSheet = customerSheetDoc.sheetsByIndex[0];
      console.log(`✅ Google Sheet loaded: ${customerSheet.title}`);
    })
    .catch(err => {
      console.error("❌ Failed to load Google Sheet:", err.message);
    });
} else {
  console.warn("⚠️ Google Sheets credentials not provided");
}

// Initialize services
const knowledgeRetriever = new AdvancedKnowledgeRetriever(pool);
const priceValidator = new PriceValidator();

// Database initialization
async function initDatabase() {
  try {
    console.log('🔧 Initializing database...');
    
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
    
    // Logs table
    await pool.query(`CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      level TEXT CHECK (level IN ('info', 'error', 'warning')),
      message TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

CONTACT INFORMATION:
Website: moonshinestills.com
Phone: (603) 997-6786
Email: tdnorders@gmail.com
Free shipping to continental USA
      `;
      await pool.query('INSERT INTO personality(content) VALUES($1)', [defaultPersonality.trim()]);
      console.log('✅ Default personality inserted');
    }
    
    console.log('✅ Database initialized successfully');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
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

// Helper function to find customer by phone in Google Sheets
async function findCustomerByPhone(phone) {
  if (!customerSheet) return null;
  
  try {
    const rows = await customerSheet.getRows();
    const normalizedInputPhone = normalizePhoneNumber(phone);
    
    console.log(`🔍 Looking for phone: ${phone} -> normalized: ${normalizedInputPhone}`);
    
    let foundCustomer = null;
    let foundRowIndex = -1;
    
    rows.forEach((row, index) => {
      const phoneField = row._rawData[6]; // Assuming phone is in column 6
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
    }
    
    return foundCustomer;
  } catch (error) {
    console.error('Google Sheets lookup error:', error.message);
    await logEvent('error', `Google Sheets lookup failed for phone ${phone}: ${error.message}`);
    return null;
  }
}

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
      if (!customer || !customer._rawData || !customer._rawData[2]) {
        // Customer not found in Google Sheets - return special response for Tasker
        await logEvent('info', `Non-customer SMS from ${phone} - no auto-reply`);
        return res.status(200).send("__IGNORE__");
      }
      
      // Customer found - proceed with conversation
      const name = customer._rawData[2];
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
        if (!customer || !customer._rawData || !customer._rawData[2]) {
          // Customer no longer in Google Sheets - return special response for Tasker
          await logEvent('info', `Non-customer SMS from removed customer ${phone} - no auto-reply`);
          return res.status(200).send("__IGNORE__");
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
      return res.status(200).send("__HUMAN__");
    }

    // Detect if user requests a human
    const humanRequestPattern = /human|person|representative|real person|talk to (?:someone|person)/i;
    if (humanRequestPattern.test(userMessage)) {
      await pool.query('UPDATE conversations SET paused=$1, requested_human=$2 WHERE phone=$3', [true, true, phone]);
      await logEvent('info', `User at ${phone} requested a human. Marked conversation as paused.`);
      return res.status(200).send("__HUMAN__");
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
      return res.status(200).send(stockReply);
    }

    // Check for order status queries
    const orderPattern = /order|ordered|purchase|purchased|bought|status|tracking|shipped|delivery|when will|eta/i;
    let orderInfo = "";
    if (orderPattern.test(userMessage)) {
      const customer = await findCustomerByPhone(phone);
      if (customer && customer._rawData) {
        // Extract order information from Google Sheets row
        const rowData = customer._rawData;
        const orderId = rowData[0] || '';
        const productOrdered = rowData[1] || '';
        const customerName = rowData[2] || '';
        const orderDate = rowData[3] || '';
        const orderStatus = rowData[4] || '';
        const trackingInfo = rowData[5] || '';
        
        // Get cell background color to determine actual status
        let statusDescription = "Order received";
        let statusColor = "white"; // default
        
        try {
          // Load the sheet cells to get formatting information
          await customerSheet.loadCells();
          const rowIndex = customer.googleRowIndex;
          
          // Check the background color of the status cell (column 4, assuming 0-indexed)
          const statusCell = customerSheet.getCell(rowIndex, 4);
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
        orderInfo += `- Always include the specific product name when discussing their order\n`;
        orderInfo += `- Follow the color-coded customer service approach for ${statusColor} status\n`;
        orderInfo += `- Adjust your tone and response based on the customer's patience level indicated by the color\n`;
        
        await logEvent('info', `Order status lookup successful for ${phone}: ${statusDescription} (${statusColor})`);
      } else {
        await logEvent('info', `Order status lookup failed for ${phone}: customer not found`);
      }
    }

    // Retrieve relevant knowledge
    const knowledgeChunks = await knowledgeRetriever.retrieveRelevantChunks(userMessage, 3);
    await logEvent('info', `Knowledge retrieved: found ${knowledgeChunks.length} relevant pieces.`);

    // Get personality from database
    const persResult = await pool.query('SELECT content FROM personality LIMIT 1');
    const personalityText = persResult.rows.length ? persResult.rows[0].content : "";
    
    // Get conversation history
    const historyResult = await pool.query(
      `SELECT sender, message FROM messages 
       WHERE phone=$1 
       ORDER BY timestamp DESC 
       LIMIT 10`, [phone]
    );
    const historyMessages = historyResult.rows.reverse(); // oldest first

    // Build messages for Claude
    const messages = [];
    
    // System message with personality and knowledge
    let systemContent = personalityText;
    if (knowledgeChunks.length > 0) {
      systemContent += "\n\nRelevant Knowledge:\n";
      knowledgeChunks.forEach((chunk, idx) => {
        systemContent += `- ${chunk}\n`;
      });
    }
    if (orderInfo) {
      systemContent += orderInfo;
    }

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
        max_tokens: 300,
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
      return res.status(200).send(errorReply);
    }

    if (!aiResponse) {
      aiResponse = "I'm sorry, I didn't catch that. Please contact us directly for help.";
      await logEvent('error', `Claude API returned empty response for ${phone}.`);
    }

    // Validate AI response for price mistakes
    const validPrice = priceValidator.validate(aiResponse, userMessage);
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
    res.status(200).send(aiResponse);

  } catch (err) {
    console.error("Error in /reply handler:", err);
    await logEvent('error', `Internal error processing SMS from ${phone}: ${err.message}`);
    res.status(500).send('Sorry, something went wrong. Please try again later.');
  }
});

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
      if (!customer || !customer._rawData || !customer._rawData[2]) {
        // Customer not found in Google Sheets - ignore message
        await logEvent('info', `Ignoring human message from non-customer: ${phone}`);
        return res.status(200).json({ 
          ignored: true, 
          message: "Customer not found in records" 
        });
      }
      
      // Customer found - proceed with logging
      const name = customer._rawData[2];
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
    
    // Insert each product as a knowledge entry
    for (let product of products) {
      const title = product.title;
      let contentText = "";
      
      if (product.body_html) {
        // Remove HTML tags
        contentText = product.body_html.replace(/<[^>]+>/g, '');
      }
      
      // Get lowest variant price
      if (product.variants && product.variants.length > 0) {
        let price = product.variants[0].price;
        for (let variant of product.variants) {
          if (parseFloat(variant.price) < parseFloat(price)) {
            price = variant.price;
          }
        }
        if (price) {
          contentText += ` Price: $${price}`;
        }
      }
      
      contentText = contentText.trim();
      await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
        [title, contentText, 'shopify']);
    }
    
    await logEvent('info', `Knowledge base synced with Shopify: ${products.length} products updated.`);
    res.json({ success: true, count: products.length });
    
  } catch (err) {
    console.error("Error syncing Shopify products:", err);
    await logEvent('error', `Shopify sync failed: ${err.message}`);
    res.status(500).json({ error: "Failed to sync Shopify products" });
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