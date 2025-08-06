# Google Sheets API Setup Guide

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "New Project" or select existing project
3. Give it a name like "Claude SMS Bot"

## Step 2: Enable APIs

1. In your project dashboard, go to "APIs & Services" → "Library"
2. Search and enable:
   - **Google Sheets API**
   - **Google Drive API**

## Step 3: Create Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill details:
   - Name: `claude-sms-bot`
   - Description: `Service account for Claude SMS automation`
4. Click "Create and Continue"
5. Skip role assignment (click "Continue")
6. Click "Done"

## Step 4: Generate Private Key

1. Click on your newly created service account
2. Go to "Keys" tab
3. Click "Add Key" → "Create New Key"
4. Select "JSON" format
5. Download the JSON file (keep it secure!)

## Step 5: Set Up Your Google Sheet

1. Create a new Google Sheet
2. Set up columns like this:

| Name | Phone | OrderID | Product | Status | DeliveryDate | Notes |
|------|--------|---------|---------|--------|--------------|-------|
| John Doe | +1234567890 | #1001 | 10 Gallon Kit | Shipped | 2025-08-10 | Express delivery |
| Jane Smith | +1987654321 | #1002 | 5 Gallon Kit | Processing | 2025-08-12 | Standard shipping |

3. **Share the sheet with your service account:**
   - Click "Share" button
   - Add the service account email (from JSON file: `client_email`)
   - Give "Editor" permissions

## Step 6: Get Sheet ID

From your Google Sheet URL:
`https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

Copy the `SHEET_ID_HERE` part.

## Step 7: Configure Environment Variables

From your downloaded JSON file, extract:
- `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `private_key` → `GOOGLE_PRIVATE_KEY`

Create `.env` file:
```env
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"
ANTHROPIC_API_KEY=your_claude_api_key
PORT=3000
```

## Column Mapping

The server supports flexible column names:
- **Name**: `Name`, `name`
- **Phone**: `Phone`, `phone`  
- **Order ID**: `OrderID`, `Order ID`, `orderid`
- **Product**: `Product`, `product`
- **Status**: `Status`, `status`
- **Delivery Date**: `DeliveryDate`, `Delivery Date`, `deliverydate`
- **Notes**: `Notes`, `notes`

## Testing Sheet Connection

Run this endpoint to test:
```bash
curl http://localhost:3000/customer/1234567890
```

Should return customer data if found in your sheet.