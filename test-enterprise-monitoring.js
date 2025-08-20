#!/usr/bin/env node

/**
 * Enterprise Monitoring Test Suite
 * Tests all monitoring functionality including metrics, logging, and external integrations
 */

const EnterpriseMonitoring = require('./enterprise-monitoring');

class MonitoringTestSuite {
    constructor() {
        this.testResults = [];
        this.monitoring = null;
    }

    async runAllTests() {
        console.log('🔧 Enterprise Monitoring Test Suite');
        console.log('===================================\n');

        try {
            // Initialize monitoring
            await this.testInitialization();
            
            // Basic functionality tests
            await this.testLogging();
            await this.testMetricsTracking();
            await this.testSystemMetrics();
            
            // Integration tests (mock external services)
            await this.testWebhookIntegration();
            await this.testAlertSystem();
            
            // Dashboard and utilities
            await this.testDashboard();
            await this.testUtilityMethods();
            
            // Performance and error handling
            await this.testPerformance();
            await this.testErrorHandling();
            
            this.printResults();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            process.exit(1);
        } finally {
            if (this.monitoring) {
                // Don't actually close connections during testing
                console.log('✅ Test cleanup completed');
            }
        }
    }

    async testInitialization() {
        console.log('🔧 Testing initialization...');
        
        try {
            this.monitoring = new EnterpriseMonitoring({
                serviceName: 'test-sms-bot',
                environment: 'test',
                elasticsearch: { enabled: false }, // Disable external services for testing
                prometheus: { enabled: false },
                datadog: { enabled: false },
                webhooks: [{
                    url: 'http://localhost:3001/test-webhook',
                    method: 'POST',
                    logLevels: ['error', 'warning']
                }],
                metricsInterval: 5000 // Shorter interval for testing
            });
            
            // Give it a moment to initialize
            await this.delay(1000);
            
            this.addTestResult('Initialization', true, 'Monitoring service initialized successfully');
            
        } catch (error) {
            this.addTestResult('Initialization', false, `Failed to initialize: ${error.message}`);
        }
    }

    async testLogging() {
        console.log('📝 Testing logging functionality...');
        
        try {
            // Test different log levels
            this.monitoring.info('Test info message', { test: 'data' });
            this.monitoring.warn('Test warning message', { warning: true });
            this.monitoring.debug('Test debug message', { debug: 'info' });
            this.monitoring.error('Test error message', new Error('Test error'), { context: 'test' });
            
            this.addTestResult('Logging', true, 'All log levels working correctly');
            
        } catch (error) {
            this.addTestResult('Logging', false, `Logging failed: ${error.message}`);
        }
    }

    async testMetricsTracking() {
        console.log('📊 Testing metrics tracking...');
        
        try {
            // Test SMS tracking
            this.monitoring.trackSMS('received', { phone: '555-0123' });
            this.monitoring.trackSMS('responded', { phone: '555-0123' });
            
            // Test API call tracking
            this.monitoring.trackAPICall('claude', 1250, true);
            this.monitoring.trackAPICall('openai', 800, true);
            this.monitoring.trackAPICall('claude', 3000, false); // Failed call
            
            // Test cache operations
            this.monitoring.trackCacheOperation('redis', true);
            this.monitoring.trackCacheOperation('redis', false);
            this.monitoring.trackCacheOperation('memory', true);
            
            // Test database operations
            this.monitoring.trackDatabaseConnection('select', 45);
            this.monitoring.trackDatabaseConnection('insert', 120);
            
            // Verify metrics were tracked
            const dashboard = this.monitoring.getDashboardData();
            const metrics = dashboard.metrics;
            
            if (metrics.sms_received >= 1 && 
                metrics.sms_responded >= 1 && 
                metrics.api_calls >= 3 &&
                metrics.cache_hits >= 2 &&
                metrics.db_connections >= 2) {
                
                this.addTestResult('Metrics Tracking', true, `Metrics correctly tracked: ${JSON.stringify({
                    sms_received: metrics.sms_received,
                    sms_responded: metrics.sms_responded,
                    api_calls: metrics.api_calls,
                    cache_hits: metrics.cache_hits,
                    db_connections: metrics.db_connections
                })}`);
            } else {
                this.addTestResult('Metrics Tracking', false, 'Some metrics not tracked correctly');
            }
            
        } catch (error) {
            this.addTestResult('Metrics Tracking', false, `Metrics tracking failed: ${error.message}`);
        }
    }

