module.exports = {
  apps: [{
    name: 'sms-bot',
    script: 'server.js',
    env_file: '.env.production',
    instances: 'max', // Use all CPU cores for production scaling
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    
    // Logging configuration
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true,
    
    // Auto-restart configuration
    watch: false, // Disable watch in production
    ignore_watch: ['node_modules', 'logs', '*.log', 'data', 'uploads'],
    restart_delay: 1000,
    max_restarts: 5,
    min_uptime: '10s',
    autorestart: true,
    
    // Environment configuration
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Development environment (for testing)
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'debug'
    },
    
    // Production environment
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'info',
      ENABLE_CLUSTERING: true
    }
  }],
  
  // Deployment configuration for PM2 Deploy
  deploy: {
    production: {
      user: 'your-user',
      host: 'your-domain.com',
      ref: 'origin/main',
      repo: 'https://github.com/yourusername/your-sms-bot-repo.git',
      path: '/var/www/html/sms-bot',
      'pre-deploy-local': '',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /var/www/html/sms-bot/logs'
    }
  }
};