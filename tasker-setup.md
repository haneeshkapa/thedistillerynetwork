# Tasker SMS Automation Setup

## Required Apps
1. **Tasker** ($3.49 on Google Play)
2. **AutoNotification** (optional, for advanced notifications)

## Tasker Profile Setup

### Profile 1: SMS Received Handler

1. **Create New Profile**
   - Event → Phone → Received Text
   - Sender: Leave blank (to capture all SMS)
   - Content: Leave blank

2. **Create Task: "Claude SMS Reply"**
   - Action 1: Variable Set
     - Name: %PHONE
     - To: %SMSRF (sender's phone number)
   
   - Action 2: Variable Set  
     - Name: %MESSAGE
     - To: %SMSRB (SMS body/content)
   
   - Action 3: HTTP Request
     - Method: POST
     - URL: `https://your-server-url.com/reply`
     - Headers: `Content-Type:application/json`
     - Body: `{"phone":"%PHONE","message":"%MESSAGE"}`
     - Output File: Leave blank
     - Trust Any Certificate: Checked
   
   - Action 4: Variable Split
     - Name: %HTTPR
     - Splitter: `"reply":"`
   
   - Action 5: Variable Split  
     - Name: %HTTPR2
     - Splitter: `"`
   
   - Action 6: Send SMS
     - Number: %PHONE  
     - Message: %HTTPR21
     - Store In Messaging App: Checked

### Alternative Simplified Version (JSON parsing)

**Task: "Claude SMS Reply v2"**
- Action 1-3: Same as above
- Action 4: JavaScriptlet
  ```javascript
  var response = JSON.parse(global('HTTPR'));
  setGlobal('REPLY', response.reply);
  ```
- Action 5: Send SMS
  - Number: %PHONE
  - Message: %REPLY

## Testing the Profile

1. **Test HTTP Endpoint First**
   - Use Action → Net → HTTP Request manually
   - URL: `https://your-server.com/health`
   - Verify you get `{"status":"OK"}`

2. **Test SMS Flow**
   - Send yourself a test SMS
   - Check Tasker run log for errors
   - Verify Claude response is sent back

## Troubleshooting

### Common Issues:
- **No response**: Check server URL and internet connection
- **JSON parsing error**: Use Variable Split method instead of JavaScriptlet  
- **SMS not sending**: Verify Tasker has SMS permissions
- **Server timeout**: Increase HTTP timeout to 30 seconds

### Permissions Needed:
- SMS Read/Send
- Internet Access
- Phone State (for caller ID)

### Variables to Monitor:
- %HTTPR: Raw HTTP response
- %SMSRF: Sender phone number  
- %SMSRB: SMS message body
- %REPLY: Parsed Claude response

## Advanced Features (Optional)

### Business Hours Filter
Add condition to Profile:
- Time: 9:00-17:00
- Days: Mon,Tue,Wed,Thu,Fri

### Keyword Filtering  
Only respond to SMS containing keywords:
- Profile → Event → Received Text
- Content: `*order*|*delivery*|*status*|*help*`

### Auto-Reply Delay
Add Wait action (5-10 seconds) before sending reply to seem more natural.