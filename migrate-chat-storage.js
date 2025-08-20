#!/usr/bin/env node

/**
 * Chat Storage Migration Script
 * Migrates existing JSON chat logs to Enterprise Chat Storage system
 */

const fs = require('fs').promises;
const path = require('path');
const EnterpriseChatStorage = require('./enterprise-chat-storage');

class ChatStorageMigration {
    constructor() {
        this.storage = null;
        this.stats = {
            totalCustomers: 0,
            totalMessages: 0,
            successfulMigrations: 0,
            errors: 0,
            startTime: Date.now()
        };
    }

    async initialize() {
        console.log('🚀 Chat Storage Migration Tool');
        console.log('==============================\n');

        // Initialize enterprise storage
        this.storage = new EnterpriseChatStorage({
            maxActiveConversations: 2000, // Increased for migration
            maxMessagesPerCustomer: 100,   // Allow more during migration
            archiveAfterDays: 90           // Extended for historical data
        });

        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('✅ Enterprise storage initialized\n');
    }

    async migrateFromJson(jsonFilePath = './chat_logs.json') {
        try {
            console.log(`📂 Reading chat logs from: ${jsonFilePath}`);
            
            // Check if file exists
            try {
                await fs.access(jsonFilePath);
            } catch (error) {
                throw new Error(`Chat logs file not found: ${jsonFilePath}`);
            }

            // Read and parse JSON
            const fileContent = await fs.readFile(jsonFilePath, 'utf8');
            const chatData = JSON.parse(fileContent);
            
            console.log(`📊 Found ${Object.keys(chatData).length} customers in chat logs\n`);
            
            this.stats.totalCustomers = Object.keys(chatData).length;

            // Process each customer
            for (const [phone, customerData] of Object.entries(chatData)) {
                await this.migrateCustomerConversations(phone, customerData);
            }

            console.log('\n🎉 Migration Summary:');
            console.log('==================');
            console.log(`📱 Total Customers: ${this.stats.totalCustomers}`);
            console.log(`💬 Total Messages: ${this.stats.totalMessages}`);
            console.log(`✅ Successful Migrations: ${this.stats.successfulMigrations}`);
            console.log(`❌ Errors: ${this.stats.errors}`);
            console.log(`⏱️  Total Time: ${((Date.now() - this.stats.startTime) / 1000).toFixed(2)}s`);
            
            if (this.stats.errors === 0) {
                console.log('\n🎊 Migration completed successfully!');
                await this.backupOriginalFile(jsonFilePath);
            } else {
                console.log(`\n⚠️  Migration completed with ${this.stats.errors} errors`);
            }

        } catch (error) {
            console.error('❌ Migration failed:', error.message);
            throw error;
        }
    }

    async migrateCustomerConversations(phone, customerData) {
        try {
            console.log(`👤 Migrating customer: ${phone.substring(0, 3)}***${phone.substring(phone.length - 3)}`);
            
            if (!customerData.messages || !Array.isArray(customerData.messages)) {
                console.log(`   ⚠️  No messages found for customer`);
                return;
            }

            const messageCount = customerData.messages.length;
            this.stats.totalMessages += messageCount;
            
            console.log(`   💬 Processing ${messageCount} messages...`);

            // Process each message
            for (let i = 0; i < customerData.messages.length; i++) {
                const message = customerData.messages[i];
                
                try {
                    await this.storage.storeMessage(
                        phone,
                        message.customerMessage || '',
                        message.botResponse || '',
                        {
                            customerInfo: customerData.customerInfo || null,
                            provider: 'legacy_migration',
                            originalTimestamp: message.timestamp,
                            migrated: true,
                            migrationBatch: new Date().toISOString()
                        }
                    );
                    
                    this.stats.successfulMigrations++;
                    
                    // Progress indicator
                    if ((i + 1) % 10 === 0) {
                        console.log(`   📈 Progress: ${i + 1}/${messageCount} messages`);
                    }
                    
                } catch (messageError) {
                    console.error(`   ❌ Failed to migrate message ${i + 1}:`, messageError.message);
                    this.stats.errors++;
                }
            }
            
            console.log(`   ✅ Customer migration completed: ${messageCount} messages\n`);
            
        } catch (error) {
            console.error(`❌ Failed to migrate customer ${phone}:`, error.message);
            this.stats.errors++;
        }
    }

