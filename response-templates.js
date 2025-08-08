const logger = require('./logger');

class ResponseTemplates {
    constructor() {
        // Pre-built SMS response templates
        this.templates = {
            orderFound: {
                pattern: /order|tracking|status|shipped/i,
                template: "Hi {customerName}! Your order #{orderNumber} for {itemName} (${amount}) is {status}. {additionalInfo} Questions? Call (603) 997-6786.",
                maxTokens: 50,
                fields: ['customerName', 'orderNumber', 'itemName', 'amount', 'status', 'additionalInfo']
            },
            
            orderNotFound: {
                pattern: /order|tracking/i,
                template: "I don't see an order for this number. Could you provide your order # or email? Call (603) 997-6786 for immediate help.",
                maxTokens: 30,
                fields: []
            },
            
            priceInquiry: {
                pattern: /price|cost|how much|\$/i,
                template: "The {productName} is ${price} with free shipping. {availability} To order, call (603) 997-6786 or visit moonshinestills.com.",
                maxTokens: 40,
                fields: ['productName', 'price', 'availability']
            },
            
            stockUnknown: {
                pattern: /stock|available|in stock/i,
                template: "I can't check live inventory. Please call (603) 997-6786 for current {productName} availability or visit moonshinestills.com.",
                maxTokens: 30,
                fields: ['productName']
            },
            
            shippingDelay: {
                pattern: /shipping|delivery|when will/i,
                template: "Your order is processing. Typical shipping: 1-2 weeks. For expedited shipping options, call (603) 997-6786.",
                maxTokens: 25,
                fields: []
            },
            
            pickupReady: {
                pattern: /pickup|ready/i,
                template: "Your order is ready for pickup! Please call (603) 997-6786 to schedule pickup at our facility.",
                maxTokens: 25,
                fields: []
            },
            
            policyGeneral: {
                pattern: /warranty|return|policy|guarantee/i,
                template: "We offer lifetime warranty on stills. For returns/exchanges, call (603) 997-6786. Full policy at moonshinestills.com/policy.",
                maxTokens: 30,
                fields: []
            },
            
            hoursContact: {
                pattern: /hours|when open|contact/i,
                template: "Contact us: (603) 997-6786 or tdnorders@gmail.com. Visit moonshinestills.com for product info and ordering.",
                maxTokens: 25,
                fields: []
            }
        };
        
        // Fallback templates for different scenarios
        this.fallbacks = {
            noContext: "I don't have that info right now. Please call (603) 997-6786 or visit moonshinestills.com for assistance.",
            highDemand: "I'm experiencing high demand right now. Please call (603) 997-6786 or visit moonshinestills.com for immediate assistance.",
            technicalIssue: "I'm having trouble accessing that information. Please call (603) 997-6786 for help.",
            unknownQuery: "I'm not sure about that. For product questions and orders, call (603) 997-6786 or visit moonshinestills.com."
        };
        
        logger.info('Response templates initialized', {
            templateCount: Object.keys(this.templates).length,
            fallbackCount: Object.keys(this.fallbacks).length
        });
    }
    
    // Try to match query to a template
    matchTemplate(query, retrievalData = null, customerInfo = null) {
        const queryLower = query.toLowerCase();
        
        // Check each template pattern
        for (const [templateKey, template] of Object.entries(this.templates)) {
            if (template.pattern.test(queryLower)) {
                return this.fillTemplate(templateKey, template, retrievalData, customerInfo, query);
            }
        }
        
        return null; // No template match - use full AI generation
    }
    
    // Fill template with available data
    fillTemplate(templateKey, template, retrievalData, customerInfo, originalQuery) {
        let response = template.template;
        const filledFields = {};
        
        // Fill template fields based on available data
        for (const field of template.fields) {
            let value = this.extractFieldValue(field, retrievalData, customerInfo, originalQuery);
            
            if (value) {
                response = response.replace(`{${field}}`, value);
                filledFields[field] = value;
            } else {
                // Handle missing fields gracefully
                response = this.handleMissingField(response, field, templateKey);
            }
        }
        
        const result = {
            templateUsed: templateKey,
            response: response.trim(),
            estimatedTokens: Math.ceil(response.length / 4),
            filledFields,
            isTemplate: true
        };
        
        logger.debug('Template response generated', {
            template: templateKey,
            tokens: result.estimatedTokens,
            fieldsUsed: Object.keys(filledFields).length
        });
        
        return result;
    }
    
