#!/bin/bash

# Bluehost Deployment Script for SMS Bot
# Usage: ./deploy-bluehost.sh

set -e

echo "🚀 Starting Bluehost deployment..."

# Configuration
REMOTE_HOST="162.240.239.106"
REMOTE_USER="dashboard"
REMOTE_PATH="~/sms-bot"
LOCAL_BUILD="./build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Pre-deployment checks
check_requirements() {
    log_info "Checking requirements..."
    
    if [ ! -f ".env.bluehost" ]; then
        log_error ".env.bluehost file not found!"
        log_info "Copy and configure .env.bluehost with your database credentials"
        exit 1
    fi
    
    if [ ! -f "package-bluehost.json" ]; then
        log_error "package-bluehost.json not found!"
        exit 1
    fi
    
    if [ ! -f "server-bluehost.js" ]; then
        log_error "server-bluehost.js not found!"
        exit 1
    fi
    
    # Check if we can connect to remote server
    log_info "Testing SSH connection..."
    if ! ssh -i ~/.ssh/bluehost_new -o ConnectTimeout=10 "$REMOTE_USER@$REMOTE_HOST" "echo 'SSH connection successful'" > /dev/null 2>&1; then
        log_error "Cannot connect to $REMOTE_USER@$REMOTE_HOST"
        log_info "Please ensure:"
        log_info "1. SSH key is properly configured"
        log_info "2. Remote host and username are correct"
        log_info "3. Server is accessible"
        exit 1
    fi
    
    log_info "✅ All requirements met"
}

# Create deployment package
create_package() {
    log_info "Creating deployment package..."
    
    # Clean previous build
    rm -rf "$LOCAL_BUILD"
    mkdir -p "$LOCAL_BUILD"
    
    # Copy essential files
    cp server-bluehost.js "$LOCAL_BUILD/server.js"
    cp package-bluehost.json "$LOCAL_BUILD/package.json"
    cp ecosystem.config.js "$LOCAL_BUILD/"
    cp migrate-mysql.js "$LOCAL_BUILD/"
    cp .env.bluehost "$LOCAL_BUILD/.env"
    
    # Copy supporting files
    cp -r advanced-retriever.js "$LOCAL_BUILD/" 2>/dev/null || log_warn "advanced-retriever.js not found"
    cp -r price-validator.js "$LOCAL_BUILD/" 2>/dev/null || log_warn "price-validator.js not found"
    cp -r enhanced-shopify-sync.js "$LOCAL_BUILD/" 2>/dev/null || log_warn "enhanced-shopify-sync.js not found"
    cp -r complete-website-sync.js "$LOCAL_BUILD/" 2>/dev/null || log_warn "complete-website-sync.js not found"
    
    # Copy public directory if it exists
    if [ -d "public" ]; then
        cp -r public "$LOCAL_BUILD/"
    fi
    
    # Create logs directory
    mkdir -p "$LOCAL_BUILD/logs"
    
    # Create deployment info
    cat > "$LOCAL_BUILD/deployment-info.json" << EOF
{
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployedBy": "$USER",
  "gitCommit": "$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')",
  "gitBranch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')",
  "version": "$(date +%Y%m%d-%H%M%S)"
}
EOF
    
    log_info "✅ Deployment package created in $LOCAL_BUILD"
}

# Deploy to server
deploy_to_server() {
    log_info "Deploying to $REMOTE_HOST..."
    
    # Create backup of current deployment
    log_info "Creating backup on server..."
    ssh -i ~/.ssh/bluehost_new "$REMOTE_USER@$REMOTE_HOST" "
        if [ -d '$REMOTE_PATH' ]; then
            mkdir -p ~/backups
            tar -czf ~/backups/sms-bot-backup-\$(date +%Y%m%d-%H%M%S).tar.gz -C \$(dirname '$REMOTE_PATH') \$(basename '$REMOTE_PATH')
            echo 'Backup created'
        fi
    "
    
    # Stop existing application
    log_info "Stopping existing application..."
    ssh -i ~/.ssh/bluehost_new "$REMOTE_USER@$REMOTE_HOST" "
        cd '$REMOTE_PATH' 2>/dev/null || exit 0
        if command -v pm2 > /dev/null; then
            pm2 stop sms-bot 2>/dev/null || echo 'PM2 app not running'
        else
            pkill -f 'node.*server' 2>/dev/null || echo 'No node processes to stop'
        fi
    "
    
    # Upload files
    log_info "Uploading files..."
    ssh -i ~/.ssh/bluehost_new "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_PATH'"
    scp -i ~/.ssh/bluehost_new -r "$LOCAL_BUILD/"* "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"
    
    # Install dependencies and start application
    log_info "Installing dependencies and starting application..."
    ssh -i ~/.ssh/bluehost_new "$REMOTE_USER@$REMOTE_HOST" "
        cd '$REMOTE_PATH'
        
        # Check Node.js version
        echo 'Checking Node.js version...'
        node --version
        npm --version
        
        # Verify Node.js 14+ is available
        if node -e 'if (process.version.split(\".\")[0].slice(1) < 14) process.exit(1)'; then
            echo '✅ Node.js version is compatible (14+)'
        else
            echo '❌ Node.js version is too old. Requires 14+'
            exit 1
        fi
        
        # Install Node.js dependencies
        echo 'Installing npm packages...'
        npm install --production --no-optional
        
        # Run database migration
        echo 'Running database migration...'
        node migrate-mysql.js || echo 'Migration completed with warnings'
        
        # Start application with PM2 if available
        if command -v pm2 > /dev/null; then
            echo 'Starting with PM2...'
            pm2 start ecosystem.config.js --env production
            pm2 save
            pm2 status
        else
            echo 'PM2 not found, starting with nohup...'
            nohup node server.js > logs/app.log 2>&1 &
            echo \$! > app.pid
            echo 'Application started with PID:' \$(cat app.pid)
        fi
        
        # Wait a moment for startup
        sleep 5
        
        # Health check
        echo 'Performing health check...'
        if curl -f http://localhost:3000/health > /dev/null 2>&1; then
            echo '✅ Application is healthy'
        else
            echo '❌ Health check failed'
            if command -v pm2 > /dev/null; then
                pm2 logs sms-bot --lines 20
            else
                tail -20 logs/app.log
            fi
        fi
    "
    
    log_info "✅ Deployment completed!"
}

# Main deployment process
main() {
    echo "============================================"
    echo "  SMS Bot Bluehost Deployment Script"
    echo "============================================"
    
    check_requirements
    create_package
    deploy_to_server
    
    echo ""
    log_info "🎉 Deployment successful!"
    log_info "📊 Management Dashboard: http://$REMOTE_HOST/management.html"
    log_info "🏥 Health Check: http://$REMOTE_HOST/health"
    echo ""
    log_info "Next steps:"
    log_info "1. Test the SMS functionality"
    log_info "2. Check the management dashboard"
    log_info "3. Monitor logs for any issues"
    log_info "4. Update your Twilio webhook URLs if needed"
    echo ""
}

# Run deployment
main "$@"