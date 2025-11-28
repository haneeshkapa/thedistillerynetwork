#!/bin/bash

# Convert all HTML Mermaid diagrams to PNG images using Chrome headless with proper timing
DIAGRAM_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams"
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Create images directory
mkdir -p "$IMAGE_DIR"

# Counter
count=0

# Loop through all HTML files
for html_file in "$DIAGRAM_DIR"/*.html; do
    # Get filename without path and extension
    filename=$(basename "$html_file" .html)

    # Output PNG file
    output_file="$IMAGE_DIR/${filename}.png"

    echo "Converting: $filename"

    # Convert HTML to PNG using Chrome headless with longer timeout for Mermaid rendering
    "$CHROME" --headless \
        --disable-gpu \
        --disable-software-rasterizer \
        --screenshot="$output_file" \
        --window-size=1400,1000 \
        --virtual-time-budget=5000 \
        --run-all-compositor-stages-before-draw \
        "file://$html_file" > /dev/null 2>&1

    # Wait a moment
    sleep 2

    # Check if file was created
    if [ -f "$output_file" ]; then
        echo "  ✓ Created: $output_file"
        count=$((count + 1))
    else
        echo "  ✗ Failed: $filename"
    fi
done

echo ""
echo "Converted $count diagrams to PNG"
echo "Images saved in: $IMAGE_DIR"
