module.exports = {
  apps: [
    {
      name: 'sms-bot',
      script: 'server-bluehost.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      // Monitoring
      monitoring: false,
      pmx: false,
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Auto restart configuration
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      max_restarts: 10,
      min_uptime: '10s',
      
      // Memory management
      max_memory_restart: '512M',
      
      // Advanced features
      kill_timeout: 3000,
      wait_ready: true,
      listen_timeout: 8000,
      
      // Environment specific settings
      node_args: '--max-old-space-size=512'
    }
  ]
};