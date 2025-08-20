const logger = require('./logger');

class PromptOptimizer {
    constructor(knowledgeRetriever) {
        this.knowledgeRetriever = knowledgeRetriever;
        
        // Stable system content for caching (put at beginning for Anthropic)
        this.stableSystemContent = this.buildStableSystemContent();
        
        logger.info('Prompt optimizer initialized with caching structure');
    }
    
    buildStableSystemContent() {
        // This method is no longer used since personality is managed entirely through the dashboard
        // Keeping for compatibility but returns empty content
        return `DEPRECATED: Personality is now managed through the dashboard UI.`;
    }
    
    optimizePrompt({ personality, combinedKnowledge, customerInfo, message, conversationHistory }) {
        // Structure for optimal caching:
        // 1. Stable system content (cacheable)
        // 2. Current product knowledge (semi-stable, changes less frequently) 
        // 3. Dynamic customer context (changes per request)
        
        // Use dashboard-managed personality - no hard-coded fallback
        // This forces personality to be managed entirely through the dashboard UI
        let prompt = personality || "ERROR: No personality configured. Please set personality in the management dashboard.";
        
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
        // Use dashboard-managed personality - no hard-coded fallback
        // This forces personality to be managed entirely through the dashboard UI
        let prompt = personality || "ERROR: No personality configured. Please set personality in the management dashboard.";
        
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