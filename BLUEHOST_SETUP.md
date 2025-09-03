# Bluehost MySQL Deployment Guide

This guide will help you deploy the SMS Bot to Bluehost using MySQL instead of PostgreSQL.

## 📋 Prerequisites

### 1. Bluehost Requirements
- Bluehost hosting account with SSH access
- MySQL database created (`dashboard_sms_bot_production`)
- Node.js support (18+)
- Domain configured

### 2. Local Requirements
- SSH key configured for Bluehost
- Node.js 18+ installed locally
- Git repository access

## 🔧 Setup Steps

### Step 1: Configure Database

1. **Create MySQL Database in Bluehost cPanel:**
   - Go to cPanel → MySQL Databases
   - Create database: `dashboard_sms_bot_production`
   - Create user with full privileges
   - Note down: hostname, username, password

### Step 2: Configure Environment

1. **Edit `.env.bluehost` file:**
```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=dashboard_sms_bot_production
DB_USER=your_mysql_username
DB_PASSWORD=your_mysql_password

# Copy all other settings from your current .env file
ANTHROPIC_API_KEY=your_actual_key
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_actual_email
# ... etc
```

### Step 3: Configure SSH Access

1. **Update deployment script:**
   - Edit `deploy-bluehost.sh`
   - Set `REMOTE_HOST` to your domain
   - Set `REMOTE_USER` to your Bluehost username
   - Set `REMOTE_PATH` to your desired installation path

2. **Test SSH connection:**
```bash
ssh your_username@your_domain.com
```

### Step 4: Deploy Application

1. **Run deployment script:**
```bash
./deploy-bluehost.sh
```

The script will:
- ✅ Create deployment package
- ✅ Upload files to server
- ✅ Install dependencies
- ✅ Run database migration
- ✅ Start application with PM2

### Step 5: Verify Deployment

1. **Check health endpoint:**
```bash
curl http://your-domain.com/health
```

2. **Access management dashboard:**
```
http://your-domain.com/management.html
```

3. **Test SMS functionality:**
```bash
curl -X POST http://your-domain.com/reply \
  -H "Content-Type: application/json" \
  -d '{"phone": "test_phone", "text": "test message"}'
```

## 📊 Database Migration

The deployment automatically migrates data from PostgreSQL to MySQL:

```bash
# Manual migration (if needed)
node migrate-mysql.js
```

**Migration includes:**
- ✅ Conversations
- ✅ Messages
- ✅ Knowledge base
- ✅ Personality settings
- ✅ System instructions
- ✅ Logs (recent 1000 entries)

## 🔄 Application Management

### With PM2 (Recommended)
```bash
# Status
pm2 status

# Logs
pm2 logs sms-bot

# Restart
pm2 restart sms-bot

# Stop
pm2 stop sms-bot
```

### Without PM2
```bash
# Check if running
ps aux | grep node

# Stop application
kill $(cat app.pid)

# Start application
nohup node server.js > logs/app.log 2>&1 &
echo $! > app.pid
```

## 🛠️ Troubleshooting

### Database Connection Issues
```bash
# Test MySQL connection
mysql -h localhost -u your_user -p your_database
```

### Application Not Starting
```bash
# Check logs
tail -f logs/error.log
tail -f logs/combined.log

# Check PM2 logs
pm2 logs sms-bot --lines 50
```

### Permission Issues
```bash
# Fix file permissions
chmod 755 server.js
chmod -R 755 public/
```

### Memory Issues
```bash
# Check memory usage
free -h

# Restart with memory limit
pm2 restart sms-bot --max-memory-restart 256M
```

## 🔒 Security Considerations

1. **Secure .env file:**
```bash
chmod 600 .env
```

2. **Firewall configuration:**
   - Allow port 3000 (or configured port)
   - Restrict MySQL access

3. **SSL/TLS:**
   - Configure SSL certificate
   - Update Twilio webhooks to HTTPS

## 📈 Monitoring

### Key Endpoints
- **Health:** `/health`
- **Admin:** `/api/conversations`
- **Management:** `/management.html`

### Log Files
- **Application:** `logs/combined.log`
- **Errors:** `logs/error.log`
- **PM2:** `~/.pm2/logs/`

## 🔄 Updates

To deploy updates:

1. **Pull latest code:**
```bash
git pull origin main
```

2. **Run deployment:**
```bash
./deploy-bluehost.sh
```

3. **Verify health:**
```bash
curl http://your-domain.com/health
```

## 📞 Support

If you encounter issues:

1. Check application logs
2. Verify database connectivity
3. Test SMS endpoints manually
4. Review Twilio webhook configuration

## 🎯 Next Steps

After successful deployment:

1. **Update Twilio webhooks** to point to your Bluehost domain
2. **Test SMS functionality** with real phone numbers
3. **Monitor application** using the management dashboard
4. **Set up regular backups** of your MySQL database

---

**Your SMS Bot is now running on Bluehost with MySQL! 🚀**