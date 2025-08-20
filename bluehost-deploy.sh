#!/bin/bash
# Enhanced SMS Bot Deployment Script for Bluehost VPS
# Run this script on your Bluehost VPS after uploading files

set -e  # Exit on any error

echo "🚀 Starting Enhanced SMS Bot deployment on Bluehost VPS..."

# 1. Install Node.js (if not installed)
echo "📦 Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

node --version
npm --version

# 2. Install system dependencies
echo "📦 Installing system dependencies..."
sudo apt update
sudo apt install -y mysql-server redis-server nginx

# 3. Start services
echo "🔧 Starting services..."
sudo systemctl start mysql
sudo systemctl start redis-server
sudo systemctl enable mysql
sudo systemctl enable redis-server

# 4. Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

# 5. Install project dependencies
echo "📦 Installing project dependencies..."
npm ci --production

# 6. Setup database
echo "🗄️ Setting up database..."
mysql -u root -p <<EOF
CREATE DATABASE IF NOT EXISTS sms_bot_production;
CREATE USER IF NOT EXISTS 'sms_bot'@'localhost' IDENTIFIED BY 'smsbot123';
GRANT ALL PRIVILEGES ON sms_bot_production.* TO 'sms_bot'@'localhost';
FLUSH PRIVILEGES;
EXIT
EOF

# Import database schema
mysql -u sms_bot -psmsbot123 sms_bot_production < setup/schema.sql

# 7. Create logs directory
mkdir -p logs

# 8. Set up environment
if [ ! -f .env.production ]; then
    echo "⚠️  Please create .env.production file with your production settings"
    echo "See .env.example for reference"
    exit 1
fi

cp .env.production .env

# 9. Start application with PM2
echo "🚀 Starting application with PM2..."
pm2 delete sms-bot-enhanced 2>/dev/null || echo "No existing process to delete"
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# 10. Configure Nginx (basic configuration)
echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/sms-bot > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    location /health {
        proxy_pass http://localhost:3000;
        access_log off;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/sms-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo "✅ Deployment completed successfully!"
echo ""
echo "📊 Application status:"
pm2 status sms-bot-enhanced
echo ""
echo "🔗 Access your application at: http://your-server-ip:80"
echo "📈 Health check: http://your-server-ip:80/health" 
echo "📊 Stats endpoint: http://your-server-ip:80/stats"
echo ""
echo "📝 To check logs: pm2 logs sms-bot-enhanced"
echo "🔄 To restart: pm2 restart sms-bot-enhanced"
echo ""
echo "⚠️  Don't forget to:"
echo "   1. Update your-domain.com in /etc/nginx/sites-available/sms-bot"
echo "   2. Set up SSL certificate with certbot"
echo "   3. Configure your SMS service (Tasker/Twilio) webhook to your domain"