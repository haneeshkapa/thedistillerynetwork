// WORKING Voice System - Simple & Reliable for Render
// Add this to your server.js to replace the current voice endpoints

// STEP 1: Replace /voice/incoming with this working version
app.post('/voice/incoming', async (req, res) => {
  const { From: callerPhone, CallSid, CallStatus } = req.body;
  
  if (!callerPhone || !CallSid) {
    return res.status(400).send('Missing required call parameters');
  }

  const phone = normalizePhoneNumber(callerPhone);
  
  // LOG: This should appear in Render logs
  console.log(`📞 INCOMING CALL from ${phone} (CallSid: ${CallSid})`);
  await logEvent('info', `Incoming voice call from ${phone} (CallSid: ${CallSid})`);

  try {
    // Check customer in Google Sheets
    const customer = await findCustomerByPhone(phone);
    let customerName = 'there';
    
    if (customer) {
      customerName = customer['Name'] || customer['Customer'] || customer['name'] || customer._rawData[2] || 'there';
      console.log(`✅ FOUND CUSTOMER: ${customerName}`);
      console.log(`📋 Customer data:`, customer._rawData?.slice(0, 5));
    } else {
      console.log(`❓ Unknown caller: ${phone}`);
    }

    // Create voice call record
    await pool.query(`
      INSERT INTO voice_calls (phone, twilio_call_sid, direction, status) 
      VALUES ($1, $2, $3, $4)
    `, [phone, CallSid, 'inbound', CallStatus || 'ringing']);

    // Create TwiML response
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Natural greeting
    const greeting = customer ? 
      `Hey ${customerName}! This is Jonathan's AI assistant. What can I help you with?` :
      `Hey there! Thanks for calling Jonathan's Distillation Equipment. I'm the AI assistant. How can I help?`;

    // Use better voice
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, greeting);
    
    console.log(`🎤 GREETING: "${greeting}"`);
    
    // Start recording with proper settings
    twiml.record({
      timeout: 8,
      transcribe: true,
      transcribeCallback: '/voice/transcription',
      action: '/voice/process',  // Simplified endpoint name
      method: 'POST',
      maxLength: 30,
      playBeep: false
    });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
    console.log(`✅ CALL SETUP COMPLETE for ${phone}`);
    
  } catch (error) {
    console.error(`❌ VOICE CALL ERROR for ${phone}:`, error);
    await logEvent('error', `Voice call error for ${phone}: ${error.message}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, "Sorry, I'm having technical difficulties. Please send us a text message or visit moonshine stills dot com.");
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// STEP 2: Add simple speech processing endpoint
app.post('/voice/process', async (req, res) => {
  const { From: callerPhone, CallSid, RecordingUrl, TranscriptionText } = req.body;
  
  const phone = normalizePhoneNumber(callerPhone);
  
  // LOG: This should show transcription in Render logs
  console.log(`🎙️ TRANSCRIPTION from ${phone}: "${TranscriptionText}"`);
  console.log(`📼 Recording URL: ${RecordingUrl}`);
  
  try {
    // Update call record
    await pool.query(`
      UPDATE voice_calls 
      SET recording_url = $1, transcription = $2, status = 'in-progress'
      WHERE twilio_call_sid = $3
    `, [RecordingUrl, TranscriptionText || '', CallSid]);
    
    if (!TranscriptionText || TranscriptionText.trim() === '') {
      console.log(`❓ NO SPEECH DETECTED for ${phone}`);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({
        voice: 'Polly.Joanna',
        language: 'en-US'
      }, "I didn't catch that. What can I help you with?");
      
      twiml.record({
        timeout: 8,
        transcribe: true,
        transcribeCallback: '/voice/transcription',
        action: '/voice/process',
        method: 'POST',
        maxLength: 30,
        playBeep: false
      });
      
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    console.log(`🤖 GENERATING AI RESPONSE for: "${TranscriptionText}"`);
    
    // Get customer data
    const customer = await findCustomerByPhone(phone);
    
    // Log the voice message to database
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'user', `[VOICE] ${TranscriptionText}`, new Date()]
    );

    // Generate AI response using existing logic
    const aiResponse = await generateAIResponse(phone, TranscriptionText, customer);
    
    console.log(`🤖 AI RESPONSE: "${aiResponse}"`);
    
    // Log AI response to database
    await pool.query(
      'INSERT INTO messages(phone, sender, message, timestamp) VALUES($1, $2, $3, $4)',
      [phone, 'assistant', `[VOICE] ${aiResponse}`, new Date()]
    );

    // Update voice call record
    await pool.query(`
      UPDATE voice_calls 
      SET ai_responses = array_append(COALESCE(ai_responses, '{}'), $1)
      WHERE twilio_call_sid = $2
    `, [aiResponse, CallSid]);

    // Create voice response
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Clean response for voice
    let voiceResponse = aiResponse
      .replace(/moonshinestills\.com/g, 'moonshine stills dot com')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '');

    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, voiceResponse);
    
    // Continue conversation
    twiml.say({
      voice: 'Polly.Joanna', 
      language: 'en-US'
    }, "Anything else I can help with?");

    twiml.record({
      timeout: 8,
      transcribe: true,
      transcribeCallback: '/voice/transcription',
      action: '/voice/process',
      method: 'POST',
      maxLength: 30,
      playBeep: false
    });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
    console.log(`✅ VOICE RESPONSE SENT for ${phone}`);
    
  } catch (error) {
    console.error(`❌ VOICE PROCESSING ERROR for ${phone}:`, error);
    console.error('Error details:', error.stack);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({
      voice: 'Polly.Joanna',
      language: 'en-US'
    }, "I'm having some trouble processing that. Please try again or send us a text message.");
    
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// STEP 3: Enhanced transcription logging
app.post('/voice/transcription', async (req, res) => {
  const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
  
  console.log(`📝 TRANSCRIPTION CALLBACK: CallSid=${CallSid}, Status=${TranscriptionStatus}`);
  console.log(`📝 TRANSCRIPTION TEXT: "${TranscriptionText}"`);
  
  try {
    await pool.query(`
      UPDATE voice_calls 
      SET transcription = $1
      WHERE twilio_call_sid = $2
    `, [TranscriptionText, CallSid]);
    
    console.log(`✅ TRANSCRIPTION SAVED to database`);
  } catch (error) {
    console.error('❌ TRANSCRIPTION SAVE ERROR:', error);
  }
  
  res.send('OK');
});

console.log('🎤 SIMPLE VOICE SYSTEM LOADED');