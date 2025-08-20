# Bluehost MySQL Remote Connection Setup Guide

This guide covers setting up remote MySQL database access on Bluehost for the SMS Bot application.

## Prerequisites

- Bluehost hosting account with MySQL database access
- cPanel access to your Bluehost account
- Local development environment with MySQL client

## Step 1: Create Remote MySQL Database

### 1.1 Access MySQL Databases in cPanel

1. Log into your Bluehost cPanel
2. Navigate to **Databases** section
3. Click on **MySQL Databases**

### 1.2 Create New Database

```bash
Database Name: [your_username]_sms_bot_production
```

**Important**: Bluehost prefixes database names with your username, so if your username is `johnsmith`, the database will be `johnsmith_sms_bot_production`

### 1.3 Create Database User

```bash
Username: [your_username]_sms_bot
Password: [Generate strong password - save this!]
```

Example:
- Username: `johnsmith_sms_bot`  
- Password: `SMSBot2024!@#Strong`

### 1.4 Add User to Database

1. In the **Add User to Database** section
2. Select your user: `johnsmith_sms_bot`
3. Select your database: `johnsmith_sms_bot_production`
4. Grant **ALL PRIVILEGES**
5. Click **Make Changes**

## Step 2: Enable Remote MySQL Access

### 2.1 Configure Remote MySQL in cPanel

1. In cPanel, find **Remote MySQL** under Databases section
2. Click **Remote MySQL**
3. Add your server's IP address to **Access Hosts**

### 2.2 Get Your Server IP Addresses

For development and production environments:

```bash
# Get your local development IP
curl -4 ifconfig.co

# Get your production server IP  
curl -4 ifconfig.co
```

### 2.3 Add IP Addresses

Add these IPs to the **Access Hosts** field in Remote MySQL:
- Your development machine IP
- Your production server IP  
- `localhost` (for testing)
- `%` (wildcard - **use with caution, only for development**)

**Security Warning**: Never use `%` wildcard in production. Always specify exact IP addresses.

## Step 3: Find MySQL Connection Details

### 3.1 Get MySQL Hostname

