#!/usr/bin/env node

/**
 * Test chat simulation with phone number 9786778131
 */

const axios = require('axios');
require('dotenv').config();

const SERVER_URL = 'https://thedistillerynetwork.onrender.com';
const TEST_PHONE = '9786778131';

async function simulateChat() {
    console.log('💬 Starting chat simulation with:', TEST_PHONE);
    console.log('=' .repeat(50));
    
    try {
        // Start the server first
        console.log('\n📱 Starting test conversation...');
        console.log('Customer: Altagracia Nelson');
        console.log('Order: #MS3781 - 25 Gallon Traditional Copper Distiller');
        console.log('Phone:', TEST_PHONE);
        
        // Test messages to send
        const testMessages = [
            "Hi, I ordered a copper still recently",
            "Can you tell me about my order?",
            "When will it ship?",
            "What's the best mash recipe for whiskey?",
            "Thanks for the help!"
        ];
        
        for (const message of testMessages) {
            console.log('\n📤 Customer:', message);
            
            try {
                const response = await axios.post(`${SERVER_URL}/reply`, {
                    From: `+1${TEST_PHONE}`,
                    Body: message
                }, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    transformRequest: [(data) => {
                        return Object.keys(data)
                            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
                            .join('&');
                    }]
                });
                
                // Extract the response from TwiML
                const responseMatch = response.data.match(/<Message>(.*?)<\/Message>/);
                if (responseMatch) {
                    const botResponse = responseMatch[1]
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&')
                        .replace(/&quot;/g, '"')
                        .replace(/&#x27;/g, "'");
                    console.log('🤖 Jonathan:', botResponse);
                } else {
                    console.log('🤖 Response:', response.data);
                }
                
                // Wait a bit between messages
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error('❌ Error sending message:', error.response?.data || error.message);
            }
        }
        
        console.log('\n✅ Chat simulation complete!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n⚠️  Make sure the server is running: npm start');
    }
}

// Run the simulation
simulateChat().catch(console.error);