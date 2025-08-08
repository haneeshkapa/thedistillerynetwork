const logger = require('./logger');

class RerankerMMR {
    constructor() {
        this.diversityWeight = 0.3; // Lambda for MMR
        this.rerankerThreshold = 0.7; // Minimum score for reranking
        
        logger.info('Reranker/MMR system initialized', {
            diversityWeight: this.diversityWeight,
            rerankerThreshold: this.rerankerThreshold
        });
    }
    
    // Cross-encoder style reranker (lightweight version)
    async rerankCandidates(query, candidates, topK = 3) {
        if (candidates.length <= topK) {
            return candidates;
        }
        
        // Score each candidate with query-document relevance
        const scoredCandidates = candidates.map(candidate => {
            const crossScore = this.calculateCrossEncoderScore(query, candidate);
            return {
                ...candidate,
                crossScore: crossScore,
                finalScore: (candidate.score || 1) * crossScore
            };
        });
        
        // Sort by cross-encoder score and take top candidates
        return scoredCandidates
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, topK);
    }
    
    // Maximal Marginal Relevance for diversity
    applyMMR(query, candidates, topK = 3, lambda = null) {
        if (candidates.length <= topK) {
            return candidates;
        }
        
        const diversityWeight = lambda || this.diversityWeight;
        const relevanceWeight = 1 - diversityWeight;
        
        const selected = [];
        const remaining = [...candidates];
        
        // First, select the most relevant candidate
        const firstCandidate = remaining.sort((a, b) => (b.score || 1) - (a.score || 1))[0];
        selected.push(firstCandidate);
        remaining.splice(remaining.indexOf(firstCandidate), 1);
        
        // Iteratively select candidates balancing relevance and diversity
        while (selected.length < topK && remaining.length > 0) {
            let bestCandidate = null;
            let bestScore = -Infinity;
            
            for (const candidate of remaining) {
                // Relevance score
                const relevanceScore = candidate.score || 1;
                
                // Diversity score (negative similarity to already selected)
                const diversityScore = this.calculateDiversityScore(candidate, selected);
                
                // MMR score
                const mmrScore = relevanceWeight * relevanceScore + diversityWeight * diversityScore;
                
                if (mmrScore > bestScore) {
                    bestScore = mmrScore;
                    bestCandidate = candidate;
                }
            }
            
            if (bestCandidate) {
                selected.push({
                    ...bestCandidate,
                    mmrScore: bestScore
                });
                remaining.splice(remaining.indexOf(bestCandidate), 1);
            }
        }
        
        logger.debug('MMR selection completed', {
            totalCandidates: candidates.length,
            selectedCount: selected.length,
            diversityWeight
        });
        
        return selected;
    }
    
    // Lightweight cross-encoder scoring (semantic similarity)
    calculateCrossEncoderScore(query, candidate) {
        const queryTokens = this.tokenize(query.toLowerCase());
        const docText = [
            candidate.product?.title || '',
            candidate.product?.description || '',
            candidate.product?.features?.join(' ') || ''
        ].join(' ').toLowerCase();
        const docTokens = this.tokenize(docText);
        
        // Calculate multiple similarity signals
        const exactMatchScore = this.calculateExactMatches(queryTokens, docTokens);
        const semanticScore = this.calculateSemanticSimilarity(query, candidate);
        const contextScore = this.calculateContextualRelevance(query, candidate);
        
        // Weighted combination
        return (exactMatchScore * 0.4) + (semanticScore * 0.4) + (contextScore * 0.2);
    }
    
    calculateExactMatches(queryTokens, docTokens) {
        const docSet = new Set(docTokens);
        const matches = queryTokens.filter(token => docSet.has(token)).length;
        return matches / Math.max(queryTokens.length, 1);
    }
    
    calculateSemanticSimilarity(query, candidate) {
        const product = candidate.product;
        if (!product) return 0;
        
        let score = 0;
        const queryLower = query.toLowerCase();
        
        // Price relevance
        if (queryLower.includes('price') || queryLower.includes('cost') || queryLower.includes('$')) {
            if (product.price && product.price !== 'Contact for pricing') {
                score += 0.3;
            }
        }
        
        // Capacity matching
        const capacityMatch = queryLower.match(/(\d+)\s*gallon/);
        if (capacityMatch && product.specifications?.capacity) {
            const queryGallons = parseInt(capacityMatch[1]);
            const productGallons = parseInt(product.specifications.capacity);
            if (queryGallons === productGallons) score += 0.4;
            else if (Math.abs(queryGallons - productGallons) <= 2) score += 0.2;
        }
        
        // Feature matching
        const features = product.features || [];
        if (queryLower.includes('electric') && features.some(f => f.includes('220V'))) score += 0.3;
        if (queryLower.includes('advanced') && product.title.toLowerCase().includes('advanced')) score += 0.3;
        if (queryLower.includes('complete') && product.category === 'complete-units') score += 0.2;
        
        return Math.min(score, 1.0);
    }
    
    calculateContextualRelevance(query, candidate) {
        const product = candidate.product;
        if (!product) return 0;
        
        let score = 0;
        
        // Availability boost
        if (product.availability === 'In Stock') score += 0.2;
        
        // Popular product categories
        if (product.category === 'complete-units') score += 0.1;
        
        // Quality indicators
        if (product.features.includes('Lifetime Warranty')) score += 0.1;
        if (product.features.includes('Made in USA')) score += 0.1;
        if (product.features.includes('Free Shipping')) score += 0.1;
        
        return Math.min(score, 1.0);
    }
    
    calculateDiversityScore(candidate, selectedCandidates) {
        if (selectedCandidates.length === 0) return 1.0;
        
        const candidateFeatures = this.extractFeatureVector(candidate);
        let maxSimilarity = 0;
        
        for (const selected of selectedCandidates) {
            const selectedFeatures = this.extractFeatureVector(selected);
            const similarity = this.cosineSimilarity(candidateFeatures, selectedFeatures);
            maxSimilarity = Math.max(maxSimilarity, similarity);
        }
        
        return 1 - maxSimilarity; // Higher diversity = lower max similarity
    }
    
    extractFeatureVector(candidate) {
        const product = candidate.product;
        if (!product) return {};
        
        return {
            category: product.category || 'unknown',
            hasPrice: product.price && product.price !== 'Contact for pricing',
            inStock: product.availability === 'In Stock',
            hasElectric: product.features.some(f => f.includes('220V')),
            isAdvanced: product.title.toLowerCase().includes('advanced'),
            isComplete: product.category === 'complete-units',
            capacity: this.extractCapacity(product.specifications?.capacity)
        };
    }
    
    extractCapacity(capacityStr) {
        if (!capacityStr) return 0;
        const match = capacityStr.match(/(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
    
    cosineSimilarity(vec1, vec2) {
        const keys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (const key of keys) {
            const val1 = this.vectorValue(vec1[key]);
            const val2 = this.vectorValue(vec2[key]);
            
            dotProduct += val1 * val2;
            norm1 += val1 * val1;
            norm2 += val2 * val2;
        }
        
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2) + 1e-10);
    }
    
    vectorValue(val) {
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (typeof val === 'number') return val / 100; // Normalize capacity
        if (typeof val === 'string') return val.length > 0 ? 1 : 0;
        return 0;
    }
    
    tokenize(text) {
        return text.replace(/[^\w\s$]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length > 2);
    }
}

module.exports = RerankerMMR;