const logger = require('./logger');

class RAGASEvaluator {
    constructor() {
        this.testSet = this.buildTestSet();
        this.evaluationCache = new Map();
        
        logger.info('RAGAS evaluator initialized', {
            testCases: this.testSet.length
        });
    }
    
    buildTestSet() {
        // Seeded test set for retrieval evaluation
        return [
            {
                query: "10 gallon advanced model price",
                groundTruth: "The 10 Gallon Advanced Model with 220v Element costs $899.00",
                expectedProducts: ["10 Gallon Advanced Model with 220v Element"],
                expectedPrice: "899.00",
                category: "pricing"
            },
            {
                query: "220V element stock",
                groundTruth: "220v Electric Heating Element with Controller costs $299.00",
                expectedProducts: ["220v Electric Heating Element"],
                expectedPrice: "299.00",
                category: "components"
            },
            {
                query: "what copper stills do you have",
                groundTruth: "Available copper stills include various gallon sizes",
                expectedProducts: ["10 Gallon", "Flash Sale", "Advanced Model"],
                expectedPrice: null,
                category: "general"
            },
            {
                query: "moonshine still parts",
                groundTruth: "Parts include heating elements, controllers, and accessories",
                expectedProducts: ["Heating Element", "Controller", "Accessories"],
                expectedPrice: null,
                category: "parts"
            },
            {
                query: "15 gallon complete still",
                groundTruth: "15 gallon stills are available as complete units",
                expectedProducts: ["15 Gallon"],
                expectedPrice: null,
                category: "capacity"
            }
        ];
    }
    
    async evaluateRetrieval(retriever, testCase = null) {
        const testCases = testCase ? [testCase] : this.testSet;
        const results = {
            precision: [],
            recall: [],
            faithfulness: [],
            answerRelevance: [],
            overall: {}
        };
        
        for (const test of testCases) {
            const evaluation = await this.evaluateQuery(retriever, test);
            
            results.precision.push(evaluation.precision);
            results.recall.push(evaluation.recall);
            results.faithfulness.push(evaluation.faithfulness);
            results.answerRelevance.push(evaluation.answerRelevance);
            
            logger.debug('Test case evaluation', {
                query: test.query,
                metrics: evaluation
            });
        }
        
        // Calculate averages
        results.overall = {
            precision: this.average(results.precision),
            recall: this.average(results.recall),
            faithfulness: this.average(results.faithfulness),
            answerRelevance: this.average(results.answerRelevance),
            f1Score: this.calculateF1(results.precision, results.recall)
        };
        
        logger.info('RAGAS evaluation completed', results.overall);
        return results;
    }
    
    async evaluateQuery(retriever, testCase) {
        const { query, expectedProducts, expectedPrice, groundTruth, category } = testCase;
        
        // Get retrieval results
        const retrievedKnowledge = await retriever.getOptimizedKnowledge(query);
        const retrievedChunks = retriever.retrieveRelevantChunks(query, 10); // Get more for precision/recall
        
        // Calculate metrics
        const precision = this.calculatePrecision(retrievedChunks, expectedProducts);
        const recall = this.calculateRecall(retrievedChunks, expectedProducts);
        const faithfulness = this.calculateFaithfulness(retrievedKnowledge, groundTruth);
        const answerRelevance = this.calculateAnswerRelevance(retrievedKnowledge, query);
        
        // Price extraction validation
        const priceAccuracy = expectedPrice ? 
            this.validatePriceExtraction(retrievedKnowledge, expectedPrice) : 1.0;
        
        return {
            precision,
            recall,
            faithfulness,
            answerRelevance,
            priceAccuracy,
            category,
            retrievedCount: retrievedChunks.length
        };
    }
    
    calculatePrecision(retrievedChunks, expectedProducts) {
        if (!retrievedChunks.length) return 0;
        
        let relevantRetrieved = 0;
        for (const chunk of retrievedChunks) {
            const title = chunk.product?.title?.toLowerCase() || '';
            const isRelevant = expectedProducts.some(expected => 
                title.includes(expected.toLowerCase()) || 
                expected.toLowerCase().includes(title.substring(0, 20))
            );
            if (isRelevant) relevantRetrieved++;
        }
        
        return relevantRetrieved / retrievedChunks.length;
    }
    
