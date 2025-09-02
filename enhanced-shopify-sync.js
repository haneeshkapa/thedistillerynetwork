/**
 * Enhanced Shopify Sync
 * Syncs products with metafields, store policies, and website content
 */

const completeWebsiteSync = require('./complete-website-sync');

async function enhancedShopifySync(pool, SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN) {
  const fetch = (await import('node-fetch')).default;
  const syncResults = {
    products: 0,
    metafields: 0,
    policies: 0,
    pages: 0,
    errors: []
  };

  try {
    // 1. Remove old Shopify entries
    await pool.query("DELETE FROM knowledge WHERE source='shopify' OR source='shopify-meta' OR source='shopify-policy' OR source='shopify-page'");

    // 2. Sync Products with Metafields
    console.log('📦 Syncing products with metafields...');
    const productsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products.json?limit=250&fields=id,title,body_html,vendor,product_type,tags,handle,variants,images,options`;
    
    const productsResponse = await fetch(productsUrl, {
      headers: { 
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json"
      }
    });
    
    if (!productsResponse.ok) {
      throw new Error(`Shopify Products API returned status ${productsResponse.status}`);
    }
    
    const productsData = await productsResponse.json();
    const products = productsData.products || [];
    
    // Process each product
    for (let product of products) {
      const baseTitle = product.title;
      let baseContentText = "";
      
      // Build comprehensive product content
      if (product.body_html) {
        baseContentText = product.body_html.replace(/<[^>]+>/g, '');
      }
      
      // Add product type and vendor
      if (product.product_type) {
        baseContentText += `\nProduct Type: ${product.product_type}`;
      }
      if (product.vendor) {
        baseContentText += `\nManufacturer: ${product.vendor}`;
      }
      if (product.tags) {
        baseContentText += `\nTags: ${product.tags}`;
      }
      
      // Fetch metafields for this product
      try {
        const metafieldsUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/products/${product.id}/metafields.json`;
        const metaResponse = await fetch(metafieldsUrl, {
          headers: { 
            "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
            "Content-Type": "application/json"
          }
        });
        
        if (metaResponse.ok) {
          const metaData = await metaResponse.json();
          const metafields = metaData.metafields || [];
          
          // Add metafields to content
          for (let metafield of metafields) {
            if (metafield.key && metafield.value) {
              // Special handling for important metafields
              if (metafield.key.includes('shipping') || metafield.key.includes('lead_time') || metafield.key.includes('delivery')) {
                baseContentText += `\n${metafield.key}: ${metafield.value}`;
                
                // Also create a separate knowledge entry for shipping info
                await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
                  [`Shipping Info - ${baseTitle}`, `${metafield.key}: ${metafield.value}`, 'shopify-meta']);
                syncResults.metafields++;
              } else {
                baseContentText += `\n${metafield.key}: ${metafield.value}`;
              }
            }
          }
        }
      } catch (metaErr) {
        console.error(`Error fetching metafields for product ${product.id}:`, metaErr);
        syncResults.errors.push(`Metafields for product ${product.id}: ${metaErr.message}`);
      }
      
      // Insert product variants with enhanced content
      if (product.variants && product.variants.length > 0) {
        for (let variant of product.variants) {
          let variantTitle = baseTitle;
          let variantContent = baseContentText;
          
          // Add variant details
          if (variant.option1) {
            variantTitle += ` - ${variant.option1}`;
            variantContent += `\nSize/Option: ${variant.option1}`;
          }
          if (variant.option2) {
            variantTitle += ` ${variant.option2}`;
            variantContent += `\nOption 2: ${variant.option2}`;
          }
          if (variant.option3) {
            variantTitle += ` ${variant.option3}`;
            variantContent += `\nOption 3: ${variant.option3}`;
          }
          
          // Add pricing
          if (variant.price) {
            variantContent += `\nPrice: $${variant.price}`;
          }
          if (variant.compare_at_price) {
            variantContent += `\nOriginal Price: $${variant.compare_at_price}`;
          }
          
          // Add SKU and barcode
          if (variant.sku) {
            variantContent += `\nSKU: ${variant.sku}`;
          }
          if (variant.barcode) {
            variantContent += `\nBarcode: ${variant.barcode}`;
          }
          
          // Add inventory and fulfillment info
          if (variant.inventory_quantity !== null) {
            variantContent += `\nInventory: ${variant.inventory_quantity > 0 ? `${variant.inventory_quantity} in stock` : 'Out of Stock'}`;
          }
          if (variant.fulfillment_service) {
            variantContent += `\nFulfillment: ${variant.fulfillment_service}`;
          }
          if (variant.weight && variant.weight_unit) {
            variantContent += `\nWeight: ${variant.weight} ${variant.weight_unit}`;
          }
          
          await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
            [variantTitle, variantContent.trim(), 'shopify']);
          syncResults.products++;
        }
      } else {
        // No variants, insert base product
        await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
          [baseTitle, baseContentText.trim(), 'shopify']);
        syncResults.products++;
      }
    }
    
    // 3. Sync Store Policies
    console.log('📋 Syncing store policies...');
    const policiesUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/policies.json`;
    
    try {
      const policiesResponse = await fetch(policiesUrl, {
        headers: { 
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      });
      
      if (policiesResponse.ok) {
        const policiesData = await policiesResponse.json();
        const policies = policiesData.policies || [];
        
        for (let policy of policies) {
          if (policy.body && policy.title) {
            const policyContent = policy.body.replace(/<[^>]+>/g, '');
            await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
              [`Store Policy: ${policy.title}`, policyContent, 'shopify-policy']);
            syncResults.policies++;
          }
        }
      }
    } catch (policyErr) {
      console.error('Error fetching policies:', policyErr);
      syncResults.errors.push(`Policies: ${policyErr.message}`);
    }
    
    // 4. Sync Store Pages (About, FAQ, Shipping, etc.)
    console.log('📄 Syncing store pages...');
    const pagesUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/pages.json`;
    
    try {
      const pagesResponse = await fetch(pagesUrl, {
        headers: { 
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      });
      
      if (pagesResponse.ok) {
        const pagesData = await pagesResponse.json();
        const pages = pagesData.pages || [];
        
        for (let page of pages) {
          if (page.body_html && page.title) {
            const pageContent = page.body_html.replace(/<[^>]+>/g, '');
            await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
              [`Page: ${page.title}`, pageContent, 'shopify-page']);
            syncResults.pages++;
          }
        }
      }
    } catch (pageErr) {
      console.error('Error fetching pages:', pageErr);
      syncResults.errors.push(`Pages: ${pageErr.message}`);
    }
    
    // 5. Fetch store metafields (global store settings)
    console.log('🏪 Syncing store metafields...');
    const storeMetaUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/metafields.json?namespace=store`;
    
    try {
      const storeMetaResponse = await fetch(storeMetaUrl, {
        headers: { 
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      });
      
      if (storeMetaResponse.ok) {
        const storeMetaData = await storeMetaResponse.json();
        const storeMetafields = storeMetaData.metafields || [];
        
        let storeInfoContent = "";
        for (let metafield of storeMetafields) {
          if (metafield.key && metafield.value) {
            storeInfoContent += `${metafield.key}: ${metafield.value}\n`;
          }
        }
        
        if (storeInfoContent) {
          await pool.query('INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3)', 
            ['Store Information and Settings', storeInfoContent.trim(), 'shopify-meta']);
          syncResults.metafields++;
        }
      }
    } catch (storeMetaErr) {
      console.error('Error fetching store metafields:', storeMetaErr);
      syncResults.errors.push(`Store metafields: ${storeMetaErr.message}`);
    }
    
    // 6. Complete website sync - scrape ALL pages, blogs, collections
    console.log('🌐 Starting complete website content sync...');
    try {
      const websiteResults = await completeWebsiteSync(pool, SHOPIFY_STORE_DOMAIN);
      
      // Add website results to our sync results
      syncResults.pages += websiteResults.pages;
      syncResults.blogs = websiteResults.blogs;
      syncResults.collections = websiteResults.collections;
      syncResults.websiteContent = websiteResults.content;
      
      if (websiteResults.errors.length > 0) {
        syncResults.errors.push(...websiteResults.errors);
      }
      
      console.log(`✅ Website sync complete: ${websiteResults.content} total content entries`);
    } catch (webErr) {
      console.error('Error in complete website sync:', webErr);
      syncResults.errors.push(`Complete website sync: ${webErr.message}`);
    }
    
    return syncResults;
    
  } catch (err) {
    console.error('Enhanced Shopify sync failed:', err);
    throw err;
  }
}

module.exports = enhancedShopifySync;