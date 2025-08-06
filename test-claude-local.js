require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

async function testClaude() {
  console.log('🧪 Testing Claude API locally...\n');
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('API Key exists:', !!apiKey);
  console.log('API Key length:', apiKey?.length);
  console.log('API Key starts with:', apiKey?.substring(0, 15));
  
  try {
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });
    
    console.log('\n📡 Making API request...');
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say hello and confirm you are working' }]
    });
    
    console.log('✅ SUCCESS! Claude Response:');
    console.log(response.content[0].text);
    
    console.log('\n🎯 Testing SMS scenario...');
    const smsResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      messages: [{ 
        role: 'user', 
        content: `You are a customer service rep. Customer "Sherry" asks "Where is my order?" 
        
        Her info:
        - Order #2159
        - Product: 60 Gallon Moonshine KIT
        - Order Date: 2024-02-07
        
        Reply like an SMS message.` 
      }]
    });
    
    console.log('✅ SMS Response:');
    console.log(smsResponse.content[0].text);
    
  } catch (error) {
    console.error('❌ Claude API Error:', error.message);
    console.error('Status:', error.status);
    console.error('Type:', error.type);
    console.error('Error object:', error.error);
  }
}

testClaude();