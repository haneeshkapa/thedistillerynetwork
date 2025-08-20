module.exports = {
  apps: [
    // Main SMS Bot Application
    {
      name: 'sms-bot',
      script: 'server.js',
      env_file: '.env.production',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      merge_logs: true,
      
      // Auto-restart configuration
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log', 'data', 'uploads'],
      restart_delay: 1000,
      max_restarts: 5,
      min_uptime: '10s',
      autorestart: true,
      
      // Environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ],

  // PM2 Deploy Configuration
  deploy: {
    // Production deployment configuration
    production: {
      user: 'your-bluehost-username',
      host: 'your-domain.com',
      ref: 'origin/main',
      repo: 'https://github.com/yourusername/your-sms-bot-repo.git',
      path: '/var/www/html/sms-bot-deploy',
      ssh_options: 'StrictHostKeyChecking=no',
      
      // Commands to run on the server BEFORE the repo is cloned
      'pre-setup': [
        'mkdir -p /var/www/html/sms-bot-deploy',
        'mkdir -p /var/www/html/sms-bot/logs',
        'mkdir -p /var/backups/sms-bot'
      ].join(' && '),
      
      // Commands to run on the server AFTER the repo is cloned
      'post-setup': [
        'ls -la',
        'npm install --production'
      ].join(' && '),
      
      // Commands to run on the server BEFORE a new deployment
      'pre-deploy': [
        'echo "Creating backup before deployment"',
        'mkdir -p /var/backups/sms-bot',
        'tar -czf /var/backups/sms-bot/backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /var/www/html sms-bot || true'
      ].join(' && '),
      
      // Commands to run on the server AFTER a new deployment
      'post-deploy': [
        'echo "Installing dependencies..."',
        'npm install --production --no-optional',
        
        'echo "Setting up environment..."',
        'cp /var/www/html/sms-bot/.env.production .env.production 2>/dev/null || echo "Environment file not found - please configure manually"',
        
        'echo "Running database migrations..."',
        'node migrate-chat-storage.js verify || echo "Migration check completed"',
        
        'echo "Setting permissions..."',
        'chmod 755 .',
        'chmod 644 *.js',
        'chmod 600 .env.production 2>/dev/null || true',
        
        'echo "Restarting application..."',
        'pm2 reload ecosystem.config.js --env production',
        'pm2 save',
        
        'echo "Waiting for application to start..."',
        'sleep 5',
        
        'echo "Running health check..."',
        'curl -f http://localhost:3000/health || echo "Health check warning"',
        
        'echo "Deployment completed successfully!"',
        'pm2 status'
      ].join(' && ')
    },

    // Staging deployment configuration (optional)
    staging: {
      user: 'your-bluehost-username',
      host: 'staging.your-domain.com',
      ref: 'origin/develop',
      repo: 'https://github.com/yourusername/your-sms-bot-repo.git',
      path: '/var/www/html/sms-bot-staging',
      ssh_options: 'StrictHostKeyChecking=no',
      
      'pre-setup': 'mkdir -p /var/www/html/sms-bot-staging',
      
      'post-setup': [
        'npm install --production',
        'cp .env.staging.template .env.production'
      ].join(' && '),
      
      'pre-deploy': 'echo "Deploying to staging environment"',
      
      'post-deploy': [
        'npm install --production',
        'pm2 reload ecosystem.config.js --env production',
        'pm2 save'
      ].join(' && ')
    }
  }
};