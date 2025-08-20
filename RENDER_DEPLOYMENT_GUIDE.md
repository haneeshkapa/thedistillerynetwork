# 🚀 Render Deployment Guide for Enterprise SMS Bot

## 📋 **Why Render?**

Render is perfect for testing because:
- ✅ **Free tier** available for development
- ✅ **PostgreSQL & Redis** included
- ✅ **Easy deployment** from GitHub
- ✅ **Auto-scaling** and monitoring
- ✅ **SSL certificates** automatic
- ✅ **Environment variables** easy to configure

---

## 🏗️ **Step 1: Prepare Your Code**

### 1.1 Push to GitHub
```bash
# Make sure all changes are committed
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 1.2 Files Created for Render
- ✅ `render.yaml` - Render configuration
- ✅ `.env.render.template` - Environment variables template
- ✅ `enterprise-chat-storage-postgres.js` - PostgreSQL version for Render

---

## 🌐 **Step 2: Create Render Services**

### 2.1 Sign Up for Render
1. Go to [render.com](https://render.com)
2. Sign up with your GitHub account
3. Connect your repository

### 2.2 Create PostgreSQL Database
1. **New → PostgreSQL**
2. **Name:** `sms-bot-db`
3. **Database:** `sms_bot_production`
4. **User:** `sms_bot_user`
5. **Plan:** Starter (free)
6. **Create Database**
7. **Copy the DATABASE_URL** (you'll need this)

### 2.3 Create Redis Instance
1. **New → Redis**
2. **Name:** `sms-bot-redis`
3. **Plan:** Starter (free)
4. **Create Redis**
5. **Copy the REDIS_URL** (you'll need this)

### 2.4 Create Web Service
1. **New → Web Service**
2. **Connect Repository:** Select your SMS bot repo
3. **Name:** `sms-bot-enterprise`
4. **Environment:** Node
5. **Build Command:** `npm install`
6. **Start Command:** `npm start`

---

## ⚙️ **Step 3: Configure Environment Variables**

In your Render web service, add these environment variables:

### Required Variables:
```bash
NODE_ENV=production
PORT=10000

# Twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Claude AI
ANTHROPIC_API_KEY=your_anthropic_api_key

# Google Sheets
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
Your private key here
-----END PRIVATE KEY-----"

# Database (copy from Render PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis (copy from Render Redis)
REDIS_URL=redis://host:port

# App URLs (replace with your Render URL)
BASE_URL=https://your-app-name.onrender.com
WEBHOOK_URL=https://your-app-name.onrender.com/webhook/sms

# Security
WEBHOOK_SECRET=your_secure_random_string
ADMIN_PIN=your_admin_pin
```

---

## 🔧 **Step 4: Update Code for PostgreSQL**

Create the PostgreSQL storage adapter:

### 4.1 Create PostgreSQL Storage