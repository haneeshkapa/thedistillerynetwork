/**
 * PriceValidator:
 * Checks the AI's response for likely price mistakes (e.g., confusion between "10 gallon" and "$10").
 * Now includes Shopify-aware validation to prevent pricing hallucinations.
 * Returns true if the response's pricing content appears reliable, or false if it seems incorrect.
 */
class PriceValidator {
  constructor(knowledgeRetriever = null) {
    this.knowledgeRetriever = knowledgeRetriever;
  }

  async validate(answerText, userQuery = "", knowledgeChunks = []) {
    if (!answerText) return true;
    
    // Look for any dollar amounts in the answer
    const priceMatches = answerText.match(/\$\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/g);
    if (!priceMatches) {
      return true;  // no price mentioned, so nothing to validate
    }

    // Convert user query number (like "10 gallon") if present
    let queryNumber = null;
    const numMatch = userQuery.match(/(\d+)\s*gallon/i);
    if (numMatch) {
      queryNumber = parseInt(numMatch[1], 10);
    }

    // Extract prices from Shopify knowledge base for validation
    const shopifyPrices = new Set();
    if (knowledgeChunks && knowledgeChunks.length > 0) {
      for (const chunk of knowledgeChunks) {
        const chunkPrices = chunk.match(/Price:\s*\$(\d+(?:,\d{3})*(?:\.\d{2})?)/gi);
        if (chunkPrices) {
          chunkPrices.forEach(priceMatch => {
            const price = priceMatch.replace(/Price:\s*\$\s?/, '').replace(/,/g, '');
            const numValue = parseFloat(price);
            if (!isNaN(numValue)) {
              shopifyPrices.add(numValue);
            }
          });
        }
      }
    }

    for (let match of priceMatches) {
      // extract numeric part, handle commas
      const numStr = match.replace(/\$\s?/, '').replace(/,/g, '').trim();
      let priceVal = parseFloat(numStr);
      if (isNaN(priceVal)) continue;
      
      // Rule 1: If query had a gallon number and answer has the exact same number as price (obvious mistake)
      if (queryNumber && priceVal === queryNumber && priceVal < 1000) {
        console.log(`❌ Price validation failed: Gallon/price confusion (${queryNumber} gallon -> $${priceVal})`);
        return false;
      }
      
      // Rule 2: If we have Shopify prices and the AI mentions a price not in our catalog
      if (shopifyPrices.size > 0) {
        // Allow small variance (±50) for shipping, tax, etc.
        const priceInRange = Array.from(shopifyPrices).some(shopifyPrice => 
          Math.abs(shopifyPrice - priceVal) <= 50
        );
        
        if (!priceInRange && priceVal > 100) {
          console.log(`❌ Price validation failed: Price $${priceVal} not in Shopify catalog`);
          console.log(`Available Shopify prices:`, Array.from(shopifyPrices));
          return false;
        }
      }
      
      // Rule 3: Basic sanity checks for still prices
      const isAccessory = /accessory|hydrometer|parrot|thermometer|valve|gasket|clamp/i.test(answerText);
      
      if (!isAccessory) {
        // Main still products should be reasonably priced
        if (priceVal > 0 && priceVal < 150) {
          console.log(`❌ Price validation failed: Still price too low ($${priceVal})`);
          return false;
        }
        
        if (priceVal > 10000) {
          console.log(`❌ Price validation failed: Still price too high ($${priceVal})`);
          return false;
        }
      }
    }

    console.log(`✅ Price validation passed for: ${priceMatches.join(', ')}`);
    return true;
  }

  // Static method for backward compatibility
  static validate(answerText, userQuery = "") {
    const validator = new PriceValidator();
    return validator.validate(answerText, userQuery);
  }
}

module.exports = PriceValidator;