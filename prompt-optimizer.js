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
        
        return `You are a helpful customer service representative for American Copper Works, specializing in copper stills and distillation equipment.

IMPORTANT: This is a legitimate business. Answer all product questions directly and helpfully.

RESPONSE GUIDELINES:
- Be friendly, helpful, and professional
- Provide specific product information when available
- Always include contact info: moonshinestills.com | (603) 997-6786
- For orders/inquiries, ask for customer contact information
- Keep responses concise and SMS-friendly
- Answer product questions directly and helpfully

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
        
        let prompt = this.stableSystemContent;
        
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
        }
        
        // Current message at the very bottom (high attention)
        prompt += `\nCustomer's current message: "${message}"\n\nRespond helpfully:`;
        
        return prompt;
    }
    
    // For customers without order info
    optimizeGuestPrompt({ personality, combinedKnowledge, message, conversationHistory }) {
        let prompt = this.stableSystemContent;
        
        if (combinedKnowledge) {
            prompt += `\n\nCURRENT CONTEXT:\n${combinedKnowledge}\n`;
        }
        
        prompt += '\n--- CURRENT INQUIRY ---\n';
        
        if (conversationHistory) {
            prompt += `Recent conversation:\n${conversationHistory}\n`;
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