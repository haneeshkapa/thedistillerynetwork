const axios = require('axios');

const SERVER_URL = 'https://thedistillerynetwork.onrender.com';

async function testLiveServer() {
  console.log('🧪 Testing Live SMS Bot Server...\n');

  try {
    console.log('Testing SMS reply with Sherry\'s real data...');
    const reply = await axios.post(`${SERVER_URL}/reply`, {
      phone: '3049190649',
      message: 'Where is my order?'
    });
    
    console.log('✅ SUCCESS! Claude Response:');
    console.log('📱 Reply:', reply.data.reply);
    console.log('👤 Customer Found:', reply.data.customerFound);
    console.log('📊 Customer Info:', JSON.stringify(reply.data.customerInfo, null, 2));
    
  } catch (error) {
    console.log('❌ SMS reply failed:', error.response?.data || error.message);
  }
}

testLiveServer();