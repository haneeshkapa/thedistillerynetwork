#!/bin/bash

# FTP Deployment Script for Bluehost
# Alternative to SSH deployment

echo "📁 Creating FTP deployment package for Bluehost..."

# Create deployment package
rm -rf ./build
mkdir -p ./build

# Copy essential files
cp server-bluehost.js ./build/server.js
cp package-bluehost.json ./build/package.json
cp ecosystem.config.js ./build/
cp migrate-mysql.js ./build/
cp .env.bluehost ./build/.env

# Copy supporting files
cp advanced-retriever.js ./build/ 2>/dev/null || echo "⚠️ advanced-retriever.js not found"
cp price-validator.js ./build/ 2>/dev/null || echo "⚠️ price-validator.js not found"
cp enhanced-shopify-sync.js ./build/ 2>/dev/null || echo "⚠️ enhanced-shopify-sync.js not found"
cp complete-website-sync.js ./build/ 2>/dev/null || echo "⚠️ complete-website-sync.js not found"

# Copy public directory
if [ -d "public" ]; then
    cp -r public ./build/
fi

# Create logs directory
mkdir -p ./build/logs

echo "✅ Deployment package created in ./build/"
echo ""
echo "📋 Next Steps:"
echo "1. Upload ./build/* to your Bluehost public_html/sms-bot/ directory"
echo "2. Use Bluehost File Manager or FTP client"
echo "3. Set up MySQL database in cPanel"
echo "4. Run 'node migrate-mysql.js' via Terminal in cPanel"
echo "5. Start with 'node server.js' or PM2"
echo ""
echo "🌐 Files ready for manual upload to userdashboard.com"