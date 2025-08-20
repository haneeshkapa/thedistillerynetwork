#!/bin/bash

# Production Server Update Script
# Run this script ON THE PRODUCTION SERVER after pushing changes to GitHub

set -e  # Exit on any error

echo "🔄 Production Server Update Script"
echo "================================="

# Check if we're in the right directory
if [ ! -f "server.js" ]; then
    echo "❌ Error: server.js not found. Are you in the SMS bot directory?"
    exit 1
fi

# Backup current state
echo "💾 Creating backup..."
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r chat_logs.json logs/ data/ "$BACKUP_DIR/" 2>/dev/null || echo "⚠️  Some backup files not found (this is normal for new installations)"

# Pull latest changes from GitHub
echo "⬇️  Pulling latest changes from GitHub..."
git pull origin main

# Install/update dependencies
echo "📦 Installing/updating dependencies..."
npm install

# Check if PM2 is available
if command -v pm2 &> /dev/null; then
    USING_PM2=true
    echo "🔍 PM2 detected - will use PM2 for process management"
else
    USING_PM2=false
    echo "🔍 PM2 not found - will use regular node process"
fi

# Stop existing server
echo "🛑 Stopping existing server..."
if [ "$USING_PM2" = true ]; then
    pm2 stop sms-bot || echo "⚠️  PM2 process 'sms-bot' not found (this is normal for first deployment)"
else
    pkill -f "node server.js" || echo "⚠️  No existing server process found"
fi

# Wait a moment
sleep 2

# Run database migrations if needed
if [ -f "setup/schema.sql" ]; then
    echo "🗄️  Checking database schema..."
    # Note: You'll need to configure your database connection details
    echo "   Run database setup manually if needed: node setup/configure-bluehost.js"
fi

# Start server
echo "🚀 Starting server..."
if [ "$USING_PM2" = true ]; then
    # Use PM2 for production
    if [ -f "ecosystem.config.js" ]; then
        pm2 start ecosystem.config.js
    else
        pm2 start server.js --name "sms-bot" --instances 1 --env production
    fi
    pm2 save
else
    # Use nohup for background process
    nohup node server.js > server.log 2>&1 &
    echo "Server started with PID: $!"
fi

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Health check
echo "🏥 Performing health check..."
if curl -s http://localhost:3000/admin/health >/dev/null 2>&1; then
    echo "✅ Server health check passed!"
else
    echo "⚠️  Health check endpoint not responding (server might still be starting)"
fi

# Show server status
if [ "$USING_PM2" = true ]; then
    echo "📊 PM2 Status:"
    pm2 list
else
    echo "📊 Server Process:"
    ps aux | grep "node server.js" | grep -v grep || echo "Server process not found in ps"
fi

# Show logs
echo "📝 Recent logs:"
if [ "$USING_PM2" = true ]; then
    pm2 logs sms-bot --lines 10 --nostream
else
    tail -n 10 server.log 2>/dev/null || echo "No log file found yet"
fi

echo ""
echo "🎉 Production server update completed!"
echo ""
echo "📊 Quick Status Check:"
echo "====================="
echo "🌐 Server should be running on port 3000"
echo "📱 SMS endpoint: http://your-domain:3000/reply"
echo "🔧 Admin panel: http://your-domain:3000/admin.html"
echo "📈 Monitoring: http://your-domain:3000/admin/monitoring/dashboard"
echo ""
echo "💡 Useful commands:"
if [ "$USING_PM2" = true ]; then
    echo "   View logs:    pm2 logs sms-bot"
    echo "   Restart:      pm2 restart sms-bot"
    echo "   Stop:         pm2 stop sms-bot"
    echo "   Monitor:      pm2 monit"
else
    echo "   View logs:    tail -f server.log"
    echo "   Stop server:  pkill -f 'node server.js'"
    echo "   Restart:      ./update-production-server.sh"
fi
echo ""

# Cleanup old backups (keep only last 5)
echo "🧹 Cleaning up old backups..."
ls -t backup_* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true

echo "✨ All done! Your SMS bot is running with the latest updates."