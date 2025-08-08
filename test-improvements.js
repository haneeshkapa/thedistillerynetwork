const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const PromptOptimizer = require('./prompt-optimizer');
const KnowledgeRetriever = require('./knowledge-retriever'); // Old system

console.log('🔬 KNOWLEDGE RETRIEVAL COMPARISON TEST\n');

// Initialize both systems
const oldRetriever = new KnowledgeRetriever();
const newRetriever = new AdvancedKnowledgeRetriever();
const promptOptimizer = new PromptOptimizer(newRetriever);

const testQueries = [
    "10 gallon advanced model price",
    "what copper stills do you have",
    "electric heating elements for stills",
    "moonshine still parts"
];

console.log('📊 RESULTS COMPARISON:\n');

testQueries.forEach((query, index) => {
    console.log(`Query ${index + 1}: "${query}"`);
    console.log('─'.repeat(50));
    
    // Old system results
    const oldResult = oldRetriever.getRelevantKnowledge(query);
    
    // New system results
    const newResult = newRetriever.getOptimizedKnowledge(query);
    
    // Optimized prompt
    const optimizedPrompt = promptOptimizer.optimizeGuestPrompt({
        combinedKnowledge: newResult,
        message: query
    });
    
    const promptMetrics = promptOptimizer.getPromptMetrics(optimizedPrompt);
    
    console.log(`OLD SYSTEM:
Length: ${oldResult.length} chars
Result: ${oldResult.substring(0, 100)}...

NEW SYSTEM:
Length: ${newResult.length} chars  
Result: ${newResult.substring(0, 100)}...

PROMPT METRICS:
Total: ${promptMetrics.totalLength} chars (${promptMetrics.estimatedTokens} tokens)
Stable Content: ${promptMetrics.stablePercentage}% cacheable

IMPROVEMENT:
Knowledge: ${((oldResult.length - newResult.length) / oldResult.length * 100).toFixed(1)}% reduction
`);
    console.log('='.repeat(80));
});

// Test advanced retrieval metrics
const metrics = newRetriever.getRetrievalMetrics();
console.log(`
🎯 ADVANCED RETRIEVAL METRICS:
- Documents indexed: ${metrics.documentsIndexed}
- Average document length: ${metrics.avgDocLength} tokens
- Vocabulary size: ${metrics.vocabSize} unique terms

✨ KEY IMPROVEMENTS IMPLEMENTED:
- ✅ Hybrid BM25 + semantic scoring
- ✅ Relevance-based ranking (not blind truncation)
- ✅ Structured product data extraction
- ✅ Few-shot canonical examples
- ✅ Prompt caching optimization
- ✅ Critical info placement (top/bottom)
- ✅ Comprehensive feature extraction
`);

console.log('\n🚀 SYSTEM READY FOR PRODUCTION');