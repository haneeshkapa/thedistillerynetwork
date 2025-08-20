#!/bin/bash

# 🚀 Bluehost Production Deployment Script
# Automated deployment for Enterprise SMS Bot

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_USER="your-bluehost-username"
DEPLOY_HOST="your-domain.com"
REMOTE_PATH="/var/www/html/sms-bot"
DB_NAME="sms_bot_production"
DB_USER="sms_bot_user"
BACKUP_DIR="/var/backups/sms-bot"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    exit 1
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "🔍 Checking prerequisites..."
    
    # Check if git is available
    if ! command -v git &> /dev/null; then
        error "Git is not installed. Please install git first."
    fi
    
    # Check if ssh is available
    if ! command -v ssh &> /dev/null; then
        error "SSH is not installed. Please install SSH client first."
    fi
    
    # Check if we're in the right directory
    if [[ ! -f "server.js" ]]; then
        error "This script must be run from the SMS bot root directory"
    fi
    
    # Check if environment file exists
    if [[ ! -f ".env.production" ]]; then
        warning ".env.production file not found. You'll need to create it on the server."
    fi
    
    log "✅ Prerequisites check completed"
}

# Create deployment package
create_deployment_package() {
    log "📦 Creating deployment package..."
    
    # Create temporary directory
    TEMP_DIR=$(mktemp -d)
    PACKAGE_DIR="$TEMP_DIR/sms-bot-deployment"
    
    # Copy application files
    mkdir -p "$PACKAGE_DIR"
    
    # Copy essential files
    cp -r \
        server.js \
        package.json \
        package-lock.json \
        ecosystem.config.js \
        enterprise-chat-storage.js \
        hybrid-vector-retriever.js \
        enterprise-monitoring.js \
        optimized-reply-handler.js \
        shopify-service.js \
        cache-optimizer.js \
        migrate-chat-storage.js \
        setup/ \
        data/ \
        "$PACKAGE_DIR/"
    
    # Copy environment template
    if [[ -f ".env.production" ]]; then
        cp .env.production "$PACKAGE_DIR/"
    fi
    
    # Create logs directory
    mkdir -p "$PACKAGE_DIR/logs"
    
    # Create deployment info file
    cat > "$PACKAGE_DIR/deployment-info.json" << EOF
{
    "deploymentTime": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "gitCommit": "$(git rev-parse HEAD)",
    "gitBranch": "$(git rev-parse --abbrev-ref HEAD)",
    "version": "$(date +%Y%m%d-%H%M%S)",
    "deployedBy": "$(whoami)",
    "deployedFrom": "$(hostname)"
}
EOF
    
    # Create archive
    ARCHIVE_NAME="sms-bot-$(date +%Y%m%d-%H%M%S).tar.gz"
    cd "$TEMP_DIR"
    tar -czf "$ARCHIVE_NAME" sms-bot-deployment/
    
    # Move archive to script directory
    mv "$ARCHIVE_NAME" "$SCRIPT_DIR/"
    
    # Cleanup
    rm -rf "$TEMP_DIR"
    
    echo "$SCRIPT_DIR/$ARCHIVE_NAME"
}

