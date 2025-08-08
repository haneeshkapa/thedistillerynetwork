const fs = require('fs');
const logger = require('./logger');
const RerankerMMR = require('./reranker-mmr');
const PriceValidator = require('./price-validator');

class AdvancedKnowledgeRetriever {
    constructor() {
        this.knowledge = null;
        this.documents = []; // Full text documents for BM25
        this.productIndex = new Map(); // Structured product data
        this.bm25Index = new Map(); // Term frequency index for BM25
        this.docFreqs = new Map(); // Document frequencies
        this.avgDocLength = 0;
        
        // Configuration
        this.k1 = 1.2; // BM25 parameter
        this.b = 0.75; // BM25 parameter
        this.maxResults = 3;
        
        // Initialize reranker/MMR system and price validator
        this.reranker = new RerankerMMR();
        this.priceValidator = new PriceValidator();
        
        // Canonical examples for few-shot prompting
        this.canonicalExamples = [
            {
                query: "10 gallon still price",
                response: "The 10 Gallon Advanced Model with 220v Element is $899.00 with free shipping."
            },
            {
                query: "what copper stills do you have",
                response: "We offer various copper stills from 2 to 100 gallons. Popular models include our 10-gallon Advanced Model ($899) and Flash Sale units ($1000)."
            }
        ];
        
        this.loadKnowledge();
    }
    
    loadKnowledge() {
        try {
            const knowledgePath = './data/knowledge.json';
            if (fs.existsSync(knowledgePath)) {
                this.knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
                this.buildAdvancedIndex();
                logger.info('Advanced knowledge retriever initialized', {
                    documents: this.documents.length,
                    products: this.productIndex.size,
                    avgDocLength: Math.round(this.avgDocLength)
                });
            }
        } catch (error) {
            logger.error('Failed to load knowledge base', { error: error.message });
            this.knowledge = [];
        }
    }
    
    buildAdvancedIndex() {
        if (!this.knowledge) return;
        
        this.knowledge.forEach((entry, entryIndex) => {
            if (entry.fileType === '.shopify' && entry.content) {
                this.indexShopifyContent(entry.content, entryIndex);
            }
        });
        
        this.buildBM25Index();
    }
    
    indexShopifyContent(content, entryIndex) {
        const sections = content.split(/\n--- /).filter(section => section.trim());
        
        sections.forEach((section, sectionIndex) => {
            const lines = section.split('\n');
            const title = lines[0].replace(/^--- | ---$/g, '').trim();
            
            if (!title || title.includes('=== ') || title.includes('Blog:')) return;
            
            // Extract comprehensive product data
            const product = this.extractProductData(lines, title);
            if (!product) return;
            
            // Store structured product data
            const productKey = `${entryIndex}_${sectionIndex}`;
            this.productIndex.set(productKey, product);
            
            // Create searchable document for BM25
            const searchableText = this.createSearchableText(product);
            this.documents.push({
                id: productKey,
                text: searchableText,
                product: product,
                relevanceScore: this.calculateBaseRelevance(product)
            });
        });
    }
    
    extractProductData(lines, title) {
        let description = '';
        let price = 'Contact for pricing';
        let features = [];
        let specifications = {};
        let availability = 'In Stock';
        
        // Enhanced extraction with better price detection
        for (let i = lines.length - 20; i < lines.length; i++) {
            if (i < 0) continue;
            const line = lines[i].trim();
            if (line.includes('Default Title:') && line.includes('$')) {
                const priceMatch = line.match(/\$(\d+(?:\.\d{2})?)/);
                if (priceMatch) {
                    price = priceMatch[1];
                    if (line.includes('Out of Stock')) availability = 'Out of Stock';
                    break;
                }
            }
        }
        
        // Extract description and features
        for (let i = 1; i < Math.min(lines.length, 25); i++) {
            const line = lines[i].trim();
            if (line && !this.isMetadataLine(line)) {
                if (line.length < 200) description += line + ' ';
                
                // Extract key features
                if (line.includes('FREE SHIPPING')) features.push('Free Shipping');
                if (line.includes('220v')) features.push('220V Electric');
                if (line.includes('Lifetime Warranty')) features.push('Lifetime Warranty');
                if (line.includes('Made in USA') || line.includes('American Made')) features.push('Made in USA');
                
                // Extract specifications
                const gallonMatch = line.match(/(\d+)\s*gallon/i);
                if (gallonMatch) specifications.capacity = `${gallonMatch[1]} gallons`;
            }
            if (description.length > 300) break;
        }
        
        return {
            title,
            description: description.trim(),
            price,
            features,
            specifications,
            availability,
            category: this.categorizeProduct(title)
        };
    }
    
    isMetadataLine(line) {
        return line.includes('URL:') || line.includes('Blog:') || 
               line.includes('Type:') || line.includes('Vendor:') ||
               line.includes('Tags:') || line.includes('Variants:');
    }
    
    categorizeProduct(title) {
        title = title.toLowerCase();
        if (title.includes('complete') || title.includes('advanced')) return 'complete-units';
        if (title.includes('kit') || title.includes('diy')) return 'kits';
        if (title.includes('element') || title.includes('controller')) return 'components';
        if (title.includes('accessory')) return 'accessories';
        return 'stills';
    }
    
    calculateBaseRelevance(product) {
        let score = 1.0;
        
        // Boost popular/complete products
        if (product.category === 'complete-units') score += 0.3;
        if (product.features.includes('Free Shipping')) score += 0.2;
        if (product.availability === 'In Stock') score += 0.1;
        
        // Boost based on capacity (10-20 gallon sweet spot)
        if (product.specifications.capacity) {
            const gallons = parseInt(product.specifications.capacity);
            if (gallons >= 10 && gallons <= 20) score += 0.2;
        }
        
        return score;
    }
    
