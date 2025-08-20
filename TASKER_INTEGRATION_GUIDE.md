# Tasker Integration Guide for Jonathan's SMS Bot

This guide shows you how to set up Tasker to automatically forward SMS messages to your AI bot for analysis and response.

## Overview

Your SMS bot will:
1. Receive SMS messages forwarded from Tasker
2. Look up customer information from Google Sheets
3. Analyze the message using Claude AI
4. Generate an intelligent response
5. Return the response to you (optionally auto-send)

## API Endpoint

**URL:** `https://thedistillerynetwork.onrender.com/tasker/sms`
**Method:** POST
**Content-Type:** application/json

## Required Parameters

```json
{
  "phone": "+15551234567",
  "message": "Hey, do you have any 5-gallon copper stills?",
  "sender_name": "John Smith (Optional)"
}
```

## Response Format

```json
{
  "success": true,
  "customer": {
    "name": "John Smith",
    "phone": "+15551234567", 
    "orderId": "1001",
    "product": "3 Gallon Copper Still",
    "created": "2024-01-15"
  },
  "response": "Hi John! Yes, we have several 5-gallon copper stills available. Since you previously ordered our 3-gallon model, you might be interested in our premium 5-gallon copper moonshine still for $899. It features improved heat distribution and includes all accessories. Would you like more details about pricing and availability?",
  "conversation_context": "Returning customer interested in upgrading still size",
  "processing_time": 1250
}
```

## Tasker Setup Instructions

### Step 1: Create SMS Received Profile

1. Open Tasker
2. Go to **Profiles** tab
3. Tap **+** to add new profile
4. Select **Event** → **Phone** → **Received Text**
5. Leave **Sender** blank to catch all SMS (or specify numbers)
6. Name the profile "SMS to AI Bot"

### Step 2: Create HTTP Request Task

1. Create new task when prompted
2. Name it "Forward SMS to AI"
3. Add Action: **Net** → **HTTP Request**
4. Configure the HTTP Request:

```
Server:Port: thedistillerynetwork.onrender.com
Path: /tasker/sms
Method: POST
Content Type: application/json
Body: {
  "phone": "%SMSRF",
  "message": "%SMSRB",
  "sender_name": "%SMSRN"
}
Timeout: 30
```

### Step 3: Handle AI Response

Add another action to process the response:

1. Add Action: **Variables** → **Variable Set**
2. Name: `%AI_Response`
3. To: `%HTTPD` (the HTTP response data)

### Step 4: Show AI Response (Optional)

Add action to display the AI's suggested response:

1. Add Action: **Alert** → **Flash**
2. Text: `AI suggests: %AI_Response`
3. Long: Yes

### Step 5: Auto-Reply (Optional)

To automatically send the AI's response:

1. Add Action: **Phone** → **Send SMS**
2. Number: `%SMSRF`
3. Message: `%AI_Response`

**⚠️ Warning:** Be careful with auto-reply. Test thoroughly first!

## Advanced Tasker Configuration

### JSON Parsing

To extract specific parts of the response:

```javascript
// Parse the JSON response
var response = JSON.parse(global('AI_Response'));
var aiMessage = response.response;
var customerName = response.customer.name;

// Set variables
setGlobal('AI_MESSAGE', aiMessage);
setGlobal('CUSTOMER_NAME', customerName);
```

### Error Handling

Add error handling for failed requests:

1. Add Action: **Variables** → **Variable Set**
2. Name: `%Error`  
3. To: `%HTTPR` (HTTP response code)
4. Add **If** condition: `%Error !~ 200`
5. Add **Alert** action: "Failed to contact AI bot"

### Selective Forwarding

Forward only certain contacts or keywords:

1. In SMS Received profile, set **Sender** to specific numbers
2. Or add **If** condition in task: `%SMSRB ~ *still*` (messages containing "still")

## Testing Your Setup

### Test Message Example

Send yourself a test SMS:
```
"Hi, I'm interested in your 10-gallon copper still. What's the price and availability?"
```

