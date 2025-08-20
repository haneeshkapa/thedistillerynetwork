#!/usr/bin/env node

/**
 * Test the exact phone lookup logic for 9786778131
 */

const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

async function testPhoneLookup() {
    console.log('🧪 Testing Phone Lookup for: 9786778131');
    console.log('='.repeat(50));
    
    try {
        // Initialize Google Sheets - exact same code as server.js
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
        const creds = {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        
        console.log('✅ Connected to sheet:', doc.title);
        
        // Use exact same phone lookup logic as server.js
        async function findCustomerByPhone(phone) {
            try {
                const sheet = doc.sheetsByIndex[0]; // Use first sheet
                const rows = await sheet.getRows();
                
                console.log(`📊 Total rows in sheet: ${rows.length}`);
                
                // Clean phone number (remove spaces, dashes, parentheses)
                const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
                console.log(`🧹 Cleaned input phone: "${cleanPhone}"`);
                
                // Log first row to understand structure
                if (rows.length > 0) {
                    console.log('\n📋 Sheet structure:');
                    console.log('Headers:', Object.keys(rows[0]));
                    console.log('First row data:', rows[0]._rawData);
                }
                
                console.log('\n🔍 Searching through rows...');
                
                let matchFound = false;
                
                return rows.find((row, index) => {
                    // Phone is in position 6 (7th column) based on your data
                    const phoneField = row._rawData[6];
                    
                    // Debug info for each row
                    if (phoneField) {
                        console.log(`Row ${index}: Phone field = "${phoneField}" (type: ${typeof phoneField})`);
                    }
                    
                    if (!phoneField) return false;
                    
                    // Convert scientific notation to regular number if needed
                    let phoneStr = phoneField.toString();
                    if (phoneStr.includes('E+')) {
                        console.log(`  Converting scientific notation: ${phoneStr}`);
                        phoneStr = Number(phoneField).toString();
                        console.log(`  Converted to: ${phoneStr}`);
                    }
                    
                    const rowPhone = phoneStr.replace(/[\s\-\(\)\.]/g, '');
                    console.log(`  Cleaned row phone: "${rowPhone}"`);
                    
                    // Test all matching conditions
                    const exactMatch = rowPhone === cleanPhone;
                    const rowContainsClean = rowPhone.includes(cleanPhone);
                    const cleanContainsRow = cleanPhone.includes(rowPhone);
                    
                    console.log(`  Match tests: exact=${exactMatch}, rowContains=${rowContainsClean}, cleanContains=${cleanContainsRow}`);
                    
                    const isMatch = exactMatch || rowContainsClean || cleanContainsRow;
                    
                    if (isMatch) {
                        matchFound = true;
                        console.log(`  🎯 MATCH FOUND at row ${index}!`);
                        console.log(`  Full row data:`, row._rawData);
                    }
                    
                    return isMatch;
                });
            } catch (error) {
                console.error('Error finding customer:', error);
                return null;
            }
        }
        
        // Test with the exact phone number
        const targetPhone = '9786778131';
        console.log(`\n🔍 Looking up phone: ${targetPhone}`);
        
        const customer = await findCustomerByPhone(targetPhone);
        
        if (customer) {
            console.log('\n🎉 SUCCESS: Customer found!');
            console.log('Customer data:', customer._rawData);
            console.log('\n🤖 Bot would extract:');
            console.log('  Order ID:', customer._rawData[0]);
            console.log('  Product:', customer._rawData[1]);
            console.log('  Name:', customer._rawData[2]);
            console.log('  Created:', customer._rawData[3]);
            console.log('  Email:', customer._rawData[5]);
            console.log('  Phone:', customer._rawData[6]);
        } else {
            console.log('\n❌ FAILURE: Customer not found');
            console.log('This explains why the bot ignores this number');
        }
        
        // Also test with different formats
        console.log('\n🧪 Testing different phone formats:');
        const formats = [
            '9786778131',
            '(978) 677-8131',
            '978-677-8131',
            '+19786778131',
            '1-978-677-8131'
        ];
        
        for (const format of formats) {
            const result = await findCustomerByPhone(format);
            console.log(`  ${format}: ${result ? '✅ Found' : '❌ Not found'}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testPhoneLookup().catch(console.error);