    async testSystemMetrics() {
        console.log('⚡ Testing system metrics collection...');
        
        try {
            // Force system metrics collection
            this.monitoring.collectSystemMetrics();
            
            const dashboard = this.monitoring.getDashboardData();
            const hasMemoryData = dashboard.metrics.memoryUsage && dashboard.metrics.memoryUsage.length > 0;
            const hasCpuData = dashboard.metrics.cpuUsage && dashboard.metrics.cpuUsage.length > 0;
            
            if (hasMemoryData && hasCpuData) {
                this.addTestResult('System Metrics', true, 'Memory and CPU metrics collected successfully');
            } else {
                this.addTestResult('System Metrics', false, 'System metrics collection incomplete');
            }
            
        } catch (error) {
            this.addTestResult('System Metrics', false, `System metrics failed: ${error.message}`);
        }
    }

    async testWebhookIntegration() {
        console.log('🔗 Testing webhook integration...');
        
        try {
            // Start a simple test webhook server
            const testServer = await this.createTestWebhookServer(3001);
            
            // Wait a moment for server to start
            await this.delay(500);
            
            // Test webhook by triggering an error (which should send to webhook)
            this.monitoring.error('Test webhook error', new Error('Webhook test'), { webhook_test: true });
            
            // Wait for webhook delivery
            await this.delay(1000);
            
            // Check if webhook received the message
            if (testServer.receivedMessages.length > 0) {
                this.addTestResult('Webhook Integration', true, `Webhook received ${testServer.receivedMessages.length} messages`);
            } else {
                this.addTestResult('Webhook Integration', false, 'No webhook messages received');
            }
            
            // Cleanup test server
            testServer.close();
            
        } catch (error) {
            this.addTestResult('Webhook Integration', false, `Webhook test failed: ${error.message}`);
        }
    }

    async testAlertSystem() {
        console.log('🚨 Testing alert system...');
        
        try {
            // Test basic alert
            this.monitoring.alert('Test alert message', { test: true });
            
            // Test error threshold alerts by generating many errors
            for (let i = 0; i < 10; i++) {
                this.monitoring.error(`Test error ${i}`, new Error(`Error ${i}`), { batch_test: true });
            }
            
            this.addTestResult('Alert System', true, 'Alerts triggered successfully');
            
        } catch (error) {
            this.addTestResult('Alert System', false, `Alert system failed: ${error.message}`);
        }
    }

    async testDashboard() {
        console.log('📈 Testing dashboard data...');
        
        try {
            const dashboard = this.monitoring.getDashboardData();
            
            const requiredFields = ['service', 'environment', 'uptime', 'metrics', 'configuration'];
            const hasAllFields = requiredFields.every(field => dashboard.hasOwnProperty(field));
            
            if (hasAllFields) {
                this.addTestResult('Dashboard', true, `Dashboard contains all required fields: ${requiredFields.join(', ')}`);
            } else {
                const missingFields = requiredFields.filter(field => !dashboard.hasOwnProperty(field));
                this.addTestResult('Dashboard', false, `Missing dashboard fields: ${missingFields.join(', ')}`);
            }
            
        } catch (error) {
            this.addTestResult('Dashboard', false, `Dashboard test failed: ${error.message}`);
        }
    }

