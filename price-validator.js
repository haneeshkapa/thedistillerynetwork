/**
 * PriceValidator:
 * Checks the AI's response for likely price mistakes (e.g., confusion between "10 gallon" and "$10").
 * Returns true if the response's pricing content appears reliable, or false if it seems incorrect.
 */
class PriceValidator {
  validate(answerText, userQuery = "") {
    if (!answerText) return true;
    
    // Look for any dollar amounts in the answer
    const priceMatches = answerText.match(/\$\s?(\d+)(\.\d+)?/g);
    if (!priceMatches) {
      return true;  // no price mentioned, so nothing to validate
    }

    // Convert user query number (like "10 gallon") if present
    let queryNumber = null;
    const numMatch = userQuery.match(/(\d+)\s*gallon/i);
    if (numMatch) {
      queryNumber = parseInt(numMatch[1], 10);
    }

    for (let match of priceMatches) {
      // extract numeric part
      const numStr = match.replace(/\$\s?/, '').trim();
      let priceVal = parseFloat(numStr);
      if (isNaN(priceVal)) continue;
      
      // Rule 1: If query had a gallon number and answer has the same number as price
      if (queryNumber && priceVal === queryNumber) {
        // e.g., user asked about "10 gallon", answer says "$10"
        return false;
      }
      
      // Rule 2: If price is unreasonably low (e.g., < $100) for our products
      if (priceVal > 0 && priceVal < 100) {
        // likely a mistake, since main products are more expensive
        return false;
      }
    }

    // If it passed these checks, assume it's fine
    return true;
  }
}

module.exports = PriceValidator;