const axios = require('axios');

class ShopifyService {
    constructor() {
        this.storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
        this.accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
        
        // Check for placeholder values or missing credentials
        const isConfigured = this.storeDomain && 
                           this.accessToken && 
                           !this.accessToken.includes('your_') &&
                           !this.accessToken.includes('_here') &&
                           this.accessToken.length > 20; // Real Shopify tokens are typically longer
        
        if (!isConfigured) {
            console.warn('Shopify credentials not configured or using placeholder values. Shopify integration disabled.');
            this.enabled = false;
            return;
        }
        
        this.enabled = true;
        this.baseURL = `https://${this.storeDomain}/admin/api/2024-10`; // Updated to supported version
        this.headers = {
            'X-Shopify-Access-Token': this.accessToken,
            'Content-Type': 'application/json'
        };
    }

    async makeRequest(endpoint) {
        if (!this.enabled) {
            throw new Error('Shopify service not configured');
        }
        
        try {
            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                headers: this.headers,
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                // Don't log 404s as errors - they're just empty resources
                console.log(`Shopify endpoint ${endpoint} returned 404 (no data)`);
            } else {
                console.error(`Shopify API error for ${endpoint}:`, error.message);
            }
            throw error;
        }
    }

    // Get all products with details
    async getProducts(limit = 250) {
        try {
            const data = await this.makeRequest(`/products.json?limit=${limit}&status=active`);
            return data.products.map(product => ({
                id: product.id,
                title: product.title,
                description: product.body_html?.replace(/<[^>]*>/g, '') || 'No description available',
                vendor: product.vendor,
                productType: product.product_type,
                tags: product.tags.split(',').map(tag => tag.trim()),
                variants: product.variants.map(variant => ({
                    id: variant.id,
                    title: variant.title,
                    price: variant.price,
                    compareAtPrice: variant.compare_at_price,
                    inventoryQuantity: variant.inventory_quantity,
                    sku: variant.sku,
                    available: variant.inventory_quantity > 0
                })),
                images: product.images.map(img => img.src),
                handle: product.handle,
                url: `https://${this.storeDomain.replace('.myshopify.com', '')}.com/products/${product.handle}`,
                createdAt: product.created_at,
                updatedAt: product.updated_at
            }));
        } catch (error) {
            console.error('Error fetching products:', error);
            return [];
        }
    }

    // Get collections
    async getCollections() {
        try {
            const data = await this.makeRequest('/collections.json');
            return data.collections.map(collection => ({
                id: collection.id,
                title: collection.title,
                description: collection.body_html?.replace(/<[^>]*>/g, '') || '',
                handle: collection.handle,
                productsCount: collection.products_count,
                url: `https://${this.storeDomain.replace('.myshopify.com', '')}.com/collections/${collection.handle}`
            }));
        } catch (error) {
            // 404 means no collections exist, which is normal for some stores
            if (error.response?.status === 404) {
                console.log('No collections found in store (404) - this is normal');
                return [];
            }
            console.error('Error fetching collections:', error.message);
            return [];
        }
    }

    // Get shop information
    async getShopInfo() {
        try {
            const data = await this.makeRequest('/shop.json');
            const shop = data.shop;
            return {
                id: shop.id,
                name: shop.name,
                email: shop.email,
                domain: shop.domain,
                phone: shop.phone,
                address: {
                    address1: shop.address1,
                    address2: shop.address2,
                    city: shop.city,
                    province: shop.province,
                    country: shop.country,
                    zip: shop.zip
                },
                currency: shop.currency,
                timezone: shop.iana_timezone,
                description: shop.description,
                policies: {
                    privacyPolicy: shop.privacy_policy,
                    refundPolicy: shop.refund_policy,
                    termsOfService: shop.terms_of_service,
                    shippingPolicy: shop.shipping_policy
                }
            };
        } catch (error) {
            console.error('Error fetching shop info:', error);
            return null;
        }
    }

    // Get pages (like About Us, FAQ, etc.)
    async getPages() {
        try {
            const data = await this.makeRequest('/pages.json');
            return data.pages.map(page => ({
                id: page.id,
                title: page.title,
                content: page.body_html?.replace(/<[^>]*>/g, '') || '',
                handle: page.handle,
                url: `https://${this.storeDomain.replace('.myshopify.com', '')}.com/pages/${page.handle}`,
                updatedAt: page.updated_at
            }));
        } catch (error) {
            console.error('Error fetching pages:', error);
            return [];
        }
    }

    // Get blog posts
    async getBlogPosts(limit = 50) {
        try {
            // First get blogs
            const blogsData = await this.makeRequest('/blogs.json');
            const allPosts = [];
            
            for (const blog of blogsData.blogs) {
                const postsData = await this.makeRequest(`/blogs/${blog.id}/articles.json?limit=${limit}`);
                const posts = postsData.articles.map(article => ({
                    id: article.id,
                    title: article.title,
                    content: article.body_html?.replace(/<[^>]*>/g, '') || '',
                    summary: article.summary,
                    author: article.author,
                    blogTitle: blog.title,
                    tags: article.tags.split(',').map(tag => tag.trim()),
                    handle: article.handle,
                    url: `https://${this.storeDomain.replace('.myshopify.com', '')}.com/blogs/${blog.handle}/${article.handle}`,
                    publishedAt: article.published_at,
                    updatedAt: article.updated_at
                }));
                allPosts.push(...posts);
            }
            
            return allPosts;
        } catch (error) {
            console.error('Error fetching blog posts:', error);
            return [];
        }
    }

    // Get order by number (for customer inquiries)
    async getOrderByNumber(orderNumber) {
        try {
            const data = await this.makeRequest(`/orders.json?name=${orderNumber}&status=any`);
            if (data.orders.length === 0) {
                return null;
            }
            
            const order = data.orders[0];
            return {
                id: order.id,
                number: order.order_number,
                name: order.name,
                email: order.email,
                phone: order.phone,
                totalPrice: order.total_price,
                currency: order.currency,
                financialStatus: order.financial_status,
                fulfillmentStatus: order.fulfillment_status,
                createdAt: order.created_at,
                updatedAt: order.updated_at,
                lineItems: order.line_items.map(item => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price
                })),
                shippingAddress: order.shipping_address,
                trackingInfo: order.fulfillments?.map(f => ({
                    trackingNumber: f.tracking_number,
                    trackingUrl: f.tracking_urls?.[0]
                })) || []
            };
        } catch (error) {
            console.error('Error fetching order:', error);
            return null;
        }
    }

    // Format all data for knowledge base
    formatForKnowledgeBase(products, collections, shopInfo, pages, blogPosts) {
        let knowledgeContent = '';
        
        // Shop Information
        if (shopInfo) {
            knowledgeContent += `=== STORE INFORMATION ===\n`;
            knowledgeContent += `Store: ${shopInfo.name}\n`;
            knowledgeContent += `Website: https://${shopInfo.domain}\n`;
            knowledgeContent += `Email: ${shopInfo.email}\n`;
            knowledgeContent += `Phone: ${shopInfo.phone || 'Not available'}\n`;
            knowledgeContent += `Description: ${shopInfo.description || 'No description'}\n`;
            knowledgeContent += `Currency: ${shopInfo.currency}\n`;
            
            if (shopInfo.address) {
                knowledgeContent += `Address: ${shopInfo.address.address1}`;
                if (shopInfo.address.address2) knowledgeContent += `, ${shopInfo.address.address2}`;
                knowledgeContent += `, ${shopInfo.address.city}, ${shopInfo.address.province} ${shopInfo.address.zip}, ${shopInfo.address.country}\n`;
            }
            knowledgeContent += `\n`;
        }

        // Products
        if (products.length > 0) {
            knowledgeContent += `=== PRODUCTS (${products.length} items) ===\n`;
            products.forEach(product => {
                knowledgeContent += `\n--- ${product.title} ---\n`;
                knowledgeContent += `Description: ${product.description}\n`;
                knowledgeContent += `Type: ${product.productType}\n`;
                knowledgeContent += `Vendor: ${product.vendor}\n`;
                knowledgeContent += `URL: ${product.url}\n`;
                
                if (product.variants.length > 0) {
                    knowledgeContent += `Variants:\n`;
                    product.variants.forEach(variant => {
                        knowledgeContent += `  - ${variant.title}: $${variant.price}`;
                        if (variant.sku) knowledgeContent += ` (SKU: ${variant.sku})`;
                        knowledgeContent += ` - ${variant.available ? 'In Stock' : 'Out of Stock'}\n`;
                    });
                }
                
                if (product.tags.length > 0) {
                    knowledgeContent += `Tags: ${product.tags.join(', ')}\n`;
                }
            });
        }

        // Collections
        if (collections.length > 0) {
            knowledgeContent += `\n=== COLLECTIONS ===\n`;
            collections.forEach(collection => {
                knowledgeContent += `\n--- ${collection.title} ---\n`;
                knowledgeContent += `Description: ${collection.description}\n`;
                knowledgeContent += `Products: ${collection.productsCount}\n`;
                knowledgeContent += `URL: ${collection.url}\n`;
            });
        }

        // Pages
        if (pages.length > 0) {
            knowledgeContent += `\n=== STORE PAGES ===\n`;
            pages.forEach(page => {
                knowledgeContent += `\n--- ${page.title} ---\n`;
                knowledgeContent += `${page.content}\n`;
                knowledgeContent += `URL: ${page.url}\n`;
            });
        }

        // Blog Posts
        if (blogPosts.length > 0) {
            knowledgeContent += `\n=== BLOG POSTS ===\n`;
            blogPosts.slice(0, 10).forEach(post => { // Limit to latest 10 posts
                knowledgeContent += `\n--- ${post.title} ---\n`;
                knowledgeContent += `Blog: ${post.blogTitle}\n`;
                knowledgeContent += `Author: ${post.author}\n`;
                knowledgeContent += `${post.content.substring(0, 500)}...\n`;
                knowledgeContent += `URL: ${post.url}\n`;
            });
        }

        return knowledgeContent;
    }

    // Get sync status
    getSyncStatus() {
        // Use same logic as constructor to determine if properly configured
        const isConfigured = this.storeDomain && 
                           this.accessToken && 
                           !this.accessToken.includes('your_') &&
                           !this.accessToken.includes('_here') &&
                           this.accessToken.length > 20;
                           
        return {
            enabled: this.enabled,
            configured: isConfigured,
            storeDomain: this.storeDomain || 'Not configured',
            lastSync: null // Will be updated when sync runs
        };
    }
}

module.exports = ShopifyService;