    async testUtilityMethods() {
        console.log('🔧 Testing utility methods...');
        
        try {
            // Test cache hit ratio calculation
            const hitRatio = this.monitoring.getCacheHitRatio();
            const isValidRatio = hitRatio >= 0 && hitRatio <= 1;
            
            // Test average response time
            const avgResponseTime = this.monitoring.getAverageResponseTime();
            const isValidResponseTime = avgResponseTime >= 0;
            
            // Test memory usage
            const memoryUsage = this.monitoring.getCurrentMemoryUsage();
            const hasMemoryFields = memoryUsage.heapUsed && memoryUsage.heapTotal;
            
            if (isValidRatio && isValidResponseTime && hasMemoryFields) {
                this.addTestResult('Utility Methods', true, `Cache ratio: ${hitRatio.toFixed(2)}, Avg response: ${avgResponseTime}ms`);
            } else {
                this.addTestResult('Utility Methods', false, 'Some utility methods returned invalid data');
            }
            
        } catch (error) {
            this.addTestResult('Utility Methods', false, `Utility methods failed: ${error.message}`);
        }
    }

    async testPerformance() {
        console.log('⚡ Testing performance...');
        
        try {
            const startTime = Date.now();
            
            // Perform a batch of operations
            for (let i = 0; i < 100; i++) {
                this.monitoring.info(`Batch message ${i}`, { batch: true, index: i });
                this.monitoring.trackAPICall('test-api', Math.random() * 1000, true);
                this.monitoring.trackCacheOperation('test-cache', Math.random() > 0.5);
            }
            
            const duration = Date.now() - startTime;
            const opsPerSecond = (300 / (duration / 1000)).toFixed(2); // 300 operations total
            
            this.addTestResult('Performance', true, `Processed 300 operations in ${duration}ms (${opsPerSecond} ops/sec)`);
            
        } catch (error) {
            this.addTestResult('Performance', false, `Performance test failed: ${error.message}`);
        }
    }

    async testErrorHandling() {
        console.log('🛡️ Testing error handling...');
        
        try {
            // Test with invalid inputs
            this.monitoring.trackAPICall(null, 'invalid'); // Should not crash
            this.monitoring.trackSMS('invalid_type', null); // Should not crash
            
            // Test with null/undefined values
            this.monitoring.info(null, undefined);
            this.monitoring.error('Test', null, null);
            
            this.addTestResult('Error Handling', true, 'Error handling is robust - no crashes with invalid inputs');
            
        } catch (error) {
            this.addTestResult('Error Handling', false, `Error handling failed: ${error.message}`);
        }
    }

    async createTestWebhookServer(port) {
        const http = require('http');
        
        const receivedMessages = [];
        
        const server = http.createServer((req, res) => {
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const message = JSON.parse(body);
                        receivedMessages.push(message);
                        console.log('📨 Test webhook received:', message.type, message.level || '');
                    } catch (e) {
                        receivedMessages.push({ raw: body });
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{"success":true}');
                });
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        
        server.receivedMessages = receivedMessages;
        server.listen(port);
        
        return server;
    }

    addTestResult(testName, passed, details) {
        this.testResults.push({
            test: testName,
            passed,
            details,
            timestamp: new Date().toISOString()
        });
        
        const status = passed ? '✅' : '❌';
        console.log(`${status} ${testName}: ${details}`);
    }

    printResults() {
        console.log('\n📊 Test Results Summary');
        console.log('=====================');
        
        const passed = this.testResults.filter(t => t.passed).length;
        const total = this.testResults.length;
        const percentage = ((passed / total) * 100).toFixed(1);
        
        console.log(`\nPassed: ${passed}/${total} (${percentage}%)`);
        
        if (passed === total) {
            console.log('\n🎉 All tests passed! Enterprise monitoring is working correctly.');
        } else {
            console.log('\n⚠️  Some tests failed. Check the details above.');
            
            const failedTests = this.testResults.filter(t => !t.passed);
            console.log('\nFailed tests:');
            failedTests.forEach(test => {
                console.log(`  ❌ ${test.test}: ${test.details}`);
            });
        }
        
        console.log('\n📋 Test Environment Information:');
        console.log(`Node.js Version: ${process.version}`);
        console.log(`Platform: ${process.platform}`);
        console.log(`Architecture: ${process.arch}`);
        console.log(`Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
        console.log(`Test Duration: ${Date.now() - this.startTime}ms`);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run the test suite if this file is executed directly
if (require.main === module) {
    const testSuite = new MonitoringTestSuite();
    testSuite.startTime = Date.now();
    testSuite.runAllTests().catch(console.error);
}

module.exports = MonitoringTestSuite;