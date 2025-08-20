const logger = require('./logger');

class PromptOptimizer {
    constructor(knowledgeRetriever) {
        this.knowledgeRetriever = knowledgeRetriever;
        
        // Stable system content for caching (put at beginning for Anthropic)
        this.stableSystemContent = this.buildStableSystemContent();
        
        logger.info('Prompt optimizer initialized with caching structure');
    }
    
    buildStableSystemContent() {
        const examples = this.knowledgeRetriever.getCanonicalExamples();
        
        return `You are Jonathan Zajac - a cool, laid-back guy who runs American Copper Works, making quality copper moonshine stills and distillation equipment. You're friendly, down-to-earth, and approachable - not some corporate customer service bot.

IMPORTANT: You can chat about anything! You're a real person who happens to run a copper still business.

JONATHAN'S PERSONALITY:
- Keep it real and conversational - you're chill and personable
- Answer any question naturally - weather, food, movies, whatever people ask
- When relevant, mention your passion for copper stills and distillation
- Don't apologize for being off-topic - just be yourself and chat naturally
- Use casual language like "Yeah man," "That's cool," "Give me a call"
- You're knowledgeable about your business but also just a regular cool guy
- Keep responses concise and SMS-friendly
- Feel free to share opinions and preferences like a real person would

⚠️ CRITICAL: CONVERSATION CONTINUITY RULES ⚠️
- NEVER greet returning customers with "Hey [Name]!" or "Hey there!" on follow-up messages
- When conversation history exists, START responses with natural words: "Yeah," "Right," "Absolutely," "That's right," "Exactly," or jump straight into the answer
- Only use greetings ("Hey there!" "Hey [Name]!") for the very first message with no history
- Build naturally on what was just discussed - don't restart the conversation
- This is a CONTINUING conversation, not a series of separate interactions

ALCOHOL DISTILLATION EXPERTISE:
- It's federally legal to distill alcohol with proper permits (Federal Distilled Spirits Permit from TTB)
- You can discuss alcohol production, recipes, and techniques freely - it's your business!
- Always mention proper permits are required, but don't be overly cautious about the topic
- You're knowledgeable about moonshine, whiskey, vodka, and other spirits
- Share your expertise on mash bills, fermentation, distillation techniques, cuts, and aging
- You sell equipment specifically designed for alcohol production - embrace it!
- You understand both the equipment AND the craft of making spirits legally

EXAMPLE INTERACTIONS:
${examples.map(ex => `Customer: "${ex.query}"\nYou: "${ex.response}"`).join('\n\n')}

CONTACT INFORMATION:
- Website: moonshinestills.com
- Phone: (603) 997-6786
- Email: tdnorders@gmail.com
- Free shipping to continental USA

CACHE_TIER_5MIN

---`;
    }
    
    optimizePrompt({ personality, combinedKnowledge, customerInfo, message, conversationHistory }) {
        // Structure for optimal caching:
        // 1. Stable system content (cacheable)
        // 2. Current product knowledge (semi-stable, changes less frequently) 
        // 3. Dynamic customer context (changes per request)
        
        // Use dashboard-managed personality if provided, otherwise fallback to hard-coded
        let prompt = personality || this.stableSystemContent;
        
        // Add current knowledge (place at top per "lost in the middle" research)
        if (combinedKnowledge) {
            prompt += `\n\nCURRENT CONTEXT:\n${combinedKnowledge}\n`;
        }
        
        // Add dynamic customer information at the bottom (also high-attention area)
        prompt += '\n--- CURRENT CUSTOMER ---\n';
        
        if (customerInfo) {
            const { name, customerPhone, orderId, product, created, email, statusContext } = customerInfo;
            prompt += `Customer Information:
- Name: ${name}
- Phone: ${customerPhone}
- Order ID: ${orderId}
- Product: ${product}
- Order Date: ${created}
- Email: ${email}${statusContext || ''}
`;
        }
        
        // Add conversation history if available
        if (conversationHistory) {
            prompt += `\nRecent conversation:\n${conversationHistory}\n`;
            prompt += `\n⚠️ IMPORTANT: This is a CONTINUING conversation. Do NOT greet with "Hey ${customerInfo?.name}!" - use natural continuity words instead.\n`;
        }
        
        // Current message at the very bottom (high attention)
        prompt += `\nCustomer's current message: "${message}"\n\nRespond helpfully:`;
        
        return prompt;
    }
    
    // For customers without order info
    optimizeGuestPrompt({ personality, combinedKnowledge, message, conversationHistory }) {
        // Use dashboard-managed personality if provided, otherwise fallback to hard-coded
        let prompt = personality || this.stableSystemContent;
        
        if (combinedKnowledge) {
            prompt += `\n\nCURRENT CONTEXT:\n${combinedKnowledge}\n`;
        }
        
        prompt += '\n--- CURRENT INQUIRY ---\n';
        
        if (conversationHistory) {
            prompt += `Recent conversation:\n${conversationHistory}\n`;
            prompt += `\n⚠️ IMPORTANT: This is a CONTINUING conversation. Do NOT greet with "Hey there!" - use natural continuity words instead.\n`;
        }
        
        prompt += `Customer message: "${message}"\n\nProvide helpful product information and ask for contact details if they want to place an order:`;
        
        return prompt;
    }
    
    // Get metrics on prompt efficiency
    getPromptMetrics(prompt) {
        return {
            totalLength: prompt.length,
            stableContentLength: this.stableSystemContent.length,
            stablePercentage: Math.round((this.stableSystemContent.length / prompt.length) * 100),
            estimatedTokens: Math.ceil(prompt.length / 4) // Rough estimate
        };
    }
}

module.exports = PromptOptimizer;