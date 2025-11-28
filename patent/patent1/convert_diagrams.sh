#!/bin/bash

# Convert all HTML Mermaid diagrams to PNG images
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

    # Convert HTML to PNG using Chrome headless
    "$CHROME" --headless --disable-gpu --screenshot="$output_file" \
        --window-size=1400,1000 \
        --default-background-color=0 \
        --hide-scrollbars \
        "file://$html_file" 2>/dev/null

    # Give it a moment to render
    sleep 1

    count=$((count + 1))
done

echo "Converted $count diagrams to PNG"
echo "Images saved in: $IMAGE_DIR"
