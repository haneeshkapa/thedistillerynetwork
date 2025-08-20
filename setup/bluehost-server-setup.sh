#!/bin/bash

# 🏗️ Bluehost Server Setup Script
# Prepares a fresh Bluehost VPS/Dedicated server for SMS bot deployment

set -e  # Exit on any error

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

# Detect OS
detect_os() {
    if [[ -f /etc/redhat-release ]]; then
        OS="centos"
        PACKAGE_MANAGER="yum"
        SERVICE_MANAGER="systemctl"
        WEB_USER="apache"
    elif [[ -f /etc/debian_version ]]; then
        OS="ubuntu"
        PACKAGE_MANAGER="apt"
        SERVICE_MANAGER="systemctl"
        WEB_USER="www-data"
    else
        error "Unsupported operating system. This script supports CentOS/RHEL and Ubuntu/Debian."
    fi
    
    log "Detected OS: $OS"
}

# Update system
update_system() {
    log "🔄 Updating system packages..."
    
    if [[ "$OS" == "centos" ]]; then
        sudo yum update -y
        sudo yum install -y wget curl git nano htop
    else
        sudo apt update && sudo apt upgrade -y
        sudo apt install -y wget curl git nano htop
    fi
    
    log "✅ System updated successfully"
}

# Install Node.js 18+
install_nodejs() {
    log "📦 Installing Node.js 18..."
    
    # Remove any existing Node.js
    if command -v node &> /dev/null; then
        warning "Node.js already installed. Version: $(node --version)"
        if [[ $(node --version | cut -d'v' -f2 | cut -d'.' -f1) -ge 18 ]]; then
            log "✅ Node.js version is compatible"
            return
        else
            warning "Node.js version is too old. Installing newer version..."
        fi
    fi
    
    # Install Node.js 18.x
    if [[ "$OS" == "centos" ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    else
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    
    # Verify installation
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    
    log "✅ Node.js installed: $NODE_VERSION"
    log "✅ npm installed: $NPM_VERSION"
    
    # Install PM2 globally
    sudo npm install -g pm2
    PM2_VERSION=$(pm2 --version)
    log "✅ PM2 installed: $PM2_VERSION"
}

# Install MySQL 8.0
install_mysql() {
    log "🗄️ Installing MySQL 8.0..."
    
    if systemctl is-active --quiet mysqld || systemctl is-active --quiet mysql; then
        warning "MySQL is already running"
        return
    fi
    
    if [[ "$OS" == "centos" ]]; then
        # Install MySQL repository
        sudo yum install -y https://dev.mysql.com/get/mysql80-community-release-el7-3.noarch.rpm || true
        sudo yum install -y mysql-server mysql
        sudo systemctl start mysqld
        sudo systemctl enable mysqld
        
        # Get temporary root password
        TEMP_PASSWORD=$(sudo grep 'temporary password' /var/log/mysqld.log | tail -1 | awk '{print $NF}')
        if [[ -n "$TEMP_PASSWORD" ]]; then
            info "MySQL temporary root password: $TEMP_PASSWORD"
        fi
    else
        sudo apt update
        sudo apt install -y mysql-server mysql-client
        sudo systemctl start mysql
        sudo systemctl enable mysql
    fi
    
    log "✅ MySQL installed and started"
    warning "Run 'sudo mysql_secure_installation' to secure MySQL"
}

# Install Redis
install_redis() {
    log "📝 Installing Redis..."
    
    if systemctl is-active --quiet redis || systemctl is-active --quiet redis-server; then
        warning "Redis is already running"
        return
    fi
    
    if [[ "$OS" == "centos" ]]; then
        sudo yum install -y epel-release
        sudo yum install -y redis
        sudo systemctl start redis
        sudo systemctl enable redis
    else
        sudo apt install -y redis-server
        sudo systemctl start redis-server
        sudo systemctl enable redis-server
    fi
    
    # Test Redis
    if redis-cli ping | grep -q "PONG"; then
        log "✅ Redis installed and running"
    else
        error "Redis installation failed"
    fi
}

# Install Nginx
install_nginx() {
    log "🌐 Installing Nginx..."
    
    if systemctl is-active --quiet nginx; then
        warning "Nginx is already running"
        return
    fi
    
    if [[ "$OS" == "centos" ]]; then
        sudo yum install -y nginx
    else
        sudo apt install -y nginx
    fi
    
    sudo systemctl start nginx
    sudo systemctl enable nginx
    
    log "✅ Nginx installed and started"
}

# Configure firewall
configure_firewall() {
    log "🔥 Configuring firewall..."
    
    if [[ "$OS" == "centos" ]]; then
        # Install and configure firewalld
        sudo yum install -y firewalld
        sudo systemctl start firewalld
        sudo systemctl enable firewalld
        
        # Open necessary ports
        sudo firewall-cmd --permanent --add-service=http
        sudo firewall-cmd --permanent --add-service=https
        sudo firewall-cmd --permanent --add-service=ssh
        sudo firewall-cmd --reload
        
        log "✅ Firewall configured with firewalld"
    else
        # Configure UFW
        sudo ufw --force enable
        sudo ufw allow ssh
        sudo ufw allow http
        sudo ufw allow https
        
        log "✅ Firewall configured with UFW"
    fi
}

# Install SSL certificate tools
install_ssl_tools() {
    log "🔐 Installing SSL certificate tools..."
    
    if [[ "$OS" == "centos" ]]; then
        sudo yum install -y certbot python3-certbot-nginx
    else
        sudo apt install -y certbot python3-certbot-nginx
    fi
    
    log "✅ Certbot installed for SSL certificates"
}

# Create application directories
create_directories() {
    log "📁 Creating application directories..."
    
    # Main application directory
    sudo mkdir -p /var/www/html/sms-bot
    sudo mkdir -p /var/www/html/sms-bot/logs
    sudo mkdir -p /var/www/html/sms-bot/backups
    sudo mkdir -p /var/backups/sms-bot
    
    # Set ownership
    sudo chown -R $WEB_USER:$WEB_USER /var/www/html/sms-bot
    sudo chmod 755 /var/www/html/sms-bot
    
    log "✅ Application directories created"
}

# Configure MySQL for production
configure_mysql() {
    log "⚙️ Configuring MySQL for production..."
    
    # Backup original config
    if [[ -f /etc/my.cnf ]]; then
        sudo cp /etc/my.cnf /etc/my.cnf.backup
    elif [[ -f /etc/mysql/my.cnf ]]; then
        sudo cp /etc/mysql/my.cnf /etc/mysql/my.cnf.backup
    fi
    
    # Create optimized MySQL configuration
    sudo tee -a /etc/mysql/conf.d/sms-bot.cnf > /dev/null << 'EOF'
[mysqld]
# SMS Bot optimizations
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
max_connections = 200
query_cache_size = 64M
tmp_table_size = 64M
max_heap_table_size = 64M

# Binary logging for backups
log-bin = mysql-bin
expire_logs_days = 7

# Performance
innodb_flush_log_at_trx_commit = 2
innodb_file_per_table = 1
innodb_buffer_pool_instances = 4
EOF
    
    # Restart MySQL to apply changes
    if [[ "$OS" == "centos" ]]; then
        sudo systemctl restart mysqld
    else
        sudo systemctl restart mysql
    fi
    
    log "✅ MySQL configured for production"
}

# Setup monitoring tools
setup_monitoring() {
    log "📊 Setting up monitoring tools..."
    
    # Install system monitoring tools
    if [[ "$OS" == "centos" ]]; then
        sudo yum install -y htop iotop nethogs
    else
        sudo apt install -y htop iotop nethogs
    fi
    
    # Setup log rotation for application logs
    sudo tee /etc/logrotate.d/sms-bot > /dev/null << 'EOF'
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
EOF
    
    log "✅ Monitoring tools installed"
}

# Create database backup script
create_backup_script() {
    log "💾 Creating database backup script..."
    
    sudo tee /var/www/html/sms-bot/backup-database.sh > /dev/null << 'EOF'
#!/bin/bash

# SMS Bot Database Backup Script
BACKUP_DIR="/var/backups/sms-bot"
DB_NAME="sms_bot_production"
DB_USER="sms_bot_user"
DB_PASS="$MYSQL_PASSWORD"  # Will be set from environment
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
EOF
    
    sudo chmod +x /var/www/html/sms-bot/backup-database.sh
    sudo chown $WEB_USER:$WEB_USER /var/www/html/sms-bot/backup-database.sh
    
    log "✅ Backup script created"
}

# Setup system limits
setup_system_limits() {
    log "⚙️ Configuring system limits..."
    
    # Increase file descriptor limits for Node.js
    sudo tee -a /etc/security/limits.conf > /dev/null << 'EOF'
# SMS Bot limits
* soft nofile 65536
* hard nofile 65536
* soft nproc 65536
* hard nproc 65536
EOF
    
    # Configure systemd limits
    sudo mkdir -p /etc/systemd/system.conf.d
    sudo tee /etc/systemd/system.conf.d/limits.conf > /dev/null << 'EOF'
[Manager]
DefaultLimitNOFILE=65536
DefaultLimitNPROC=65536
EOF
    
    log "✅ System limits configured"
}

# Final system verification
verify_installation() {
    log "🔍 Verifying installation..."
    
    # Check Node.js
    if command -v node &> /dev/null; then
        info "✅ Node.js: $(node --version)"
    else
        error "❌ Node.js not found"
    fi
    
    # Check PM2
    if command -v pm2 &> /dev/null; then
        info "✅ PM2: $(pm2 --version)"
    else
        error "❌ PM2 not found"
    fi
    
    # Check MySQL
    if systemctl is-active --quiet mysqld || systemctl is-active --quiet mysql; then
        info "✅ MySQL: Running"
    else
        error "❌ MySQL not running"
    fi
    
    # Check Redis
    if redis-cli ping | grep -q "PONG"; then
        info "✅ Redis: Running"
    else
        error "❌ Redis not responding"
    fi
    
    # Check Nginx
    if systemctl is-active --quiet nginx; then
        info "✅ Nginx: Running"
    else
        error "❌ Nginx not running"
    fi
    
    log "✅ Installation verification completed"
}

# Main setup function
main() {
    echo
    echo "🏗️  Bluehost Server Setup for Enterprise SMS Bot"
    echo "=============================================="
    echo
    
    # Check if running as root
    if [[ $EUID -eq 0 ]]; then
        error "This script should not be run as root. Please run as a regular user with sudo privileges."
    fi
    
    # Check sudo access
    if ! sudo -n true 2>/dev/null; then
        error "This script requires sudo privileges. Please run 'sudo -v' first."
    fi
    
    # Detect OS
    detect_os
    
    # Run setup steps
    update_system
    install_nodejs
    install_mysql
    install_redis
    install_nginx
    configure_firewall
    install_ssl_tools
    create_directories
    configure_mysql
    setup_monitoring
    create_backup_script
    setup_system_limits
    verify_installation
    
    echo
    log "🎉 Server setup completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Secure MySQL: sudo mysql_secure_installation"
    echo "2. Create database and user for SMS bot"
    echo "3. Configure domain DNS to point to this server"
    echo "4. Get SSL certificate: sudo certbot --nginx -d yourdomain.com"
    echo "5. Deploy SMS bot application"
    echo
    echo "Service status:"
    echo "- MySQL: $(systemctl is-active mysqld mysql 2>/dev/null || echo 'inactive')"
    echo "- Redis: $(systemctl is-active redis redis-server 2>/dev/null || echo 'inactive')"
    echo "- Nginx: $(systemctl is-active nginx 2>/dev/null || echo 'inactive')"
    echo
}

# Run main function
main "$@"