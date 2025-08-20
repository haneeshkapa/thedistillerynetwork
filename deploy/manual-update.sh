#!/bin/bash

# 🔄 Manual Update Script for SMS Bot on Bluehost
# Run this script to manually deploy updates to your production server

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_PATH="/var/www/html/sms-bot"
PM2_APP_NAME="sms-bot"
BACKUP_DIR="/var/backups/sms-bot"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
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

# Check if running on server
check_environment() {
    if [[ ! -d "$DEPLOY_PATH" ]]; then
        error "This script should be run on the Bluehost server where the SMS bot is deployed"
    fi
    
    if ! command -v pm2 &> /dev/null; then
        error "PM2 is not installed. This script requires PM2 to manage the application"
    fi
    
    log "✅ Environment check passed"
}

# Create backup before update
create_backup() {
    log "📦 Creating backup before update..."
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/pre-update-backup-$timestamp.tar.gz"
    
    # Create backup directory
    sudo mkdir -p "$BACKUP_DIR"
    
    # Create backup
    sudo tar -czf "$backup_file" -C "$(dirname $DEPLOY_PATH)" "$(basename $DEPLOY_PATH)"
    
    log "✅ Backup created: $backup_file"
    
    # Keep only last 5 backups
    sudo find "$BACKUP_DIR" -name "pre-update-backup-*.tar.gz" -type f -printf '%T@ %p\n' | sort -n | head -n -5 | cut -d' ' -f2- | xargs -r sudo rm
}

# Stop application gracefully
stop_application() {
    log "🛑 Stopping application gracefully..."
    
    pm2 stop "$PM2_APP_NAME" || {
        warning "Application may not be running"
    }
    
    # Wait a moment for graceful shutdown
    sleep 2
    
    log "✅ Application stopped"
}

# Pull latest changes from git
update_code() {
    log "📥 Pulling latest changes from repository..."
    
    cd "$DEPLOY_PATH"
    
    # Check if we're in a git repository
    if [[ ! -d ".git" ]]; then
        error "Deploy path is not a git repository. Please use the deployment script instead."
    fi
    
    # Get current branch and commit info
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    local current_commit=$(git rev-parse --short HEAD)
    
    info "Current branch: $current_branch"
    info "Current commit: $current_commit"
    
    # Fetch latest changes
    git fetch origin
    
    # Check if there are updates available
    local latest_commit=$(git rev-parse --short origin/$current_branch)
    
    if [[ "$current_commit" == "$latest_commit" ]]; then
        info "No updates available. Current version is up to date."
        return 0
    fi
    
    info "Updates available. Pulling changes..."
    info "Updating from $current_commit to $latest_commit"
    
    # Pull latest changes
    git pull origin "$current_branch"
    
    # Show what changed
    log "📋 Changes in this update:"
    git log --oneline "$current_commit..$latest_commit" | head -10
    
    log "✅ Code updated successfully"
}

# Install/update dependencies
update_dependencies() {
    log "📦 Updating dependencies..."
    
    cd "$DEPLOY_PATH"
    
    # Check if package.json has changed
    if git diff --name-only HEAD~1 HEAD | grep -q "package.json\|package-lock.json"; then
        info "Package files changed, updating dependencies..."
        npm install --production --no-optional
    else
        info "No package changes detected, skipping dependency update"
    fi
    
    log "✅ Dependencies updated"
}

# Run database migrations if needed
run_migrations() {
    log "🗄️ Checking for database migrations..."
    
    cd "$DEPLOY_PATH"
    
    # Check if migration files exist and run verification
    if [[ -f "migrate-chat-storage.js" ]]; then
        node migrate-chat-storage.js verify || {
            warning "Migration verification completed with warnings"
        }
    else
        info "No migration script found, skipping"
    fi
    
    log "✅ Migration check completed"
}

# Start application
start_application() {
    log "🚀 Starting application..."
    
    cd "$DEPLOY_PATH"
    
    # Start with PM2
    pm2 start ecosystem.config.js --env production
    
    # Save PM2 configuration
    pm2 save
    
    # Wait for application to start
    sleep 5
    
    log "✅ Application started"
}

