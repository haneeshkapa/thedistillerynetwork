const logger = require('./logger');

class CacheOptimizer {
    constructor() {
        this.cacheWriteMultiplier = 1.25; // 5-min TTL cache write cost
        this.cacheReadMultiplier = 0.1;   // Cache read cost
        this.cacheHitRate = 0.85; // Target 85% cache hits
        
        // Stable content that should be cached
        this.stableContent = this.buildStableCacheContent();
        
        logger.info('Cache optimizer initialized', {
            stableContentLength: this.stableContent.length,
            targetHitRate: this.cacheHitRate
        });
    }
    
    buildStableCacheContent() {
        return `You are a helpful customer service representative for American Copper Works, specializing in copper stills and distillation equipment.

CRITICAL RULES (FRONT-LOADED):
- Never invent price or stock information
- If fields missing, say so + give phone (603) 997-6786 or site moonshinestills.com  
- Prefer 1-2 sentences; max 300 tokens; no emojis
- If customer not matched by phone, ask for order # or email

RESPONSE GUIDELINES:
- Be friendly, helpful, and professional
- Provide specific product information when available
- Always include contact info: moonshinestills.com | (603) 997-6786
- For orders/inquiries, ask for customer contact information
- Keep responses concise and SMS-friendly

EXAMPLE INTERACTIONS:
Customer: "10 gallon still price"
You: "The 10 Gallon Advanced Model with 220v Element is $899.00 with free shipping."

Customer: "what copper stills do you have"
You: "We offer various copper stills from 2 to 100 gallons. Popular models include our 10-gallon Advanced Model ($899) and Flash Sale units ($1000)."

CONTACT INFORMATION:
- Website: moonshinestills.com
- Phone: (603) 997-6786  
- Email: tdnorders@gmail.com
- Free shipping to continental USA

CACHE_TIER_5MIN_STABLE_CONTENT`;
    }
    
    // Generate cache-optimized prompt structure
    generateCachedPrompt(dynamicContext, userMessage, customerInfo = null) {
        // Cached portion (stable system content)
        const cachedSection = this.stableContent;
        
        // Dynamic portion (not cached)
        let dynamicSection = '\n\nCURRENT CONTEXT:\n';
        
        // Add dynamic product information if available
        if (dynamicContext && dynamicContext.length > 0) {
            dynamicSection += dynamicContext + '\n';
        }
        
        // Add customer context if available  
        if (customerInfo) {
            dynamicSection += `\nCUSTOMER INFO:\n`;
            dynamicSection += `Phone: ${customerInfo.phone || 'Unknown'}\n`;
            if (customerInfo.previousOrders) {
                dynamicSection += `Previous Orders: ${customerInfo.previousOrders.length} orders\n`;
            }
            if (customerInfo.lastOrderAmount) {
                dynamicSection += `Last Order: $${customerInfo.lastOrderAmount}\n`;
            }
        }
        
        // Add user message
        dynamicSection += `\nCUSTOMER MESSAGE: "${userMessage}"\n`;
        
        // Critical reminders at the end (anti "lost in the middle")
        dynamicSection += `\nFINAL REMINDERS:
- Never guess prices or stock status
- If uncertain, direct to (603) 997-6786
- Keep response under 300 tokens
- Include contact info in response`;
        
        return {
            cached: cachedSection,
            dynamic: dynamicSection,
            full: cachedSection + dynamicSection,
            cacheEfficiency: this.calculateCacheEfficiency(cachedSection, dynamicSection)
        };
    }
    
    calculateCacheEfficiency(cachedContent, dynamicContent) {
        const totalLength = cachedContent.length + dynamicContent.length;
        const cacheablePercent = (cachedContent.length / totalLength) * 100;
        
        // Calculate cost savings
        const normalCost = totalLength * 1.0; // Base input cost
        const cachedCost = (cachedContent.length * this.cacheWriteMultiplier * 0.05) + // 5% cache writes
                          (cachedContent.length * this.cacheReadMultiplier * 0.95) +    // 95% cache reads  
                          (dynamicContent.length * 1.0);                                // Dynamic always full cost
        
        const savings = ((normalCost - cachedCost) / normalCost) * 100;
        
        return {
            cacheablePercent: cacheablePercent,
            costSavings: savings,
            estimatedTokens: Math.ceil(totalLength / 4)
        };
    }
    
    // Generate cache key for stable content (reuse across requests)
    getCacheKey() {
        // Use content hash for stable cache key reuse
        return 'american_copper_works_stable_v1_5min';
    }
    
    // Estimate token costs with caching
    estimateTokenCosts(promptData) {
        const { cached, dynamic } = promptData;
        
        const cachedTokens = Math.ceil(cached.length / 4);
        const dynamicTokens = Math.ceil(dynamic.length / 4);
        
        // Assume 95% cache hits for stable content
        const cacheWriteTokens = cachedTokens * this.cacheWriteMultiplier * 0.05;
        const cacheReadTokens = cachedTokens * this.cacheReadMultiplier * 0.95;
        const dynamicCostTokens = dynamicTokens * 1.0;
        
        return {
            totalInputTokens: cachedTokens + dynamicTokens,
            effectiveCost: cacheWriteTokens + cacheReadTokens + dynamicCostTokens,
            savings: ((cachedTokens + dynamicTokens) - (cacheWriteTokens + cacheReadTokens + dynamicCostTokens)),
            breakdown: {
                cached: { tokens: cachedTokens, writes: cacheWriteTokens, reads: cacheReadTokens },
                dynamic: { tokens: dynamicTokens, cost: dynamicCostTokens }
            }
        };
    }
}

module.exports = CacheOptimizer;