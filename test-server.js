// Quick test script for the SMS bot
const axios = require('axios');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function testServer() {
  console.log('🧪 Testing Claude SMS Bot Server...\n');

  // Test 1: Health Check
  try {
    console.log('1️⃣ Testing health endpoint...');
    const health = await axios.get(`${SERVER_URL}/health`);
    console.log('✅ Health check passed:', health.data.message);
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return;
  }

  // Test 2: Customer Lookup (will fail without real data, but tests connection)
  try {
    console.log('\n2️⃣ Testing customer lookup...');
    const customer = await axios.get(`${SERVER_URL}/customer/1234567890`);
    console.log('✅ Customer lookup response:', customer.data);
  } catch (error) {
    console.log('⚠️ Customer lookup error (expected if no data):', error.response?.data || error.message);
  }

  // Test 3: SMS Reply Endpoint
  try {
    console.log('\n3️⃣ Testing SMS reply generation...');
    const reply = await axios.post(`${SERVER_URL}/reply`, {
      phone: '1234567890',
      message: 'Where is my order?'
    });
    console.log('✅ SMS reply generated:', reply.data.reply);
    console.log('📊 Customer found:', reply.data.customerFound);
  } catch (error) {
    console.log('❌ SMS reply failed:', error.response?.data || error.message);
  }

  console.log('\n🏁 Testing complete!');
  console.log('\nNext steps:');
  console.log('1. Set up your Google Sheets (see google-sheets-setup.md)');
  console.log('2. Configure Tasker on your Android phone (see tasker-setup.md)');
  console.log('3. Deploy to a free hosting platform (see deployment-guide.md)');
}

// Run if called directly
if (require.main === module) {
  testServer();
}

module.exports = { testServer };