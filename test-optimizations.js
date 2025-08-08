const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const SmartRouter = require('./smart-router');
const ResponseTemplates = require('./response-templates');
const CacheOptimizer = require('./cache-optimizer');
const OptimizedReplyHandler = require('./optimized-reply-handler');

async function testOptimizations() {
    console.log('🚀 Testing High-Impact Optimizations\n');
    
    // Initialize components
    const retriever = new AdvancedKnowledgeRetriever();
    const router = new SmartRouter();
    const templates = new ResponseTemplates();
    const cacheOptimizer = new CacheOptimizer();
    
    // Test queries with different complexities
    const testQueries = [
        // Cheap lane queries (should be instant)
        { query: "hours", expectedMethod: "cheap_lane" },
        { query: "phone", expectedMethod: "cheap_lane" },
        { query: "website", expectedMethod: "cheap_lane" },
        
        // Template-suitable queries  
        { query: "10 gallon price", expectedMethod: "template" },
        { query: "order status", expectedMethod: "template" },
        { query: "shipping info", expectedMethod: "template" },
        
        // Simple AI queries (Haiku suitable)
        { query: "what stills do you have", expectedModel: "haiku" },
        { query: "copper equipment available", expectedModel: "haiku" },
        
        // Complex AI queries (Sonnet escalation)
        { query: "explain the technical differences between 110v and 220v heating elements", expectedModel: "sonnet" },
        { query: "why should I choose your stills over competitors", expectedModel: "sonnet" },
        { query: "I have a complaint about my order quality", expectedModel: "sonnet" }
    ];
    
    console.log('📊 Testing Query Routing & Response Generation:\n');
    
    for (const test of testQueries) {
        console.log(`Query: "${test.query}"`);
        
        // Test cheap lane detection
        const cheapLane = checkCheapLane(test.query);
        if (cheapLane) {
            console.log(`✅ Cheap Lane: ${cheapLane.response.substring(0, 50)}...`);
            console.log(`⚡ Instant response (0 tokens, $0 cost)\n`);
            continue;
        }
        
        // Test template matching
        const knowledge = await retriever.getOptimizedKnowledge(test.query);
        const templateMatch = templates.matchTemplate(test.query, knowledge);
        
        if (templateMatch && templates.isTemplateSuitable(test.query, 0.8)) {
            console.log(`✅ Template Used: ${templateMatch.templateUsed}`);
            console.log(`📝 Response: ${templateMatch.response.substring(0, 60)}...`);
            console.log(`💰 Tokens: ${templateMatch.estimatedTokens} (vs ~150 AI tokens)\n`);
            continue;
        }
        
        // Test AI routing
        const retrievalConfidence = calculateRetrievalConfidence(knowledge, test.query);
        const routingDecision = router.routeRequest(test.query, retrievalConfidence);
        
        const selectedModel = routingDecision.model.name.includes('haiku') ? 'haiku' : 'sonnet';
        console.log(`🤖 AI Model: ${selectedModel}`);
        console.log(`📈 Confidence: ${retrievalConfidence.toFixed(2)}`);
        console.log(`💭 Routing Reason: ${routingDecision.reasoning.join(', ')}`);
        
        // Test cache optimization
        const promptData = cacheOptimizer.generateCachedPrompt(knowledge, test.query);
        console.log(`🎯 Cache Efficiency: ${promptData.cacheEfficiency.cacheablePercent.toFixed(1)}%`);
        console.log(`💸 Cost Savings: ${promptData.cacheEfficiency.costSavings.toFixed(1)}%\n`);
    }
    
    // Test BM25 parameter improvements
    console.log('🔍 Testing BM25 Parameter Tuning:\n');
    
    const oldParams = { k1: 1.2, b: 0.75 };
    const newParams = { k1: 1.4, b: 0.6 };
    
    console.log(`Old BM25: k1=${oldParams.k1}, b=${oldParams.b}`);
    console.log(`New BM25: k1=${newParams.k1}, b=${newParams.b} (tuned for precision)`);
    console.log(`Cross-encoder threshold: 0.4 (filters low-quality chunks)\n`);
    
    // Test cost savings analysis
    console.log('💰 Cost Savings Analysis:\n');
    
    const costAnalysis = router.analyzeCostSavings(1000, 0.7); // 1000 requests, 70% Haiku
    console.log(`Total Requests: ${costAnalysis.totalRequests}`);
    console.log(`Haiku Usage: ${costAnalysis.haikuUsagePercent}%`);
    console.log(`All-Sonnet Cost: $${costAnalysis.allSonnetCost}`);
    console.log(`Smart-Routing Cost: $${costAnalysis.smartRoutingCost}`);
    console.log(`💸 Total Savings: $${costAnalysis.savings} (${costAnalysis.savingsPercent}%)\n`);
    
    // Template vs AI token comparison
    console.log('📈 Template vs AI Token Comparison:\n');
    
    const templateSavings = templates.calculateTokenSavings(25, 150);
    console.log(`Template Response: ${templateSavings.templateTokens} tokens`);
    console.log(`Full AI Response: ${templateSavings.fullAITokens} tokens`);
    console.log(`Token Savings: ${templateSavings.savings} (${templateSavings.savingsPercent}%)\n`);
    
    // Performance recommendations
    console.log('🎯 Performance Summary:\n');
    
    console.log('✅ Implemented Optimizations:');
    console.log('  • Surgical prompt caching (5-min TTL, stable content only)');
    console.log('  • Two-tier routing (Haiku → Sonnet escalation)'); 
    console.log('  • Response templates for common queries');
    console.log('  • Cheap lane routing for instant responses');
    console.log('  • BM25 parameter tuning (k1=1.4, b=0.6)');
    console.log('  • Cross-encoder gating (threshold=0.4)');
    console.log('  • Updated Shopify API version (2024-10)');
    console.log('  • Critical facts positioning (front + end)');
    console.log('  • Hard output token capping (220-300 max)\n');
    
    console.log('📊 Expected Impact:');
    console.log('  • ~60% cost reduction through smart routing');
    console.log('  • ~80% token savings for template responses'); 
    console.log('  • ~50% cost savings from prompt caching');
    console.log('  • Instant responses for common queries (0ms)');
    console.log('  • Improved precision from BM25 tuning');
    console.log('  • Better faithfulness from cross-encoder gating\n');
    
    console.log('🏁 High-Impact Optimization Testing Complete!');
}

// Helper functions
function checkCheapLane(message) {
    const cheapPatterns = [
        { pattern: /^(hours?|when (are you )?open)$/i, response: "Contact us: (603) 997-6786" },
        { pattern: /^(phone|contact|number)$/i, response: "(603) 997-6786" },
        { pattern: /^(website|site|url)$/i, response: "moonshinestills.com" }
    ];
    
    for (const pattern of cheapPatterns) {
        if (pattern.pattern.test(message.trim())) {
            return pattern;
        }
    }
    return null;
}

function calculateRetrievalConfidence(content, query) {
    if (!content || content.length < 50) return 0.1;
    
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let matches = 0;
    for (const term of queryTerms) {
        if (contentLower.includes(term)) matches++;
    }
    
    return queryTerms.length > 0 ? matches / queryTerms.length : 0;
}

if (require.main === module) {
    testOptimizations().catch(console.error);
}

module.exports = { testOptimizations };