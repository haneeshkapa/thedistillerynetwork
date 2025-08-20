# How to Build an Enterprise SMS Bot with AI Integration

## Overview
Build a comprehensive SMS bot application that integrates with Claude AI, Google Sheets customer database, Shopify, and supports automated SMS responses with customer context awareness.

## Core Features to Implement

### 1. **SMS Processing System**
- **Twilio Integration**: Handle incoming SMS via webhook
- **Tasker Integration**: Android automation for SMS forwarding
- **Customer Validation**: Only respond to known customers from database
- **Rate Limiting**: Prevent spam and manage API costs

### 2. **AI Integration**
- **Claude API**: Primary AI for generating responses
- **Context Awareness**: Include customer history and order status
- **Personality System**: Configurable bot personality (friendly business owner)
- **Knowledge Base**: Product information and FAQ integration

### 3. **Customer Database Integration**
- **Google Sheets**: Customer lookup by phone number
- **Order History**: Access to purchase history
- **Customer Status**: Track order status and priority levels
- **Real-time Updates**: Sync customer data automatically

### 4. **Knowledge Management**
- **File Upload**: PDF, Excel, text file processing
- **Dynamic Updates**: Admin can update knowledge without restart
- **Search System**: Relevant knowledge retrieval for responses
- **Version Control**: Track knowledge updates

### 5. **Admin Dashboard**
- **Web Interface**: Management portal with authentication
- **Real-time Logs**: Monitor SMS conversations
- **Analytics**: Response times, customer satisfaction
- **Configuration**: Update settings without code changes

## Technical Architecture

### **Backend Stack**
```
- Node.js + Express (REST API)
- PostgreSQL (production) / MySQL (local development)
- Redis (caching and session storage)
- Anthropic Claude API (AI responses)
- Google Sheets API (customer database)
- Shopify API (e-commerce integration)
- Twilio API (SMS handling)
```

### **Key Dependencies**
```json
{
  "express": "^4.18.0",
  "pg": "^8.8.0", 
  "@anthropic-ai/sdk": "^0.24.0",
  "google-spreadsheet": "^4.1.0",
  "twilio": "^4.20.0",
  "multer": "^1.4.5",
  "pdf-parse": "^1.1.1",
  "xlsx": "^0.18.5",
  "node-cron": "^3.0.3",
  "express-session": "^1.17.0",
  "cors": "^2.8.5",
  "winston": "^3.8.0"
}
```

### **Directory Structure**
```
sms-bot/
├── server.js                 # Main application entry
├── package.json
├── .env                      # Environment variables
├── data/
│   ├── knowledge.json        # Knowledge base storage
│   ├── personality.json      # Bot personality config
│   └── admin.json           # Admin settings
├── logs/                    # Application logs
├── uploads/                 # File upload storage
├── public/
│   ├── management.html      # Admin dashboard
│   ├── login.html          # Authentication
│   └── upload.html         # File upload interface
├── modules/
│   ├── logger.js           # Logging system
│   ├── shopify-service.js  # Shopify integration
│   ├── enhanced-sheets-service.js  # Google Sheets
│   ├── knowledge-retriever-postgres.js  # Knowledge system
│   ├── optimized-reply-handler.js      # AI processing
│   └── enterprise-chat-storage.js      # Conversation storage
└── setup/
    ├── schema.sql          # Database schema
    └── configure-bluehost.js  # Deployment config
```

## Implementation Steps

### **Phase 1: Core Infrastructure (Week 1)**

#### 1. Project Setup
```bash
mkdir sms-bot && cd sms-bot
npm init -y
npm install express pg @anthropic-ai/sdk google-spreadsheet cors dotenv
```

#### 2. Basic Express Server
```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`SMS Bot server running on port ${port}`);
});
```

