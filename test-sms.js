// Simple test script to trigger a message to your phone
const axios = require('axios');

const testMessage = async () => {
  try {
    const response = await axios.post('https://thedistillerynetwork.onrender.com/reply', {
      phone: '9786778131',
      text: 'Status update on my order?'
    });
    
    console.log('Bot Response:');
    console.log(response.data);
  } catch (err) {
    console.error('Error:', err.message);
  }
};

testMessage();
