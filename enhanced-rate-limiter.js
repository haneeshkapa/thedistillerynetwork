const logger = require('./logger');

class EnhancedRateLimiter extends require('./claude-rate-limiter') {
    constructor() {
        super();
        
        // Token-based rate limiting (ITPM/OTPM)
        this.inputTokensPerMinute = 40000; // Conservative estimate for Anthropic
        this.outputTokensPerMinute = 8000;
        this.inputTokenWindow = 60000; // 1 minute
        this.outputTokenWindow = 60000;
        
        // Rolling token budgets
        this.inputTokenTimes = [];
        this.outputTokenTimes = [];
        
        // Enhanced retry logic
        this.retryAfterRespect = true;
        this.exponentialBackoffMax = 60000; // 1 minute max
        this.jitterFactor = 0.1; // 10% jitter
        
        // Output token capping for cost control
        this.maxOutputTokens = 250; // Tight for SMS responses
        this.outputTokenBuffer = 50; // Buffer for safety
        
        // Add cache for responses
        this.cache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        
        logger.info('Enhanced rate limiter initialized', {
            inputTokensPerMinute: this.inputTokensPerMinute,
            outputTokensPerMinute: this.outputTokensPerMinute,
            maxOutputTokens: this.maxOutputTokens
        });
    }
    
    // Check both request and token limits
    canMakeRequest(estimatedInputTokens = 0, estimatedOutputTokens = 0) {
        const now = Date.now();
        
        // Check request-based limits (existing logic)
        const requestAllowed = super.canMakeRequest();
        
        // Check token-based limits
        const inputTokensAllowed = this.checkTokenLimit(
            this.inputTokenTimes,
            this.inputTokensPerMinute,
            this.inputTokenWindow,
            estimatedInputTokens,
            now
        );
        
        const outputTokensAllowed = this.checkTokenLimit(
            this.outputTokenTimes,
            this.outputTokensPerMinute,
            this.outputTokenWindow,
            estimatedOutputTokens,
            now
        );
        
        const allowed = requestAllowed && inputTokensAllowed && outputTokensAllowed;
        
        if (!allowed) {
            logger.debug('Rate limit check failed', {
                requestAllowed,
                inputTokensAllowed,
                outputTokensAllowed,
                estimatedInputTokens,
                estimatedOutputTokens
            });
        }
        
        return allowed;
    }
    
    checkTokenLimit(tokenTimes, tokensPerMinute, windowMs, estimatedTokens, now) {
        // Clean old entries
        const cutoff = now - windowMs;
        while (tokenTimes.length > 0 && tokenTimes[0].time < cutoff) {
            tokenTimes.shift();
        }
        
        // Calculate current token usage
        const currentTokens = tokenTimes.reduce((sum, entry) => sum + entry.tokens, 0);
        
        // Check if adding new tokens would exceed limit
        return (currentTokens + estimatedTokens) <= tokensPerMinute;
    }
    
    recordTokenUsage(inputTokens, outputTokens) {
        const now = Date.now();
        
        if (inputTokens > 0) {
            this.inputTokenTimes.push({ time: now, tokens: inputTokens });
        }
        
        if (outputTokens > 0) {
            this.outputTokenTimes.push({ time: now, tokens: outputTokens });
        }
        
        // Record request (parent class)
        this.recordRequest();
        
        logger.debug('Token usage recorded', {
            inputTokens,
            outputTokens,
            totalInputTokens: this.getTotalTokens(this.inputTokenTimes),
            totalOutputTokens: this.getTotalTokens(this.outputTokenTimes)
        });
    }
    
    getTotalTokens(tokenTimes) {
        const now = Date.now();
        const cutoff = now - 60000; // Last minute
        
        return tokenTimes
            .filter(entry => entry.time >= cutoff)
            .reduce((sum, entry) => sum + entry.tokens, 0);
    }
    