# Verify deployment
verify_deployment() {
    log "🔍 Verifying deployment..."
    
    # Check PM2 status
    if pm2 status | grep -q "$PM2_APP_NAME.*online"; then
        info "✅ PM2 process is online"
    else
        error "PM2 process is not running properly"
    fi
    
    # Check health endpoint
    local health_check_attempts=0
    local max_attempts=6
    
    while [[ $health_check_attempts -lt $max_attempts ]]; do
        if curl -f -s http://localhost:3000/health > /dev/null; then
            info "✅ Health check passed"
            break
        else
            health_check_attempts=$((health_check_attempts + 1))
            if [[ $health_check_attempts -eq $max_attempts ]]; then
                error "Health check failed after $max_attempts attempts"
            fi
            info "Health check attempt $health_check_attempts/$max_attempts failed, retrying..."
            sleep 5
        fi
    done
    
    # Show recent logs
    log "📋 Recent application logs:"
    pm2 logs "$PM2_APP_NAME" --lines 10 --nostream
    
    log "✅ Deployment verification completed"
}

# Show deployment summary
show_summary() {
    local end_time=$(date)
    local duration=$(($(date +%s) - start_timestamp))
    
    echo
    log "🎉 Update completed successfully!"
    echo
    echo "📊 Update Summary:"
    echo "  Start Time: $start_time"
    echo "  End Time: $end_time"
    echo "  Duration: ${duration}s"
    echo "  Application Status: $(pm2 status | grep "$PM2_APP_NAME" | awk '{print $10}' | head -1)"
    echo
    echo "🔗 Quick Access:"
    echo "  Application Logs: pm2 logs $PM2_APP_NAME"
    echo "  Application Status: pm2 status"
    echo "  Application Monitor: pm2 monit"
    echo
    echo "🌐 Endpoints:"
    echo "  Health Check: curl http://localhost:3000/health"
    echo "  Admin Panel: https://yourdomain.com/admin"
    echo
}

# Rollback function (in case of issues)
rollback_deployment() {
    error_msg="$1"
    
    warning "🔄 Attempting to rollback due to error: $error_msg"
    
    # Find the most recent backup
    local latest_backup=$(sudo find "$BACKUP_DIR" -name "pre-update-backup-*.tar.gz" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
    
    if [[ -n "$latest_backup" && -f "$latest_backup" ]]; then
        warning "Rolling back to: $latest_backup"
        
        # Stop current application
        pm2 stop "$PM2_APP_NAME" || true
        
        # Restore backup
        sudo tar -xzf "$latest_backup" -C "$(dirname $DEPLOY_PATH)"
        
        # Start application
        cd "$DEPLOY_PATH"
        pm2 start ecosystem.config.js --env production
        pm2 save
        
        warning "🔄 Rollback completed. Please check application status."
    else
        error "No backup found for rollback. Manual intervention required."
    fi
    
    exit 1
}

# Main update function
main() {
    local start_timestamp=$(date +%s)
    local start_time=$(date)
    
    echo
    echo "🔄 SMS Bot Manual Update"
    echo "======================="
    echo
    
    # Parse command line arguments
    FORCE_UPDATE=false
    SKIP_BACKUP=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force)
                FORCE_UPDATE=true
                shift
                ;;
            --skip-backup)
                SKIP_BACKUP=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [options]"
                echo "Options:"
                echo "  --force         Force update even if no changes detected"
                echo "  --skip-backup   Skip creating backup (not recommended)"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done
    
    # Set error trap for rollback
    trap 'rollback_deployment "Update failed during execution"' ERR
    
    # Run update steps
    check_environment
    
    if [[ "$SKIP_BACKUP" != true ]]; then
        create_backup
    fi
    
    stop_application
    update_code
    update_dependencies
    run_migrations
    start_application
    verify_deployment
    
    # Disable error trap after successful completion
    trap - ERR
    
    show_summary
}

# Run main function
main "$@"