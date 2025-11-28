const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DIAGRAM_DIR = '/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams';
const IMAGE_DIR = '/Users/haneeshkapa/chatbotp2/patent/patent1/images';

// Create images directory if it doesn't exist
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

async function convertDiagram(browser, htmlFile) {
    const filename = path.basename(htmlFile, '.html');
    const outputFile = path.join(IMAGE_DIR, `${filename}.jpg`);

    console.log(`Converting: ${filename}`);

    const page = await browser.newPage();

    // Set viewport to a reasonable width
    await page.setViewport({ width: 1600, height: 1200 });

    // Load the HTML file
    await page.goto(`file://${htmlFile}`, {
        waitUntil: 'networkidle0',
        timeout: 30000
    });

    // Wait for Mermaid to render
    await page.waitForTimeout(3000);

    // Get the actual content height
    const dimensions = await page.evaluate(() => {
        const body = document.body;
        const html = document.documentElement;

        const height = Math.max(
            body.scrollHeight,
            body.offsetHeight,
            html.clientHeight,
            html.scrollHeight,
            html.offsetHeight
        );

        return {
            width: 1600,
            height: height + 100 // Add padding
        };
    });

    // Set viewport to full content size
    await page.setViewport(dimensions);

    // Wait a bit more for re-render
    await page.waitForTimeout(1000);

    // Take screenshot of full page
    await page.screenshot({
        path: outputFile,
        type: 'jpeg',
        quality: 95,
        fullPage: true
    });

    await page.close();

    console.log(`  ✓ Created: ${filename}.jpg (${dimensions.width}x${dimensions.height})`);
}

async function main() {
    console.log('Starting diagram conversion...\n');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Get all HTML files
    const files = fs.readdirSync(DIAGRAM_DIR)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(DIAGRAM_DIR, f))
        .sort();

    console.log(`Found ${files.length} diagrams to convert\n`);

    let count = 0;
    for (const file of files) {
        try {
            await convertDiagram(browser, file);
            count++;
        } catch (error) {
            console.error(`  ✗ Failed: ${path.basename(file)} - ${error.message}`);
        }
    }

    await browser.close();

    console.log(`\n✓ Converted ${count}/${files.length} diagrams successfully`);
    console.log(`Images saved in: ${IMAGE_DIR}`);
}

main().catch(console.error);
