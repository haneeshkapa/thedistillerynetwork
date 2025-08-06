# Claude SMS Bot with Google Sheets Integration

Automated SMS customer service bot that uses Claude AI to respond to customer inquiries by pulling order information from Google Sheets.

## 🌟 Features

- **Automated SMS Responses**: Uses Tasker (Android) to intercept and respond to SMS
- **Claude AI Integration**: Generates intelligent, contextual responses
- **Google Sheets Database**: Stores customer orders and information
- **Phone Number Matching**: Finds customers by phone number automatically  
- **Flexible Column Support**: Works with various Google Sheets formats
- **Free Hosting Options**: Deploy on Railway, Render, or Glitch

## 🚀 Quick Start

### 1. Clone and Install
```bash
git clone <your-repo>
cd claude-sms-bot
npm install
```

### 2. Set Up Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Configure Google Sheets
Follow [google-sheets-setup.md](./google-sheets-setup.md)

### 4. Set Up Tasker (Android)
Follow [tasker-setup.md](./tasker-setup.md) 

### 5. Deploy
Follow [deployment-guide.md](./deployment-guide.md)

## 📋 Google Sheets Format

Your sheet should have these columns (flexible naming):
| Name | Phone | OrderID | Product | Status | DeliveryDate | Notes |
|------|-------|---------|---------|--------|--------------|-------|
| John Doe | +1234567890 | #1001 | 10 Gallon Kit | Shipped | 2025-08-10 | Express |

## 🔧 API Endpoints

- `POST /reply` - Main SMS processing endpoint
- `GET /health` - Health check
- `GET /customer/:phone` - Find customer by phone (testing)

## 💬 Example Conversation

**Customer SMS**: "Hey, when will my order arrive?"

**Claude Response**: "Hi John! Your 10 Gallon Kit (Order #1001) was shipped and should arrive by August 10th. Let me know if you need anything else!"

## 🛠️ Environment Variables

```env
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com  
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
ANTHROPIC_API_KEY=your_claude_api_key
PORT=3000
```

## 📱 Tasker Integration

The Tasker profile automatically:
1. Intercepts incoming SMS
2. Sends phone number and message to your server
3. Receives Claude's response  
4. Sends reply SMS back to customer

## 🔒 Security

- Service account authentication for Google Sheets
- Environment variables for all secrets
- No sensitive data in code repository
- HTTPS-only communication

## 🆓 Free Hosting

Works on all major free platforms:
- **Railway**: $5 monthly credits (recommended)
- **Render**: 100% free with cold starts
- **Glitch**: Instant deployment
- **Fly.io**: Advanced users

## 🧪 Testing

```bash
# Start local server
npm run dev

# Test health
curl http://localhost:3000/health

# Test customer lookup
curl http://localhost:3000/customer/1234567890

# Test SMS reply
curl -X POST http://localhost:3000/reply \
  -H "Content-Type: application/json" \
  -d '{"phone":"1234567890","message":"Where is my order?"}'
```

## 📞 Workflow

1. Customer sends SMS to your phone
2. Tasker intercepts the SMS
3. Tasker sends phone + message to your server
4. Server looks up customer in Google Sheets
5. Server asks Claude to generate a response
6. Claude generates personalized reply with order info
7. Server returns reply to Tasker
8. Tasker sends reply SMS to customer

## ⚠️ Requirements  

- Android phone with Tasker app ($3.49)
- Google Cloud account (free)
- Claude API access (Anthropic)
- Google Sheets with order data

## 🤝 Support

Check the setup guides for detailed instructions:
- [Google Sheets Setup](./google-sheets-setup.md)
- [Tasker Configuration](./tasker-setup.md)  
- [Deployment Options](./deployment-guide.md)