    createSearchableText(product) {
        return [
            product.title,
            product.description,
            product.features.join(' '),
            Object.values(product.specifications).join(' '),
            product.category.replace('-', ' '),
            product.price !== 'Contact for pricing' ? `$${product.price}` : ''
        ].filter(Boolean).join(' ').toLowerCase();
    }
    
    buildBM25Index() {
        // Calculate document frequencies and average length
        let totalLength = 0;
        
        this.documents.forEach(doc => {
            const terms = this.tokenize(doc.text);
            totalLength += terms.length;
            
            const uniqueTerms = new Set(terms);
            uniqueTerms.forEach(term => {
                this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
            });
            
            // Build term frequency index for this document
            const termFreqs = new Map();
            terms.forEach(term => {
                termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
            });
            this.bm25Index.set(doc.id, termFreqs);
        });
        
        this.avgDocLength = totalLength / this.documents.length;
    }
    
    tokenize(text) {
        return text.toLowerCase()
            .replace(/[^\w\s$]/g, ' ')
            .split(/\s+/)
            .filter(token => token.length > 2);
    }
    
    // Hybrid BM25 + Vector-like retrieval
    retrieveRelevantChunks(query, maxChunks = 3) {
        const queryTerms = this.tokenize(query);
        const N = this.documents.length;
        
        // Calculate BM25 scores
        const scores = this.documents.map(doc => {
            const termFreqs = this.bm25Index.get(doc.id);
            const docLength = Array.from(termFreqs.values()).reduce((sum, freq) => sum + freq, 0);
            
            let bm25Score = 0;
            queryTerms.forEach(term => {
                const tf = termFreqs.get(term) || 0;
                const df = this.docFreqs.get(term) || 0;
                
                if (tf > 0 && df > 0) {
                    const idf = Math.log((N - df + 0.5) / (df + 0.5));
                    const tfComponent = (tf * (this.k1 + 1)) / 
                        (tf + this.k1 * (1 - this.b + this.b * docLength / this.avgDocLength));
                    bm25Score += idf * tfComponent;
                }
            });
            
            // Combine with base relevance and semantic signals
            const semanticBoost = this.calculateSemanticScore(query, doc.product);
            const finalScore = bm25Score * doc.relevanceScore + semanticBoost;
            
            return {
                doc,
                score: finalScore,
                bm25Score,
                semanticScore: semanticBoost
            };
        });
        
        // Re-rank and return top results
        return scores
            .sort((a, b) => b.score - a.score)
            .slice(0, maxChunks)
            .map(result => result.doc);
    }
    
    calculateSemanticScore(query, product) {
        const queryLower = query.toLowerCase();
        let score = 0;
        
        // Exact title matches
        if (queryLower.includes(product.title.toLowerCase().substring(0, 20))) score += 5;
        
        // Price queries
        if (queryLower.includes('price') || queryLower.includes('cost') || queryLower.includes('$')) {
            score += 2;
        }
        
        // Size/capacity queries
        const capacityMatch = queryLower.match(/(\d+)\s*gallon/);
        if (capacityMatch && product.specifications.capacity) {
            const queryGallons = parseInt(capacityMatch[1]);
            const productGallons = parseInt(product.specifications.capacity);
            if (queryGallons === productGallons) score += 3;
            else if (Math.abs(queryGallons - productGallons) <= 2) score += 1;
        }
        
        // Feature matching
        if (queryLower.includes('advanced') && product.title.toLowerCase().includes('advanced')) score += 2;
        if (queryLower.includes('complete') && product.category === 'complete-units') score += 2;
        if (queryLower.includes('electric') && product.features.some(f => f.includes('220V'))) score += 2;
        
        return score;
    }
    
    // Main retrieval method with caching-optimized output
    async getOptimizedKnowledge(query) {
        // Get more candidates for reranking
        const candidates = this.retrieveRelevantChunks(query, 10);
        
        if (candidates.length === 0) {
            return this.getFallbackResponse();
        }
        
        // Apply reranking and MMR for diversity
        const reranked = await this.reranker.rerankCandidates(query, candidates, 5);
        const finalChunks = this.reranker.applyMMR(query, reranked, this.maxResults);
        
        // Format for optimal prompt caching
        return this.formatForCaching(finalChunks, query);
    }
    
    formatForCaching(chunks, query) {
        // Critical info at top (anti "lost in the middle")
        let formatted = "RELEVANT PRODUCTS:\n";
        
        chunks.forEach((chunk, index) => {
            const p = chunk.product;
            formatted += `${index + 1}. ${p.title}\n`;
            formatted += `   Price: $${p.price} | ${p.availability}\n`;
            if (p.features.length > 0) {
                formatted += `   Features: ${p.features.join(', ')}\n`;
            }
            if (p.description && p.description.length < 150) {
                formatted += `   ${p.description}\n`;
            }
            formatted += "\n";
        });
        
        // Add contact info (stable for caching)
        formatted += "Contact: moonshinestills.com | (603) 997-6786";
        
        return formatted;
    }
    
    getFallbackResponse() {
        return `American Copper Works - Copper stills and distillation equipment
Popular products: 10-gallon stills starting at $899
Contact: moonshinestills.com | (603) 997-6786`;
    }
    
    // Get canonical examples for few-shot prompting (cached)
    getCanonicalExamples() {
        return this.canonicalExamples;
    }
    
    // Performance metrics
    getRetrievalMetrics(queries) {
        // TODO: Implement precision/recall@k tracking
        return {
            documentsIndexed: this.documents.length,
            avgDocLength: this.avgDocLength,
            vocabSize: this.docFreqs.size
        };
    }
}

module.exports = AdvancedKnowledgeRetriever;