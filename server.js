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
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    console.log('Google Sheets connected successfully');
  } catch (error) {
    console.error('Failed to connect to Google Sheets:', error);
  }
}

// Helper function to find customer by phone
async function findCustomerByPhone(phone) {
  try {
    const sheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    
    // Clean phone number (remove spaces, dashes, parentheses)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    
    return rows.find(row => {
      const rowPhone = (row.Phone || row.phone || '').replace(/[\s\-\(\)]/g, '');
      return rowPhone.includes(cleanPhone) || cleanPhone.includes(rowPhone);
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
      prompt = `You are a helpful customer service representative. A customer has sent the following message: "${message}"

Customer Information:
- Name: ${customer.Name || customer.name || 'N/A'}
- Phone: ${customer.Phone || customer.phone || 'N/A'}  
- Order ID: ${customer.OrderID || customer['Order ID'] || customer.orderid || 'N/A'}
- Product: ${customer.Product || customer.product || 'N/A'}
- Status: ${customer.Status || customer.status || 'N/A'}
- Delivery Date: ${customer.DeliveryDate || customer['Delivery Date'] || customer.deliverydate || 'N/A'}
- Notes: ${customer.Notes || customer.notes || 'N/A'}

Please provide a helpful, professional, and friendly response. Keep it concise and conversational like an SMS. If they're asking about their order, provide relevant details from the information above.`;
    } else {
      prompt = `You are a helpful customer service representative. A customer has sent the following message: "${message}"

I don't have their order information in our system. Please provide a helpful, professional response asking them to provide their order number or contact information so you can assist them better. Keep it concise and conversational like an SMS.`;
    }

    // Get response from Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const reply = response.content[0].text;
    
    console.log(`Generated reply: ${reply}`);

    res.json({ 
      reply: reply,
      customerFound: !!customer,
      customerInfo: customer ? {
        name: customer.Name || customer.name,
        orderId: customer.OrderID || customer['Order ID'] || customer.orderid,
        status: customer.Status || customer.status
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Claude SMS Bot is running' });
});

// Get customer info endpoint (for testing)
app.get('/customer/:phone', async (req, res) => {
  try {
    const customer = await findCustomerByPhone(req.params.phone);
    if (customer) {
      res.json({ found: true, customer: customer._rawData });
    } else {
      res.json({ found: false, message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await initializeGoogleSheets();
});

module.exports = app;