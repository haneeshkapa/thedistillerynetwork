# Voice Call Integration Setup Guide

This guide explains how to set up voice call functionality for Jonathan's Distillation SMS Bot using Twilio and OpenAI's speech APIs.

## 🎯 Voice Features

- **Automatic Customer Recognition**: Only customers in Google Sheets get AI assistance
- **Speech-to-Text**: Uses Twilio's built-in transcription service
- **AI Response Generation**: Same intelligent responses as SMS using Claude AI
- **Text-to-Speech**: Twilio's natural voice synthesis
- **Call Recording**: Full conversation transcripts and recordings
- **Admin Dashboard**: Real-time voice call monitoring

## 📋 Prerequisites

1. **Twilio Account** with phone number capable of receiving calls
2. **OpenAI Account** for enhanced speech processing (optional)
3. **Existing SMS bot** setup and working

## 🔧 Twilio Voice Setup

### Step 1: Configure Voice Webhook

In your Twilio Console:

1. Go to **Phone Numbers** → **Manage** → **Active Numbers**
2. Click on your Twilio phone number
3. In the **Voice** section, configure:
   - **Webhook URL**: `https://your-domain.com/voice/incoming`
   - **HTTP Method**: POST
   - **Status Callback URL**: `https://your-domain.com/voice/call-status`

### Step 2: Environment Variables

Add to your `.env` file:

```env
# OpenAI for enhanced voice processing (optional but recommended)
OPENAI_API_KEY=your_openai_api_key_here

# Twilio credentials (same as SMS setup)
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
```

## 📞 How Voice Calls Work

### Call Flow for Customers

1. **Customer calls** your Twilio number
2. **System checks** if caller is in Google Sheets customer database
3. **AI greeting**: "Hello [Name]! This is Jonathan's Distillation Equipment..."
4. **Speech recording** starts (30 seconds max)
5. **Transcription** converts speech to text
6. **AI processing** generates response using same logic as SMS
7. **Text-to-speech** reads AI response to customer
8. **Loop continues** until customer hangs up or conversation ends

### Call Flow for Non-Customers

1. **System plays message**: "Thank you for calling Jonathan's Distillation Equipment..."
2. **Directs to website**: "Please visit moonshine stills dot com..."
3. **Call ends** automatically

## 🎛️ Voice Settings

### TwiML Voice Configuration

The system uses these Twilio voice settings:
- **Voice**: Alice (clear, professional female voice)
- **Language**: en-US
- **Recording Timeout**: 10 seconds of silence
- **Max Recording Length**: 30 seconds
- **Transcription**: Enabled for all recordings

### AI Response Optimization

Voice responses are optimized for speech:
- **Length**: Max 150 tokens (~100 words)
- **Style**: Conversational and clear
- **URLs**: Spoken as "moonshine stills dot com"
- **Context**: Same customer data as SMS

## 📊 Admin Dashboard Integration

### Voice Calls Section

The admin dashboard shows:
- **Call Status**: Completed, In-Progress, Failed
- **Customer Name**: From Google Sheets lookup
- **Duration**: Total call time
- **Transcription**: What customer said
- **AI Responses**: All AI responses during call
- **Timestamps**: Start and end times

### Color Coding

- 🟢 **Green**: Completed calls
- 🟡 **Yellow**: In-progress calls  
- 🔴 **Red**: Failed calls
- 🔵 **Blue**: Default/ringing calls

## 🔍 Testing Voice Integration

### Test Script

```bash
# Test voice webhook (simulate Twilio)
curl -X POST https://your-domain.com/voice/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+15551234567&CallSid=test123&CallStatus=ringing"
```

### Test Checklist

- [ ] **Non-customer calls** get website message and hang up
- [ ] **Customer calls** get personalized greeting
- [ ] **Speech transcription** works correctly
- [ ] **AI responses** are appropriate and helpful
- [ ] **Call logging** appears in admin dashboard
- [ ] **Call recordings** are stored properly

## 💰 Cost Considerations

### Twilio Voice Pricing (US)
- **Inbound calls**: ~$0.0085/minute
- **TTS (text-to-speech)**: ~$0.04/1000 characters
- **Transcription**: ~$0.05/minute
- **Recording storage**: ~$0.05/month per recording

### OpenAI Pricing (if used)
- **Whisper transcription**: $0.006/minute
- **TTS**: $15/1M characters

**Estimated cost per 5-minute call**: $0.10-0.25

## 🚨 Troubleshooting

### Common Issues

**"Call goes straight to voicemail"**
- Check Twilio webhook URL is accessible
- Verify webhook returns valid TwiML response

**"Transcription is blank"**
- Customer may not be speaking clearly
- Background noise interference
- Check recording timeout settings

**"AI responses are too long"**
- Responses are limited to 100 words for voice
- Check system instructions in admin dashboard

**"Non-customers get AI response"**
- Verify Google Sheets customer lookup is working
- Check phone number normalization

### Debug Mode

Enable detailed logging:

```env
LOG_LEVEL=debug
```

Check admin dashboard logs for voice call processing details.

## 🔐 Security Considerations

- **Customer verification**: Only Google Sheets customers get AI assistance
- **Call recording**: Stored securely in database with encryption
- **Webhook validation**: Twilio signatures validated (recommended)
- **Rate limiting**: Built-in protection against call flooding

## 📈 Analytics and Monitoring

### Key Metrics

Track in admin dashboard:
- **Call volume**: Daily/weekly/monthly totals
- **Customer satisfaction**: Call completion rates
- **Response quality**: Average call duration
- **Cost tracking**: Monthly voice expenses

### Alerts

Monitor for:
- Failed transcriptions
- Long call durations (>10 minutes)
- High volume spikes
- API errors

## 🎯 Next Steps

1. **Test thoroughly** with known customer phone numbers
2. **Monitor call quality** for first week
3. **Adjust AI responses** based on call feedback
4. **Set up monitoring alerts** for failed calls
5. **Consider advanced features**:
   - Call forwarding to human agent
   - Voicemail integration
   - Multi-language support

## 💡 Pro Tips

- **Keep responses short** for better voice comprehension
- **Use customer names** from Google Sheets for personalization
- **Monitor transcription accuracy** and adjust for common terms
- **Test during business hours** for realistic scenarios
- **Have backup plan** for high call volumes

---

**Voice integration is now live!** Customers can call your Twilio number and get the same intelligent AI assistance as SMS, with full conversation tracking in the admin dashboard.