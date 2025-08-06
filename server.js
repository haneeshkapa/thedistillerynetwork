const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    
    let prompt;
    if (customer) {
      // Map data based on your sheet structure
      const name = customer._rawData[2] || customer.shipping_name || 'N/A';
      const orderId = customer._rawData[0] || 'N/A';
      const product = customer._rawData[1] || 'N/A';
      const email = customer._rawData[5] || 'N/A';
      const phone = customer._rawData[6] || 'N/A';
      const created = customer._rawData[3] || 'N/A';
      
      prompt = `You are a helpful customer service representative. A customer has sent the following message: "${message}"

Customer Information:
- Name: ${name}
- Phone: ${phone}  
- Order ID: ${orderId}
- Product: ${product}
- Order Date: ${created}
- Email: ${email}

Please provide a helpful, professional, and friendly response. Keep it concise and conversational like an SMS. If they're asking about their order, provide relevant details from the information above.`;
    } else {
      prompt = `You are a helpful customer service representative. A customer has sent the following message: "${message}"

I don't have their order information in our system. Please provide a helpful, professional response asking them to provide their order number or contact information so you can assist them better. Keep it concise and conversational like an SMS.`;
    }

    // Get response from Claude
    console.log('Sending prompt to Claude:', prompt);
    
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const reply = response.content[0].text;
    console.log('Claude response received:', reply);
    
    console.log(`Generated reply: ${reply}`);

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
    res.status(500).json({ 
      error: 'Internal server error',
      reply: 'Sorry, I\'m having trouble processing your request right now. Please try again later or call our support line.'
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
      sms_reply: 'POST /reply'
    },
    status: 'OK'
  });
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

// Start server
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initializeGoogleSheets();
});

module.exports = app;