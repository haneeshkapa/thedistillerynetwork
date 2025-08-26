# OpenAI Realtime Voice Setup Guide

This guide explains how to configure ChatGPT-style natural voice conversations for Jonathan's Distillation Bot.

## 🎤 What's New

**Before**: Traditional robotic TTS with delays
- Customer speaks → 10s timeout → Robotic voice response

**After**: ChatGPT-style natural conversation
- Customer speaks → Instant response → Natural interruption support
- Real-time bidirectional audio streaming
- Natural conversation flow with voice activity detection

## 🔧 Configuration

### 1. Update Twilio Webhook URL

In your Twilio Console:

**Old webhook**: `https://your-domain.com/voice/incoming`
**New webhook**: `https://your-domain.com/voice/realtime`

### 2. Required Environment Variables

All existing variables remain the same. The system uses your existing:
- `OPENAI_API_KEY` (for OpenAI Realtime API)
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
- Database and customer lookup credentials

### 3. WebSocket Requirements

The system automatically creates a WebSocket server on the same port as your HTTP server. Ensure your hosting platform supports:
- WebSocket connections
- Persistent connections
- SSL/TLS for WSS connections

## 🚀 Deployment Steps

### Step 1: Deploy Updated Code
```bash
# The code is already updated with realtime support
npm install  # Installs new 'ws' dependency
npm start    # Starts server with WebSocket support
```

### Step 2: Update Twilio Configuration

1. Go to Twilio Console → Phone Numbers → Manage → Active Numbers
2. Click your phone number
3. Change Voice webhook URL from:
   - `https://your-domain.com/voice/incoming`
   - To: `https://your-domain.com/voice/realtime`
4. Save configuration

### Step 3: Test the System

Call your Twilio number and experience:
- Instant voice responses
- Natural conversation flow
- Ability to interrupt the AI mid-sentence
- No robotic delays or beeps

## 🎛️ Voice Configuration

The system is configured for natural conversation:

```javascript
voice: 'nova',              // Natural female voice
turn_detection: {
  type: 'server_vad',       // Voice Activity Detection
  threshold: 0.5,           // Sensitivity
  silence_duration_ms: 500  // Half-second pause detection
}
```

### Available Voices
- `nova` (default): Natural, friendly female
- `alloy`: Balanced, conversational
- `echo`: Deep, authoritative male
- `fable`: Warm, expressive
- `onyx`: Deep, serious male
- `shimmer`: Bright, enthusiastic

To change voice, edit line 1862 in `server.js`:
```javascript
voice: 'onyx',  // Change to desired voice
```

## 📊 Monitoring

The system logs all realtime voice interactions:

```bash
# Check logs for realtime voice calls
grep "REALTIME VOICE" your-log-file
```

Database records include:
- `[REALTIME VOICE]` prefix for realtime conversations
- Real-time transcriptions
- AI response tracking
- Call duration and quality metrics

## 🔄 Fallback System

The old `/voice/incoming` endpoint remains active for:
- Backward compatibility
- Fallback if realtime fails
- Testing comparison

## 🐛 Troubleshooting

### Common Issues

**1. WebSocket Connection Failed**
- Check hosting platform WebSocket support
- Verify SSL certificate for WSS connections
- Ensure port accessibility

**2. OpenAI Realtime API Error**
- Verify OpenAI API key has Realtime API access
- Check account has sufficient credits
- Monitor rate limits

**3. Audio Quality Issues**
- Check network connection stability
- Verify Twilio audio format compatibility
- Monitor WebSocket connection quality

### Debug Commands

```bash
# Test WebSocket connection
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: test" \
  https://your-domain.com/voice/stream/test?phone=1234567890

# Check realtime logs
tail -f your-log-file | grep "REALTIME\\|WebSocket\\|OpenAI"
```

## 💡 Optimization Tips

### 1. Reduce Latency
- Use fast hosting (avoid cold starts)
- Optimize WebSocket connection pooling
- Monitor OpenAI API response times

### 2. Improve Voice Quality  
- Adjust `threshold` for voice detection sensitivity
- Modify `silence_duration_ms` for conversation pacing
- Fine-tune system instructions for concise responses

### 3. Customer Experience
- Keep responses short (1-2 sentences)
- Use conversational language
- Allow natural interruptions

## 📈 Performance Monitoring

Key metrics to track:
- WebSocket connection success rate
- Average response latency
- Call completion rates
- Customer satisfaction with voice quality

The system maintains all existing SMS functionality while adding natural voice conversation capabilities.