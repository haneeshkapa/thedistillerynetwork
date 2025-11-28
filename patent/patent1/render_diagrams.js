#!/usr/bin/env node

/**
 * Convert Mermaid HTML diagrams to high-quality JPG images
 * Waits for actual Mermaid rendering before capturing
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIAGRAM_DIR = '/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams';
const IMAGE_DIR = '/Users/haneeshkapa/chatbotp2/patent/patent1/images';
const TEMP_HTML_DIR = '/Users/haneeshkapa/chatbotp2/patent/patent1/temp_html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Create directories
if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_HTML_DIR)) {
    fs.mkdirSync(TEMP_HTML_DIR, { recursive: true });
}

// Enhanced HTML template that waits for Mermaid to render
function createEnhancedHTML(originalHTML) {
    // Add script to wait for Mermaid and signal when ready
    const enhancedHTML = originalHTML.replace('</body>', `
    <script>
        // Wait for Mermaid to finish rendering
        window.addEventListener('load', function() {
            setTimeout(function() {
                // Check if Mermaid rendered
                const svg = document.querySelector('svg');
                if (svg) {
                    console.log('Mermaid rendered successfully');
                    document.body.setAttribute('data-rendered', 'true');
                } else {
                    console.error('Mermaid did not render');
                }
            }, 3000); // Wait 3 seconds for Mermaid to render
        });
    </script>
</body>`);

    return enhancedHTML;
}

function convertDiagram(htmlFile) {
    const filename = path.basename(htmlFile, '.html');
    const tempHTMLPath = path.join(TEMP_HTML_DIR, `${filename}.html`);
    const outputJPG = path.join(IMAGE_DIR, `${filename}.jpg`);

    console.log(`Converting: ${filename}`);

    try {
        // Read original HTML
        const originalHTML = fs.readFileSync(htmlFile, 'utf8');

        // Create enhanced HTML
        const enhancedHTML = createEnhancedHTML(originalHTML);
        fs.writeFileSync(tempHTMLPath, enhancedHTML);

        // Take screenshot with Chrome - use reasonable dimensions
        const cmd = `"${CHROME}" --headless --disable-gpu --screenshot="${outputJPG}" --window-size=1600,2400 --default-background-color=0 --hide-scrollbars --disable-web-security --allow-file-access-from-files --virtual-time-budget=10000 "file://${tempHTMLPath}"`;

        execSync(cmd, { stdio: 'pipe', timeout: 15000 });

        // Wait a moment
        execSync('sleep 2');

        // Check if file was created and get dimensions
        if (fs.existsSync(outputJPG)) {
            const sipsOutput = execSync(`/usr/bin/sips -g pixelWidth -g pixelHeight "${outputJPG}"`, { encoding: 'utf8' });
            const width = sipsOutput.match(/pixelWidth: (\d+)/)?.[1] || '?';
            const height = sipsOutput.match(/pixelHeight: (\d+)/)?.[1] || '?';

            console.log(`  ✓ Created: ${filename}.jpg (${width}x${height})`);
            return true;
        } else {
            console.log(`  ✗ Failed: ${filename}`);
            return false;
        }

    } catch (error) {
        console.log(`  ✗ Error: ${filename} - ${error.message}`);
        return false;
    }
}

function main() {
    console.log('Converting Mermaid diagrams to JPG with proper rendering...\n');

    // Get all HTML files
    const files = fs.readdirSync(DIAGRAM_DIR)
        .filter(f => f.endsWith('.html'))
        .sort();

    console.log(`Found ${files.length} diagrams\n`);

    let success = 0;
    for (const file of files) {
        const fullPath = path.join(DIAGRAM_DIR, file);
        if (convertDiagram(fullPath)) {
            success++;
        }
    }

    // Cleanup temp files
    console.log('\nCleaning up temporary files...');
    fs.rmSync(TEMP_HTML_DIR, { recursive: true, force: true });

    console.log(`\n✓ Successfully converted ${success}/${files.length} diagrams`);
    console.log(`Images saved in: ${IMAGE_DIR}`);
}

main();