# Upload and deploy to server
deploy_to_server() {
    local archive_path=$1
    local archive_name=$(basename "$archive_path")
    
    log "🚀 Deploying to Bluehost server..."
    
    # Upload archive
    info "Uploading deployment package..."
    scp "$archive_path" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/"
    
    # Execute deployment on server
    info "Executing deployment on server..."
    ssh "$DEPLOY_USER@$DEPLOY_HOST" bash << EOF
        set -e
        
        # Colors
        GREEN='\033[0;32m'
        RED='\033[0;31m'
        YELLOW='\033[1;33m'
        NC='\033[0m'
        
        echo -e "\${GREEN}🔧 Starting server deployment...\${NC}"
        
        # Create backup of current deployment
        if [[ -d "$REMOTE_PATH" ]]; then
            echo -e "\${YELLOW}📦 Creating backup of current deployment...\${NC}"
            sudo mkdir -p $BACKUP_DIR
            sudo tar -czf "$BACKUP_DIR/backup-\$(date +%Y%m%d-%H%M%S).tar.gz" -C "$(dirname $REMOTE_PATH)" "$(basename $REMOTE_PATH)" || true
        fi
        
        # Create deployment directory
        sudo mkdir -p "$REMOTE_PATH"
        cd /tmp
        
        # Extract deployment package
        echo -e "\${GREEN}📂 Extracting deployment package...\${NC}"
        tar -xzf "$archive_name"
        
        # Copy files to deployment directory
        echo -e "\${GREEN}📋 Copying files to deployment directory...\${NC}"
        sudo cp -r sms-bot-deployment/* "$REMOTE_PATH/"
        
        # Set proper ownership
        sudo chown -R apache:apache "$REMOTE_PATH" || sudo chown -R www-data:www-data "$REMOTE_PATH"
        
        # Set proper permissions
        sudo chmod 755 "$REMOTE_PATH"
        sudo chmod 644 "$REMOTE_PATH"/*.js
        sudo chmod 600 "$REMOTE_PATH/.env.production" 2>/dev/null || true
        sudo chmod +x "$REMOTE_PATH"/setup/*.sh 2>/dev/null || true
        
        # Install dependencies
        echo -e "\${GREEN}📥 Installing Node.js dependencies...\${NC}"
        cd "$REMOTE_PATH"
        npm install --production --no-optional
        
        # Deploy database schema
        echo -e "\${GREEN}🗄️ Deploying database schema...\${NC}"
        if [[ -f "setup/enterprise-chat-schema.sql" ]]; then
            mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < setup/enterprise-chat-schema.sql 2>/dev/null || echo "Schema deployment skipped (may already exist)"
        fi
        
        # Create logs directory
        mkdir -p "$REMOTE_PATH/logs"
        sudo chown -R apache:apache "$REMOTE_PATH/logs" || sudo chown -R www-data:www-data "$REMOTE_PATH/logs"
        
        # Restart application with PM2
        echo -e "\${GREEN}🔄 Restarting application...\${NC}"
        pm2 delete sms-bot 2>/dev/null || true
        pm2 start ecosystem.config.js --env production
        pm2 save
        
        # Cleanup
        rm -f "/tmp/$archive_name"
        rm -rf /tmp/sms-bot-deployment
        
        echo -e "\${GREEN}✅ Server deployment completed successfully!\${NC}"
        
        # Show status
        pm2 status
EOF
    
    log "✅ Deployment to server completed"
}

# Verify deployment
verify_deployment() {
    log "🔍 Verifying deployment..."
    
    # Check if application is running
    info "Checking application status..."
    ssh "$DEPLOY_USER@$DEPLOY_HOST" "pm2 status | grep sms-bot || exit 1"
    
    # Check health endpoint
    info "Testing health endpoint..."
    ssh "$DEPLOY_USER@$DEPLOY_HOST" "curl -f http://localhost:3000/health || exit 1"
    
    # Check database connection
    info "Testing database connection..."
    ssh "$DEPLOY_USER@$DEPLOY_HOST" "cd $REMOTE_PATH && mysql -u $DB_USER -p$DB_PASS $DB_NAME -e 'SELECT 1;' || exit 1"
    
    log "✅ Deployment verification completed"
}

# Setup monitoring
setup_monitoring() {
    log "📊 Setting up monitoring..."
    
    ssh "$DEPLOY_USER@$DEPLOY_HOST" bash << 'EOF'
        # Setup log rotation
        sudo tee /etc/logrotate.d/sms-bot > /dev/null << 'LOGROTATE_CONF'
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
LOGROTATE_CONF
        
        # Setup cron jobs for health checks
        (crontab -l 2>/dev/null; echo "*/15 * * * * curl -f http://localhost:3000/health > /dev/null 2>&1 || pm2 restart sms-bot") | crontab -
        
        # Setup database backup cron
        (crontab -l 2>/dev/null; echo "0 2 * * * /var/www/html/sms-bot/backup-database.sh >> /var/log/sms-bot-backup.log 2>&1") | crontab -
        
        echo "✅ Monitoring setup completed"
EOF
    
    log "✅ Monitoring setup completed"
}

# Main deployment function
main() {
    echo
    echo "🚀 Enterprise SMS Bot - Bluehost Deployment"
    echo "============================================"
    echo
    
    # Parse command line arguments
    SKIP_VERIFY=false
    SKIP_MONITORING=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-verify)
                SKIP_VERIFY=true
                shift
                ;;
            --skip-monitoring)
                SKIP_MONITORING=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [options]"
                echo "Options:"
                echo "  --skip-verify      Skip deployment verification"
                echo "  --skip-monitoring  Skip monitoring setup"
                echo "  --help, -h         Show this help message"
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done
    
    # Check prerequisites
    check_prerequisites
    
    # Create deployment package
    log "Creating deployment package..."
    ARCHIVE_PATH=$(create_deployment_package)
    info "Deployment package created: $ARCHIVE_PATH"
    
    # Deploy to server
    deploy_to_server "$ARCHIVE_PATH"
    
    # Verify deployment
    if [[ "$SKIP_VERIFY" != true ]]; then
        verify_deployment
    fi
    
    # Setup monitoring
    if [[ "$SKIP_MONITORING" != true ]]; then
        setup_monitoring
    fi
    
    # Cleanup local archive
    rm -f "$ARCHIVE_PATH"
    
    echo
    log "🎉 Deployment completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Update Twilio webhook URL to: https://$DEPLOY_HOST/webhook/sms"
    echo "2. Test SMS functionality by sending a message to your Twilio number"
    echo "3. Monitor logs: ssh $DEPLOY_USER@$DEPLOY_HOST 'pm2 logs sms-bot'"
    echo "4. Check admin panel: https://$DEPLOY_HOST/admin"
    echo
}

# Run main function
main "$@"