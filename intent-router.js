const logger = require('./logger');

class ContextualIntentRouter {
    constructor() {
        this.deterministicTemplates = new Map([
            ['order_status', /order|status|tracking|shipped|delivery|arrive|when.*get|where.*order/i],
            ['price_check', /price|cost|how much|expensive|\$|dollar|pricing/i],
            ['availability', /stock|available|in stock|inventory|have.*in/i],
            ['contact_info', /phone|email|address|contact|call|reach/i],
            ['hours', /hours|open|closed|when.*open/i],
            ['greeting', /^(hi|hello|hey|good morning|good afternoon|good evening)$/i]
        ]);
        
        this.templateResponses = {
            'contact_info': "You can reach us at (603) 997-6786 or visit moonshinestills.com. We're here to help!",
            'hours': "We're available Monday-Friday 9am-5pm EST. Call (603) 997-6786 or visit moonshinestills.com anytime!",
            'greeting': "Hey! I'm Jonathan from American Copper Works. How can I help you with our moonshine stills today?"
        };

        this.bypassCache = new Map();
        logger.info('Intent router initialized with deterministic templates');
    }

    async routeQuery(query, phone, conversationContext = null) {
        try {
            // Check cache first
            const cacheKey = `intent:${query.toLowerCase()}`;
            if (this.bypassCache.has(cacheKey)) {
                const cached = this.bypassCache.get(cacheKey);
                if (Date.now() - cached.timestamp < 300000) { // 5 minute cache
                    return cached.response;
                }
            }

            // Detect intent
            const intent = this.detectIntent(query);
            
            if (intent && this.canBypassLLM(intent, phone)) {
                const response = await this.generateDeterministicResponse(intent, phone, query);
                
                // Cache the response
                this.bypassCache.set(cacheKey, {
                    response,
                    timestamp: Date.now()
                });
                
                logger.info(`Intent routing bypass: ${intent} for query: ${query.substring(0, 50)}...`);
                return response;
            }

            return null; // Let AI handle complex queries

        } catch (error) {
            logger.error('Intent routing error:', error.message);
            return null;
        }
    }

    detectIntent(query) {
        const normalizedQuery = query.toLowerCase().trim();
        
        for (const [intent, pattern] of this.deterministicTemplates) {
            if (pattern.test(normalizedQuery)) {
                return intent;
            }
        }
        return null;
    }

    canBypassLLM(intent, phone) {
        // Simple intents that don't need customer context
        const simpleIntents = ['contact_info', 'hours', 'greeting'];
        return simpleIntents.includes(intent);
    }

    async generateDeterministicResponse(intent, phone, query) {
        try {
            // Use predefined templates for simple queries
            if (this.templateResponses[intent]) {
                return this.templateResponses[intent];
            }

            // For complex intents, return fallback
            switch (intent) {
                case 'order_status':
                    return "I'd be happy to check your order status! Please call (603) 997-6786 with your order details, or check your email for tracking info.";
                    
                case 'price_check':
                    const productMention = this.extractProductFromQuery(query);
                    if (productMention) {
                        return `For current pricing on ${productMention}, please visit moonshinestills.com or call (603) 997-6786. Prices vary by configuration!`;
                    }
                    return "For current pricing on our copper stills, please visit moonshinestills.com or call (603) 997-6786!";
                    
                case 'availability':
                    return "I can't check live inventory right now. Please call (603) 997-6786 for current stock levels, or visit moonshinestills.com!";
                    
                default:
                    return null;
            }

        } catch (error) {
            logger.error('Response generation error:', error.message);
            return null;
        }
    }

    extractProductFromQuery(query) {
        const productPatterns = [
            /(\d+)\s*gallon/i,
            /copper\s*still/i,
            /moonshine\s*still/i,
            /distill/i
        ];

        for (const pattern of productPatterns) {
            const match = query.match(pattern);
            if (match) return match[0];
        }
        
        return null;
    }

    getBypassStats() {
        return {
            cacheSize: this.bypassCache.size,
            intents: Array.from(this.deterministicTemplates.keys())
        };
    }
}

module.exports = ContextualIntentRouter;