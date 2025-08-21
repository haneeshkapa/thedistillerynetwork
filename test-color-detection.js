#!/usr/bin/env node

const { GoogleSpreadsheet } = require('google-spreadsheet');
require('dotenv').config();

const TEST_PHONE = '9786778131';

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const phoneStr = phone.toString();
  const digitsOnly = phoneStr.replace(/\D/g, '');
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return digitsOnly.substring(1);
  }
  return digitsOnly;
}

async function testColorDetection() {
  console.log(`🎨 Testing color detection for phone: ${TEST_PHONE}`);
  
  try {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey
    });
    
    await doc.loadInfo();
    console.log(`✅ Connected to sheet: ${doc.title}`);
    
    const sheet = doc.sheetsByIndex[0];
    console.log(`📄 Sheet: ${sheet.title}`);
    
    // Get all rows first
    const rows = await sheet.getRows();
    const normalizedInputPhone = normalizePhoneNumber(TEST_PHONE);
    
    console.log(`🔍 Looking for phone: ${TEST_PHONE} -> normalized: ${normalizedInputPhone}`);
    
    let foundCustomer = null;
    let rowIndex = -1;
    
    rows.forEach((row, index) => {
      const phoneField = row._rawData[6]; // Phone in column 6
      if (!phoneField) return;
      
      const normalizedRowPhone = normalizePhoneNumber(phoneField);
      
      if (normalizedRowPhone === normalizedInputPhone) {
        console.log(`✅ FOUND CUSTOMER at row ${index}:`);
        console.log(`   Name: ${row._rawData[2]}`);
        console.log(`   Product: ${row._rawData[3]}`);
        console.log(`   Status: ${row._rawData[4]}`);
        console.log(`   Raw data:`, row._rawData);
        foundCustomer = row;
        rowIndex = index + 1; // Google Sheets is 1-indexed
      }
    });
    
    if (!foundCustomer) {
      console.log('❌ Customer not found');
      return;
    }
    
    // Now test color detection
    console.log('\n🎨 Testing color detection...');
    
    // Load cells with formatting
    await sheet.loadCells();
    console.log('✅ Cells loaded');
    
    // Try to get the status cell (column 4, 0-indexed)
    const statusCell = sheet.getCell(rowIndex, 4);
    
    console.log('📱 Status cell info:');
    console.log(`   Value: ${statusCell.value}`);
    console.log(`   Formatted value: ${statusCell.formattedValue}`);
    console.log(`   Background color:`, statusCell.backgroundColor);
    console.log(`   Text format:`, statusCell.textFormat);
    
    if (statusCell.backgroundColor) {
      const bg = statusCell.backgroundColor;
      console.log(`   RGB values: R=${bg.red}, G=${bg.green}, B=${bg.blue}`);
      
      // Test color mapping (normalize undefined values)
      const red = bg.red || 0;
      const green = bg.green || 0;
      const blue = bg.blue || 0;
      
      console.log(`   Normalized RGB: R=${red}, G=${green}, B=${blue}`);
      
      let statusDescription = "Unknown";
      if (red > 0.9 && green < 0.3 && blue < 0.3) {
        statusDescription = "Customer wants to cancel (RED)";
      } else if (red < 0.3 && green > 0.7 && blue < 0.3) {
        statusDescription = "Shipped (GREEN)";
      } else if (red > 0.8 && green > 0.8 && blue < 0.3) {
        statusDescription = "In process (YELLOW/ORANGE)";
      } else if (red < 0.3 && green > 0.5 && blue > 0.7) {
        statusDescription = "Need to call for update (LIGHT BLUE)";
      } else if (red < 0.3 && green < 0.3 && blue > 0.7) {
        statusDescription = "Priority customer (DARK BLUE)";
      } else {
        statusDescription = "Order received (WHITE/DEFAULT)";
      }
      
      console.log(`🎯 Detected status: ${statusDescription}`);
    } else {
      console.log('⚠️ No background color detected');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testColorDetection().catch(console.error);