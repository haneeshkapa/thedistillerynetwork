#!/usr/bin/env node

/**
 * Bluehost MySQL Configuration Helper
 * Automatically configures database connections for Bluehost hosting
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

class BluehostConfigurator {
    constructor() {
        this.config = {
            host: '',
            port: 3306,
            user: '',
            password: '',
            database: '',
            ssl: false
        };
    }

    async collectDatabaseInfo() {
        console.log('🔧 Bluehost MySQL Configuration Helper');
        console.log('=====================================\n');

        console.log('Please provide your Bluehost database information:\n');

        // Get hostname
        this.config.host = await question('MySQL Hostname (e.g., box1234.bluehost.com): ');
        
        // Get port (default 3306)
        const port = await question('MySQL Port (default: 3306): ');
        this.config.port = port ? parseInt(port) : 3306;
        
        // Get username
        this.config.user = await question('MySQL Username (e.g., username_sms_bot): ');
        
        // Get password
        this.config.password = await question('MySQL Password: ');
        
        // Get database name
        this.config.database = await question('Database Name (e.g., username_sms_bot_production): ');
        
        // SSL option
        const useSSL = await question('Use SSL connection? (y/N): ');
        this.config.ssl = useSSL.toLowerCase() === 'y' || useSSL.toLowerCase() === 'yes';
        
        console.log('\n📝 Configuration Summary:');
        console.log('========================');
        console.log(`Host: ${this.config.host}`);
        console.log(`Port: ${this.config.port}`);
        console.log(`User: ${this.config.user}`);
        console.log(`Database: ${this.config.database}`);
        console.log(`SSL: ${this.config.ssl ? 'Enabled' : 'Disabled'}`);
        console.log('');
    }

    async testConnection() {
        console.log('🔍 Testing database connection...');
        
        try {
            const connection = await mysql.createConnection({
                host: this.config.host,
                port: this.config.port,
                user: this.config.user,
                password: this.config.password,
                database: this.config.database,
                ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
                connectTimeout: 10000
            });

            const [rows] = await connection.execute(`
                SELECT 
                    CONNECTION_ID() as connection_id,
                    NOW() as server_time,
                    VERSION() as mysql_version,
                    DATABASE() as current_database
            `);

            console.log('✅ Connection successful!');
            console.log(`Connection ID: ${rows[0].connection_id}`);
            console.log(`Server Time: ${rows[0].server_time}`);
            console.log(`MySQL Version: ${rows[0].mysql_version}`);
            console.log(`Current Database: ${rows[0].current_database}`);

            await connection.end();
            return true;

        } catch (error) {
            console.error('❌ Connection failed:', error.message);
            console.error('Error Code:', error.code);
            
            // Provide helpful error messages
            if (error.code === 'ENOTFOUND') {
                console.error('\n💡 Troubleshooting: Check if the hostname is correct');
            } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
                console.error('\n💡 Troubleshooting: Check username and password');
            } else if (error.code === 'ECONNREFUSED') {
                console.error('\n💡 Troubleshooting: Check if your IP is added to Remote MySQL access hosts in cPanel');
            }
            
            return false;
        }
    }

    async createEnvironmentFile() {
        const envContent = `# Bluehost MySQL Configuration
# Generated on ${new Date().toISOString()}

MYSQL_HOST=${this.config.host}
MYSQL_PORT=${this.config.port}
MYSQL_USER=${this.config.user}
MYSQL_PASSWORD=${this.config.password}
MYSQL_DATABASE=${this.config.database}
MYSQL_SSL=${this.config.ssl}

# Redis Configuration (update as needed)
REDIS_HOST=localhost
REDIS_PORT=6379

# OpenAI Configuration (add your key)
OPENAI_API_KEY=your-openai-api-key-here

# Other configurations
NODE_ENV=production
PORT=3000
`;

        const envPath = path.join(process.cwd(), '.env.bluehost');
        
        try {
            fs.writeFileSync(envPath, envContent);
            console.log(`✅ Environment file created: ${envPath}`);
            console.log('\n📋 Next steps:');
            console.log('1. Rename .env.bluehost to .env for production use');
            console.log('2. Add your OpenAI API key to enable semantic search');
            console.log('3. Update Redis configuration if using remote Redis');
            console.log('4. Test your application with the new configuration');
        } catch (error) {
            console.error('❌ Failed to create environment file:', error.message);
        }
    }

    async updateApplicationFiles() {
        console.log('\n🔄 Updating application configuration files...');

        const filesToUpdate = [
            'hybrid-vector-retriever.js',
            'conversation-graph.js',
            'multi-tier-cache.js'
        ];

        for (const filename of filesToUpdate) {
            const filepath = path.join(process.cwd(), filename);
            
            if (fs.existsSync(filepath)) {
                try {
                    let content = fs.readFileSync(filepath, 'utf8');
                    
                    // Replace hardcoded database configuration with environment variables
                    const oldDbConfig = /host: '127\.0\.0\.1',\s*port: 3306,\s*user: 'sms_bot',\s*password: 'smsbot123',\s*database: 'sms_bot_production'/g;
                    const newDbConfig = `host: process.env.MYSQL_HOST || '127.0.0.1',
            port: parseInt(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER || 'sms_bot',
            password: process.env.MYSQL_PASSWORD || 'smsbot123',
            database: process.env.MYSQL_DATABASE || 'sms_bot_production'`;
                    
                    if (oldDbConfig.test(content)) {
                        content = content.replace(oldDbConfig, newDbConfig);
                        fs.writeFileSync(filepath, content);
                        console.log(`✅ Updated ${filename}`);
                    } else {
                        console.log(`⚠️  ${filename} - no changes needed or different format`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to update ${filename}:`, error.message);
                }
            } else {
                console.log(`⚠️  ${filename} - file not found`);
            }
        }
    }

    async deploySchema() {
        console.log('\n📊 Deploying database schema...');
        
        const schemaFiles = [
            'setup/schema.sql',
            'setup/enhanced-schema.sql'
        ];

        try {
            const connection = await mysql.createConnection({
                host: this.config.host,
                port: this.config.port,
                user: this.config.user,
                password: this.config.password,
                database: this.config.database,
                ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
                multipleStatements: true
            });

            for (const schemaFile of schemaFiles) {
                const schemaPath = path.join(process.cwd(), schemaFile);
                
                if (fs.existsSync(schemaPath)) {
                    console.log(`📂 Loading ${schemaFile}...`);
                    
                    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
                    await connection.execute(schemaSql);
                    
                    console.log(`✅ ${schemaFile} deployed successfully`);
                } else {
                    console.log(`⚠️  ${schemaFile} not found - skipping`);
                }
            }

            await connection.end();
            console.log('✅ Schema deployment completed');

        } catch (error) {
            console.error('❌ Schema deployment failed:', error.message);
            console.error('💡 You may need to run the SQL files manually in phpMyAdmin or MySQL client');
        }
    }

    async generateConnectionTest() {
        const testScript = `#!/usr/bin/env node

/**
 * Bluehost MySQL Connection Test
 * Generated by configure-bluehost.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function testBluehostConnection() {
    const config = {
        host: process.env.MYSQL_HOST,
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : false
    };

    console.log('🔍 Testing Bluehost MySQL connection...');
    console.log('Config:', { ...config, password: '[HIDDEN]' });

    try {
        const connection = await mysql.createConnection(config);
        
        // Test basic connection
        const [basicTest] = await connection.execute('SELECT 1 as test');
        console.log('✅ Basic connection test passed');
        
        // Test database access
        const [dbTest] = await connection.execute('SHOW TABLES');
        console.log(\`✅ Database access test passed - found \${dbTest.length} tables\`);
        
        // Test knowledge_chunks table (if exists)
        try {
            const [knowledgeTest] = await connection.execute('SELECT COUNT(*) as count FROM knowledge_chunks');
            console.log(\`✅ Knowledge chunks table: \${knowledgeTest[0].count} entries\`);
        } catch (e) {
            console.log('⚠️  knowledge_chunks table not found - run schema deployment');
        }
        
        await connection.end();
        console.log('✅ All connection tests passed!');
        
    } catch (error) {
        console.error('❌ Connection test failed:', error.message);
        process.exit(1);
    }
}

testBluehostConnection();
`;

        const testPath = path.join(process.cwd(), 'test-bluehost-connection.js');
        fs.writeFileSync(testPath, testScript);
        fs.chmodSync(testPath, '755');
        
        console.log(`✅ Connection test script created: ${testPath}`);
        console.log('Run: node test-bluehost-connection.js');
    }
}

async function main() {
    const configurator = new BluehostConfigurator();
    
    try {
        await configurator.collectDatabaseInfo();
        
        const testSuccess = await configurator.testConnection();
        
        if (!testSuccess) {
            const retry = await question('\nConnection failed. Do you want to try with different settings? (y/N): ');
            if (retry.toLowerCase() === 'y') {
                rl.close();
                return main(); // Restart the process
            } else {
                console.log('💡 Please check your database settings and try again.');
                rl.close();
                return;
            }
        }
        
        await configurator.createEnvironmentFile();
        await configurator.updateApplicationFiles();
        
        const deploySchema = await question('\nDo you want to deploy the database schema now? (y/N): ');
        if (deploySchema.toLowerCase() === 'y') {
            await configurator.deploySchema();
        }
        
        await configurator.generateConnectionTest();
        
        console.log('\n🎉 Bluehost configuration completed successfully!');
        console.log('\n📋 Final checklist:');
        console.log('✅ Database connection tested');
        console.log('✅ Environment file created');
        console.log('✅ Application files updated');
        console.log('✅ Connection test script generated');
        console.log('');
        console.log('🚀 Your SMS bot is ready for Bluehost deployment!');
        
    } catch (error) {
        console.error('❌ Configuration failed:', error.message);
    } finally {
        rl.close();
    }
}

// Run the configurator if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = BluehostConfigurator;
`;