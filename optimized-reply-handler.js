const logger = require('./logger');

class OptimizedReplyHandler {
    constructor(knowledgeRetriever, smartRouter, responseTemplates, cacheOptimizer) {
        this.knowledgeRetriever = knowledgeRetriever;
        this.smartRouter = smartRouter;
        this.responseTemplates = responseTemplates;
        this.cacheOptimizer = cacheOptimizer;
        
        // Common query patterns for cheap lane routing - Jonathan's voice
        this.cheapLanePatterns = [
            // Conversational greetings - Jonathan's chill personality
            { pattern: /^(hi|hey|hello|what's up|whats up|sup)(\s+(jonathan|man|dude|there))?$/i, response: "Hey there! I'm Jonathan from American Copper Works. What can I help you with today? Give me a call at (603) 997-6786 if you want to chat about stills!" },
            
            // Product inquiries - Jonathan's expertise showing through  
            { pattern: /moonshine|gallon.*still|still.*gallon|copper.*still|distill|equipment/i, response: "Hey! I make quality copper stills and distillation equipment here at American Copper Works. Each one's built to last. Give me a call at (603) 997-6786 and we can talk about what you need!" },
            
            // Pricing with Jonathan's personality
            { pattern: /price|cost|how much|pricing/i, response: "Pricing depends on what you're looking for - I've got everything from DIY kits to complete setups. Give me a ring at (603) 997-6786 and we'll figure out what works best for you!" },
            
            // About Jonathan/company
            { pattern: /about|who are you|tell me about|your company|american copper/i, response: "I'm Jonathan, and I run American Copper Works. Been making quality copper moonshine stills and distillation gear for folks who appreciate good craftsmanship. Check us out at moonshinestills.com or call (603) 997-6786!" },
            
            // Basic contact info with personality
            { pattern: /^(hours?|when (are you )?open)$/i, response: "Just give me a call at (603) 997-6786 or shoot an email to tdnorders@gmail.com. I'm pretty flexible - visit moonshinestills.com too!" },
            { pattern: /^(address|location|where are you)$/i, response: "Check out moonshinestills.com for all the details or give me a call at (603) 997-6786!" },
            { pattern: /^(phone|contact|number)$/i, response: "You got it - (603) 997-6786 or tdnorders@gmail.com. Always happy to chat!" },
            { pattern: /^(website|site|url)$/i, response: "moonshinestills.com - that's where you can see all my work! Or call me at (603) 997-6786." }
        ];
        
        logger.info('Optimized reply handler initialized');
    }
    
    async processMessage(message, phone, customerInfo = null, anthropic) {
        const startTime = Date.now();
        
        try {
            // Step 1: Check cheap lane for instant responses
            const cheapLaneResponse = this.checkCheapLane(message);
            if (cheapLaneResponse) {
                logger.info('Cheap lane response used', { phone, pattern: cheapLaneResponse.pattern });
                return {
                    reply: cheapLaneResponse.response,
                    tokensUsed: 0,
                    cost: 0,
                    method: 'cheap_lane',
                    responseTime: Date.now() - startTime
                };
            }
            
            // Step 2: Get knowledge with advanced retrieval
            const retrievalStart = Date.now();
            const relevantKnowledge = await this.knowledgeRetriever.getOptimizedKnowledge(message);
            const retrievalTime = Date.now() - retrievalStart;
            
            // Calculate retrieval confidence based on content quality
            const retrievalConfidence = this.calculateRetrievalConfidence(relevantKnowledge, message);
            
            // Step 3: Try template matching for high-confidence simple queries
            const templateResponse = this.responseTemplates.matchTemplate(message, relevantKnowledge, customerInfo);
            if (templateResponse && retrievalConfidence > 0.6) {
                logger.info('Template response used', { 
                    phone, 
                    template: templateResponse.templateUsed,
                    tokens: templateResponse.estimatedTokens
                });
                
                return {
                    reply: templateResponse.response,
                    tokensUsed: templateResponse.estimatedTokens,
                    cost: this.estimateTemplateCost(templateResponse.estimatedTokens),
                    method: 'template',
                    responseTime: Date.now() - startTime,
                    retrievalTime
                };
            }
            
            // Step 4: Route to appropriate AI model
            const routingDecision = this.smartRouter.routeRequest(message, retrievalConfidence, customerInfo);
            
            // Step 5: Generate cache-optimized prompt
            const promptData = this.cacheOptimizer.generateCachedPrompt(relevantKnowledge, message, customerInfo);
            
            // Step 6: Make AI API call with optimized settings
            const aiResponse = await this.callAI(anthropic, promptData, routingDecision);
            
            // Step 7: Record metrics and return
            this.smartRouter.recordRoutingDecision(message, routingDecision.model.name, aiResponse.outputTokens);
            
            const totalTime = Date.now() - startTime;
            
            logger.info('AI response generated', {
                phone,
                model: routingDecision.model.name,
                inputTokens: aiResponse.inputTokens,
                outputTokens: aiResponse.outputTokens,
                cost: aiResponse.cost.toFixed(6),
                totalTime,
                retrievalTime,
                cacheEfficiency: promptData.cacheEfficiency.cacheablePercent.toFixed(1) + '%'
            });
            
            return {
                reply: aiResponse.text,
                tokensUsed: aiResponse.inputTokens + aiResponse.outputTokens,
                cost: aiResponse.cost,
                method: 'ai_' + (routingDecision.model.name.includes('haiku') ? 'haiku' : 'sonnet'),
                responseTime: totalTime,
                retrievalTime,
                cacheEfficiency: promptData.cacheEfficiency
            };
            
        } catch (error) {
            logger.error('Optimized reply handler error', { error: error.message, phone });
            
            // Fallback to template response
            const fallback = this.responseTemplates.getFallback('technicalIssue');
            return {
                reply: fallback.response,
                tokensUsed: fallback.estimatedTokens,
                cost: 0,
                method: 'fallback',
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }
    
    // Check if query matches cheap lane patterns
    checkCheapLane(message) {
        const cleanMessage = message.trim().toLowerCase();
        
        for (const pattern of this.cheapLanePatterns) {
            if (pattern.pattern.test(cleanMessage)) {
                return {
                    pattern: pattern.pattern.source,
                    response: pattern.response
                };
            }
        }
        
        return null;
    }
    
    // Calculate retrieval confidence based on content relevance
    calculateRetrievalConfidence(retrievalContent, query) {
        if (!retrievalContent || retrievalContent.length < 50) {
            return 0.1; // Very low confidence for empty/short content
        }
        
        const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
        const contentLower = retrievalContent.toLowerCase();
        
        let matchedTerms = 0;
        for (const term of queryTerms) {
            if (contentLower.includes(term)) {
                matchedTerms++;
            }
        }
        
        const termOverlap = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
        
        // Boost confidence for price/product information
        let boost = 0;
        if (contentLower.includes('$') && query.toLowerCase().includes('price')) boost += 0.2;
        if (contentLower.includes('gallon') && query.toLowerCase().includes('gallon')) boost += 0.2;
        if (contentLower.includes('stock') && query.toLowerCase().includes('stock')) boost += 0.1;
        
        return Math.min(termOverlap + boost, 1.0);
    }
    
    // Make AI API call with optimizations
    async callAI(anthropic, promptData, routingDecision) {
        const modelConfig = routingDecision.model;
        
        const response = await anthropic.messages.create({
            model: modelConfig.name,
            max_tokens: modelConfig.maxTokens,
            messages: [{ role: 'user', content: promptData.full }]
        });
        
        const inputTokens = response.usage?.input_tokens || Math.ceil(promptData.full.length / 4);
        const outputTokens = response.usage?.output_tokens || Math.ceil(response.content[0].text.length / 4);
        
        // Calculate cost with caching optimization
        const cacheOptimizedCost = this.cacheOptimizer.estimateTokenCosts(promptData);
        
        // Handle potential missing cost properties safely
        const inputCostPerToken = modelConfig?.costPerInputToken || 0.000003; // Default Sonnet pricing
        const outputCostPerToken = modelConfig?.costPerOutputToken || 0.000015;
        
        const actualCost = cacheOptimizedCost.effectiveCost * (inputCostPerToken * 1000000) / 1000000 +
                          outputTokens * outputCostPerToken;
        
        return {
            text: response.content[0].text,
            inputTokens,
            outputTokens,
            cost: actualCost
        };
    }
    
    // Estimate cost for template responses
    estimateTemplateCost(tokens) {
        // Templates have minimal processing cost
        return tokens * 0.00001; // Negligible cost
    }
    
    // Get performance metrics
    getPerformanceMetrics() {
        return {
            cheapLanePatterns: this.cheapLanePatterns.length,
            cacheOptimizer: this.cacheOptimizer.cacheHitRate,
            routingAnalysis: this.smartRouter.analyzeCostSavings(1000, 0.7) // Estimate 70% Haiku usage
        };
    }
}

module.exports = OptimizedReplyHandler;