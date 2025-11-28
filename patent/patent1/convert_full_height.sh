#!/bin/bash

# Convert all HTML Mermaid diagrams to JPG images with full height capture
DIAGRAM_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams"
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Create images directory
mkdir -p "$IMAGE_DIR"

echo "Starting diagram conversion with full height capture..."
echo ""

# Counter
count=0

# Loop through all HTML files
for html_file in "$DIAGRAM_DIR"/*.html; do
    # Get filename without path and extension
    filename=$(basename "$html_file" .html)

    # Output PNG file (will convert to JPG after)
    output_png="$IMAGE_DIR/${filename}.png"
    output_jpg="$IMAGE_DIR/${filename}.jpg"

    echo "Converting: $filename"

    # Convert HTML to PNG using Chrome headless with very large height to capture everything
    "$CHROME" --headless \
        --disable-gpu \
        --screenshot="$output_png" \
        --window-size=1600,5000 \
        --force-device-scale-factor=2 \
        --virtual-time-budget=5000 \
        "file://$html_file" > /dev/null 2>&1

    # Wait for file creation
    sleep 1

    # Check if PNG was created
    if [ -f "$output_png" ]; then
        # Convert PNG to JPG with quality 95 and trim whitespace
        /usr/bin/sips -s format jpeg -s formatOptions 95 "$output_png" --out "$output_jpg" > /dev/null 2>&1

        # Remove PNG
        rm "$output_png"

        # Get dimensions
        dimensions=$(/usr/bin/sips -g pixelWidth -g pixelHeight "$output_jpg" | grep -E "pixelWidth|pixelHeight" | awk '{print $2}' | tr '\n' 'x' | sed 's/x$//')

        echo "  ✓ Created: ${filename}.jpg ($dimensions)"
        count=$((count + 1))
    else
        echo "  ✗ Failed: $filename"
    fi
done

echo ""
echo "✓ Converted $count diagrams to JPG"
echo "Images saved in: $IMAGE_DIR"
echo ""
echo "Checking for cutoff diagrams (height > 4500px might be cut off)..."
echo ""

# Check for very tall diagrams that might be cut off
for jpg_file in "$IMAGE_DIR"/*.jpg; do
    filename=$(basename "$jpg_file")
    height=$(/usr/bin/sips -g pixelHeight "$jpg_file" | grep pixelHeight | awk '{print $2}')

    if [ "$height" -gt 4500 ]; then
        echo "⚠️  $filename might be cut off (height: ${height}px)"
    fi
done