    // Extract field values from available data
    extractFieldValue(field, retrievalData, customerInfo, query) {
        switch (field) {
            case 'customerName':
                return customerInfo?.shipping_name || customerInfo?.billing_name || null;
                
            case 'orderNumber':
                return customerInfo?.order || null;
                
            case 'itemName':
                return customerInfo?.items || 'your order';
                
            case 'amount':
                return customerInfo?.total_price || null;
                
            case 'status':
                // Default status based on typical order flow
                return 'being processed';
                
            case 'additionalInfo':
                return 'Tracking info will be sent via email.';
                
            case 'productName':
                if (retrievalData) {
                    // Extract product name from retrieval data
                    const productMatch = retrievalData.match(/([^-\n]+(?:Gallon|Element|Still)[^-\n]*)/i);
                    return productMatch ? productMatch[1].trim() : 'that product';
                }
                return this.guessProductFromQuery(query);
                
            case 'price':
                if (retrievalData) {
                    const priceMatch = retrievalData.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
                    return priceMatch ? priceMatch[1] : null;
                }
                return null;
                
            case 'availability':
                if (retrievalData) {
                    if (retrievalData.toLowerCase().includes('out of stock')) {
                        return 'Currently out of stock.';
                    } else if (retrievalData.toLowerCase().includes('in stock')) {
                        return 'In stock now.';
                    }
                }
                return 'Call for availability.';
                
            default:
                return null;
        }
    }
    
    // Handle missing template fields
    handleMissingField(response, field, templateKey) {
        switch (field) {
            case 'customerName':
                return response.replace('Hi {customerName}!', 'Hi there!');
                
            case 'productName':
                return response.replace('{productName}', 'that product');
                
            case 'price':
                return response.replace('${price}', 'current pricing');
                
            case 'availability':
                return response.replace('{availability}', '');
                
            case 'additionalInfo':
                return response.replace('{additionalInfo}', '');
                
            default:
                // Remove the placeholder entirely
                return response.replace(`{${field}}`, '');
        }
    }
    
    // Guess product from query keywords
    guessProductFromQuery(query) {
        const queryLower = query.toLowerCase();
        
        if (queryLower.includes('10 gallon') || queryLower.includes('10-gallon')) {
            return '10 gallon still';
        } else if (queryLower.includes('element') || queryLower.includes('220v')) {
            return 'heating element';
        } else if (queryLower.includes('still') || queryLower.includes('copper')) {
            return 'copper still';
        }
        
        return 'that product';
    }
    
    // Get appropriate fallback response
    getFallback(scenario = 'unknownQuery') {
        return {
            response: this.fallbacks[scenario] || this.fallbacks.unknownQuery,
            estimatedTokens: Math.ceil(this.fallbacks[scenario]?.length / 4 || 25),
            isTemplate: true,
            isFallback: true,
            scenario
        };
    }
    
    // Determine if query is suitable for template matching
    isTemplateSuitable(query, retrievalConfidence = 1.0) {
        // Use templates for high-confidence simple queries
        const isSimple = query.length < 100; // Short queries
        const hasGoodRetrieval = retrievalConfidence > 0.6;
        const matchesPattern = Object.values(this.templates).some(t => t.pattern.test(query));
        
        return isSimple && hasGoodRetrieval && matchesPattern;
    }
    
    // Calculate token savings from template usage
    calculateTokenSavings(templateTokens, fullAITokens = 150) {
        const savings = fullAITokens - templateTokens;
        const savingsPercent = (savings / fullAITokens) * 100;
        
        return {
            templateTokens,
            fullAITokens,
            savings,
            savingsPercent: savingsPercent.toFixed(1)
        };
    }
}

module.exports = ResponseTemplates;