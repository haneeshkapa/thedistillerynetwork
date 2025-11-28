#!/bin/bash

# Use macOS screencapture with Chrome to capture full diagrams
DIAGRAM_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams"
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"

mkdir -p "$IMAGE_DIR"

echo "This script will open each diagram in Chrome and you need to:"
echo "1. Wait for the diagram to fully render (2-3 seconds)"
echo "2. Press ENTER to take a screenshot"
echo "3. The script will automatically capture and save the image"
echo ""
echo "Ready to start? Press ENTER..."
read

count=0

for html_file in "$DIAGRAM_DIR"/*.html; do
    filename=$(basename "$html_file" .html)
    output_jpg="$IMAGE_DIR/${filename}.jpg"

    echo ""
    echo "=== $filename ==="
    echo "Opening in Chrome..."

    # Open in Chrome
    open -a "Google Chrome" "file://$html_file"

    # Wait for Chrome to load
    sleep 4

    echo "Press ENTER when diagram is fully rendered..."
    read

    # Take screenshot of front window
    screencapture -o -x -w -t png "/tmp/${filename}.png"

    # Convert to JPG
    /usr/bin/sips -s format jpeg -s formatOptions 95 "/tmp/${filename}.png" --out "$output_jpg" > /dev/null 2>&1

    # Clean up temp
    rm "/tmp/${filename}.png"

    # Get dimensions
    width=$(/usr/bin/sips -g pixelWidth "$output_jpg" | grep pixelWidth | awk '{print $2}')
    height=$(/usr/bin/sips -g pixelHeight "$output_jpg" | grep pixelHeight | awk '{print $2}')

    echo "✓ Saved: ${filename}.jpg (${width}x${height})"

    ((count++))
done

echo ""
echo "✓ Captured $count diagrams"
echo "Images saved in: $IMAGE_DIR"
