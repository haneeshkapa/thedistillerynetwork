const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
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
    if (customer) {
      // Map data based on your sheet structure
      const name = customer._rawData[2] || customer.shipping_name || 'N/A';
      const orderId = customer._rawData[0] || 'N/A';
      const product = customer._rawData[1] || 'N/A';
      const email = customer._rawData[5] || 'N/A';
      const phone = customer._rawData[6] || 'N/A';
      const created = customer._rawData[3] || 'N/A';
      
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

${combinedKnowledge ? `COMPANY KNOWLEDGE:\n${combinedKnowledge}\n\n` : ""}Customer Information:
- Name: ${name}
- Phone: ${phone}  
- Order ID: ${orderId}
- Product: ${product}
- Order Date: ${created}
- Email: ${email}${historyContext}
Customer has sent: "${message}"

Respond in your natural style, keeping it concise like an SMS. Use the customer info, company knowledge, and conversation history to provide helpful, contextual assistance. Reference previous conversations when relevant.`;
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
        product: customer._rawData[1]
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
      management: '/management.html'
    },
    status: 'OK'
  });
});

// Explicit route for management dashboard
app.get('/management.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'management.html'));
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
  
  console.log('Personality reset to default/environment');
  
  res.json({
    message: 'Personality reset to default/environment',
    current: process.env.CLAUDE_PERSONALITY || "You are a helpful customer service representative"
  });
});

// CHAT HISTORY MANAGEMENT

// Get all chat logs
app.get('/chat-logs', (req, res) => {
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

// Start server
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  loadChatLogs(); // Load existing chat logs
  await initializeGoogleSheets();
  await testClaudeAPI();
});

module.exports = app;