#!/usr/bin/env node

const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

const CUSTOMER_PHONE = '5097073183';

// Normalize phone number function (copied from server.js)
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  
  let phoneStr = phone.toString();
  
  // Convert scientific notation to regular number if needed
  if (phoneStr.includes('E+')) {
    phoneStr = Number(phone).toString();
  }
  
  // Remove all non-digit characters
  return phoneStr.replace(/\D/g, '');
}

async function debugCustomerIssue() {
  console.log(`🔍 Debugging customer issue with phone: ${CUSTOMER_PHONE}`);
  
  try {
    console.log('📋 Environment check:');
    console.log(`- GOOGLE_SERVICE_ACCOUNT_EMAIL: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'Set' : 'Missing'}`);
    console.log(`- GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? 'Set (' + process.env.GOOGLE_PRIVATE_KEY.length + ' chars)' : 'Missing'}`);
    console.log(`- GOOGLE_SHEET_ID: ${process.env.GOOGLE_SHEET_ID ? 'Set' : 'Missing'}`);
    
    // Initialize Google Sheets connection (same as server.js)
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    
    const creds = {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
    
    console.log('🔐 Authenticating with Google Sheets...');
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    
    console.log('📊 Connected to Google Sheets:', doc.title);
    console.log('📋 Available sheets:', doc.sheetsByTitle);
    
    const sheet = doc.sheetsByIndex[0];
    console.log('📄 Current sheet title:', sheet.title);
    console.log('📊 Sheet properties:', {
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      gridProperties: sheet.gridProperties
    });
    
    // Check if there are other sheets that might contain color legend
    console.log('\n📋 All sheets in document:');
    doc.sheetsByIndex.forEach((sh, idx) => {
      console.log(`  Sheet ${idx}: "${sh.title}"`);
    });
    
    // Get headers first
    await sheet.loadHeaderRow(1);
    console.log('\n📋 Sheet headers:');
    sheet.headerValues.forEach((header, index) => {
      console.log(`  Column ${index}: "${header}"`);
    });
    
    const rows = await sheet.getRows();
    console.log(`\n📋 Total rows: ${rows.length}`);
    
    // Normalize the target phone
    const normalizedTargetPhone = normalizePhoneNumber(CUSTOMER_PHONE);
    console.log(`🎯 Looking for normalized phone: ${normalizedTargetPhone}`);
    
    // Find the customer
    const foundCustomer = rows.find((row, index) => {
      const phoneField = row._rawData[6]; // Column 6 should be phone
      
      if (!phoneField) return false;
      
      const normalizedRowPhone = normalizePhoneNumber(phoneField);
      
      console.log(`Row ${index}: Phone field: "${phoneField}" -> Normalized: "${normalizedRowPhone}"`);
      
      if (normalizedRowPhone === normalizedTargetPhone) {
        console.log(`✅ MATCH FOUND at row ${index}!`);
        return true;
      }
      
      return false;
    });
    
    if (foundCustomer) {
      console.log('\n🎉 Customer found!');
      console.log('Raw data:', foundCustomer._rawData);
      console.log('Customer name (column 2):', foundCustomer._rawData[2]);
      console.log('Order ID (column 0):', foundCustomer._rawData[0]);
      
      // Test what would happen in the AI prompt
      const customerName = foundCustomer._rawData?.[2] || 'Unknown';
      const orderId = foundCustomer._rawData?.[0] || 'No Order';
      
      console.log('\n📝 AI Prompt customer info would be:');
      console.log(`CUSTOMER INFO: ${customerName} (${orderId})`);
      
      // Check for any suspicious or malformed data
      console.log('\n🔍 Data validation:');
      foundCustomer._rawData.forEach((cell, index) => {
        if (cell && cell.length > 100) {
          console.log(`⚠️ Column ${index} has suspiciously long data: ${cell.length} chars`);
        }
        if (cell && typeof cell === 'string' && cell.includes('\n')) {
          console.log(`⚠️ Column ${index} contains newlines`);
        }
      });
      
    } else {
      console.log('❌ Customer not found');
      
      // Show all phone numbers in column 6 for debugging
      console.log('\n📱 All phone numbers in sheet:');
      rows.slice(0, 15).forEach((row, index) => {
        const phoneField = row._rawData[6];
        if (phoneField) {
          const normalized = normalizePhoneNumber(phoneField);
          console.log(`  Row ${index}: "${phoneField}" -> "${normalized}" ${normalized === normalizedTargetPhone ? '⭐ MATCH!' : ''}`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  debugCustomerIssue();
}