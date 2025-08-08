const logger = require('./logger');

class SmartRouter {
    constructor() {
        // Model configurations
        this.models = {
            haiku: {
                name: 'claude-3-5-haiku-20241022',
                costPerInputToken: 0.25 / 1000000,   // $0.25 per 1M tokens
                costPerOutputToken: 1.25 / 1000000,  // $1.25 per 1M tokens
                maxTokens: 200,
                suitableFor: ['simple_queries', 'template_responses', 'basic_info']
            },
            sonnet: {
                name: 'claude-3-5-sonnet-20241022', 
                costPerInputToken: 3.00 / 1000000,   // $3.00 per 1M tokens
                costPerOutputToken: 15.00 / 1000000, // $15.00 per 1M tokens
                maxTokens: 300,
                suitableFor: ['complex_reasoning', 'low_confidence', 'policy_help', 'technical_details']
            }
        };
        
        // Escalation thresholds
        this.escalationCriteria = {
            retrievalConfidenceThreshold: 0.4,
            complexQueryKeywords: [
                'why', 'how does', 'explain', 'difference', 'compare', 'recommend', 
                'policy', 'warranty', 'technical', 'specifications', 'compatibility'
            ],
            multiHopIndicators: [
                'and also', 'but what about', 'in addition', 'however', 'on the other hand'
            ],
            customerServiceEscalation: [
                'complaint', 'problem', 'issue', 'refund', 'return', 'disappointed', 'wrong'
            ]
        };
        
        logger.info('Smart router initialized', {
            haikuCost: this.models.haiku.costPerOutputToken * 1000000,
            sonnetCost: this.models.sonnet.costPerOutputToken * 1000000,
            costRatio: this.models.sonnet.costPerOutputToken / this.models.haiku.costPerOutputToken
        });
    }
    
    // Route request to appropriate model
    routeRequest(query, retrievalConfidence = 1.0, customerHistory = null) {
        const routingAnalysis = this.analyzeQuery(query, retrievalConfidence, customerHistory);
        
        const selectedModel = routingAnalysis.shouldEscalate ? 'sonnet' : 'haiku';
        
        logger.debug('Model routing decision', {
            query: query.substring(0, 50),
            selectedModel,
            confidence: retrievalConfidence,
            reasoning: routingAnalysis.reasons
        });
        
        return {
            model: this.models[selectedModel],
            reasoning: routingAnalysis.reasons,
            costEstimate: this.estimateCost(selectedModel, query.length, 150) // Estimate 150 output tokens
        };
    }
    
    analyzeQuery(query, retrievalConfidence, customerHistory) {
        const analysis = {
            shouldEscalate: false,
            reasons: [],
            confidence: retrievalConfidence
        };
        
        const queryLower = query.toLowerCase();
        
        // Check retrieval confidence
        if (retrievalConfidence < this.escalationCriteria.retrievalConfidenceThreshold) {
            analysis.shouldEscalate = true;
            analysis.reasons.push(`Low retrieval confidence: ${retrievalConfidence.toFixed(2)}`);
        }
        
        // Check for complex query patterns
        const hasComplexKeywords = this.escalationCriteria.complexQueryKeywords.some(keyword => 
            queryLower.includes(keyword)
        );
        if (hasComplexKeywords) {
            analysis.shouldEscalate = true;
            analysis.reasons.push('Complex query requiring detailed explanation');
        }
        
        // Check for multi-hop reasoning
        const hasMultiHop = this.escalationCriteria.multiHopIndicators.some(indicator =>
            queryLower.includes(indicator)
        );
        if (hasMultiHop) {
            analysis.shouldEscalate = true;
            analysis.reasons.push('Multi-hop reasoning detected');
        }
        
        // Check for customer service escalation needs
        const needsCustomerService = this.escalationCriteria.customerServiceEscalation.some(term =>
            queryLower.includes(term)
        );
        if (needsCustomerService) {
            analysis.shouldEscalate = true;
            analysis.reasons.push('Customer service issue requires careful handling');
        }
        
        // Consider customer history
        if (customerHistory && customerHistory.previousIssues > 0) {
            analysis.shouldEscalate = true;
            analysis.reasons.push('Customer has previous issues - use premium model');
        }
        
        // Query length heuristic (very long queries often need more reasoning)
        if (query.length > 200) {
            analysis.shouldEscalate = true;
            analysis.reasons.push('Long query likely requires detailed response');
        }
        
        // Default to Haiku if no escalation criteria met
        if (!analysis.shouldEscalate) {
            analysis.reasons.push('Simple query suitable for Haiku');
        }
        
        return analysis;
    }
    
    // Estimate cost for a given model and request
    estimateCost(modelKey, inputLength, estimatedOutputTokens) {
        const model = this.models[modelKey];
        const inputTokens = Math.ceil(inputLength / 4);
        
        const inputCost = inputTokens * model.costPerInputToken;
        const outputCost = estimatedOutputTokens * model.costPerOutputToken;
        
        return {
            model: modelKey,
            inputTokens,
            outputTokens: estimatedOutputTokens,
            inputCost,
            outputCost,
            totalCost: inputCost + outputCost,
            costBreakdown: `$${(inputCost + outputCost).toFixed(6)} (${inputTokens}in + ${estimatedOutputTokens}out)`
        };
    }
    
    // Get model configuration for API call
    getModelConfig(modelKey) {
        const model = this.models[modelKey];
        return {
            model: model.name,
            max_tokens: model.maxTokens
        };
    }
    
    // Track routing decisions for optimization
    recordRoutingDecision(query, modelUsed, actualOutputTokens, responseQuality = null) {
        const actualCost = this.estimateCost(modelUsed, query.length, actualOutputTokens);
        
        logger.info('Routing decision recorded', {
            model: modelUsed,
            queryLength: query.length,
            outputTokens: actualOutputTokens,
            cost: actualCost.costBreakdown,
            quality: responseQuality
        });
        
        // Could store this data for ML-based routing optimization
        return actualCost;
    }
    
    // Analyze cost savings from smart routing
    analyzeCostSavings(totalRequests, haikuUsage = 0.7) {
        const avgInputTokens = 300;
        const avgOutputTokens = 150;
        
        // All Sonnet cost
        const allSonnetCost = totalRequests * (
            avgInputTokens * this.models.sonnet.costPerInputToken +
            avgOutputTokens * this.models.sonnet.costPerOutputToken
        );
        
        // Smart routing cost  
        const haikuRequests = totalRequests * haikuUsage;
        const sonnetRequests = totalRequests * (1 - haikuUsage);
        
        const smartRoutingCost = 
            haikuRequests * (avgInputTokens * this.models.haiku.costPerInputToken + avgOutputTokens * this.models.haiku.costPerOutputToken) +
            sonnetRequests * (avgInputTokens * this.models.sonnet.costPerInputToken + avgOutputTokens * this.models.sonnet.costPerOutputToken);
        
        const savings = allSonnetCost - smartRoutingCost;
        const savingsPercent = (savings / allSonnetCost) * 100;
        
        return {
            totalRequests,
            haikuUsagePercent: haikuUsage * 100,
            allSonnetCost: allSonnetCost.toFixed(4),
            smartRoutingCost: smartRoutingCost.toFixed(4), 
            savings: savings.toFixed(4),
            savingsPercent: savingsPercent.toFixed(1)
        };
    }
}

module.exports = SmartRouter;