    async backupOriginalFile(originalPath) {
        try {
            const backupPath = `${originalPath}.migrated.${new Date().toISOString().replace(/[:.]/g, '-')}.backup`;
            
            console.log(`\n💾 Creating backup of original file...`);
            console.log(`   Original: ${originalPath}`);
            console.log(`   Backup: ${backupPath}`);
            
            await fs.copyFile(originalPath, backupPath);
            console.log('✅ Backup created successfully');
            
            // Optionally compress the backup
            console.log('💡 Consider compressing the backup file to save space:');
            console.log(`   gzip "${backupPath}"`);
            
        } catch (error) {
            console.error('⚠️  Failed to create backup:', error.message);
            console.log('   Manual backup recommended before deleting original file');
        }
    }

    async verifyMigration(originalJsonPath = './chat_logs.json') {
        try {
            console.log('\n🔍 Verifying Migration...');
            console.log('========================');
            
            // Get storage stats
            const storageStats = await this.storage.getStorageStats();
            
            console.log('📊 Enterprise Storage Statistics:');
            console.log(`   Total Conversations: ${storageStats.database?.total_conversations || 0}`);
            console.log(`   Unique Customers: ${storageStats.database?.unique_customers || 0}`);
            console.log(`   Active Conversations: ${storageStats.database?.active_conversations || 0}`);
            
            // Read original file for comparison
            try {
                const originalContent = await fs.readFile(originalJsonPath, 'utf8');
                const originalData = JSON.parse(originalContent);
                
                let originalMessageCount = 0;
                for (const customerData of Object.values(originalData)) {
                    if (customerData.messages && Array.isArray(customerData.messages)) {
                        originalMessageCount += customerData.messages.length;
                    }
                }
                
                console.log('\n📝 Comparison:');
                console.log(`   Original JSON Messages: ${originalMessageCount}`);
                console.log(`   Migrated Messages: ${this.stats.successfulMigrations}`);
                console.log(`   Migration Success Rate: ${((this.stats.successfulMigrations / originalMessageCount) * 100).toFixed(2)}%`);
                
                if (this.stats.successfulMigrations === originalMessageCount) {
                    console.log('✅ Perfect migration - all messages transferred!');
                } else {
                    console.log(`⚠️  ${originalMessageCount - this.stats.successfulMigrations} messages may need attention`);
                }
                
            } catch (error) {
                console.log('⚠️  Could not verify against original file:', error.message);
            }
            
        } catch (error) {
            console.error('❌ Verification failed:', error.message);
        }
    }

    async showMigrationOptions() {
        console.log('🎛️  Migration Options:');
        console.log('====================');
        console.log('1. Standard Migration - Migrate all conversations');
        console.log('2. Recent Only - Migrate conversations from last 30 days');
        console.log('3. High-Value Customers - Migrate customers with 5+ messages');
        console.log('4. Custom Date Range - Migrate conversations within date range');
        console.log('5. Test Migration - Migrate only first 5 customers');
        console.log('');
    }

    async cleanup() {
        if (this.storage) {
            await this.storage.close();
        }
    }
}

// CLI Interface
async function main() {
    const migration = new ChatStorageMigration();
    
    try {
        await migration.initialize();
        
        // Get command line arguments
        const args = process.argv.slice(2);
        const command = args[0] || 'migrate';
        const filePath = args[1] || './chat_logs.json';
        
        switch (command.toLowerCase()) {
            case 'migrate':
                await migration.migrateFromJson(filePath);
                await migration.verifyMigration(filePath);
                break;
                
            case 'verify':
                await migration.verifyMigration(filePath);
                break;
                
            case 'help':
                console.log('Chat Storage Migration Tool');
                console.log('==========================');
                console.log('Usage:');
                console.log('  node migrate-chat-storage.js [command] [file]');
                console.log('');
                console.log('Commands:');
                console.log('  migrate [file]  - Migrate chat logs (default: ./chat_logs.json)');
                console.log('  verify [file]   - Verify migration results');
                console.log('  help           - Show this help message');
                console.log('');
                console.log('Examples:');
                console.log('  node migrate-chat-storage.js migrate');
                console.log('  node migrate-chat-storage.js verify');
                console.log('  node migrate-chat-storage.js migrate ./backup/old_chats.json');
                break;
                
            default:
                console.log(`❌ Unknown command: ${command}`);
                console.log('Run "node migrate-chat-storage.js help" for usage information');
                process.exit(1);
        }
        
    } catch (error) {
        console.error('💥 Migration tool failed:', error.message);
        process.exit(1);
        
    } finally {
        await migration.cleanup();
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = ChatStorageMigration;