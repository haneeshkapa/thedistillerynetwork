#!/usr/bin/env node

/**
 * Debug script to check phone number lookup in Google Sheets
 * Run this to see why phone 9786778131 is not being found
 */

const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

async function debugPhoneLookup() {
    console.log('🔍 Debugging Phone Lookup for: 9786778131');
    console.log('='.repeat(50));
    
    // Check environment variables
    console.log('\n📋 Environment Check:');
    console.log('GOOGLE_SHEET_ID:', process.env.GOOGLE_SHEET_ID ? '✅ Set' : '❌ Missing');
    console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? '✅ Set' : '❌ Missing');
    console.log('GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
    
    if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
        console.error('❌ Missing required environment variables');
        return;
    }
    
    try {
        // Initialize Google Sheets
        console.log('\n🔗 Connecting to Google Sheets...');
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
        
        const creds = {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
        
        await doc.useServiceAccountAuth(creds);
        await doc.loadInfo();
        
        console.log('✅ Connected to sheet:', doc.title);
        console.log('📊 Total sheets:', doc.sheetCount);
        
        // Get first sheet
        const sheet = doc.sheetsByIndex[0];
        console.log('\n📄 Using sheet:', sheet.title);
        console.log('📏 Rows:', sheet.rowCount);
        console.log('📐 Columns:', sheet.columnCount);
        
        // Get all rows
        const rows = await sheet.getRows();
        console.log('✅ Loaded', rows.length, 'data rows');
        
        if (rows.length === 0) {
            console.log('❌ No data rows found in sheet');
            return;
        }
        
        // Show first row structure
        console.log('\n🗂️ Sheet Structure (First Row):');
        console.log('Headers:', Object.keys(rows[0]));
        console.log('Raw Data:', rows[0]._rawData);
        
        // Show column mapping
        console.log('\n📍 Column Mapping:');
        rows[0]._rawData.forEach((value, index) => {
            console.log(`Column ${index}: "${value}"`);
        });
        
        // Search for the specific phone number
        const targetPhone = '9786778131';
        const cleanTargetPhone = targetPhone.replace(/[\s\-\(\)]/g, '');
        
        console.log(`\n🔍 Searching for phone: ${targetPhone}`);
        console.log(`🧹 Cleaned target: ${cleanTargetPhone}`);
        
        let foundCustomer = null;
        let phoneMatches = [];
        
        rows.forEach((row, rowIndex) => {
            // Check all columns for phone numbers
            row._rawData.forEach((cellValue, colIndex) => {
                if (!cellValue) return;
                
                let phoneStr = cellValue.toString();
                
                // Convert scientific notation if needed
                if (phoneStr.includes('E+')) {
                    phoneStr = Number(cellValue).toString();
                }
                
                const cleanRowPhone = phoneStr.replace(/[\s\-\(\)\.]/g, '');
                
                // Check if this looks like a phone number and if it matches
                if (/^\d{10,}$/.test(cleanRowPhone)) {
                    phoneMatches.push({
                        row: rowIndex,
                        column: colIndex,
                        original: cellValue,
                        cleaned: cleanRowPhone,
                        matches: cleanRowPhone === cleanTargetPhone || 
                                cleanRowPhone.includes(cleanTargetPhone) || 
                                cleanTargetPhone.includes(cleanRowPhone)
                    });
                    
                    if (cleanRowPhone === cleanTargetPhone || 
                        cleanRowPhone.includes(cleanTargetPhone) || 
                        cleanTargetPhone.includes(cleanRowPhone)) {
                        foundCustomer = {
                            row: rowIndex,
                            data: row._rawData,
                            phoneColumn: colIndex,
                            phoneValue: cellValue
                        };
                    }
                }
            });
        });
        
        console.log(`\n📱 Found ${phoneMatches.length} phone numbers in sheet:`);
        phoneMatches.forEach(match => {
            console.log(`Row ${match.row}, Col ${match.column}: "${match.original}" -> "${match.cleaned}" ${match.matches ? '✅ MATCH' : ''}`);
        });
        
        if (foundCustomer) {
            console.log('\n🎉 Customer Found!');
            console.log('Row:', foundCustomer.row);
            console.log('Phone Column:', foundCustomer.phoneColumn);
            console.log('Phone Value:', foundCustomer.phoneValue);
            console.log('Full Row Data:', foundCustomer.data);
            
            // Show what the bot would extract
            console.log('\n🤖 Bot would extract:');
            console.log('Order ID (Col 0):', foundCustomer.data[0] || 'N/A');
            console.log('Product (Col 1):', foundCustomer.data[1] || 'N/A');
            console.log('Name (Col 2):', foundCustomer.data[2] || 'N/A');
            console.log('Created (Col 3):', foundCustomer.data[3] || 'N/A');
            console.log('Email (Col 5):', foundCustomer.data[5] || 'N/A');
            console.log('Phone (Col 6):', foundCustomer.data[6] || 'N/A');
            
        } else {
            console.log('\n❌ Customer NOT Found');
            console.log('Possible issues:');
            console.log('1. Phone number not in the sheet');
            console.log('2. Phone number in different format');
            console.log('3. Phone number in different column than expected (Column 6)');
            console.log('4. Phone number has extra characters/formatting');
            
            // Show all unique phone patterns found
            const uniquePhones = [...new Set(phoneMatches.map(m => m.cleaned))];
            console.log('\n📞 All phone numbers in sheet:');
            uniquePhones.forEach(phone => {
                console.log(`  ${phone}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the debug
debugPhoneLookup().catch(console.error);