#!/usr/bin/env node

/**
 * Webhook-based Deployment System for Bluehost
 * Listens for GitHub webhooks and automatically deploys changes
 */

const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class WebhookDeployer {
    constructor() {
        this.app = express();
        this.port = process.env.WEBHOOK_PORT || 9000;
        this.secret = process.env.GITHUB_WEBHOOK_SECRET;
        this.deployPath = process.env.DEPLOY_PATH || '/var/www/html/sms-bot';
        this.repoUrl = process.env.REPO_URL || 'https://github.com/yourusername/your-repo.git';
        this.branch = process.env.DEPLOY_BRANCH || 'main';
        this.pm2AppName = process.env.PM2_APP_NAME || 'sms-bot';
        
        this.setupMiddleware();
        this.setupRoutes();
        this.deploymentInProgress = false;
    }

    setupMiddleware() {
        // Parse JSON payloads
        this.app.use('/webhook', express.raw({ type: 'application/json' }));
        
        // Simple logging middleware
        this.app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                deploymentInProgress: this.deploymentInProgress
            });
        });

        // GitHub webhook endpoint
        this.app.post('/webhook', (req, res) => this.handleWebhook(req, res));

        // Manual deployment endpoint (secured)
        this.app.post('/deploy', (req, res) => this.handleManualDeploy(req, res));

        // Deployment status endpoint
        this.app.get('/status', (req, res) => {
            res.json({
                deploymentInProgress: this.deploymentInProgress,
                lastDeployment: this.lastDeployment || null,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            });
        });
    }

    /**
     * Verify GitHub webhook signature
     */
    verifySignature(payload, signature) {
        if (!this.secret) {
            console.log('⚠️ No webhook secret configured, skipping signature verification');
            return true;
        }

        const expectedSignature = 'sha256=' + crypto
            .createHmac('sha256', this.secret)
            .update(payload)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * Handle GitHub webhook
     */
    async handleWebhook(req, res) {
        try {
            const signature = req.get('X-Hub-Signature-256');
            const payload = req.body;

            // Verify signature
            if (!this.verifySignature(payload, signature)) {
                console.log('❌ Invalid webhook signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }

            const event = JSON.parse(payload.toString());

            // Only deploy on push to main branch
            if (event.ref !== `refs/heads/${this.branch}`) {
                console.log(`ℹ️ Ignoring push to ${event.ref}, only deploying ${this.branch}`);
                return res.json({ message: 'Ignored - not main branch' });
            }

            console.log(`🚀 Webhook received for ${event.ref}`);
            console.log(`📋 Commit: ${event.head_commit.id.substring(0, 7)} - ${event.head_commit.message}`);

            // Trigger deployment
            this.triggerDeployment(event.head_commit)
                .then(result => {
                    console.log('✅ Deployment completed successfully');
                })
                .catch(error => {
                    console.error('❌ Deployment failed:', error.message);
                });

            // Respond immediately
            res.json({ 
                message: 'Deployment triggered',
                commit: event.head_commit.id.substring(0, 7)
            });

        } catch (error) {
            console.error('❌ Webhook error:', error.message);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }

    /**
     * Handle manual deployment
     */
    async handleManualDeploy(req, res) {
        try {
            const { secret } = req.query;
            
            if (!secret || secret !== this.secret) {
                return res.status(401).json({ error: 'Invalid secret' });
            }

            console.log('🔧 Manual deployment triggered');
            
            this.triggerDeployment({ id: 'manual', message: 'Manual deployment' })
                .then(result => {
                    console.log('✅ Manual deployment completed');
                })
                .catch(error => {
                    console.error('❌ Manual deployment failed:', error.message);
                });

            res.json({ message: 'Manual deployment triggered' });

        } catch (error) {
            console.error('❌ Manual deploy error:', error.message);
            res.status(500).json({ error: 'Manual deployment failed' });
        }
    }

    /**
     * Execute deployment
     */
    async triggerDeployment(commit) {
        if (this.deploymentInProgress) {
            throw new Error('Deployment already in progress');
        }

        this.deploymentInProgress = true;
        const startTime = Date.now();

        try {
            console.log('🚀 Starting deployment...');

            // Create backup
            await this.createBackup();

            // Stop application
            await this.stopApplication();

            // Pull latest code
            await this.pullCode();

            // Install dependencies
            await this.installDependencies();

            // Run migrations
            await this.runMigrations();

            // Start application
            await this.startApplication();

            // Verify deployment
            await this.verifyDeployment();

            const duration = Date.now() - startTime;
            this.lastDeployment = {
                timestamp: new Date().toISOString(),
                commit: commit.id,
                message: commit.message,
                duration,
                status: 'success'
            };

            console.log(`✅ Deployment completed in ${duration}ms`);

        } catch (error) {
            this.lastDeployment = {
                timestamp: new Date().toISOString(),
                commit: commit.id,
                message: commit.message,
                status: 'failed',
                error: error.message
            };

            throw error;
        } finally {
            this.deploymentInProgress = false;
        }
    }

    /**
     * Create backup of current deployment
     */
    async createBackup() {
        console.log('📦 Creating backup...');
        
        const backupDir = '/var/backups/sms-bot';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = `${backupDir}/backup-${timestamp}.tar.gz`;

        await this.execCommand(`mkdir -p ${backupDir}`);
        await this.execCommand(`tar -czf ${backupFile} -C ${path.dirname(this.deployPath)} ${path.basename(this.deployPath)}`);
        
        console.log(`✅ Backup created: ${backupFile}`);
    }

    /**
     * Stop the application
     */
    async stopApplication() {
        console.log('🛑 Stopping application...');
        
        try {
            await this.execCommand(`pm2 stop ${this.pm2AppName}`);
        } catch (error) {
            console.log('ℹ️ Application may not be running');
        }
    }

    /**
     * Pull latest code from repository
     */
    async pullCode() {
        console.log('📥 Pulling latest code...');

        // Check if it's a git repository
        try {
            await this.execCommand(`cd ${this.deployPath} && git status`);
            // If it's already a repo, pull latest
            await this.execCommand(`cd ${this.deployPath} && git pull origin ${this.branch}`);
        } catch (error) {
            // If not a repo, clone it
            console.log('📂 Cloning repository...');
            await this.execCommand(`rm -rf ${this.deployPath}`);
            await this.execCommand(`git clone -b ${this.branch} ${this.repoUrl} ${this.deployPath}`);
        }
    }

    /**
     * Install dependencies
     */
    async installDependencies() {
        console.log('📦 Installing dependencies...');
        await this.execCommand(`cd ${this.deployPath} && npm install --production --no-optional`);
    }

    /**
     * Run database migrations
     */
    async runMigrations() {
        console.log('🗄️ Running migrations...');
        
        try {
            await this.execCommand(`cd ${this.deployPath} && node migrate-chat-storage.js verify`);
        } catch (error) {
            console.log('ℹ️ Migration verification skipped');
        }
    }

    /**
     * Start the application
     */
    async startApplication() {
        console.log('🚀 Starting application...');
        await this.execCommand(`cd ${this.deployPath} && pm2 start ecosystem.config.js --env production`);
        await this.execCommand('pm2 save');
        
        // Wait for application to start
        await this.sleep(5000);
    }

    /**
     * Verify deployment
     */
    async verifyDeployment() {
        console.log('🔍 Verifying deployment...');
        
        // Check if PM2 process is running
        await this.execCommand(`pm2 status | grep ${this.pm2AppName}`);
        
        // Check health endpoint
        const healthCheck = await this.execCommand('curl -f http://localhost:3000/health');
        if (!healthCheck.includes('healthy') && !healthCheck.includes('ok')) {
            throw new Error('Health check failed');
        }
        
        console.log('✅ Deployment verified');
    }

    /**
     * Execute shell command
     */
    execCommand(command) {
        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Command failed: ${command}`);
                    console.error(`Error: ${error.message}`);
                    return reject(error);
                }
                
                if (stderr) {
                    console.log(`stderr: ${stderr}`);
                }
                
                resolve(stdout);
            });
        });
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Start the webhook server
     */
    start() {
        this.app.listen(this.port, () => {
            console.log(`🎯 Webhook deployment server running on port ${this.port}`);
            console.log(`📋 Configuration:`);
            console.log(`   - Deploy Path: ${this.deployPath}`);
            console.log(`   - Repository: ${this.repoUrl}`);
            console.log(`   - Branch: ${this.branch}`);
            console.log(`   - PM2 App: ${this.pm2AppName}`);
            console.log(`🔗 Endpoints:`);
            console.log(`   - Webhook: http://localhost:${this.port}/webhook`);
            console.log(`   - Health: http://localhost:${this.port}/health`);
            console.log(`   - Status: http://localhost:${this.port}/status`);
        });
    }
}

// Start the webhook deployer if run directly
if (require.main === module) {
    const deployer = new WebhookDeployer();
    deployer.start();

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down webhook deployer...');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        console.log('🛑 Shutting down webhook deployer...');
        process.exit(0);
    });
}

module.exports = WebhookDeployer;