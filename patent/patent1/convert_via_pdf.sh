#!/bin/bash

# Convert HTML diagrams to PDF first (auto-sizes to content), then PDF to high-quality JPG
DIAGRAM_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams"
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"
PDF_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/temp_pdfs"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Create directories
mkdir -p "$IMAGE_DIR"
mkdir -p "$PDF_DIR"

echo "Converting diagrams via PDF (auto-sizing to content)..."
echo ""

count=0

# Step 1: Convert HTML to PDF (auto-sizes to content)
for html_file in "$DIAGRAM_DIR"/*.html; do
    filename=$(basename "$html_file" .html)
    pdf_file="$PDF_DIR/${filename}.pdf"

    echo "Converting $filename to PDF..."

    "$CHROME" --headless \
        --disable-gpu \
        --print-to-pdf="$pdf_file" \
        --print-to-pdf-no-header \
        --no-pdf-header-footer \
        --virtual-time-budget=5000 \
        "file://$html_file" > /dev/null 2>&1

    sleep 1

    if [ -f "$pdf_file" ]; then
        echo "  ✓ Created PDF: $filename.pdf"
        ((count++))
    else
        echo "  ✗ Failed to create PDF: $filename"
    fi
done

echo ""
echo "✓ Created $count PDFs"
echo ""

# Step 2: Convert PDFs to high-quality JPGs using sips
echo "Converting PDFs to JPG images..."
echo ""

jpg_count=0

for pdf_file in "$PDF_DIR"/*.pdf; do
    filename=$(basename "$pdf_file" .pdf)
    jpg_file="$IMAGE_DIR/${filename}.jpg"

    echo "Converting $filename to JPG..."

    # Convert PDF to JPG with sips (built-in macOS tool)
    /usr/bin/sips -s format jpeg -s formatOptions 95 "$pdf_file" --out "$jpg_file" > /dev/null 2>&1

    if [ -f "$jpg_file" ]; then
        # Get dimensions
        width=$(/usr/bin/sips -g pixelWidth "$jpg_file" | grep pixelWidth | awk '{print $2}')
        height=$(/usr/bin/sips -g pixelHeight "$jpg_file" | grep pixelHeight | awk '{print $2}')

        echo "  ✓ Created: ${filename}.jpg (${width}x${height})"
        ((jpg_count++))
    else
        echo "  ✗ Failed: $filename"
    fi
done

echo ""
echo "✓ Converted $jpg_count diagrams to JPG"
echo "Images saved in: $IMAGE_DIR"
echo ""

# Clean up temp PDFs
echo "Cleaning up temporary PDF files..."
rm -rf "$PDF_DIR"

echo "✓ Done!"
