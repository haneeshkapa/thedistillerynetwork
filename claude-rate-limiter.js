const logger = require('./logger');

class ClaudeRateLimiter {
    constructor() {
        // Rate limiting configuration
        this.queue = [];
        this.processing = false;
        this.requestsPerMinute = 20; // Increased for better throughput
        this.requestWindow = 60000; // 1 minute in milliseconds
        this.burstLimit = 5; // Allow 5 rapid requests, then queue
        this.requestTimes = [];
        this.maxRetries = 3;
        
        // Response caching
        this.cache = new Map();
        this.cacheMaxSize = 200; // Increased cache to reduce API calls
        this.cacheTTL = 600000; // 10 minutes - longer cache for similar queries
        
        // Request optimization
        this.maxContextLength = 1000; // Extreme token reduction - emergency mode
        this.maxKnowledgeSections = 1; // Only 1 most relevant section
        
        // Advanced knowledge indexing
        this.productIndex = new Map(); // Hash table for O(1) product lookups
        this.tagIndex = new Map(); // Index for tags and categories
        this.priceIndex = new Map(); // Price-based indexing
        this.buildIndexes();
        
        logger.info('Claude API rate limiter initialized', {
            requestsPerMinute: this.requestsPerMinute,
            maxContextLength: this.maxContextLength,
            cacheSize: this.cacheMaxSize
        });
    }
    
    // Build efficient indexes for fast product search
    buildIndexes() {
        try {
            const fs = require('fs');
            const knowledgePath = './data/knowledge.json';
            
            if (fs.existsSync(knowledgePath)) {
                const knowledgeData = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
                
                knowledgeData.forEach(entry => {
                    if (entry.fileType === '.shopify' && entry.content) {
                        this.indexShopifyData(entry.content);
                    }
                });
                
                logger.info('Knowledge base indexes built', {
                    products: this.productIndex.size,
                    tags: this.tagIndex.size,
                    priceRanges: this.priceIndex.size
                });
            }
        } catch (error) {
            logger.warn('Failed to build indexes', { error: error.message });
        }
    }
    
    // Index Shopify product data for fast retrieval
    indexShopifyData(content) {
        const productSections = content.split('--- ').slice(1); // Skip header
        
        productSections.forEach((section, index) => {
            const lines = section.split('\n');
            const title = lines[0]?.replace(' ---', '').trim();
            
            if (title && title !== 'PRODUCTS (51 items) ===') {
                const productData = {
                    title,
                    section: section.substring(0, 800), // Aggressive truncation
                    index
                };
                
                // Index by product name (hash table for O(1) lookup)
                this.indexProductByName(title, productData);
                
                // Extract and index tags
                const tagsMatch = section.match(/Tags: ([^\n]+)/);
                if (tagsMatch) {
                    const tags = tagsMatch[1].split(', ');
                    tags.forEach(tag => this.indexByTag(tag.toLowerCase().trim(), productData));
                }
                
                // Extract and index price
                const priceMatch = section.match(/\$(\d+(?:\.\d{2})?)/);
                if (priceMatch) {
                    const price = parseFloat(priceMatch[1]);
                    this.indexByPrice(price, productData);
                }
            }
        });
    }
    
    // Index product by name with fuzzy matching support
    indexProductByName(name, productData) {
        const normalizedName = name.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const words = normalizedName.split(/\s+/);
        
        // Index full name
        this.productIndex.set(normalizedName, productData);
        
        // Index individual significant words (length > 3)
        words.forEach(word => {
            if (word.length > 3) {
                if (!this.productIndex.has(word)) {
                    this.productIndex.set(word, []);
                }
                if (Array.isArray(this.productIndex.get(word))) {
                    this.productIndex.get(word).push(productData);
                } else {
                    this.productIndex.set(word, [productData]);
                }
            }
        });
    }
    
    // Index by tags for category-based search
    indexByTag(tag, productData) {
        if (!this.tagIndex.has(tag)) {
            this.tagIndex.set(tag, []);
        }
        this.tagIndex.get(tag).push(productData);
    }
    
