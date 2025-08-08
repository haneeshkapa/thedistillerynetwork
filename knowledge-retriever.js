const fs = require('fs');
const logger = require('./logger');

class KnowledgeRetriever {
    constructor() {
        this.knowledge = null;
        this.productIndex = new Map();
        this.keywordIndex = new Map();
        this.loadKnowledge();
    }
    
    loadKnowledge() {
        try {
            const knowledgePath = './data/knowledge.json';
            if (fs.existsSync(knowledgePath)) {
                this.knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
                this.buildIndexes();
                logger.info('Knowledge base loaded and indexed', {
                    entries: this.knowledge.length,
                    products: this.productIndex.size,
                    keywords: this.keywordIndex.size
                });
            }
        } catch (error) {
            logger.error('Failed to load knowledge base', { error: error.message });
            this.knowledge = [];
        }
    }
    
    buildIndexes() {
        if (!this.knowledge) return;
        
        this.knowledge.forEach((entry, index) => {
            if (entry.fileType === '.shopify' && entry.content) {
                this.indexShopifyData(entry.content, index);
            }
        });
    }
    
    indexShopifyData(content, entryIndex) {
        try {
            // Parse text-based Shopify data format
            const products = this.parseShopifyTextContent(content);
            products.forEach((product, productIndex) => {
                if (!product.title) return;
                
                const productKey = `${entryIndex}_${productIndex}`;
                
                // Index by product title
                this.productIndex.set(product.title.toLowerCase(), {
                    entryIndex,
                    productIndex,
                    product: {
                        title: product.title,
                        price: product.price || 'Contact for pricing',
                        available: true, // Assume available from catalog
                        description: product.description?.substring(0, 200) || '',
                        tags: product.tags || []
                    }
                });
                
                // Index by keywords
                const keywords = [
                    ...product.title.toLowerCase().split(/\s+/),
                    ...(product.tags || []).map(tag => tag.toLowerCase()),
                    ...(product.description || '').toLowerCase().split(/\s+/).slice(0, 20)
                ].filter(word => word.length > 2);
                
                keywords.forEach(keyword => {
                    if (!this.keywordIndex.has(keyword)) {
                        this.keywordIndex.set(keyword, new Set());
                    }
                    this.keywordIndex.get(keyword).add(productKey);
                });
            });
        } catch (error) {
            logger.warn('Failed to index Shopify data', { error: error.message });
        }
    }
    
    parseShopifyTextContent(content) {
        const products = [];
        
        // Split by product sections (lines starting with ---)
        const sections = content.split(/\n--- /).filter(section => section.trim());
        
        sections.forEach(section => {
            const lines = section.split('\n');
            const title = lines[0].replace(/^--- | ---$/g, '').trim();
            
            if (!title || title.includes('=== ') || title.includes('Blog:')) return;
            
            // Extract description and price info
            let description = '';
            let price = '';
            
            // First pass: Look for pricing in variants section (near the end)
            for (let i = lines.length - 20; i < lines.length; i++) {
                if (i < 0) continue;
                const line = lines[i].trim();
                if (line.includes('Default Title:') && line.includes('$')) {
                    const priceMatch = line.match(/\$(\d+(?:\.\d{2})?)/);
                    if (priceMatch) {
                        price = priceMatch[1];
                        break;
                    }
                }
            }
            
            // Second pass: Build description from beginning
            for (let i = 1; i < Math.min(lines.length, 20); i++) {
                const line = lines[i].trim();
                if (line && !line.includes('URL:') && !line.includes('Blog:') && !line.includes('Type:') && !line.includes('Vendor:')) {
                    description += line + ' ';
                    
                    // Also look for prices in description area if not found in variants
                    if (!price) {
                        const priceMatch = line.match(/\$(\d{3,}(?:\.\d{2})?)/);
                        if (priceMatch && !line.toLowerCase().includes('gallon')) {
                            price = priceMatch[1];
                        }
                    }
                }
                if (description.length > 400) break;
            }
            
            // Extract tags/keywords from title and description
            const tags = [];
            const titleWords = title.toLowerCase().split(/\s+/);
            const stillKeywords = ['gallon', 'copper', 'still', 'moonshine', 'distiller', 'kit', 'complete', 'advanced'];
            titleWords.forEach(word => {
                if (stillKeywords.includes(word) || word.match(/^\d+$/)) {
                    tags.push(word);
                }
            });
            
            products.push({
                title: title,
                description: description.trim(),
                price: price || 'Contact for pricing',
                tags: tags
            });
        });
        
        return products;
    }
    
