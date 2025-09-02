/**
 * Complete Website Content Sync
 * Scrapes EVERYTHING from the website including blogs, all pages, collections, etc.
 */

const cheerio = require('cheerio');

async function completeWebsiteSync(pool, SHOPIFY_STORE_DOMAIN) {
  const fetch = (await import('node-fetch')).default;
  const syncResults = {
    pages: 0,
    blogs: 0,
    collections: 0,
    content: 0,
    errors: []
  };

  try {
    // Get the public website URL
    const websiteUrl = SHOPIFY_STORE_DOMAIN.includes('.myshopify.com') 
      ? `https://${SHOPIFY_STORE_DOMAIN.replace('.myshopify.com', '.com')}`
      : `https://${SHOPIFY_STORE_DOMAIN}`;
    
    console.log(`🌐 Syncing ALL content from ${websiteUrl}`);
    
    // Remove old website entries
    await pool.query("DELETE FROM knowledge WHERE source='website' OR source='website-blog' OR source='website-page'");
    
    // 1. Parse sitemap to get all URLs
    console.log('🗺️ Fetching sitemap...');
    const sitemapUrls = [];
    
    try {
      const sitemapResponse = await fetch(`${websiteUrl}/sitemap.xml`);
      if (sitemapResponse.ok) {
        const sitemapText = await sitemapResponse.text();
        const urlMatches = sitemapText.match(/<loc>(.*?)<\/loc>/g) || [];
        
        for (let match of urlMatches) {
          const url = match.replace(/<\/?loc>/g, '');
          sitemapUrls.push(url);
        }
        
        console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
      }
    } catch (err) {
      console.log('No sitemap found, will scrape main pages');
      syncResults.errors.push(`Sitemap: ${err.message}`);
    }
    
    // 2. If no sitemap, build URL list from common pages
    if (sitemapUrls.length === 0) {
      const commonPages = [
        '',
        '/pages/about',
        '/pages/about-us',
        '/pages/shipping',
        '/pages/shipping-policy',
        '/pages/return-policy',
        '/pages/refund-policy',
        '/pages/privacy-policy',
        '/pages/terms-of-service',
        '/pages/faq',
        '/pages/contact',
        '/pages/contact-us',
        '/blogs/news',
        '/blogs/blog',
        '/blogs/recipes',
        '/blogs/guides',
        '/collections',
        '/collections/all'
      ];
      
      for (let page of commonPages) {
        sitemapUrls.push(`${websiteUrl}${page}`);
      }
    }
    
    // 3. Scrape each URL
    console.log('📄 Scraping website pages...');
    for (let url of sitemapUrls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Get page title
        const title = $('title').text() || $('h1').first().text() || 'Untitled Page';
        
        // Determine content type
        let source = 'website-page';
        if (url.includes('/blogs/') || url.includes('/blog/')) {
          source = 'website-blog';
          syncResults.blogs++;
        } else if (url.includes('/collections/')) {
          source = 'website-collection';
          syncResults.collections++;
        } else {
          syncResults.pages++;
        }
        
        // Extract main content
        let content = '';
        
        // Try different content selectors
        const contentSelectors = [
          'main',
          'article',
          '.main-content',
          '.page-content',
          '.blog-content',
          '.article-content',
          '.content',
          '[role="main"]',
          '#content'
        ];
        
        for (let selector of contentSelectors) {
          const element = $(selector);
          if (element.length > 0) {
            content = element.text();
            break;
          }
        }
        
        // Fallback to body if no content found
        if (!content) {
          // Remove script and style tags
          $('script').remove();
          $('style').remove();
          $('header').remove();
          $('footer').remove();
          $('nav').remove();
          
          content = $('body').text();
        }
        
        // Clean up content
        content = content
          .replace(/\s+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        
        // Extract specific important information
        const importantInfo = [];
        
        // Look for shipping information
        const shippingPatterns = [
          /shipping.{0,50}(\d+[-\s]?\d+\s*(days?|weeks?|months?))/gi,
          /lead\s*time.{0,50}(\d+[-\s]?\d+\s*(days?|weeks?|months?))/gi,
          /delivery.{0,50}(\d+[-\s]?\d+\s*(days?|weeks?|months?))/gi,
          /ships?\s+in.{0,50}(\d+[-\s]?\d+\s*(days?|weeks?|months?))/gi
        ];
        
        for (let pattern of shippingPatterns) {
          const matches = content.match(pattern);
          if (matches) {
            importantInfo.push(...matches);
          }
        }
        
        // Look for price information
        const priceMatches = content.match(/\$\d+(\.\d{2})?/g);
        if (priceMatches && priceMatches.length > 0) {
          importantInfo.push(`Prices found: ${priceMatches.slice(0, 5).join(', ')}`);
        }
        
        // Look for product sizes
        const sizeMatches = content.match(/\d+\s*gallon/gi);
        if (sizeMatches && sizeMatches.length > 0) {
          const uniqueSizes = [...new Set(sizeMatches)];
          importantInfo.push(`Sizes mentioned: ${uniqueSizes.join(', ')}`);
        }
        
        // Create knowledge entry
        if (content && content.length > 50) {
          // Add main content
          let knowledgeContent = content.substring(0, 5000); // Limit to 5000 chars
          
          // Add important info summary
          if (importantInfo.length > 0) {
            knowledgeContent = `IMPORTANT INFO:\n${importantInfo.join('\n')}\n\nFULL CONTENT:\n${knowledgeContent}`;
          }
          
          await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
            [`${title} (${url.replace(websiteUrl, '')})`, knowledgeContent, source]);
          
          syncResults.content++;
        }
        
        // Special handling for blog posts - also extract individual articles
        if (url.includes('/blogs/') && !url.includes('/tagged/')) {
          const articleLinks = $('a[href*="/blogs/"][href*="/articles/"]');
          for (let i = 0; i < articleLinks.length && i < 20; i++) {
            const articleUrl = $(articleLinks[i]).attr('href');
            if (articleUrl && !sitemapUrls.includes(articleUrl)) {
              sitemapUrls.push(articleUrl.startsWith('http') ? articleUrl : `${websiteUrl}${articleUrl}`);
            }
          }
        }
        
        // Special handling for collections - extract product listings
        if (url.includes('/collections/')) {
          const productInfo = [];
          $('.product-item, .product-card, .grid-product').each((i, elem) => {
            const productTitle = $(elem).find('.product-title, .product-name, h3, h4').first().text().trim();
            const productPrice = $(elem).find('.price, .product-price').first().text().trim();
            if (productTitle) {
              productInfo.push(`${productTitle}${productPrice ? ` - ${productPrice}` : ''}`);
            }
          });
          
          if (productInfo.length > 0) {
            await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
              [`Collection Products: ${title}`, productInfo.join('\n'), 'website-collection']);
            syncResults.collections++;
          }
        }
        
      } catch (err) {
        console.error(`Error scraping ${url}:`, err.message);
        syncResults.errors.push(`${url}: ${err.message}`);
      }
      
      // Add small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 4. Fetch and parse robots.txt for additional URLs
    try {
      const robotsResponse = await fetch(`${websiteUrl}/robots.txt`);
      if (robotsResponse.ok) {
        const robotsText = await robotsResponse.text();
        const sitemapMatches = robotsText.match(/Sitemap:\s*(.*)/gi) || [];
        
        for (let match of sitemapMatches) {
          const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
          if (!sitemapUrl.includes('sitemap.xml')) {
            // Additional sitemaps like sitemap_products.xml, sitemap_pages.xml
            console.log(`Found additional sitemap: ${sitemapUrl}`);
            // Parse this sitemap too
            try {
              const additionalSitemapResponse = await fetch(sitemapUrl);
              if (additionalSitemapResponse.ok) {
                const sitemapText = await additionalSitemapResponse.text();
                const urlMatches = sitemapText.match(/<loc>(.*?)<\/loc>/g) || [];
                
                for (let match of urlMatches) {
                  const url = match.replace(/<\/?loc>/g, '');
                  if (!sitemapUrls.includes(url)) {
                    sitemapUrls.push(url);
                  }
                }
              }
            } catch (err) {
              console.error(`Error fetching additional sitemap ${sitemapUrl}:`, err);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching robots.txt:', err);
    }
    
    // 5. Add a comprehensive summary entry
    const summaryContent = `
Website Content Summary:
- Total pages scraped: ${syncResults.pages}
- Blog posts found: ${syncResults.blogs}
- Collections found: ${syncResults.collections}
- Total content entries: ${syncResults.content}
- Website URL: ${websiteUrl}
- Last synced: ${new Date().toISOString()}
    `.trim();
    
    await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
      ['Website Content Summary', summaryContent, 'website']);
    
    return syncResults;
    
  } catch (err) {
    console.error('Complete website sync failed:', err);
    throw err;
  }
}

module.exports = completeWebsiteSync;