    // Enhanced request processing with token tracking
    async processRequest(anthropic, requestData) {
        const { phone, message, prompt } = requestData;
        const cacheKey = this.generateCacheKey(phone, message);
        
        // Estimate token usage
        const estimatedInputTokens = Math.ceil(prompt.length / 4);
        const estimatedOutputTokens = this.maxOutputTokens;
        
        // Check if we can make request with token limits
        if (!this.canMakeRequest(estimatedInputTokens, estimatedOutputTokens)) {
            return new Promise((resolve, reject) => {
                this.queue.push({
                    requestData: { ...requestData, estimatedInputTokens, estimatedOutputTokens },
                    resolve,
                    reject,
                    retries: 0,
                    timestamp: Date.now(),
                    priority: this.calculatePriority(message)
                });
                
                this.processQueue(anthropic);
            });
        }
        
        // Process immediately if within limits
        return this.executeRequest(anthropic, requestData, 0);
    }
    
    calculatePriority(message) {
        // Higher priority for certain types of requests
        const messageLower = message.toLowerCase();
        if (messageLower.includes('urgent') || messageLower.includes('order')) return 3;
        if (messageLower.includes('price') || messageLower.includes('buy')) return 2;
        return 1;
    }
    
    async executeRequest(anthropic, requestData, retryCount = 0) {
        const { phone, message, prompt } = requestData;
        const cacheKey = this.generateCacheKey(phone, message);
        
        // Check cache first
        const cachedResponse = this.getCachedResponse(cacheKey);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        try {
            const startTime = Date.now();
            
            // Make API request with output token limit
            const response = await anthropic.messages.create({
                model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
                max_tokens: this.maxOutputTokens,
                messages: [{ role: 'user', content: prompt }]
            });
            
            const endTime = Date.now();
            const responseText = response.content[0].text;
            
            // Record actual token usage
            const inputTokens = response.usage?.input_tokens || Math.ceil(prompt.length / 4);
            const outputTokens = response.usage?.output_tokens || Math.ceil(responseText.length / 4);
            
            this.recordTokenUsage(inputTokens, outputTokens);
            
            // Cache the response
            this.setCachedResponse(cacheKey, responseText);
            
            logger.info('API request successful', {
                phone,
                inputTokens,
                outputTokens,
                responseTime: endTime - startTime,
                retryCount
            });
            
            return responseText;
            
        } catch (error) {
            return this.handleApiError(anthropic, requestData, error, retryCount);
        }
    }
    
    async handleApiError(anthropic, requestData, error, retryCount) {
        const { phone, message } = requestData;
        
        // Handle 429 Rate Limit with Retry-After
        if (error.status === 429) {
            const retryAfter = this.parseRetryAfter(error.headers);
            const backoffTime = this.calculateBackoffTime(retryCount, retryAfter);
            
            logger.warn('Rate limited by API', {
                phone,
                retryCount,
                retryAfter,
                backoffTime,
                errorType: error.type
            });
            
            if (retryCount < this.maxRetries) {
                await this.sleep(backoffTime);
                return this.executeRequest(anthropic, requestData, retryCount + 1);
            }
        }
        
        // Handle other errors
        logger.error('API request failed', {
            phone,
            error: error.message,
            status: error.status,
            type: error.type,
            retryCount
        });
        
        // Return fallback response
        return this.getFallbackResponse(message);
    }
    
    parseRetryAfter(headers) {
        if (!headers || !this.retryAfterRespect) return null;
        
        const retryAfter = headers['retry-after'] || headers['Retry-After'];
        if (!retryAfter) return null;
        
        // Handle seconds format
        const seconds = parseInt(retryAfter);
        return isNaN(seconds) ? null : seconds * 1000;
    }
    