    // Get relevant knowledge for a customer message
    getRelevantKnowledge(message, maxProducts = 3) {
        if (!this.knowledge || this.knowledge.length === 0) {
            return 'Product information not available.';
        }
        
        logger.info('Knowledge retrieval', { message, products: this.productIndex.size });
        
        const query = message.toLowerCase();
        const relevantProducts = new Map();
        
        // Direct product name matches (highest priority)
        for (const [productName, data] of this.productIndex) {
            if (query.includes(productName) || productName.includes(query.substring(0, 20))) {
                relevantProducts.set(`${data.entryIndex}_${data.productIndex}`, {
                    score: 100,
                    product: data.product
                });
            }
        }
        
        // Keyword matches (medium priority)
        const queryWords = query.split(/\s+/).filter(word => word.length > 3);
        queryWords.forEach(word => {
            if (this.keywordIndex.has(word)) {
                const productKeys = this.keywordIndex.get(word);
                productKeys.forEach(key => {
                    const [entryIndex, productIndex] = key.split('_').map(Number);
                    const productData = this.findProductByIndex(entryIndex, productIndex);
                    if (productData) {
                        const currentScore = relevantProducts.get(key)?.score || 0;
                        relevantProducts.set(key, {
                            score: currentScore + 10,
                            product: productData
                        });
                    }
                });
            }
        });
        
        // If no specific matches, include top products
        if (relevantProducts.size === 0) {
            let count = 0;
            for (const [, data] of this.productIndex) {
                if (count >= maxProducts) break;
                relevantProducts.set(`${data.entryIndex}_${data.productIndex}`, {
                    score: 1,
                    product: data.product
                });
                count++;
            }
        }
        
        // Sort by relevance and format response
        const sortedProducts = Array.from(relevantProducts.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, maxProducts);
        
        const result = this.formatProductInfo(sortedProducts.map(item => item.product));
        logger.info('Knowledge result', { message, resultLength: result.length, productsFound: sortedProducts.length });
        return result;
    }
    
    findProductByIndex(entryIndex, productIndex) {
        try {
            if (!this.knowledge[entryIndex] || this.knowledge[entryIndex].fileType !== '.shopify') {
                return null;
            }
            
            const products = JSON.parse(this.knowledge[entryIndex].content);
            const product = products[productIndex];
            
            if (!product) return null;
            
            return {
                title: product.title,
                price: product.variants?.[0]?.price || 'Contact for pricing',
                available: product.variants?.[0]?.available || false,
                description: product.description?.substring(0, 200) || '',
                tags: product.tags || []
            };
        } catch (error) {
            return null;
        }
    }
    
    formatProductInfo(products) {
        if (products.length === 0) {
            return 'Products available - contact for specific information.';
        }
        
        let info = `Available Products:\n`;
        products.forEach(product => {
            const availability = product.available ? 'In Stock' : 'Contact for availability';
            info += `• ${product.title} - $${product.price} (${availability})\n`;
            if (product.description) {
                info += `  ${product.description}\n`;
            }
        });
        
        info += `\nFor detailed specifications and ordering: moonshinestills.com | (603) 997-6786`;
        return info;
    }
    
    // Get basic company info without full product catalog
    getCompanyInfo() {
        return `American Copper Works - Premium copper stills and distillation equipment.
Contact: (603) 997-6786 | moonshinestills.com
Specializing in moonshine stills, copper accessories, and distillation supplies.
All products are for legal water distillation and fuel alcohol production only.`;
    }
}

module.exports = KnowledgeRetriever;