const AdvancedKnowledgeRetriever = require('./advanced-retriever');
const RAGASEvaluator = require('./ragas-evaluator');
const logger = require('./logger');

async function testRAGASEvaluation() {
    console.log('🧪 Starting RAGAS evaluation test...\n');
    
    const retriever = new AdvancedKnowledgeRetriever();
    const evaluator = new RAGASEvaluator();
    
    // Test individual queries
    const testQueries = [
        "10 gallon advanced model price",
        "what copper stills do you have", 
        "220V element stock",
        "moonshine still parts"
    ];
    
    console.log('📊 Testing individual queries:\n');
    
    for (const query of testQueries) {
        console.log(`Query: "${query}"`);
        
        // Get retrieval results
        const knowledge = await retriever.getOptimizedKnowledge(query);
        const chunks = retriever.retrieveRelevantChunks(query, 5);
        
        console.log(`Retrieved ${chunks.length} chunks, ${knowledge.length} chars`);
        
        // Find matching test case
        const testCase = evaluator.testSet.find(test => 
            test.query.toLowerCase().includes(query.split(' ')[0]) ||
            query.toLowerCase().includes(test.query.split(' ')[0])
        );
        
        if (testCase) {
            const evaluation = await evaluator.evaluateQuery(retriever, testCase);
            console.log('Metrics:', {
                precision: evaluation.precision.toFixed(3),
                recall: evaluation.recall.toFixed(3),
                faithfulness: evaluation.faithfulness.toFixed(3),
                answerRelevance: evaluation.answerRelevance.toFixed(3),
                priceAccuracy: evaluation.priceAccuracy.toFixed(3)
            });
        }
        console.log('---\n');
    }
    
    // Full evaluation
    console.log('🎯 Running complete RAGAS evaluation...\n');
    const results = await evaluator.evaluateRetrieval(retriever);
    
    console.log('📈 Overall Results:');
    console.log('Precision:', results.overall.precision.toFixed(3));
    console.log('Recall:', results.overall.recall.toFixed(3)); 
    console.log('Faithfulness:', results.overall.faithfulness.toFixed(3));
    console.log('Answer Relevance:', results.overall.answerRelevance.toFixed(3));
    console.log('F1 Score:', results.overall.f1Score.toFixed(3));
    
    // Test reranker impact
    console.log('\n🔄 Testing reranker impact...');
    
    const query = "10 gallon advanced model price";
    const candidates = retriever.retrieveRelevantChunks(query, 10);
    const reranked = await retriever.reranker.rerankCandidates(query, candidates, 5);
    const mmrResults = retriever.reranker.applyMMR(query, reranked, 3);
    
    console.log(`Candidates: ${candidates.length} → Reranked: ${reranked.length} → MMR: ${mmrResults.length}`);
    
    // Show diversity
    const categories = new Set(mmrResults.map(r => r.product?.category));
    console.log(`Diversity: ${categories.size} different categories`);
    
    console.log('\n✅ RAGAS evaluation completed!');
}

if (require.main === module) {
    testRAGASEvaluation().catch(console.error);
}

module.exports = { testRAGASEvaluation };