const { google } = require('googleapis');

class EnhancedSheetsService {
    constructor() {
        this.serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        this.privateKey = process.env.GOOGLE_PRIVATE_KEY;
        this.spreadsheetId = process.env.GOOGLE_SHEET_ID;
        
        if (!this.serviceAccountEmail || !this.privateKey || !this.spreadsheetId) {
            console.warn('Enhanced Google Sheets credentials not configured');
            this.enabled = false;
            return;
        }
        
        this.enabled = true;
        this.setupAuth();
    }

    setupAuth() {
        try {
            this.auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: this.serviceAccountEmail,
                    private_key: this.privateKey.replace(/\\n/g, '\n')
                },
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
            });
            
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            console.log('✅ Enhanced Google Sheets service initialized');
        } catch (error) {
            console.error('❌ Enhanced Google Sheets setup failed:', error.message);
            this.enabled = false;
        }
    }

    // Convert RGB color object to hex
    rgbToHex(rgb) {
        if (!rgb || (rgb.red === undefined && rgb.green === undefined && rgb.blue === undefined)) {
            return null;
        }
        
        const r = Math.round((rgb.red || 0) * 255);
        const g = Math.round((rgb.green || 0) * 255);
        const b = Math.round((rgb.blue || 0) * 255);
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // Get sheet data with formatting
    async getSheetWithFormatting(sheetName = null) {
        if (!this.enabled) {
            throw new Error('Enhanced Google Sheets service not enabled');
        }

        try {
            // First, get basic spreadsheet info
            const spreadsheetResponse = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId,
                includeGridData: true
            });

            const spreadsheet = spreadsheetResponse.data;
            const sheets = spreadsheet.sheets;
            
            // Find the target sheet (use first sheet if no name specified)
            let targetSheet;
            if (sheetName) {
                targetSheet = sheets.find(sheet => sheet.properties.title === sheetName);
                if (!targetSheet) {
                    throw new Error(`Sheet "${sheetName}" not found`);
                }
            } else {
                targetSheet = sheets[0]; // Use first sheet
            }

            const sheetData = {
                title: targetSheet.properties.title,
                sheetId: targetSheet.properties.sheetId,
                gridProperties: targetSheet.properties.gridProperties,
                tabColor: this.rgbToHex(targetSheet.properties.tabColor),
                data: []
            };

            // Process grid data with formatting
            if (targetSheet.data && targetSheet.data[0] && targetSheet.data[0].rowData) {
                const rows = targetSheet.data[0].rowData;
                
                rows.forEach((row, rowIndex) => {
                    const rowData = {
                        rowIndex: rowIndex,
                        cells: []
                    };

                    if (row.values) {
                        row.values.forEach((cell, colIndex) => {
                            const cellData = {
                                colIndex: colIndex,
                                value: this.getCellValue(cell),
                                formatting: this.getCellFormatting(cell)
                            };
                            rowData.cells.push(cellData);
                        });
                    }
                    
                    sheetData.data.push(rowData);
                });
            }

            return sheetData;
            
        } catch (error) {
            console.error('Error fetching sheet with formatting:', error);
            throw error;
        }
    }

    // Extract cell value
    getCellValue(cell) {
        if (!cell) return '';
        
        const effectiveValue = cell.effectiveValue;
        if (!effectiveValue) return '';
        
        if (effectiveValue.stringValue !== undefined) return effectiveValue.stringValue;
        if (effectiveValue.numberValue !== undefined) return effectiveValue.numberValue;
        if (effectiveValue.boolValue !== undefined) return effectiveValue.boolValue;
        if (effectiveValue.formulaValue !== undefined) return effectiveValue.formulaValue;
        
        return '';
    }

    // Extract cell formatting
    getCellFormatting(cell) {
        if (!cell || !cell.effectiveFormat) {
            return null;
        }

        const format = cell.effectiveFormat;
        const formatting = {};

        // Background color
        if (format.backgroundColor) {
            formatting.backgroundColor = this.rgbToHex(format.backgroundColor);
        }

        // Text format
        if (format.textFormat) {
            const textFormat = format.textFormat;
            
            if (textFormat.foregroundColor) {
                formatting.textColor = this.rgbToHex(textFormat.foregroundColor);
            }
            
            if (textFormat.fontSize) {
                formatting.fontSize = textFormat.fontSize;
            }
            
            if (textFormat.fontFamily) {
                formatting.fontFamily = textFormat.fontFamily;
            }
            
            if (textFormat.bold) {
                formatting.bold = textFormat.bold;
            }
            
            if (textFormat.italic) {
                formatting.italic = textFormat.italic;
            }
            
            if (textFormat.underline) {
                formatting.underline = textFormat.underline;
            }
            
            if (textFormat.strikethrough) {
                formatting.strikethrough = textFormat.strikethrough;
            }
        }

        // Borders
        if (format.borders) {
            formatting.borders = {};
            
            ['top', 'bottom', 'left', 'right'].forEach(side => {
                const border = format.borders[side];
                if (border && border.style !== 'NONE') {
                    formatting.borders[side] = {
                        style: border.style,
                        color: border.color ? this.rgbToHex(border.color) : null,
                        width: border.width || 1
                    };
                }
            });
        }

        // Number format
        if (format.numberFormat) {
            formatting.numberFormat = {
                type: format.numberFormat.type,
                pattern: format.numberFormat.pattern
            };
        }

        // Horizontal alignment
        if (format.horizontalAlignment) {
            formatting.horizontalAlignment = format.horizontalAlignment;
        }

        // Vertical alignment  
        if (format.verticalAlignment) {
            formatting.verticalAlignment = format.verticalAlignment;
        }

        // Text wrap
        if (format.wrapStrategy) {
            formatting.wrapStrategy = format.wrapStrategy;
        }

        return Object.keys(formatting).length > 0 ? formatting : null;
    }

    // Get all sheets info
    async getSheetsInfo() {
        if (!this.enabled) {
            throw new Error('Enhanced Google Sheets service not enabled');
        }

        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId
            });

            const spreadsheet = response.data;
            
            return {
                title: spreadsheet.properties.title,
                locale: spreadsheet.properties.locale,
                timeZone: spreadsheet.properties.timeZone,
                sheets: spreadsheet.sheets.map(sheet => ({
                    title: sheet.properties.title,
                    sheetId: sheet.properties.sheetId,
                    index: sheet.properties.index,
                    sheetType: sheet.properties.sheetType,
                    gridProperties: sheet.properties.gridProperties,
                    tabColor: this.rgbToHex(sheet.properties.tabColor),
                    hidden: sheet.properties.hidden || false,
                    rightToLeft: sheet.properties.rightToLeft || false
                }))
            };
            
        } catch (error) {
            console.error('Error fetching sheets info:', error);
            throw error;
        }
    }

    // Generate formatting summary
    generateFormattingSummary(sheetData) {
        const summary = {
            sheetTitle: sheetData.title,
            tabColor: sheetData.tabColor,
            totalRows: sheetData.data.length,
            totalCells: 0,
            formattedCells: 0,
            colors: {
                backgrounds: new Set(),
                texts: new Set()
            },
            fonts: new Set(),
            formatting: {
                bold: 0,
                italic: 0,
                underline: 0,
                borders: 0
            }
        };

        // Analyze all cells
        sheetData.data.forEach(row => {
            row.cells.forEach(cell => {
                summary.totalCells++;
                
                if (cell.formatting) {
                    summary.formattedCells++;
                    
                    if (cell.formatting.backgroundColor) {
                        summary.colors.backgrounds.add(cell.formatting.backgroundColor);
                    }
                    
                    if (cell.formatting.textColor) {
                        summary.colors.texts.add(cell.formatting.textColor);
                    }
                    
                    if (cell.formatting.fontFamily) {
                        summary.fonts.add(cell.formatting.fontFamily);
                    }
                    
                    if (cell.formatting.bold) summary.formatting.bold++;
                    if (cell.formatting.italic) summary.formatting.italic++;
                    if (cell.formatting.underline) summary.formatting.underline++;
                    if (cell.formatting.borders) summary.formatting.borders++;
                }
            });
        });

        // Convert sets to arrays
        summary.colors.backgrounds = Array.from(summary.colors.backgrounds);
        summary.colors.texts = Array.from(summary.colors.texts);
        summary.fonts = Array.from(summary.fonts);

        return summary;
    }

    // Color code interpretation for order status
    getColorStatusMapping() {
        return {
            '#ffffff': { status: 'new_order', label: 'Order Received', priority: 'normal', action: 'none' },
            '#add8e6': { status: 'call_for_update', label: 'Call for Update', priority: 'medium', action: 'call' },
            '#lightblue': { status: 'call_for_update', label: 'Call for Update', priority: 'medium', action: 'call' },
            '#ff0000': { status: 'wants_cancel', label: 'Wants to Cancel', priority: 'high', action: 'urgent' },
            '#red': { status: 'wants_cancel', label: 'Wants to Cancel', priority: 'high', action: 'urgent' },
            '#da70d6': { status: 'important_antsy', label: 'Important & Antsy', priority: 'high', action: 'immediate' },
            '#orchid': { status: 'important_antsy', label: 'Important & Antsy', priority: 'high', action: 'immediate' },
            '#ffff00': { status: 'in_process', label: 'In Process', priority: 'normal', action: 'update' },
            '#ffa500': { status: 'in_process', label: 'In Process', priority: 'normal', action: 'update' },
            '#yellow': { status: 'in_process', label: 'In Process', priority: 'normal', action: 'update' },
            '#orange': { status: 'in_process', label: 'In Process', priority: 'normal', action: 'update' },
            '#00ff00': { status: 'shipped', label: 'Shipped', priority: 'low', action: 'tracking' },
            '#green': { status: 'shipped', label: 'Shipped', priority: 'low', action: 'tracking' }
        };
    }

    // Interpret color to order status
    interpretColorStatus(color) {
        if (!color) return { status: 'unknown', label: 'Unknown Status', priority: 'normal', action: 'none' };
        
        const colorMapping = this.getColorStatusMapping();
        const normalizedColor = color.toLowerCase();
        
        // Direct match
        if (colorMapping[normalizedColor]) {
            return colorMapping[normalizedColor];
        }
        
        // Fuzzy matching for common color variations
        if (normalizedColor.includes('white') || normalizedColor === '#ffffff' || normalizedColor === '#fff') {
            return colorMapping['#ffffff'];
        }
        if (normalizedColor.includes('blue') || normalizedColor.includes('add8e6')) {
            return colorMapping['#add8e6'];
        }
        if (normalizedColor.includes('red') || normalizedColor.includes('ff0000')) {
            return colorMapping['#ff0000'];
        }
        if (normalizedColor.includes('purple') || normalizedColor.includes('pink') || normalizedColor.includes('da70d6') || normalizedColor.includes('orchid')) {
            return colorMapping['#da70d6'];
        }
        if (normalizedColor.includes('yellow') || normalizedColor.includes('orange') || normalizedColor.includes('ffff00') || normalizedColor.includes('ffa500')) {
            return colorMapping['#ffff00'];
        }
        if (normalizedColor.includes('green') || normalizedColor.includes('00ff00')) {
            return colorMapping['#00ff00'];
        }
        
        return { status: 'unknown', label: 'Unknown Status', priority: 'normal', action: 'none' };
    }

    // Enhanced sheet analysis with order status detection
    async getSheetWithOrderStatus(sheetName = null) {
        const sheetData = await this.getSheetWithFormatting(sheetName);
        
        // Add order status interpretation to each row
        sheetData.data.forEach((row, rowIndex) => {
            // Assume first few columns contain order info (phone, name, order details)
            // Look for background colors to determine status
            let rowStatus = { status: 'unknown', label: 'Unknown Status', priority: 'normal', action: 'none' };
            let statusColor = null;
            
            // Check cells in the row for background colors
            row.cells.forEach(cell => {
                if (cell.formatting && cell.formatting.backgroundColor) {
                    const colorStatus = this.interpretColorStatus(cell.formatting.backgroundColor);
                    if (colorStatus.status !== 'unknown') {
                        rowStatus = colorStatus;
                        statusColor = cell.formatting.backgroundColor;
                    }
                }
            });
            
            row.orderStatus = rowStatus;
            row.statusColor = statusColor;
        });
        
        return sheetData;
    }

    // Generate status-aware summary
    generateStatusSummary(sheetData) {
        const statusCounts = {};
        const colorMapping = this.getColorStatusMapping();
        
        // Initialize counts
        Object.values(colorMapping).forEach(status => {
            if (!statusCounts[status.status]) {
                statusCounts[status.status] = { ...status, count: 0, rows: [] };
            }
        });
        statusCounts['unknown'] = { status: 'unknown', label: 'Unknown Status', priority: 'normal', action: 'none', count: 0, rows: [] };
        
        // Count statuses
        sheetData.data.forEach((row, index) => {
            const status = row.orderStatus ? row.orderStatus.status : 'unknown';
            if (statusCounts[status]) {
                statusCounts[status].count++;
                statusCounts[status].rows.push(index + 1); // 1-based row numbering
            }
        });
        
        return {
            sheetTitle: sheetData.title,
            totalRows: sheetData.data.length,
            statusBreakdown: statusCounts,
            urgentCount: statusCounts.wants_cancel.count + statusCounts.important_antsy.count,
            completedCount: statusCounts.shipped.count,
            activeCount: statusCounts.new_order.count + statusCounts.call_for_update.count + statusCounts.in_process.count
        };
    }

    // Get customer order status by phone number
    findCustomerStatus(sheetData, phoneNumber) {
        if (!phoneNumber) return null;
        
        // Clean phone number for comparison
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        for (let rowIndex = 0; rowIndex < sheetData.data.length; rowIndex++) {
            const row = sheetData.data[rowIndex];
            
            // Check first few cells for phone number (adjust column index as needed)
            for (let cellIndex = 0; cellIndex < Math.min(5, row.cells.length); cellIndex++) {
                const cell = row.cells[cellIndex];
                if (cell && cell.value) {
                    const cellValue = String(cell.value).replace(/\D/g, '');
                    if (cellValue.includes(cleanPhone) || cleanPhone.includes(cellValue)) {
                        return {
                            rowNumber: rowIndex + 1,
                            phoneNumber: phoneNumber,
                            status: row.orderStatus,
                            statusColor: row.statusColor,
                            rowData: row.cells.map(c => c.value).filter(Boolean)
                        };
                    }
                }
            }
        }
        
        return null;
    }

    // Get status
    getStatus() {
        return {
            enabled: this.enabled,
            configured: !!(this.serviceAccountEmail && this.privateKey && this.spreadsheetId),
            spreadsheetId: this.spreadsheetId || 'Not configured',
            colorMapping: this.getColorStatusMapping()
        };
    }
}

module.exports = EnhancedSheetsService;