    calculateRecall(retrievedChunks, expectedProducts) {
        if (!expectedProducts.length) return 1.0;
        
        let expectedFound = 0;
        for (const expected of expectedProducts) {
            const found = retrievedChunks.some(chunk => {
                const title = chunk.product?.title?.toLowerCase() || '';
                return title.includes(expected.toLowerCase()) || 
                       expected.toLowerCase().includes(title.substring(0, 20));
            });
            if (found) expectedFound++;
        }
        
        return expectedFound / expectedProducts.length;
    }
    
    calculateFaithfulness(retrievedKnowledge, groundTruth) {
        // Check if retrieved knowledge supports the ground truth
        const knowledge = retrievedKnowledge.toLowerCase();
        const truth = groundTruth.toLowerCase();
        
        // Extract key facts from ground truth
        const truthTokens = this.extractKeyFacts(truth);
        let supportedFacts = 0;
        
        for (const fact of truthTokens) {
            if (knowledge.includes(fact)) {
                supportedFacts++;
            }
        }
        
        return truthTokens.length ? supportedFacts / truthTokens.length : 1.0;
    }
    
    calculateAnswerRelevance(retrievedKnowledge, query) {
        const knowledge = retrievedKnowledge.toLowerCase();
        const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        
        let relevantTokens = 0;
        for (const token of queryTokens) {
            if (knowledge.includes(token)) {
                relevantTokens++;
            }
        }
        
        return queryTokens.length ? relevantTokens / queryTokens.length : 0;
    }
    
    validatePriceExtraction(retrievedKnowledge, expectedPrice) {
        const pricePattern = /\$(\d+(?:\.\d{2})?)/g;
        const matches = [...retrievedKnowledge.matchAll(pricePattern)];
        
        if (!matches.length) return 0;
        
        // Check if expected price is found
        return matches.some(match => match[1] === expectedPrice) ? 1.0 : 0.0;
    }
    
    extractKeyFacts(text) {
        // Extract meaningful tokens (not stop words)
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
        return text.split(/\s+/)
            .filter(token => token.length > 2 && !stopWords.has(token))
            .map(token => token.replace(/[^\w$]/g, ''));
    }
    
    average(arr) {
        return arr.length ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
    }
    
    calculateF1(precisionArr, recallArr) {
        const avgPrecision = this.average(precisionArr);
        const avgRecall = this.average(recallArr);
        
        if (avgPrecision + avgRecall === 0) return 0;
        return 2 * (avgPrecision * avgRecall) / (avgPrecision + avgRecall);
    }
    
    // Run continuous evaluation
    async runContinuousEvaluation(retriever, interval = 300000) { // 5 minutes
        const evaluate = async () => {
            try {
                const results = await this.evaluateRetrieval(retriever);
                
                // Log metrics for monitoring
                logger.info('Continuous RAGAS evaluation', {
                    timestamp: new Date().toISOString(),
                    metrics: results.overall,
                    alert: results.overall.precision < 0.7 || results.overall.recall < 0.7
                });
                
                // Store results for trending
                this.evaluationCache.set(Date.now(), results.overall);
                
                // Keep only last 24 hours of data
                const cutoff = Date.now() - 24 * 60 * 60 * 1000;
                for (const [timestamp] of this.evaluationCache) {
                    if (timestamp < cutoff) {
                        this.evaluationCache.delete(timestamp);
                    }
                }
                
            } catch (error) {
                logger.error('Continuous evaluation failed', { error: error.message });
            }
        };
        
        // Run initial evaluation
        await evaluate();
        
        // Set up periodic evaluation
        setInterval(evaluate, interval);
        
        logger.info('Continuous RAGAS evaluation started', { 
            intervalMinutes: interval / 60000 
        });
    }
    
    getEvaluationTrends(hours = 24) {
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        const recentResults = [];
        
        for (const [timestamp, metrics] of this.evaluationCache) {
            if (timestamp >= cutoff) {
                recentResults.push({ timestamp, ...metrics });
            }
        }
        
        return recentResults.sort((a, b) => a.timestamp - b.timestamp);
    }
}

module.exports = RAGASEvaluator;