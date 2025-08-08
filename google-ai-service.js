const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

class GoogleAIService {
    constructor(apiKey) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        logger.info('Google AI service initialized');
    }
    
    // Convert to Claude-like message format for compatibility
    async messages() {
        return {
            create: async (params) => {
                try {
                    const { messages, max_tokens = 1024 } = params;
                    
                    // Extract the user message content
                    const userMessage = messages.find(m => m.role === 'user')?.content || '';
                    
                    const result = await this.model.generateContent(userMessage);
                    const response = await result.response;
                    const text = response.text();
                    
                    // Return in Claude-compatible format
                    return {
                        content: [{ text }],
                        usage: {
                            input_tokens: Math.ceil(userMessage.length / 4),
                            output_tokens: Math.ceil(text.length / 4)
                        }
                    };
                    
                } catch (error) {
                    logger.error('Google AI API error', { error: error.message });
                    
                    // Return fallback response for service unavailable or other errors
                    const fallbackText = "I'm experiencing high demand right now. Please call (603) 997-6786 or visit moonshinestills.com for immediate assistance.";
                    
                    return {
                        content: [{ text: fallbackText }],
                        usage: {
                            input_tokens: Math.ceil(userMessage.length / 4),
                            output_tokens: Math.ceil(fallbackText.length / 4)
                        }
                    };
                }
            }
        };
    }
}

module.exports = GoogleAIService;