    // Index by price ranges
    indexByPrice(price, productData) {
        const range = this.getPriceRange(price);
        if (!this.priceIndex.has(range)) {
            this.priceIndex.set(range, []);
        }
        this.priceIndex.get(range).push(productData);
    }
    
    // Get price range for indexing
    getPriceRange(price) {
        if (price < 100) return 'under-100';
        if (price < 300) return '100-300';
        if (price < 500) return '300-500';
        if (price < 1000) return '500-1000';
        return 'over-1000';
    }
    
    // Fast product search using indexes
    fastProductSearch(query) {
        const queryLower = query.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const queryWords = queryLower.split(/\s+/);
        const results = new Set();
        
        // Direct product name lookup (O(1))
        if (this.productIndex.has(queryLower)) {
            const match = this.productIndex.get(queryLower);
            if (Array.isArray(match)) {
                match.forEach(product => results.add(product));
            } else {
                results.add(match);
            }
        }
        
        // Word-based search (O(1) per word)
        queryWords.forEach(word => {
            if (word.length > 3 && this.productIndex.has(word)) {
                const matches = this.productIndex.get(word);
                if (Array.isArray(matches)) {
                    matches.forEach(product => results.add(product));
                }
            }
        });
        
        // Tag-based search (O(1))
        queryWords.forEach(word => {
            if (this.tagIndex.has(word)) {
                this.tagIndex.get(word).forEach(product => results.add(product));
            }
        });
        
        // Price-based search
        const priceMatch = query.match(/\$(\d+)/);
        if (priceMatch) {
            const price = parseFloat(priceMatch[1]);
            const range = this.getPriceRange(price);
            if (this.priceIndex.has(range)) {
                this.priceIndex.get(range).forEach(product => results.add(product));
            }
        }
        
        return Array.from(results).slice(0, this.maxKnowledgeSections);
    }
    
    // Generate cache key from phone and message with fuzzy matching
    generateCacheKey(phone, message) {
        // Normalize message for better cache hits
        const normalizedMessage = message.toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
            .substring(0, 80); // Shorter key for more cache hits
        
        return `${phone}:${normalizedMessage}`;
    }
    
    // Check if we're within rate limits
    canMakeRequest() {
        const now = Date.now();
        
        // Clean old request times
        this.requestTimes = this.requestTimes.filter(time => now - time < this.requestWindow);
        
        // Check burst limit (last 10 seconds)
        const recentRequests = this.requestTimes.filter(time => now - time < 10000);
        if (recentRequests.length >= this.burstLimit) {
            return false; // Too many rapid requests
        }
        
        return this.requestTimes.length < this.requestsPerMinute;
    }
    
    // Record a request
    recordRequest() {
        this.requestTimes.push(Date.now());
    }
    
    // Clean up cache if it gets too large
    cleanupCache() {
        if (this.cache.size > this.cacheMaxSize) {
            // Remove oldest entries (first 20%)
            const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.cacheMaxSize * 0.2));
            keysToDelete.forEach(key => this.cache.delete(key));
            
