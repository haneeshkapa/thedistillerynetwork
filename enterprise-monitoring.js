const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const http = require('http');
const https = require('https');
const os = require('os');

class EnterpriseMonitoring {
    constructor(options = {}) {
        this.config = {
            serviceName: options.serviceName || 'sms-bot',
            version: options.version || '1.0.0',
            environment: options.environment || process.env.NODE_ENV || 'development',
            
            // Elasticsearch configuration
            elasticsearch: {
                enabled: options.elasticsearch?.enabled || process.env.ELASTIC_ENABLED === 'true',
                host: options.elasticsearch?.host || process.env.ELASTIC_HOST || 'localhost:9200',
                index: options.elasticsearch?.index || 'sms-bot-logs',
                auth: options.elasticsearch?.auth || {
                    username: process.env.ELASTIC_USER,
                    password: process.env.ELASTIC_PASSWORD
                }
            },
            
            // Grafana/Prometheus configuration
            prometheus: {
                enabled: options.prometheus?.enabled || process.env.PROMETHEUS_ENABLED === 'true',
                gateway: options.prometheus?.gateway || process.env.PROMETHEUS_GATEWAY || 'localhost:9091',
                jobName: options.prometheus?.jobName || 'sms-bot-metrics'
            },
            
            // Datadog configuration
            datadog: {
                enabled: options.datadog?.enabled || process.env.DATADOG_ENABLED === 'true',
                apiKey: options.datadog?.apiKey || process.env.DATADOG_API_KEY,
                host: options.datadog?.host || process.env.DATADOG_HOST || 'api.datadoghq.com'
            },
            
            // Custom webhook endpoints
            webhooks: options.webhooks || [],
            
            // Metrics collection interval
            metricsInterval: options.metricsInterval || 30000 // 30 seconds
        };
        
        this.metrics = {
            smsReceived: 0,
            smsResponded: 0,
            errors: 0,
            apiCalls: 0,
            cacheHits: 0,
            cacheMisses: 0,
            dbConnections: 0,
            responseTime: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        this.alerts = new Map();
        this.initialize();
    }

    initialize() {
        this.setupLogger();
        this.setupMetricsCollection();
        this.setupHealthChecks();
        
        console.log('🔍 Enterprise Monitoring initialized', {
            service: this.config.serviceName,
            environment: this.config.environment,
            elasticsearch: this.config.elasticsearch.enabled,
            prometheus: this.config.prometheus.enabled,
            datadog: this.config.datadog.enabled
        });
    }

    setupLogger() {
        // Simple logger for testing - avoid complex winston configurations that might cause recursion
        this.logger = {
            info: (message, meta = {}) => {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    level: 'INFO',
                    message,
                    service: this.config.serviceName,
                    environment: this.config.environment,
                    ...meta
                };
                console.log('ℹ️ ', JSON.stringify(logEntry));
            },
            error: (message, meta = {}) => {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    level: 'ERROR',
                    message,
                    service: this.config.serviceName,
                    environment: this.config.environment,
                    ...meta
                };
                console.error('❌', JSON.stringify(logEntry));
            },
            warn: (message, meta = {}) => {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    level: 'WARN',
                    message,
                    service: this.config.serviceName,
                    environment: this.config.environment,
                    ...meta
                };
                console.warn('⚠️ ', JSON.stringify(logEntry));
            },
            debug: (message, meta = {}) => {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    level: 'DEBUG',
                    message,
                    service: this.config.serviceName,
                    environment: this.config.environment,
                    ...meta
                };
                console.log('🐛', JSON.stringify(logEntry));
            }
        };
    }

    setupMetricsCollection() {
        // Only setup intervals if not in test mode
        if (this.config.environment !== 'test') {
            setInterval(() => {
                this.collectSystemMetrics();
                this.shipMetrics();
            }, this.config.metricsInterval);
        }
    }

    setupHealthChecks() {
        // Only setup health checks if not in test mode
        if (this.config.environment !== 'test') {
            setInterval(() => {
                this.performHealthChecks();
            }, 60000); // Every minute
        }
    }

    // Logging methods with automatic shipping
    info(message, meta = {}) {
        this.logger.info(message, { ...meta, timestamp: new Date().toISOString() });
        this.shipLogToWebhooks('info', message, meta);
    }

    error(message, error = null, meta = {}) {
        this.metrics.errors++;
        const errorMeta = {
            ...meta,
            error: error ? {
                message: error.message,
                stack: error.stack,
                code: error.code
            } : null,
            timestamp: new Date().toISOString()
        };
        
        this.logger.error(message, errorMeta);
        this.shipLogToWebhooks('error', message, errorMeta);
        this.checkErrorThresholds();
    }

    warn(message, meta = {}) {
        this.logger.warn(message, { ...meta, timestamp: new Date().toISOString() });
        this.shipLogToWebhooks('warning', message, meta);
    }

    debug(message, meta = {}) {
        this.logger.debug(message, { ...meta, timestamp: new Date().toISOString() });
    }

    // Metrics tracking
    trackSMS(type, metadata = {}) {
        if (type === 'received') {
            this.metrics.smsReceived++;
        } else if (type === 'responded') {
            this.metrics.smsResponded++;
        }
        
        this.info(`SMS ${type}`, {
            type: 'sms_metric',
            sms_type: type,
            ...metadata
        });
    }

    trackAPICall(provider, responseTime, success = true) {
        this.metrics.apiCalls++;
        this.metrics.responseTime.push(responseTime);
        
        // Keep only last 100 response times for memory efficiency
        if (this.metrics.responseTime.length > 100) {
            this.metrics.responseTime = this.metrics.responseTime.slice(-100);
        }
        
        this.info('API call completed', {
            type: 'api_metric',
            provider,
            response_time_ms: responseTime,
            success,
            timestamp: new Date().toISOString()
        });
    }

    trackCacheOperation(operation, hit = false) {
        if (hit) {
            this.metrics.cacheHits++;
        } else {
            this.metrics.cacheMisses++;
        }
        
        this.debug('Cache operation', {
            type: 'cache_metric',
            operation,
            hit,
            hit_ratio: this.getCacheHitRatio()
        });
    }

    trackDatabaseConnection(operation, responseTime) {
        this.metrics.dbConnections++;
        
        this.debug('Database operation', {
            type: 'db_metric',
            operation,
            response_time_ms: responseTime
        });
    }

    // System metrics collection
    collectSystemMetrics() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        this.metrics.memoryUsage.push({
            timestamp: Date.now(),
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            rss: memUsage.rss
        });
        
        this.metrics.cpuUsage.push({
            timestamp: Date.now(),
            user: cpuUsage.user,
            system: cpuUsage.system
        });
        
        // Keep only last 100 entries for memory efficiency
        if (this.metrics.memoryUsage.length > 100) {
            this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-100);
        }
        if (this.metrics.cpuUsage.length > 100) {
            this.metrics.cpuUsage = this.metrics.cpuUsage.slice(-100);
        }
    }

    // Ship metrics to external systems
    async shipMetrics() {
        const timestamp = new Date().toISOString();
        const metrics = {
            timestamp,
            service: this.config.serviceName,
            environment: this.config.environment,
            host: os.hostname(),
            metrics: {
                sms_received: this.metrics.smsReceived,
                sms_responded: this.metrics.smsResponded,
                errors: this.metrics.errors,
                api_calls: this.metrics.apiCalls,
                cache_hits: this.metrics.cacheHits,
                cache_misses: this.metrics.cacheMisses,
                cache_hit_ratio: this.getCacheHitRatio(),
                db_connections: this.metrics.dbConnections,
                avg_response_time: this.getAverageResponseTime(),
                memory_heap_used: this.getCurrentMemoryUsage().heapUsed,
                memory_heap_total: this.getCurrentMemoryUsage().heapTotal
            }
        };

        // Ship to Prometheus Push Gateway
        if (this.config.prometheus.enabled) {
            await this.shipToPrometheus(metrics);
        }

        // Ship to Datadog
        if (this.config.datadog.enabled) {
            await this.shipToDatadog(metrics);
        }

        // Ship to custom webhooks
        for (const webhook of this.config.webhooks) {
            await this.shipToWebhook(webhook, metrics);
        }
    }

    async shipToPrometheus(metrics) {
        try {
            const prometheusMetrics = this.convertToPrometheusFormat(metrics);
            
            const response = await this.httpRequest({
                hostname: this.config.prometheus.gateway.split(':')[0],
                port: parseInt(this.config.prometheus.gateway.split(':')[1]) || 9091,
                path: `/metrics/job/${this.config.prometheus.jobName}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'Content-Length': Buffer.byteLength(prometheusMetrics)
                }
            }, prometheusMetrics);

            this.debug('Metrics shipped to Prometheus', { 
                gateway: this.config.prometheus.gateway,
                statusCode: response.statusCode 
            });

        } catch (error) {
            this.error('Failed to ship metrics to Prometheus', error);
        }
    }

    async shipToDatadog(metrics) {
        try {
            const datadogMetrics = {
                series: [
                    {
                        metric: 'sms_bot.sms.received',
                        points: [[Math.floor(Date.now() / 1000), metrics.metrics.sms_received]],
                        tags: [`service:${this.config.serviceName}`, `env:${this.config.environment}`]
                    },
                    {
                        metric: 'sms_bot.sms.responded',
                        points: [[Math.floor(Date.now() / 1000), metrics.metrics.sms_responded]],
                        tags: [`service:${this.config.serviceName}`, `env:${this.config.environment}`]
                    },
                    {
                        metric: 'sms_bot.errors',
                        points: [[Math.floor(Date.now() / 1000), metrics.metrics.errors]],
                        tags: [`service:${this.config.serviceName}`, `env:${this.config.environment}`]
                    },
                    {
                        metric: 'sms_bot.cache.hit_ratio',
                        points: [[Math.floor(Date.now() / 1000), metrics.metrics.cache_hit_ratio]],
                        tags: [`service:${this.config.serviceName}`, `env:${this.config.environment}`]
                    }
                ]
            };

            const response = await this.httpRequest({
                hostname: this.config.datadog.host,
                path: '/api/v1/series',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'DD-API-KEY': this.config.datadog.apiKey
                }
            }, JSON.stringify(datadogMetrics));

            this.debug('Metrics shipped to Datadog', { 
                statusCode: response.statusCode 
            });

        } catch (error) {
            this.error('Failed to ship metrics to Datadog', error);
        }
    }

    async shipToWebhook(webhook, data) {
        try {
            const url = new URL(webhook.url);
            const payload = {
                service: this.config.serviceName,
                environment: this.config.environment,
                timestamp: new Date().toISOString(),
                type: 'metrics',
                data: data
            };

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: webhook.method || 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...webhook.headers
                }
            };

            const response = await this.httpRequest(options, JSON.stringify(payload));
            
            this.debug('Data shipped to webhook', { 
                url: webhook.url,
                statusCode: response.statusCode 
            });

        } catch (error) {
            this.error('Failed to ship to webhook', error, { webhook: webhook.url });
        }
    }

    async shipLogToWebhooks(level, message, meta) {
        for (const webhook of this.config.webhooks) {
            if (webhook.logLevels && !webhook.logLevels.includes(level)) {
                continue; // Skip this webhook for this log level
            }

            const payload = {
                service: this.config.serviceName,
                environment: this.config.environment,
                timestamp: new Date().toISOString(),
                type: 'log',
                level,
                message,
                meta
            };

            await this.shipToWebhook(webhook, payload);
        }
    }

    // Health checks
    async performHealthChecks() {
        const checks = {
            elasticsearch: this.config.elasticsearch.enabled,
            prometheus: this.config.prometheus.enabled,
            datadog: this.config.datadog.enabled
        };

        for (const [service, enabled] of Object.entries(checks)) {
            if (enabled) {
                await this.checkServiceHealth(service);
            }
        }
    }

    async checkServiceHealth(service) {
        try {
            let healthy = false;
            
            switch (service) {
                case 'elasticsearch':
                    healthy = await this.checkElasticsearchHealth();
                    break;
                case 'prometheus':
                    healthy = await this.checkPrometheusHealth();
                    break;
                case 'datadog':
                    healthy = await this.checkDatadogHealth();
                    break;
            }

            if (!healthy && !this.alerts.has(service)) {
                this.alert(`${service} health check failed`, { service });
                this.alerts.set(service, Date.now());
            } else if (healthy && this.alerts.has(service)) {
                this.info(`${service} health check recovered`, { service });
                this.alerts.delete(service);
            }

        } catch (error) {
            this.error(`Health check failed for ${service}`, error);
        }
    }

    async checkElasticsearchHealth() {
        try {
            const response = await this.httpRequest({
                hostname: this.config.elasticsearch.host.split(':')[0],
                port: parseInt(this.config.elasticsearch.host.split(':')[1]) || 9200,
                path: '/_cluster/health',
                method: 'GET',
                timeout: 5000
            });

            return response.statusCode === 200;
        } catch (error) {
            return false;
        }
    }

    async checkPrometheusHealth() {
        try {
            const response = await this.httpRequest({
                hostname: this.config.prometheus.gateway.split(':')[0],
                port: parseInt(this.config.prometheus.gateway.split(':')[1]) || 9091,
                path: '/api/v1/status/config',
                method: 'GET',
                timeout: 5000
            });

            return response.statusCode === 200;
        } catch (error) {
            return false;
        }
    }

    async checkDatadogHealth() {
        try {
            const response = await this.httpRequest({
                hostname: this.config.datadog.host,
                path: '/api/v1/validate',
                method: 'GET',
                headers: {
                    'DD-API-KEY': this.config.datadog.apiKey
                },
                timeout: 5000
            });

            return response.statusCode === 200;
        } catch (error) {
            return false;
        }
    }

    // Alert system
    alert(message, meta = {}) {
        this.error(`ALERT: ${message}`, null, {
            ...meta,
            alert: true,
            severity: 'high'
        });

        // Ship alert to all webhooks immediately
        for (const webhook of this.config.webhooks) {
            this.shipToWebhook(webhook, {
                type: 'alert',
                message,
                meta,
                timestamp: new Date().toISOString()
            });
        }
    }

    checkErrorThresholds() {
        const errorRate = this.metrics.errors / (this.metrics.smsReceived || 1);
        
        if (errorRate > 0.1) { // 10% error rate threshold
            this.alert('High error rate detected', {
                error_rate: errorRate,
                errors: this.metrics.errors,
                sms_received: this.metrics.smsReceived
            });
        }
    }

    // Utility methods
    getCacheHitRatio() {
        const total = this.metrics.cacheHits + this.metrics.cacheMisses;
        return total > 0 ? (this.metrics.cacheHits / total) : 0;
    }

    getAverageResponseTime() {
        if (this.metrics.responseTime.length === 0) return 0;
        return this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length;
    }

    getCurrentMemoryUsage() {
        return process.memoryUsage();
    }

    convertToPrometheusFormat(metrics) {
        const lines = [];
        const timestamp = Math.floor(Date.now() / 1000);
        
        for (const [key, value] of Object.entries(metrics.metrics)) {
            if (typeof value === 'number') {
                lines.push(`sms_bot_${key}{service="${this.config.serviceName}",environment="${this.config.environment}"} ${value} ${timestamp}`);
            }
        }
        
        return lines.join('\n') + '\n';
    }

    async httpRequest(options, data = null) {
        return new Promise((resolve, reject) => {
            const protocol = options.port === 443 || options.hostname.includes('https') ? https : http;
            
            const req = protocol.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, body }));
            });

            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Request timeout')));
            
            if (options.timeout) {
                req.setTimeout(options.timeout);
            }

            if (data) {
                req.write(data);
            }
            
            req.end();
        });
    }

    // Get monitoring dashboard data
    getDashboardData() {
        return {
            service: this.config.serviceName,
            environment: this.config.environment,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            metrics: {
                ...this.metrics,
                cache_hit_ratio: this.getCacheHitRatio(),
                avg_response_time: this.getAverageResponseTime(),
                current_memory: this.getCurrentMemoryUsage(),
                active_alerts: Array.from(this.alerts.keys())
            },
            configuration: {
                elasticsearch: this.config.elasticsearch.enabled,
                prometheus: this.config.prometheus.enabled,
                datadog: this.config.datadog.enabled,
                webhooks: this.config.webhooks.length
            }
        };
    }

    // Reset metrics (useful for testing or periodic resets)
    resetMetrics() {
        this.metrics = {
            smsReceived: 0,
            smsResponded: 0,
            errors: 0,
            apiCalls: 0,
            cacheHits: 0,
            cacheMisses: 0,
            dbConnections: 0,
            responseTime: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        this.info('Metrics reset');
    }
}

module.exports = EnterpriseMonitoring;