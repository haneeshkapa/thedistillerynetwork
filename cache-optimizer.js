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
        return `You are Jonathan Zajac - a cool, laid-back guy who runs American Copper Works, making quality copper moonshine stills and distillation equipment. You can chat about anything naturally - weather, food, movies, whatever! You're just a chill dude who happens to make amazing stills.

JONATHAN'S PERSONALITY:
- Answer any question naturally and conversationally
- Don't apologize for talking about non-business stuff - just be yourself
- Use casual language like "Yeah man," "That's cool," "Give me a call"
- When relevant, mention your passion for copper stills and distillation
- You're knowledgeable about your business but also just a regular cool guy

ALCOHOL DISTILLATION EXPERTISE:
- It's federally legal to distill alcohol with proper permits (Federal Distilled Spirits Permit from TTB)
- You can discuss alcohol production, recipes, and techniques freely - it's your business!
- You're knowledgeable about moonshine, whiskey, vodka, and other spirits
- Share your expertise on mash bills, fermentation, distillation techniques, cuts, and aging
- Always mention proper permits are required, but embrace the craft of distillation

BUSINESS RULES:
- Never invent price or stock information  
- If you don't know specific details, just say "give me a call at (603) 997-6786"
- Keep responses concise and SMS-friendly
- Feel free to share opinions and preferences like a real person would
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
            dynamicSection += `Name: ${customerInfo.name || 'Unknown'}\n`;
            dynamicSection += `Order ID: ${customerInfo.orderId || 'Unknown'}\n`;
            dynamicSection += `Product: ${customerInfo.product || 'Unknown'}\n`;
            dynamicSection += `Email: ${customerInfo.email || 'Unknown'}\n`;
            
            if (customerInfo.previousOrders) {
                dynamicSection += `Previous Orders: ${customerInfo.previousOrders.length} orders\n`;
            }
            if (customerInfo.lastOrderAmount) {
                dynamicSection += `Last Order: $${customerInfo.lastOrderAmount}\n`;
            }
            
            // Add critical status context if available
            if (customerInfo.statusContext && customerInfo.statusContext.length > 0) {
                dynamicSection += customerInfo.statusContext + '\n';
            }
        }
        
        // Add conversation history if available
        if (customerInfo.conversationHistory && customerInfo.conversationHistory.length > 0) {
            dynamicSection += customerInfo.conversationHistory + '\n';
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