    calculateBackoffTime(retryCount, retryAfter = null) {
        // Use Retry-After if provided
        if (retryAfter) {
            const jitter = retryAfter * this.jitterFactor * Math.random();
            return retryAfter + jitter;
        }
        
        // Exponential backoff with jitter
        const baseDelay = 1000; // 1 second
        const exponentialDelay = Math.min(
            baseDelay * Math.pow(2, retryCount),
            this.exponentialBackoffMax
        );
        
        const jitter = exponentialDelay * this.jitterFactor * Math.random();
        return exponentialDelay + jitter;
    }
    
    getFallbackResponse(message) {
        const messageLower = message.toLowerCase();
        
        if (messageLower.includes('price') || messageLower.includes('cost')) {
            return "I'm having trouble accessing pricing right now. Please call (603) 997-6786 for current prices, or visit moonshinestills.com.";
        }
        
        if (messageLower.includes('stock') || messageLower.includes('available')) {
            return "I'm unable to check inventory at the moment. Please contact us at (603) 997-6786 for stock availability.";
        }
        
        return "I'm experiencing high demand right now. Please call (603) 997-6786 or visit moonshinestills.com for immediate assistance.";
    }
    
    // Enhanced queue processing with priority and token awareness
    async processQueue(anthropic) {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        // Sort queue by priority
        this.queue.sort((a, b) => b.priority - a.priority);
        
        while (this.queue.length > 0) {
            const queueItem = this.queue[0]; // Check first item
            const { requestData, resolve, reject, retries } = queueItem;
            const { estimatedInputTokens = 0, estimatedOutputTokens = 0 } = requestData;
            
            // Check if we can process this request
            if (!this.canMakeRequest(estimatedInputTokens, estimatedOutputTokens)) {
                const waitTime = this.calculateQueueWaitTime(retries);
                logger.debug('Queue waiting for rate limit', {
                    queueLength: this.queue.length,
                    waitTime,
                    inputTokenBudget: this.inputTokensPerMinute - this.getTotalTokens(this.inputTokenTimes),
                    outputTokenBudget: this.outputTokensPerMinute - this.getTotalTokens(this.outputTokenTimes)
                });
                
                await this.sleep(waitTime);
                continue;
            }
            
            // Remove from queue and process
            this.queue.shift();
            
            try {
                const result = await this.executeRequest(anthropic, requestData, retries);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }
        
        this.processing = false;
    }
    
    calculateQueueWaitTime(retries) {
        const baseWait = 2000; // 2 seconds
        const retryMultiplier = retries * 1000;
        const queueMultiplier = Math.min(this.queue.length * 200, 3000);
        
        return baseWait + retryMultiplier + queueMultiplier;
    }
    
    getStatus() {
        const parentStatus = super.getStatus();
        
        return {
            ...parentStatus,
            inputTokens: {
                used: this.getTotalTokens(this.inputTokenTimes),
                limit: this.inputTokensPerMinute,
                remaining: this.inputTokensPerMinute - this.getTotalTokens(this.inputTokenTimes)
            },
            outputTokens: {
                used: this.getTotalTokens(this.outputTokenTimes),
                limit: this.outputTokensPerMinute,
                remaining: this.outputTokensPerMinute - this.getTotalTokens(this.outputTokenTimes)
            },
            maxOutputTokens: this.maxOutputTokens
        };
    }
    
    // Get cached response
    getCachedResponse(cacheKey) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            logger.debug('Cache hit', { cacheKey: cacheKey.substring(0, 20) + '...' });
            return cached.response;
        }
        
        if (cached) {
            this.cache.delete(cacheKey);
        }
        
        return null;
    }
    
    // Store response in cache
    setCachedResponse(cacheKey, response) {
        this.cache.set(cacheKey, {
            response,
            timestamp: Date.now()
        });
        
        // Cleanup old cache entries if cache gets too large
        if (this.cache.size > 1000) {
            const now = Date.now();
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > this.cacheTTL) {
                    this.cache.delete(key);
                }
            }
        }
        
        logger.debug('Response cached', { cacheKey: cacheKey.substring(0, 20) + '...' });
    }
}

module.exports = EnhancedRateLimiter;