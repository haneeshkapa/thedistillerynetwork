# 🚀 Bluehost Production Deployment Checklist

## 📋 Pre-Deployment Requirements

### ✅ Bluehost Account Setup
- [ ] **VPS or Dedicated Server** purchased (Shared hosting won't work)
- [ ] **SSH Access** enabled in Bluehost control panel
- [ ] **Root/Sudo privileges** confirmed
- [ ] **Domain name** pointed to server IP address
- [ ] **DNS propagation** completed (check with `nslookup yourdomain.com`)

### ✅ External Services
- [ ] **Twilio Account** created and verified
- [ ] **Twilio Phone Number** purchased
- [ ] **Anthropic API Key** obtained from console.anthropic.com
- [ ] **GitHub Repository** created for your SMS bot code

---

## 🏗️ Step 1: Server Preparation

### 1.1 Initial Server Setup
```bash
# SSH into your Bluehost server
ssh your-username@yourdomain.com

# Run the automated server setup script
cd /tmp
wget https://raw.githubusercontent.com/yourusername/your-repo/main/setup/bluehost-server-setup.sh
chmod +x bluehost-server-setup.sh
./bluehost-server-setup.sh
```

**What this installs:**
- [ ] Node.js 18+ and npm
- [ ] PM2 Process Manager
- [ ] MySQL 8.0 database server
- [ ] Redis cache server
- [ ] Nginx web server
- [ ] SSL certificate tools (certbot)
- [ ] Monitoring tools (htop, iotop)
- [ ] Firewall configuration

### 1.2 Secure MySQL Installation
```bash
# Secure MySQL (set root password, remove test databases)
sudo mysql_secure_installation

# Answer the prompts:
# - Set root password: YES (use a strong password)
# - Remove anonymous users: YES
# - Disallow root login remotely: YES
# - Remove test database: YES
# - Reload privilege tables: YES
```

### 1.3 Create Application Database
```bash
# Login to MySQL
mysql -u root -p

# Create database and user
CREATE DATABASE sms_bot_production;
CREATE USER 'sms_bot_user'@'localhost' IDENTIFIED BY 'YourStrongPassword123!';
GRANT ALL PRIVILEGES ON sms_bot_production.* TO 'sms_bot_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### ✅ Server Setup Verification
- [ ] Node.js 18+ installed: `node --version`
- [ ] PM2 installed: `pm2 --version`
- [ ] MySQL running: `sudo systemctl status mysqld`
- [ ] Redis running: `redis-cli ping` returns "PONG"
- [ ] Nginx running: `sudo systemctl status nginx`
- [ ] Firewall configured: `sudo firewall-cmd --list-all` (CentOS) or `sudo ufw status` (Ubuntu)

---

## 🔐 Step 2: SSL Certificate Setup

### 2.1 Get Free SSL Certificate
```bash
# Install SSL certificate for your domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow the prompts:
# - Enter email address for renewal notifications
# - Agree to terms of service: YES
# - Share email with EFF: Your choice
# - Redirect HTTP to HTTPS: YES (recommended)
```

### 2.2 Setup Automatic Renewal
```bash
# Add renewal cron job
sudo crontab -e

# Add this line (runs renewal check twice daily):
0 12 * * * /usr/bin/certbot renew --quiet
```

### ✅ SSL Verification
- [ ] SSL certificate installed successfully
- [ ] Website accessible via HTTPS: `https://yourdomain.com`
- [ ] HTTP redirects to HTTPS automatically
- [ ] SSL test passes: Check at https://www.ssllabs.com/ssltest/

---

## 📦 Step 3: Application Deployment

### 3.1 Configure Environment Variables
```bash
# Create production environment file
cd /var/www/html/sms-bot
cp .env.production.template .env.production
nano .env.production
```

**Required Configuration:**
- [ ] `TWILIO_ACCOUNT_SID` - From Twilio Console
- [ ] `TWILIO_AUTH_TOKEN` - From Twilio Console  
- [ ] `TWILIO_PHONE_NUMBER` - Your Twilio phone number
- [ ] `ANTHROPIC_API_KEY` - From Anthropic Console
- [ ] `MYSQL_PASSWORD` - Database password you created
- [ ] `BASE_URL` - Your domain (https://yourdomain.com)
- [ ] `WEBHOOK_URL` - Your webhook URL (https://yourdomain.com/webhook/sms)
- [ ] `WEBHOOK_SECRET` - Generate a random secret key

### 3.2 Deploy Application Code
```bash
# Option A: Use automated deployment script (recommended)
cd /path/to/your/local/sms-bot
./deploy-to-bluehost.sh

# Option B: Manual deployment
git clone https://github.com/yourusername/your-sms-bot-repo.git /var/www/html/sms-bot
cd /var/www/html/sms-bot
npm install --production
```

### 3.3 Deploy Database Schema
```bash
# Deploy enterprise chat storage schema
mysql -u sms_bot_user -p sms_bot_production < setup/enterprise-chat-schema.sql

# Migrate existing data if upgrading
node migrate-chat-storage.js migrate
```

### 3.4 Configure Nginx
```bash
# Copy Nginx configuration
sudo cp setup/nginx-bluehost.conf /etc/nginx/conf.d/sms-bot.conf

# Edit configuration with your domain name
sudo nano /etc/nginx/conf.d/sms-bot.conf
# Replace 'yourdomain.com' with your actual domain

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### ✅ Application Deployment Verification
- [ ] Application files deployed to `/var/www/html/sms-bot`
- [ ] Dependencies installed successfully: `npm list --production`
- [ ] Database schema deployed: Check tables exist
- [ ] Environment variables configured properly
- [ ] File permissions set correctly: `ls -la /var/www/html/sms-bot`

---

## 🚀 Step 4: Start the Application

### 4.1 Start with PM2
```bash
cd /var/www/html/sms-bot

# Start the application
pm2 start ecosystem.config.js --env production

# Save PM2 configuration
pm2 save

# Enable PM2 startup on server boot
pm2 startup
# Follow the instructions provided by PM2
```

### 4.2 Verify Application Status
```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs sms-bot --lines 50

# Test health endpoint
curl http://localhost:3000/health
curl https://yourdomain.com/health
```

### ✅ Application Startup Verification
- [ ] PM2 shows app as "online": `pm2 status`
- [ ] No errors in logs: `pm2 logs sms-bot`
- [ ] Health endpoint returns success: `/health` returns 200 OK
- [ ] Website loads properly: Visit `https://yourdomain.com`

---

## 📱 Step 5: Configure Twilio Webhook

### 5.1 Set Webhook URL in Twilio
1. **Login to Twilio Console:** https://console.twilio.com
2. **Navigate to Phone Numbers:**
   - Go to **Phone Numbers > Manage > Active Numbers**
   - Click on your SMS-enabled phone number
3. **Configure Webhook:**
   - **Webhook URL:** `https://yourdomain.com/webhook/sms`
   - **HTTP Method:** `POST`
   - **Primary Handler Enabled:** ✅
4. **Save Configuration**

### 5.2 Test SMS Functionality
```bash
# Monitor logs in real-time
pm2 logs sms-bot --lines 0 --follow

# Send a test SMS to your Twilio number
# You should see processing logs appear immediately
```

### ✅ SMS Integration Verification
- [ ] Twilio webhook URL configured correctly
- [ ] Test SMS sent to Twilio number
- [ ] SMS processing appears in logs: `pm2 logs sms-bot`
- [ ] Bot responds with appropriate message
- [ ] Conversation stored in database: Check admin panel

---

## 🔍 Step 6: Production Testing

### 6.1 Comprehensive SMS Test
- [ ] **Basic SMS:** Send "Hello" - should get welcome response
- [ ] **Knowledge Query:** Send technical question - should get detailed response
- [ ] **Conversation Context:** Send follow-up question - should reference previous messages
- [ ] **Error Handling:** Send gibberish - should handle gracefully

### 6.2 Performance Testing
```bash
# Check server resources
htop
free -h
df -h

# Check database performance
mysql -u sms_bot_user -p sms_bot_production -e "SHOW FULL PROCESSLIST;"

# Check Redis performance
redis-cli info memory
```

### 6.3 Admin Panel Testing
- [ ] **Admin Panel Access:** Visit `https://yourdomain.com/admin`
- [ ] **Storage Stats:** Check `/admin/storage/stats` for metrics
- [ ] **Conversation History:** View conversation logs for test phone number
- [ ] **System Health:** All systems showing green status

### ✅ Production Testing Verification
- [ ] All SMS test scenarios pass
- [ ] Server performance is acceptable
- [ ] Admin panel fully functional
- [ ] No error messages in logs
- [ ] Database queries executing efficiently

---

## 📊 Step 7: Monitoring Setup

### 7.1 Configure Log Monitoring
```bash
# Setup log rotation (already done by setup script)
sudo systemctl status logrotate

# Setup daily log monitoring
crontab -e
# Add: 0 9 * * * tail -100 /var/www/html/sms-bot/logs/error.log | mail -s "SMS Bot Daily Errors" your@email.com
```

### 7.2 Setup Health Monitoring
```bash
# Add health check monitoring
crontab -e
# Add: */5 * * * * curl -f https://yourdomain.com/health > /dev/null 2>&1 || echo "SMS Bot Down" | mail -s "ALERT: SMS Bot Health Check Failed" your@email.com
```

### 7.3 Database Backup Verification
```bash
# Test backup script
sudo -u apache /var/www/html/sms-bot/backup-database.sh

# Verify backup was created
ls -la /var/backups/sms-bot/

# Setup automated backups (already done by setup script)
crontab -l | grep backup
```

### ✅ Monitoring Setup Verification
- [ ] Log rotation configured: `/etc/logrotate.d/sms-bot` exists
- [ ] Health check cron job added: `crontab -l` shows health monitoring
- [ ] Database backups working: Test backup script runs successfully
- [ ] Backup files created: Check `/var/backups/sms-bot/`

---

## 🔒 Step 8: Security Hardening

### 8.1 Secure File Permissions
```bash
# Set secure ownership
sudo chown -R apache:apache /var/www/html/sms-bot  # CentOS
# or
sudo chown -R www-data:www-data /var/www/html/sms-bot  # Ubuntu

# Set secure permissions
chmod 755 /var/www/html/sms-bot
chmod 600 /var/www/html/sms-bot/.env.production
```

### 8.2 Firewall Verification
```bash
# Check firewall rules
sudo firewall-cmd --list-all  # CentOS
# or
sudo ufw status verbose  # Ubuntu

# Should only allow SSH (22), HTTP (80), HTTPS (443)
```

### 8.3 Optional: Restrict Admin Access
```bash
# Edit Nginx config to restrict admin panel access
sudo nano /etc/nginx/conf.d/sms-bot.conf

# Uncomment IP restriction lines in /admin location block:
# allow your.ip.address.here;
# deny all;

sudo systemctl reload nginx
```

### ✅ Security Verification
- [ ] File permissions properly secured
- [ ] Firewall only allows necessary ports
- [ ] Environment files not publicly accessible
- [ ] Admin panel access restricted (optional)
- [ ] SSL certificate properly configured

---

## 🎯 Step 9: Final Production Verification

### 9.1 End-to-End Test
1. **Send SMS from your phone** to Twilio number
2. **Verify immediate response** from SMS bot
3. **Check conversation appears** in admin panel
4. **Send follow-up SMS** to test conversation context
5. **Verify AI response** uses previous conversation history

### 9.2 Performance Benchmark
```bash
# Check system metrics
pm2 monit

# Monitor real-time logs
pm2 logs sms-bot --follow
```

### 9.3 Documentation Access
- [ ] **Main Application:** `https://yourdomain.com`
- [ ] **Admin Panel:** `https://yourdomain.com/admin` 
- [ ] **Health Check:** `https://yourdomain.com/health`
- [ ] **API Status:** `https://yourdomain.com/api/status`

---

## ✅ **DEPLOYMENT COMPLETE!** 🎉

### 🎊 **Congratulations!** Your Enterprise SMS Bot is now live on Bluehost with:

**✅ Enterprise Infrastructure:**
- Multi-tier conversation storage (Memory → Redis → MySQL)
- Vector search with semantic understanding
- Automatic conversation archiving
- Real-time monitoring and health checks

**✅ Production Features:**
- SSL-secured HTTPS endpoints
- Process monitoring with PM2
- Automated database backups
- Log rotation and monitoring
- Firewall security

**✅ Scalability:**
- Handles 100,000+ customers
- Multi-CPU clustering
- Intelligent caching
- Database optimization

---

## 🔄 Future Updates

### To deploy updates:
```bash
# From your local development machine:
./deploy-to-bluehost.sh

# Or manually on server:
cd /var/www/html/sms-bot
git pull origin main
npm install --production
pm2 reload sms-bot
```

### Monitor your deployment:
```bash
# Check status
pm2 status

# View logs
pm2 logs sms-bot

# Monitor resources
pm2 monit
```

---

## 🆘 Support & Troubleshooting

### Common Issues:
1. **SMS not working:** Check Twilio webhook URL configuration
2. **Application down:** Check `pm2 logs sms-bot` for errors
3. **Database issues:** Verify MySQL service and credentials
4. **SSL problems:** Run `sudo certbot renew` to refresh certificate

### Get Help:
- **Server Logs:** `pm2 logs sms-bot`
- **System Status:** `sudo systemctl status nginx mysqld redis`
- **Resource Usage:** `htop` and `df -h`
- **Database Status:** `mysql -u sms_bot_user -p -e "SHOW TABLES;"`

**🎉 Your SMS bot is now ready for production traffic!**