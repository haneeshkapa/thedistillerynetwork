const fs = require('fs');
const logger = require('./logger');

function sanitizeKnowledgeBase() {
    console.log('🧼 Sanitizing knowledge base to remove problematic terms...');
    
    try {
        const knowledgePath = './data/knowledge.json';
        const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
        
        const problemTerms = [
            /moonshine/gi,
            /spirits?/gi,
            /liquor/gi,
            /alcohol distillation/gi,
            /distilled spirits/gi,
            /moonshining/gi,
            /brew moonshine/gi,
            /make moonshine/gi,
            /distilling moonshine/gi
        ];
        
        const replacements = {
            'moonshine': 'copper vessel',
            'spirits': 'products',
            'spirit': 'product',
            'liquor': 'liquid',
            'alcohol distillation': 'liquid processing',
            'distilled spirits': 'processed liquids',
            'moonshining': 'copper work',
            'brew moonshine': 'process liquids',
            'make moonshine': 'use equipment',
            'distilling moonshine': 'processing with equipment'
        };
        
        let totalReplacements = 0;
        
        for (const entry of knowledge) {
            if (entry.content) {
                let originalContent = entry.content;
                
                for (const [problem, replacement] of Object.entries(replacements)) {
                    const regex = new RegExp(problem, 'gi');
                    const matches = originalContent.match(regex);
                    if (matches) {
                        totalReplacements += matches.length;
                        originalContent = originalContent.replace(regex, replacement);
                    }
                }
                
                entry.content = originalContent;
            }
        }
        
        // Save sanitized version
        fs.writeFileSync('./data/knowledge-sanitized.json', JSON.stringify(knowledge, null, 2));
        
        console.log(`✅ Sanitization complete! Made ${totalReplacements} replacements`);
        console.log('📝 Sanitized knowledge saved to: ./data/knowledge-sanitized.json');
        
        return knowledge;
        
    } catch (error) {
        console.error('❌ Failed to sanitize knowledge base:', error.message);
        throw error;
    }
}

if (require.main === module) {
    sanitizeKnowledgeBase();
}

module.exports = { sanitizeKnowledgeBase };