### Expected Workflow

1. Tasker detects incoming SMS
2. Forwards to AI bot API
3. AI analyzes message and customer history
4. Returns intelligent response
5. You review and send (or auto-send if configured)

## Troubleshooting

### Common Issues

**HTTP Request Fails (Timeout)**
- Check internet connection
- Verify server URL: `https://thedistillerynetwork.onrender.com`
- Increase timeout to 60 seconds

**JSON Parse Error**
- Check that Content-Type is `application/json`
- Verify Body format matches exactly
- Use Tasker's **Test Action** feature

**No Response from AI**
- Check server logs at management dashboard
- Verify phone number format: `+1XXXXXXXXXX`
- Ensure message text is not empty

### Debug Mode

Enable debug mode in your task:

1. Add Action: **Alert** → **Popup**
2. Title: "Debug Info"
3. Text: `Phone: %SMSRF\nMessage: %SMSRB\nResponse: %HTTPD`

## Security Considerations

1. **No Authentication Required**: The API is currently open (no API keys needed)
2. **Rate Limiting**: Built-in rate limiting prevents spam
3. **Phone Number Privacy**: Numbers are hashed for logging
4. **Data Storage**: Conversations stored in encrypted PostgreSQL

## Advanced Features

### Customer Lookup Integration

The AI bot automatically:
- Looks up customer info from Google Sheets
- References previous orders and conversations
- Provides personalized responses based on history

### Multi-Language Support

Add language detection:
```json
{
  "phone": "+15551234567",
  "message": "Hola, ¿tienen alambiques de cobre?",
  "language": "es"
}
```

### Priority Handling

Mark urgent messages:
```json
{
  "phone": "+15551234567", 
  "message": "My still stopped working!",
  "priority": "urgent"
}
```

## Example Complete Tasker Profile Export

```xml
<TaskerData sr="" dvi="1" tv="6.0.9">
  <Profile sr="prof2" ve="2">
    <cdate>1642234567890</cdate>
    <edate>1642234567890</edate>
    <id>2</id>
    <mid0>3</mid0>
    <nme>SMS to AI Bot</nme>
    <Event sr="con0" ve="2">
      <code>5</code>
      <pri>0</pri>
      <Str sr="arg0" ve="3"></Str>
      <Str sr="arg1" ve="3"></Str>
      <Int sr="arg2" val="0"/>
    </Event>
  </Profile>
  
  <Task sr="task3">
    <cdate>1642234567890</cdate>
    <edate>1642234567890</edate>
    <id>3</id>
    <nme>Forward SMS to AI</nme>
    
    <Action sr="act0" ve="7">
      <code>339</code>
      <Str sr="arg0" ve="3">thedistillerynetwork.onrender.com</Str>
      <Str sr="arg1" ve="3">/tasker/sms</Str>
      <Str sr="arg2" ve="3">application/json</Str>
      <Str sr="arg3" ve="3">{"phone":"%SMSRF","message":"%SMSRB","sender_name":"%SMSRN"}</Str>
      <Str sr="arg4" ve="3"></Str>
      <Str sr="arg5" ve="3"></Str>
      <Int sr="arg6" val="30"/>
    </Action>
    
    <Action sr="act1" ve="7">
      <code>547</code>
      <Str sr="arg0" ve="3">AI_Response</Str>
      <Str sr="arg1" ve="3">%HTTPD</Str>
    </Action>
    
    <Action sr="act2" ve="7">
      <code>548</code>
      <Str sr="arg0" ve="3">AI suggests: %AI_Response</Str>
      <Int sr="arg1" val="1"/>
    </Action>
  </Task>
</TaskerData>
```

## Support

- **Management Dashboard**: `https://thedistillerynetwork.onrender.com/management.html`
- **API Status**: Check `/health` endpoint
- **Logs**: View system logs in management dashboard

---

**Ready to get started?** Follow the steps above and your SMS messages will be powered by AI! 🤖📱