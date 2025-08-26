/**
 * Voice Upgrade: Natural TTS with OpenAI
 * Replace Twilio's basic TTS with OpenAI's advanced voices
 */

// Enhanced voice processing endpoint
async function processVoiceWithOpenAI(req, res) {
  const { From: callerPhone, CallSid, TranscriptionText } = req.body;
  const phone = normalizePhoneNumber(callerPhone);
  
  try {
    // Generate AI response (same as current)
    const customer = await findCustomerByPhone(phone);
    const aiResponse = await generateAIResponse(phone, TranscriptionText, customer);
    
    // Generate natural speech with OpenAI TTS
    const speechResponse = await openaiClient.audio.speech.create({
      model: "tts-1-hd", // High quality
      voice: "nova", // Natural female voice (or "onyx" for male)
      input: aiResponse,
      response_format: "mp3",
      speed: 1.0
    });
    
    // Convert to audio buffer
    const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());
    
    // Save audio file temporarily
    const audioPath = `/tmp/response_${CallSid}.mp3`;
    require('fs').writeFileSync(audioPath, audioBuffer);
    
    // Create Twilio response with custom audio
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play(`https://your-domain.com/audio/${CallSid}.mp3`);
    
    // Continue conversation
    twiml.record({
      timeout: 8,
      transcribe: true,
      transcribeCallback: '/voice/transcription',
      action: '/voice/process-speech',
      method: 'POST',
      maxLength: 30
    });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error) {
    console.error('Voice processing error:', error);
    // Fallback to regular TTS
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("I'm having audio issues. Let me try again.");
    res.type('text/xml');
    res.send(twiml.toString());
  }
}

// Add audio serving endpoint
app.get('/audio/:filename', (req, res) => {
  const filename = req.params.filename;
  const audioPath = `/tmp/response_${filename.replace('.mp3', '')}.mp3`;
  
  if (require('fs').existsSync(audioPath)) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.sendFile(audioPath);
    
    // Clean up file after serving
    setTimeout(() => {
      try {
        require('fs').unlinkSync(audioPath);
      } catch (err) {
        console.log('Audio cleanup error:', err);
      }
    }, 60000); // Delete after 1 minute
  } else {
    res.status(404).send('Audio not found');
  }
});

module.exports = { processVoiceWithOpenAI };