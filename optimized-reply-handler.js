const logger = require('./logger');

class OptimizedReplyHandler {
    constructor(knowledgeRetriever, smartRouter, responseTemplates, cacheOptimizer) {
        this.knowledgeRetriever = knowledgeRetriever;
        this.smartRouter = smartRouter;
        this.responseTemplates = responseTemplates;
        this.cacheOptimizer = cacheOptimizer;
        
        // Cheap lane patterns removed - all messages now go through full AI processing
        // to ensure customer status and context are properly handled
        
        logger.info('Optimized reply handler initialized');
    }
    
    async processMessage(message, phone, customerInfo = null, anthropic) {
        const startTime = Date.now();
        
        try {
            // Step 1: Get knowledge with advanced retrieval (cheap lane removed)
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
    
    // Cheap lane check removed - all messages go through full AI processing
    
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
            cacheOptimizer: this.cacheOptimizer.cacheHitRate,
            routingAnalysis: this.smartRouter.analyzeCostSavings(1000, 0.7) // Estimate 70% Haiku usage
        };
    }
}

module.exports = OptimizedReplyHandler;