#### 3. Environment Configuration
```env
# API Keys
ANTHROPIC_API_KEY=your_claude_api_key
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your_google_sheet_id

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/sms_bot
REDIS_URL=redis://localhost:6379

# Shopify (optional)
SHOPIFY_SHOP_NAME=your_shop
SHOPIFY_ACCESS_TOKEN=your_access_token

# Security
SESSION_SECRET=your_random_session_secret
ADMIN_PIN=1234
```

### **Phase 2: Database & Storage (Week 2)**

#### 1. PostgreSQL Schema
```sql
-- conversations table
CREATE TABLE distillation_conversations (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL,
    customer_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    customer_info JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_time INTEGER,
    provider VARCHAR(50),
    tokens_used INTEGER
);

-- knowledge_base table
CREATE TABLE knowledge_base (
    id SERIAL PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT[],
    priority INTEGER DEFAULT 5,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_conversations_phone ON distillation_conversations(phone);
CREATE INDEX idx_conversations_created_at ON distillation_conversations(created_at);
CREATE INDEX idx_knowledge_category ON knowledge_base(category);
CREATE INDEX idx_knowledge_keywords ON knowledge_base USING GIN(keywords);
```

#### 2. Database Connection Module
```javascript
// db-connection.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};
```

### **Phase 3: AI Integration (Week 3)**

#### 1. Claude API Integration
```javascript
// ai-service.js
const Anthropic = require('@anthropic-ai/sdk');

class AIService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generateResponse(prompt, customerContext = null) {
    try {
      const systemPrompt = this.buildSystemPrompt(customerContext);
      
      const response = await this.anthropic.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      });

      return {
        text: response.content[0].text,
        tokens: response.usage?.total_tokens || 0,
        model: 'claude-3-sonnet'
      };
    } catch (error) {
      console.error('Claude API error:', error);
      return {
        text: "I'm having trouble processing your message right now. Please try again.",
        tokens: 0,
        model: 'fallback'
      };
    }
  }

  buildSystemPrompt(customerContext) {
    return `You are Jonathan, owner of American Copper Works. You make quality copper moonshine stills.

PERSONALITY:
- Friendly, down-to-earth, knowledgeable about distillation
- Keep responses conversational and SMS-friendly (under 160 chars when possible)
- You're passionate about your craft but also just a regular person

${customerContext ? `CUSTOMER CONTEXT:\n${JSON.stringify(customerContext, null, 2)}` : ''}

BUSINESS INFO:
- Website: moonshinestills.com
- Phone: (603) 997-6786  
- Email: tdnorders@gmail.com
- Free shipping to continental USA`;
  }
}

module.exports = AIService;
```

#### 2. Knowledge Base Integration
```javascript
// knowledge-service.js
const db = require('./db-connection');

class KnowledgeService {
  async getRelevantKnowledge(query, limit = 3) {
    try {
      const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
      
      if (queryWords.length === 0) return '';

      // Search by keywords and content
      const result = await db.query(`
        SELECT title, content, category, priority
        FROM knowledge_base 
        WHERE is_active = true 
        AND (
          keywords && $1 
          OR content ILIKE ANY($2)
          OR title ILIKE ANY($2)
        )
        ORDER BY priority DESC, created_at DESC
        LIMIT $3
      `, [
        queryWords,
        queryWords.map(word => `%${word}%`),
        limit
      ]);

      return result.rows.map(row => 
        `[${row.category}] ${row.title}: ${row.content}`
      ).join('\n\n');
      
    } catch (error) {
      console.error('Knowledge retrieval error:', error);
      return 'Basic product information available on request.';
    }
  }

  async addKnowledge(category, title, content, keywords = []) {
    try {
      const result = await db.query(`
        INSERT INTO knowledge_base (category, title, content, keywords)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [category, title, content, keywords]);
      
      return result.rows[0].id;
    } catch (error) {
      console.error('Knowledge creation error:', error);
      throw error;
    }
  }
}

