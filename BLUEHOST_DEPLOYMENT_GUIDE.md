# 🚀 Complete Bluehost Deployment Guide for Enterprise SMS Bot

## 📋 **Prerequisites**

### Bluehost Requirements:
- **VPS or Dedicated Server** (Shared hosting won't support Node.js applications)
- **SSH Access** enabled
- **Root/Sudo Access** for installing dependencies
- **Domain** pointed to your Bluehost server
- **SSL Certificate** (free via Bluehost/Let's Encrypt)

### External Services:
- **Twilio Account** (SMS provider)
- **Anthropic API Key** (Claude AI)
- **GitHub Repository** (for code deployment)

---

## 🏗️ **Step 1: Bluehost Server Setup**

### 1.1 Connect to Your Bluehost Server
```bash
# SSH into your Bluehost server
ssh username@your-domain.com
# or
ssh username@your-server-ip
```

### 1.2 Install Node.js and Dependencies
```bash
# Update system
sudo yum update -y  # For CentOS/RHEL
# or
sudo apt update && sudo apt upgrade -y  # For Ubuntu/Debian

# Install Node.js 18+ (required for this application)
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -  # CentOS
sudo yum install -y nodejs

# For Ubuntu/Debian:
# curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
# sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v18+
npm --version
```

### 1.3 Install Process Manager (PM2)
```bash
sudo npm install -g pm2
pm2 --version
```

### 1.4 Install MySQL 8.0
```bash
# For CentOS/RHEL:
sudo yum install -y mysql-server mysql
sudo systemctl start mysqld
sudo systemctl enable mysqld

# For Ubuntu/Debian:
# sudo apt install -y mysql-server mysql-client

# Secure MySQL installation
sudo mysql_secure_installation
```

### 1.5 Install Redis
```bash
# For CentOS/RHEL:
sudo yum install -y redis
sudo systemctl start redis
sudo systemctl enable redis

# For Ubuntu/Debian:
# sudo apt install -y redis-server
# sudo systemctl start redis-server
# sudo systemctl enable redis-server

# Test Redis
redis-cli ping  # Should return "PONG"
```

---

## 🗄️ **Step 2: Database Setup**

### 2.1 Create MySQL User and Database
```bash
# Login to MySQL as root
mysql -u root -p

# Create database and user
CREATE DATABASE sms_bot_production;
CREATE USER 'sms_bot_user'@'localhost' IDENTIFIED BY 'YourStrongPassword123!';
GRANT ALL PRIVILEGES ON sms_bot_production.* TO 'sms_bot_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 2.2 Configure MySQL for Production
```bash
# Edit MySQL configuration
sudo nano /etc/my.cnf
# Add these optimizations:
```

```ini
[mysqld]
# Performance optimizations for SMS bot
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
max_connections = 200
query_cache_size = 64M
tmp_table_size = 64M
max_heap_table_size = 64M

# Enable binary logging for backups
log-bin = mysql-bin
expire_logs_days = 7
```

```bash
# Restart MySQL
sudo systemctl restart mysqld
```

---

## 📦 **Step 3: Deploy Application Code**

### 3.1 Clone Repository
```bash
# Navigate to web directory
cd /var/www/html
# or your preferred directory

# Clone your SMS bot repository
git clone https://github.com/yourusername/your-sms-bot-repo.git sms-bot
cd sms-bot

# Install dependencies
npm install --production
```

### 3.2 Create Production Environment File
```bash
# Create production environment configuration
nano .env.production
```

```env
# Production Environment Configuration for Bluehost
NODE_ENV=production

# Server Configuration
PORT=3000
HOST=0.0.0.0

# Twilio Configuration (SMS Provider)
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here

# Claude AI Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# MySQL Database Configuration (Production)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=sms_bot_user
MYSQL_PASSWORD=YourStrongPassword123!
MYSQL_DATABASE=sms_bot_production

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Enterprise Storage Configuration
MAX_ACTIVE_CONVERSATIONS=5000
MAX_MESSAGES_PER_CUSTOMER=100
ARCHIVE_AFTER_DAYS=90
COMPRESSION_ENABLED=true

# Performance Configuration
MYSQL_CONNECTION_LIMIT=50
REDIS_MEMORY_LIMIT=1gb
STORAGE_BATCH_SIZE=500

# Monitoring Configuration
ENABLE_MONITORING=true
LOG_LEVEL=info
ENABLE_EXTERNAL_MONITORING=false

# Security Configuration
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100
WEBHOOK_SECRET=your_webhook_secret_here

# Backup Configuration
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30

# Domain Configuration
BASE_URL=https://yourdomain.com
WEBHOOK_URL=https://yourdomain.com/webhook/sms
```

### 3.3 Deploy Database Schema
```bash
# Deploy enterprise chat storage schema
mysql -u sms_bot_user -p sms_bot_production < setup/enterprise-chat-schema.sql

# Migrate existing data if needed
node migrate-chat-storage.js migrate
```

---

## 🔧 **Step 4: Configure Web Server**

### 4.1 Install and Configure Nginx
```bash
# Install Nginx
sudo yum install -y nginx  # CentOS
# or
# sudo apt install -y nginx  # Ubuntu

# Create Nginx configuration
sudo nano /etc/nginx/conf.d/sms-bot.conf
```

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /etc/ssl/certs/yourdomain.pem;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
    
    # Main application proxy
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Webhook endpoint (critical for SMS)
    location /webhook {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # No caching for webhooks
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    
    # Admin panel (secure)
    location /admin {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Optional: Add IP restriction for admin panel
        # allow your.ip.address.here;
        # deny all;
    }
    
    # Static files (if any)
    location /static {
        alias /var/www/html/sms-bot/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
```

```bash
# Test Nginx configuration
sudo nginx -t

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 4.2 SSL Certificate Setup
```bash
# Install Certbot for free SSL
sudo yum install -y certbot python3-certbot-nginx  # CentOS
# or
# sudo apt install -y certbot python3-certbot-nginx  # Ubuntu

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Set up automatic renewal
sudo crontab -e
# Add this line:
0 12 * * * /usr/bin/certbot renew --quiet
```

---

## 🚀 **Step 5: Start the Application**

### 5.1 Create PM2 Ecosystem File
```bash
nano ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'sms-bot',
    script: 'server.js',
    env_file: '.env.production',
    instances: 'max', // Use all CPU cores
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    
    // Auto-restart configuration
    watch: false,
    ignore_watch: ['node_modules', 'logs'],
    restart_delay: 1000,
    max_restarts: 5,
    min_uptime: '10s',
    
    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

### 5.2 Create Logs Directory and Start
```bash
# Create logs directory
mkdir -p logs

# Start the application with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Enable PM2 to start on server boot
pm2 startup
# Follow the instructions that PM2 provides
```

### 5.3 Verify Deployment
```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs sms-bot

# Test the application
curl http://localhost:3000/health
curl https://yourdomain.com/health
```

---

## ⚙️ **Step 6: Configure Monitoring & Backups**

### 6.1 Set Up Log Rotation
```bash
sudo nano /etc/logrotate.d/sms-bot
```

```bash
/var/www/html/sms-bot/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 6.2 Database Backup Script
```bash
# Create backup script
nano backup-database.sh
chmod +x backup-database.sh
```

```bash
#!/bin/bash
# SMS Bot Database Backup Script

BACKUP_DIR="/var/backups/sms-bot"
DB_NAME="sms_bot_production"
DB_USER="sms_bot_user"
DB_PASS="YourStrongPassword123!"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Create database dump
mysqldump -u $DB_USER -p$DB_PASS $DB_NAME > $BACKUP_DIR/sms_bot_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/sms_bot_$DATE.sql

# Remove backups older than 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: sms_bot_$DATE.sql.gz"
```

### 6.3 Set Up Cron Jobs
```bash
# Edit crontab
crontab -e

# Add these lines:
# Daily database backup at 2 AM
0 2 * * * /var/www/html/sms-bot/backup-database.sh >> /var/log/sms-bot-backup.log 2>&1

# Weekly log cleanup
0 0 * * 0 find /var/www/html/sms-bot/logs -name "*.log" -mtime +7 -delete

# Daily application health check
*/15 * * * * curl -f http://localhost:3000/health > /dev/null 2>&1 || pm2 restart sms-bot
```

---

## 🔐 **Step 7: Security Configuration**

### 7.1 Firewall Setup
```bash
# Install and configure firewall
sudo yum install -y firewalld  # CentOS
sudo systemctl start firewalld
sudo systemctl enable firewalld

# Open necessary ports
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh

# Optional: Open specific port for debugging
# sudo firewall-cmd --permanent --add-port=3000/tcp

sudo firewall-cmd --reload

# Check firewall status
sudo firewall-cmd --list-all
```

### 7.2 Secure File Permissions
```bash
# Set proper ownership
sudo chown -R www-data:www-data /var/www/html/sms-bot  # Ubuntu
# or
sudo chown -R apache:apache /var/www/html/sms-bot  # CentOS

# Set secure permissions
chmod 755 /var/www/html/sms-bot
chmod 600 /var/www/html/sms-bot/.env.production
chmod +x /var/www/html/sms-bot/backup-database.sh
```

---

## 📱 **Step 8: Configure Twilio Webhook**

### 8.1 Set Webhook URL in Twilio Console
1. Log into [Twilio Console](https://console.twilio.com)
2. Go to **Phone Numbers > Manage > Active Numbers**
3. Click your SMS-enabled phone number
4. Set **Webhook URL** to: `https://yourdomain.com/webhook/sms`
5. Set **HTTP Method** to: `POST`
6. **Save Configuration**

### 8.2 Test SMS Flow
```bash
# Monitor logs in real-time
pm2 logs sms-bot --lines 50

# Send test SMS to your Twilio number
# Check logs for processing
```

---

## 🎯 **Step 9: Final Verification**

### 9.1 Application Health Check
```bash
# Check all services are running
systemctl status nginx
systemctl status mysqld
systemctl status redis
pm2 status

# Test database connection
mysql -u sms_bot_user -p sms_bot_production -e "SELECT COUNT(*) FROM enterprise_conversations;"

# Test Redis connection
redis-cli ping

# Test application endpoints
curl -k https://yourdomain.com/health
curl -k https://yourdomain.com/admin/status
```

### 9.2 Performance Test
```bash
# Check server resources
free -h
df -h
top

# Test conversation retrieval
curl -X POST https://yourdomain.com/admin/storage/conversations/PHONE_NUMBER \
  -H "Content-Type: application/json"
```

---

## 🔄 **Step 10: Deployment Updates**

### 10.1 Create Deployment Script
```bash
nano deploy-update.sh
chmod +x deploy-update.sh
```

```bash
#!/bin/bash
# SMS Bot Update Deployment Script

echo "🚀 Starting SMS Bot deployment update..."

# Pull latest code
git pull origin main

# Install/update dependencies
npm install --production

# Run database migrations if any
node migrate-chat-storage.js verify

# Restart application with zero downtime
pm2 reload sms-bot

echo "✅ Deployment completed successfully!"

# Show status
pm2 status
```

### 10.2 Zero-Downtime Updates
```bash
# For updates, use:
./deploy-update.sh

# Monitor deployment
pm2 logs sms-bot --lines 20
```

---

## 🆘 **Troubleshooting**

### Common Issues:

**1. Application Won't Start:**
```bash
# Check logs
pm2 logs sms-bot
# Check environment variables
cat .env.production
# Test database connection
mysql -u sms_bot_user -p sms_bot_production -e "SHOW TABLES;"
```

**2. SMS Not Working:**
```bash
# Check webhook URL is accessible
curl -X POST https://yourdomain.com/webhook/sms \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=%2B1234567890&Body=test"

# Check Twilio configuration in .env.production
```

**3. Database Issues:**
```bash
# Check MySQL status
sudo systemctl status mysqld
# Check connection
mysql -u sms_bot_user -p -e "SELECT 1;"
# Check disk space
df -h
```

**4. Performance Issues:**
```bash
# Check server resources
htop
free -m
# Check MySQL performance
mysql -u root -p -e "SHOW FULL PROCESSLIST;"
# Restart services if needed
sudo systemctl restart redis
pm2 reload sms-bot
```

---

## 📊 **Monitoring Dashboard URLs**

After deployment, access these URLs:
- **Main Application**: `https://yourdomain.com`
- **Admin Panel**: `https://yourdomain.com/admin`
- **Health Check**: `https://yourdomain.com/health`
- **Storage Stats**: `https://yourdomain.com/admin/storage/stats`

---

## ✅ **Deployment Checklist**

- [ ] Bluehost VPS/Dedicated server set up
- [ ] Node.js 18+ installed
- [ ] MySQL 8.0 configured and running
- [ ] Redis installed and running
- [ ] Application code deployed
- [ ] Environment variables configured
- [ ] Database schema deployed
- [ ] SSL certificate installed
- [ ] Nginx configured and running
- [ ] PM2 process manager configured
- [ ] Firewall configured
- [ ] Twilio webhook URL set
- [ ] Backup scripts configured
- [ ] Monitoring set up
- [ ] Test SMS flow working
- [ ] Health checks passing

**🎉 Your Enterprise SMS Bot is now live on Bluehost!**