Bluehost MySQL hostname is usually:
- `box####.bluehost.com` (where #### is your server number)
- Or your domain: `yourdomain.com`

To find your exact hostname:
1. In cPanel → **MySQL Databases**
2. Look for "MySQL Hostname" or "Remote MySQL Hostname"

### 3.2 Test Connection

```bash
mysql -h [hostname] -P 3306 -u [username] -p[password] [database]
```

Example:
```bash
mysql -h box1234.bluehost.com -P 3306 -u johnsmith_sms_bot -pSMSBot2024!@#Strong johnsmith_sms_bot_production
```

## Step 4: Update Application Configuration

### 4.1 Environment Variables

Create/update `.env.production`:

```bash
# Bluehost MySQL Configuration
MYSQL_HOST=box1234.bluehost.com
MYSQL_PORT=3306
MYSQL_USER=johnsmith_sms_bot
MYSQL_PASSWORD=SMSBot2024!@#Strong
MYSQL_DATABASE=johnsmith_sms_bot_production

# SSL Configuration (Bluehost supports SSL)
MYSQL_SSL=true
MYSQL_SSL_CA=/path/to/ca-cert.pem
MYSQL_SSL_REJECT_UNAUTHORIZED=false
```

### 4.2 Update Database Connection Code

Update all database connection configurations in your application:

```javascript
// Example for hybrid-vector-retriever.js
const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'sms_bot',
    password: process.env.MYSQL_PASSWORD || 'smsbot123',
    database: process.env.MYSQL_DATABASE || 'sms_bot_production',
    waitForConnections: true,
    connectionLimit: 10,
    ssl: process.env.MYSQL_SSL === 'true' ? {
        rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false'
    } : false
};

const dbPool = mysql.createPool(dbConfig);
```

## Step 5: Deploy Database Schema

### 5.1 Run Schema Creation Scripts

```bash
# Connect to remote database
mysql -h box1234.bluehost.com -P 3306 -u johnsmith_sms_bot -p johnsmith_sms_bot_production

# Run schema scripts
SOURCE setup/schema.sql;
SOURCE setup/enhanced-schema.sql;
```

### 5.2 Import Initial Data

```bash
# Import knowledge base
mysql -h box1234.bluehost.com -P 3306 -u johnsmith_sms_bot -p johnsmith_sms_bot_production < data/knowledge-base-export.sql

# Import any existing customer data
mysql -h box1234.bluehost.com -P 3306 -u johnsmith_sms_bot -p johnsmith_sms_bot_production < data/customers-export.sql
```

## Step 6: Security Configuration

### 6.1 Firewall Rules

Configure your production server firewall to allow MySQL traffic:

```bash
# Allow MySQL port 3306 for specific IPs
ufw allow from [bluehost-server-ip] to any port 3306

# Or for specific service only
ufw allow out 3306/tcp
```

### 6.2 Connection Encryption

Always use SSL/TLS for remote connections:

```javascript
const dbConfig = {
    // ... other config
    ssl: {
        rejectUnauthorized: false, // Set to true in production with proper certificates
        minVersion: 'TLSv1.2'
    }
};
```

## Step 7: Monitoring and Maintenance

### 7.1 Connection Monitoring

Add connection health checks:

```javascript
// In server.js
app.get('/admin/health/mysql', requireAuth, async (req, res) => {
    try {
        const [result] = await dbPool.execute('SELECT 1 as test');
        res.json({
            success: true,
            status: 'connected',
            host: process.env.MYSQL_HOST,
            database: process.env.MYSQL_DATABASE,
            test: result[0].test
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'disconnected',
            error: error.message
        });
    }
});
```

### 7.2 Backup Strategy

Set up automated backups:

```bash
#!/bin/bash
# backup-mysql.sh

BACKUP_DIR="/var/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sms_bot_backup_$DATE.sql"

mysqldump -h box1234.bluehost.com \
    -u johnsmith_sms_bot \
    -p$MYSQL_PASSWORD \
    johnsmith_sms_bot_production > $BACKUP_FILE

gzip $BACKUP_FILE

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

## Step 8: Troubleshooting

### 8.1 Common Connection Issues

**Issue**: "Connection refused"
- Check if your IP is added to Remote MySQL access hosts
- Verify firewall settings
- Confirm MySQL port (3306) is open

**Issue**: "Access denied"
- Verify username/password
- Check if user has proper privileges
- Ensure database name is correct (with username prefix)

**Issue**: "SSL connection error"
- Try with `ssl: false` first to test basic connection
- Check if Bluehost requires specific SSL certificates

### 8.2 Testing Script

Create `test-bluehost-connection.js`:

```javascript
const mysql = require('mysql2/promise');

async function testConnection() {
    const config = {
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        ssl: false // Start with false for testing
    };

    try {
        console.log('Testing connection with config:', { ...config, password: '[HIDDEN]' });
        
        const connection = await mysql.createConnection(config);
        const [rows] = await connection.execute('SELECT CONNECTION_ID(), NOW() as server_time');
        
        console.log('✅ Connection successful!');
        console.log('Connection ID:', rows[0]['CONNECTION_ID()']);
        console.log('Server Time:', rows[0].server_time);
        
        await connection.end();
        
    } catch (error) {
        console.error('❌ Connection failed:', error.message);
        console.error('Error code:', error.code);
    }
}

testConnection();
```

## Step 9: Production Deployment Checklist

- [ ] Database created on Bluehost
- [ ] Database user created with proper privileges  
- [ ] Remote MySQL access configured with server IPs
- [ ] Connection tested from development environment
- [ ] Schema deployed to remote database
- [ ] SSL/TLS encryption enabled
- [ ] Environment variables configured
- [ ] Application connection code updated
- [ ] Health check endpoint working
- [ ] Backup strategy implemented
- [ ] Monitoring alerts configured

## Security Best Practices

1. **Never use wildcard (%) IP access in production**
2. **Always use SSL/TLS encryption for remote connections**
3. **Rotate database passwords regularly**
4. **Monitor connection logs for suspicious activity**
5. **Limit database user privileges to only required operations**
6. **Keep database server and client libraries updated**
7. **Use connection pooling to prevent connection exhaustion**
8. **Set up database firewall rules**

## Performance Optimization

1. **Configure connection pooling appropriately**
2. **Monitor query performance and optimize slow queries**
3. **Set appropriate timeouts for remote connections**
4. **Consider read replicas for read-heavy workloads**
5. **Implement proper indexing strategy**
6. **Use Redis for caching to reduce database load**

---

**Need Help?** 
- Bluehost Support: Available 24/7 via chat, phone, or ticket
- Check Bluehost Knowledge Base for MySQL-specific documentation
- Test connections thoroughly before deploying to production