module.exports = KnowledgeService;
```

### **Phase 4: SMS Integration (Week 4)**

#### 1. Twilio Webhook Handler
```javascript
// sms-handler.js
app.post('/sms/webhook', async (req, res) => {
  try {
    const { From: phone, Body: message } = req.body;
    
    // Validate customer exists in database
    const customer = await findCustomerByPhone(phone);
    if (!customer) {
      console.log(`Unknown number ${phone} - ignoring message`);
      return res.status(200).send('OK'); // Don't respond to unknown numbers
    }

    // Get conversation history
    const history = await getConversationHistory(phone, 5);
    
    // Get relevant knowledge
    const knowledge = await knowledgeService.getRelevantKnowledge(message);
    
    // Generate AI response
    const aiResponse = await aiService.generateResponse(message, {
      customer: customer,
      history: history,
      knowledge: knowledge
    });

    // Store conversation
    await storeConversation(phone, message, aiResponse.text, customer);

    // Send SMS response via Twilio
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(aiResponse.text);
    
    res.type('text/xml').send(twiml.toString());
    
  } catch (error) {
    console.error('SMS processing error:', error);
    res.status(500).send('Internal Server Error');
  }
});
```

#### 2. Tasker Integration Endpoint
```javascript
// Tasker SMS forwarding endpoint
app.post('/tasker/sms', async (req, res) => {
  try {
    const { phone, message, sender_name } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ 
        error: 'Phone and message are required' 
      });
    }

    // Process the SMS (reuse existing logic)
    const result = await processIncomingSMS(phone, message, 'tasker');
    
    // Return structured response for Tasker
    res.json({
      success: true,
      response: result.message,
      customer: result.customerInfo,
      conversation_context: result.context || 'New conversation',
      processing_time: Date.now() - Date.now(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Tasker SMS processing failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process SMS',
      message: 'Sorry, I\'m having trouble right now. Please try again in a moment.'
    });
  }
});
```

### **Phase 5: Google Sheets Integration (Week 5)**

```javascript
// sheets-service.js
const { GoogleSpreadsheet } = require('google-spreadsheet');

class SheetsService {
  constructor() {
    this.doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    this.initialized = false;
  }

  async initialize() {
    try {
      await this.doc.useServiceAccountAuth({
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
      
      await this.doc.loadInfo();
      this.sheet = this.doc.sheetsByIndex[0]; // First sheet
      this.initialized = true;
      
      console.log('Google Sheets connected:', this.doc.title);
    } catch (error) {
      console.error('Google Sheets connection failed:', error);
    }
  }

  async findCustomerByPhone(phone) {
    if (!this.initialized) await this.initialize();
    if (!this.sheet) return null;

    try {
      const normalizedPhone = this.normalizePhone(phone);
      const rows = await this.sheet.getRows();
      
      return rows.find(row => 
        this.normalizePhone(row._rawData[6]) === normalizedPhone ||
        this.normalizePhone(row.phone) === normalizedPhone
      );
    } catch (error) {
      console.error('Customer lookup error:', error);
      return null;
    }
  }

  normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').replace(/^1/, ''); // Remove non-digits and leading 1
  }
}

module.exports = SheetsService;
```

### **Phase 6: Admin Dashboard (Week 6)**

#### 1. Authentication System
```javascript
// auth-middleware.js
const session = require('express-session');

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.post('/admin/login', (req, res) => {
  const { pin } = req.body;
  
  if (pin === process.env.ADMIN_PIN) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid PIN' });
  }
});