            logger.debug('Cache cleanup performed', { 
                removedEntries: keysToDelete.length,
                currentSize: this.cache.size 
            });
        }
    }
    
    // Check cache for existing response
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
        
        this.cleanupCache();
    }
    
    // Ultra-fast knowledge base optimization using pre-built indexes
    optimizeKnowledgeBase(knowledgeBase, message) {
        if (!knowledgeBase || knowledgeBase.length <= this.maxContextLength) {
            return knowledgeBase;
        }
        
        // Try fast product search first (O(1) for most queries)
        const fastResults = this.fastProductSearch(message);
        if (fastResults.length > 0) {
            let optimizedContent = '';
            
            fastResults.forEach(product => {
                if (optimizedContent.length + product.section.length <= this.maxContextLength) {
                    optimizedContent += product.section + '\n---\n';
                }
            });
            
            if (optimizedContent) {
                logger.debug('Fast product search used', {
                    originalLength: knowledgeBase.length,
                    optimizedLength: optimizedContent.length,
                    productsFound: fastResults.length,
                    tokenReduction: `${Math.round((1 - optimizedContent.length / knowledgeBase.length) * 100)}%`
                });
                
                return optimizedContent;
            }
        }
        
        // Fallback to legacy search with improved fuzzy matching
        return this.legacyOptimizeKnowledgeBase(knowledgeBase, message);
    }
    
    // Legacy optimization method with fuzzy matching improvements
    legacyOptimizeKnowledgeBase(knowledgeBase, message) {
        const messageWords = this.extractKeywords(message);
        const sections = knowledgeBase.split('---').filter(s => s.trim());
        
        // Enhanced scoring with fuzzy matching
        const scoredSections = sections.map(section => {
            const sectionLower = section.toLowerCase();
            let score = 0;
            
            // Advanced keyword matching with fuzzy tolerance
            messageWords.forEach(word => {
                // Exact matches (highest score)
                const exactMatches = (sectionLower.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
                score += exactMatches * 5;
                
                // Partial matches
                const partialMatches = (sectionLower.match(new RegExp(word, 'g')) || []).length - exactMatches;
                score += partialMatches * 2;
                
                // Fuzzy matches (edit distance 1-2)
                const fuzzyMatches = this.findFuzzyMatches(word, sectionLower);
                score += fuzzyMatches * 1;
            });
            
            // Boost for important content types
            if (sectionLower.match(/\$\d+/) || sectionLower.includes('price')) score += 3;
            if (sectionLower.includes('gallon') || sectionLower.includes('still')) score += 2;
            if (sectionLower.includes('copper') || sectionLower.includes('electric')) score += 2;
            
            // Length penalty
            if (section.length > 1000) score *= 0.8;
            
            return { section: section.trim(), score };
        }).sort((a, b) => b.score - a.score);
        
        // Build optimized content
        let optimizedContent = '';
        let sectionCount = 0;
        
        for (const { section, score } of scoredSections) {
            if (sectionCount >= this.maxKnowledgeSections || 
                optimizedContent.length + section.length > this.maxContextLength) {
                break;
            }
            
            if (score > 0) {
                optimizedContent += section + '\n---\n';
                sectionCount++;
            }
        }
        
        logger.debug('Legacy search used', {
            originalLength: knowledgeBase.length,
            optimizedLength: optimizedContent.length,
            sectionsIncluded: sectionCount,
            totalSections: sections.length,
            tokenReduction: `${Math.round((1 - optimizedContent.length / knowledgeBase.length) * 100)}%`
        });
        
        return optimizedContent || knowledgeBase.substring(0, this.maxContextLength);
    }
    
    // Extract and normalize keywords from message
    extractKeywords(message) {
        return message.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2)
            .slice(0, 8); // Limit keywords for performance
    }
    
    // Simple fuzzy matching for typos (Levenshtein distance approximation)
    findFuzzyMatches(word, text) {
        if (word.length < 4) return 0; // Too short for fuzzy matching
        
        let matches = 0;
        const regex = new RegExp(`\\b\\w*${word.substring(0, Math.floor(word.length * 0.7))}\\w*\\b`, 'g');
        const fuzzyMatches = text.match(regex) || [];
        
        fuzzyMatches.forEach(match => {
            const distance = this.levenshteinDistance(word, match);
            if (distance <= Math.max(1, Math.floor(word.length * 0.2))) {
                matches++;
            }
        });
        
        return matches;
    }
    
    // Simple Levenshtein distance calculation
    levenshteinDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + cost
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    // Process request with rate limiting, caching, and retry logic
    async processRequest(anthropic, requestData) {
        const { phone, message, prompt } = requestData;
        const cacheKey = this.generateCacheKey(phone, message);
        
        // Emergency token reduction - force optimize ALL prompts
        let optimizedPrompt = prompt;
        
        // Find knowledge section with multiple patterns
        let knowledgeMatch = prompt.match(/COMPANY KNOWLEDGE:\n([\s\S]*?)\n\n/);
        if (!knowledgeMatch) {
            knowledgeMatch = prompt.match(/KNOWLEDGE:\n([\s\S]*?)\n\n/);
        }
        if (!knowledgeMatch) {
            // Look for any large text block
            knowledgeMatch = prompt.match(/([\s\S]{2000,})/);
        }
        
        if (knowledgeMatch) {
            const knowledgeBase = knowledgeMatch[1];
            const optimizedKnowledge = this.optimizeKnowledgeBase(knowledgeBase, message);
            optimizedPrompt = prompt.replace(knowledgeMatch[1], optimizedKnowledge);
        }
        
        // Emergency fallback: if prompt still too long, truncate aggressively
        if (optimizedPrompt.length > 5000) {
            const systemPart = optimizedPrompt.substring(0, 500);
            const messagePart = `Customer message: "${message}"`;
            optimizedPrompt = systemPart + '\n\n' + messagePart + '\n\nRespond briefly as a helpful customer service rep.';
        }
        
        // Check cache first
        const cachedResponse = this.getCachedResponse(cacheKey);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Add to queue if rate limited
        return new Promise((resolve, reject) => {
            this.queue.push({
                requestData,
                resolve,
                reject,
                retries: 0,
                timestamp: Date.now(),
                optimizedPrompt
            });
            
            this.processQueue(anthropic);
        });
    }
    
    // Process the request queue
    async processQueue(anthropic) {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            if (!this.canMakeRequest()) {
                // Exponential backoff based on queue length and retries
                const baseWait = 2000; // 2 seconds base
                const queueMultiplier = Math.min(this.queue.length * 500, 5000); // Max 5s for queue
                const retryMultiplier = queueItem.retries * 1000; // 1s per retry
                const waitTime = baseWait + queueMultiplier + retryMultiplier;
                
                logger.warn(`Rate limit reached, waiting ${waitTime}ms (queue: ${this.queue.length}, retries: ${queueItem.retries})`);
                await this.sleep(waitTime);
                continue;
            }
            
            const queueItem = this.queue.shift();
            const { requestData, resolve, reject, retries, optimizedPrompt } = queueItem;
            const { phone, message } = requestData;
            const cacheKey = this.generateCacheKey(phone, message);
            
            try {
                this.recordRequest();
                
                logger.debug('Processing Claude API request', { 
                    phone,
                    messageLength: message.length,
                    queueLength: this.queue.length,
                    retries
                });
                
                const response = await anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 200, // Reduced for SMS responses
                    messages: [{ role: 'user', content: optimizedPrompt || requestData.prompt }]
                });
                
                const reply = response.content[0].text;
                
                // Cache successful response
                this.setCachedResponse(cacheKey, reply);
                
                logger.info('Claude API request successful', { 
                    phone,
                    responseLength: reply.length,
                    tokensUsed: response.usage?.input_tokens || 'unknown'
                });
                
                resolve(reply);
                
            } catch (error) {
                if (error.status === 429 && retries < this.maxRetries) {
                    // Rate limit error - retry with exponential backoff
                    const backoffTime = Math.pow(2, retries) * 10000; // 10s, 20s, 40s
                    
                    logger.warn('Rate limit hit, retrying request', {
                        phone,
                        retries: retries + 1,
                        backoffTime,
                        queueLength: this.queue.length
                    });
                    
                    // Add back to queue with retry count
                    setTimeout(() => {
                        this.queue.unshift({
                            ...queueItem,
                            retries: retries + 1
                        });
                        this.processQueue(anthropic);
                    }, backoffTime);
                    
                } else {
                    logger.error('Claude API request failed', {
                        phone,
                        error: error.message,
                        status: error.status,
                        retries,
                        finalFailure: retries >= this.maxRetries
                    });
                    
                    reject(error);
                }
            }
        }
        
        this.processing = false;
    }
    
    // Helper function for delays
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Get queue status for monitoring
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            requestsInWindow: this.requestTimes.length,
            cacheSize: this.cache.size,
            rateLimitStatus: this.canMakeRequest() ? 'ok' : 'limited'
        };
    }
    
    // Clear cache (for admin use)
    clearCache() {
        const size = this.cache.size;
        this.cache.clear();
        logger.info('Response cache cleared', { clearedEntries: size });
        return size;
    }
}

module.exports = ClaudeRateLimiter;