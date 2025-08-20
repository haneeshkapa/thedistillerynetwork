module.exports = {
  apps: [{
    name: 'webhook-deployer',
    script: 'webhook-deploy.js',
    cwd: '/var/www/html/sms-bot/deploy',
    
    // Environment variables
    env: {
      NODE_ENV: 'production',
      WEBHOOK_PORT: 9000,
      DEPLOY_PATH: '/var/www/html/sms-bot',
      REPO_URL: 'https://github.com/yourusername/your-sms-bot-repo.git',
      DEPLOY_BRANCH: 'main',
      PM2_APP_NAME: 'sms-bot',
      GITHUB_WEBHOOK_SECRET: 'your-webhook-secret-here'
    },
    
    // Logging
    log_file: '/var/www/html/sms-bot/logs/webhook-deployer.log',
    out_file: '/var/www/html/sms-bot/logs/webhook-deployer-out.log',
    error_file: '/var/www/html/sms-bot/logs/webhook-deployer-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Process management
    instances: 1, // Only need one instance for webhook
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 5,
    min_uptime: '10s',
    restart_delay: 1000,
    
    // Memory management
    max_memory_restart: '100M' // Lightweight service
  }]
};