// Middleware to protect admin routes
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
};
```

#### 2. Admin Endpoints
```javascript
// Get conversation logs
app.get('/admin/conversations', requireAuth, async (req, res) => {
  try {
    const { phone, limit = 50 } = req.query;
    
    let query = 'SELECT * FROM distillation_conversations';
    let params = [];
    
    if (phone) {
      query += ' WHERE phone = $1';
      params.push(phone);
    }
    
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));
    
    const result = await db.query(query, params);
    res.json(result.rows);
    
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Update knowledge base
app.post('/admin/knowledge', requireAuth, async (req, res) => {
  try {
    const { category, title, content, keywords } = req.body;
    
    const id = await knowledgeService.addKnowledge(
      category, title, content, keywords
    );
    
    res.json({ success: true, id });
  } catch (error) {
    console.error('Knowledge update error:', error);
    res.status(500).json({ error: 'Failed to update knowledge' });
  }
});
```

### **Phase 7: Production Deployment**

#### 1. Environment Setup
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["node", "server.js"]
```

#### 2. Deploy to Render/Heroku
```yaml
# render.yaml
services:
  - type: web
    name: sms-bot
    env: node
    buildCommand: npm ci
    startCommand: node server.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: DATABASE_URL
        sync: false
```

#### 3. Database Migration Script
```javascript
// migrate.js
const db = require('./db-connection');
const fs = require('fs');

async function runMigrations() {
  try {
    const schema = fs.readFileSync('./setup/schema.sql', 'utf8');
    await db.query(schema);
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

if (require.main === module) {
  runMigrations().then(() => process.exit(0));
}
```

## Testing & Quality Assurance

### **Unit Tests**
```javascript
// tests/ai-service.test.js
const AIService = require('../ai-service');

describe('AIService', () => {
  let aiService;
  
  beforeEach(() => {
    aiService = new AIService();
  });

  test('should generate response for basic query', async () => {
    const result = await aiService.generateResponse('What stills do you have?');
    
    expect(result.text).toBeTruthy();
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.model).toBeDefined();
  });
});
```

### **Integration Tests**
```javascript
// tests/sms-integration.test.js
const request = require('supertest');
const app = require('../server');

describe('SMS Integration', () => {
  test('should handle Tasker SMS endpoint', async () => {
    const response = await request(app)
      .post('/tasker/sms')
      .send({
        phone: '+15551234567',
        message: 'Test message'
      });
    
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success');
    expect(response.body).toHaveProperty('response');
  });
});
```

## Performance Optimization

### **Caching Strategy**
```javascript
// cache-service.js
const Redis = require('redis');
const client = Redis.createClient(process.env.REDIS_URL);

class CacheService {
  async get(key) {
    try {
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, value, expireSeconds = 3600) {
    try {
      await client.setEx(key, expireSeconds, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }
}
```

### **Rate Limiting**
```javascript
// rate-limiter.js
const rateLimit = require('express-rate-limit');

const smsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each phone number to 10 requests per windowMs
  keyGenerator: (req) => req.body.phone || req.ip,
  message: { error: 'Too many messages, please try again later' }
});

app.use('/tasker/sms', smsLimiter);
```

## Security Best Practices

1. **Environment Variables**: Never commit API keys
2. **Input Validation**: Sanitize all user inputs
3. **Authentication**: Secure admin endpoints
4. **Rate Limiting**: Prevent API abuse
5. **Error Handling**: Don't expose internal details
6. **HTTPS**: Use SSL certificates in production
7. **Database Security**: Use connection pooling and prepared statements

## Monitoring & Logging

```javascript
// logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

## Final Checklist

### **Development Complete**
- [ ] SMS webhook handling (Twilio + Tasker)
- [ ] Claude AI integration with context
- [ ] Google Sheets customer database
- [ ] Knowledge base management
- [ ] Admin dashboard with authentication
- [ ] Conversation history storage
- [ ] Error handling and logging
- [ ] Rate limiting and security

### **Production Ready**
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] SSL certificate installed
- [ ] Monitoring and alerts setup
- [ ] Backup strategy implemented
- [ ] Performance testing completed
- [ ] Security audit passed

This guide provides a complete roadmap for building a production-ready SMS bot with AI integration. Each phase builds upon the previous one, allowing for iterative development and testing.