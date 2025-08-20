#!/bin/bash

# Production Deployment Script for SMS Bot
# This script pushes changes to GitHub and handles production deployment

set -e  # Exit on any error

echo "🚀 SMS Bot Production Deployment Script"
echo "======================================"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Warning: You're on branch '$CURRENT_BRANCH', not 'main'"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Deployment cancelled"
        exit 1
    fi
fi

# Show current status
echo "📊 Current Git Status:"
git status --porcelain

# Add all new enterprise components
echo "📦 Adding new enterprise components..."
git add -A

# Show what will be committed
echo "📋 Changes to be committed:"
git diff --cached --name-status

# Ask for commit message
echo ""
read -p "💬 Enter commit message (or press Enter for default): " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="Deploy enterprise SMS bot with vector search, monitoring, and Bluehost integration

🚀 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"
fi

# Commit changes
echo "📝 Committing changes..."
git commit -m "$COMMIT_MSG"

# Push to GitHub
echo "⬆️  Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Code pushed to GitHub successfully!"
echo ""

# Production deployment instructions
echo "🏭 PRODUCTION DEPLOYMENT INSTRUCTIONS:"
echo "======================================="
echo ""
echo "On your production server, run:"
echo ""
echo "1. Pull latest changes:"
echo "   git pull origin main"
echo ""
echo "2. Install new dependencies:"
echo "   npm install"
echo ""
echo "3. Deploy database schema (if using Bluehost):"
echo "   node setup/configure-bluehost.js"
echo ""
echo "4. Restart server with PM2:"
echo "   pm2 restart sms-bot"
echo "   # OR if not using PM2:"
echo "   pkill -f 'node server.js' && nohup node server.js > server.log 2>&1 &"
echo ""
echo "5. Verify deployment:"
echo "   curl http://your-server:3000/admin/monitoring/dashboard"
echo ""

# Show what was deployed
echo "🎯 DEPLOYED FEATURES:"
echo "===================="
echo "✅ Hybrid Vector Search (BM25 + Semantic)"
echo "✅ Enterprise Monitoring (Elasticsearch, Prometheus, Datadog)"
echo "✅ Bluehost MySQL Integration"
echo "✅ Multi-tier Caching (Memory + Redis + Database)"
echo "✅ Intent Routing for Cost Optimization"
echo "✅ Conversation Graph Memory"
echo "✅ Admin Dashboard Enhancements"
echo "✅ Performance Analytics"
echo ""

echo "🔗 GitHub Repository: $(git remote get-url origin)"
echo "⏰ Deployed at: $(date)"
echo ""
echo "🎉 Deployment completed successfully!"

# Optional: Open GitHub in browser
if command -v open &> /dev/null; then
    read -p "🌐 Open GitHub repository in browser? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "$(git remote get-url origin | sed 's/\.git$//')"
    fi
fi