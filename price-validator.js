const logger = require('./logger');

class PriceValidator {
    constructor() {
        // Common price extraction patterns
        this.pricePatterns = [
            /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g, // Standard $999.00 or $1,299.00
            /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*dollars?/gi, // 999 dollars
            /price[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi // price: $999
        ];
        
        // Suspicious patterns that might be wrong
        this.suspiciousPatterns = [
            /\$(\d{1,2})(?:\s|$)/, // Very low prices like $10, $99 (might be capacity)
            /(\d{1,2})\s*gallon.*\$(\d{1,2})(?:\s|$)/, // "10 gallon" with low price
        ];
        
        logger.info('Price validator initialized');
    }
    
    validatePriceExtraction(text, expectedPriceRange = null) {
        const extractedPrices = this.extractPrices(text);
        const validation = {
            prices: extractedPrices,
            isValid: true,
            warnings: [],
            confidence: 1.0
        };
        
        // Check for suspicious patterns
        for (const price of extractedPrices) {
            const checks = this.performPriceChecks(price, text);
            validation.warnings.push(...checks.warnings);
            validation.confidence = Math.min(validation.confidence, checks.confidence);
        }
        
        // Check against expected range
        if (expectedPriceRange && extractedPrices.length > 0) {
            const rangeCheck = this.validatePriceRange(extractedPrices, expectedPriceRange);
            validation.isValid = rangeCheck.isValid;
            validation.warnings.push(...rangeCheck.warnings);
        }
        
        // Log validation results
        logger.debug('Price validation completed', {
            extractedPrices: extractedPrices.length,
            isValid: validation.isValid,
            confidence: validation.confidence,
            warnings: validation.warnings.length
        });
        
        return validation;
    }
    
    extractPrices(text) {
        const prices = new Set();
        
        for (const pattern of this.pricePatterns) {
            const matches = [...text.matchAll(pattern)];
            for (const match of matches) {
                const priceStr = match[1] || match[0];
                const price = this.parsePrice(priceStr);
                if (price > 0) {
                    prices.add(price);
                }
            }
        }
        
        return Array.from(prices).sort((a, b) => b - a); // Highest first
    }
    
    parsePrice(priceStr) {
        // Remove currency symbols and spaces
        const cleaned = priceStr.replace(/[$,\s]/g, '');
        const price = parseFloat(cleaned);
        return isNaN(price) ? 0 : price;
    }
    
    performPriceChecks(price, text) {
        const checks = {
            warnings: [],
            confidence: 1.0
        };
        
        // Check 1: Suspiciously low price (might be capacity confusion)
        if (price < 100) {
            const capacityMatch = text.match(/(\\d{1,2})\\s*gallon/gi);
            if (capacityMatch) {
                const capacity = parseInt(capacityMatch[0]);
                if (capacity === price) {
                    checks.warnings.push(`Price $${price} matches gallon capacity - might be extraction error`);
                    checks.confidence = 0.2;
                }
            }
        }
        
        // Check 2: Missing decimal places for equipment prices
        if (price > 100 && price % 1 === 0 && price < 1000) {
            checks.warnings.push(`Price $${price} lacks decimal precision - verify if $${price}.00 intended`);
            checks.confidence = 0.8;
        }
        
        // Check 3: Reasonable range for distillation equipment
        if (price < 50) {
            checks.warnings.push(`Price $${price} unusually low for distillation equipment`);
            checks.confidence = 0.3;
        } else if (price > 10000) {
            checks.warnings.push(`Price $${price} unusually high - verify commercial equipment`);
            checks.confidence = 0.7;
        }
        
        return checks;
    }
    
    validatePriceRange(extractedPrices, expectedRange) {
        const { min = 0, max = Infinity, expected = null } = expectedRange;
        const validation = {
            isValid: true,
            warnings: []
        };
        
        for (const price of extractedPrices) {
            if (price < min || price > max) {
                validation.isValid = false;
                validation.warnings.push(`Price $${price} outside expected range $${min}-$${max}`);
            }
            
            if (expected && Math.abs(price - expected) > expected * 0.1) {
                validation.warnings.push(`Price $${price} differs significantly from expected $${expected}`);
            }
        }
        
        return validation;
    }
    
    // Enhanced price extraction for product data
    extractProductPrice(productData) {
        const candidates = [];
        
        // Check variants section first (most reliable)
        if (productData.variants) {
            for (const variant of productData.variants) {
                if (variant.price && variant.price !== 'Contact for pricing') {
                    const price = this.parsePrice(variant.price);
                    if (price > 0) {
                        candidates.push({
                            price,
                            source: 'variants',
                            confidence: 0.95,
                            data: variant
                        });
                    }
                }
            }
        }
        
        // Check main price field
        if (productData.price && productData.price !== 'Contact for pricing') {
            const price = this.parsePrice(productData.price);
            if (price > 0) {
                candidates.push({
                    price,
                    source: 'main_price',
                    confidence: 0.9,
                    data: { price: productData.price }
                });
            }
        }
        
        // Check title and description as fallback
        const textContent = [productData.title, productData.description].filter(Boolean).join(' ');
        const textPrices = this.extractPrices(textContent);
        
        for (const price of textPrices) {
            candidates.push({
                price,
                source: 'text_content',
                confidence: 0.6,
                data: { extracted_from: textContent.substring(0, 100) }
            });
        }
        
        // Return highest confidence price
        candidates.sort((a, b) => b.confidence - a.confidence || b.price - a.price);
        
        if (candidates.length > 0) {
            const best = candidates[0];
            logger.debug('Product price extracted', {
                price: best.price,
                source: best.source,
                confidence: best.confidence
            });
            return best;
        }
        
        return null;
    }
}

module.exports = PriceValidator;