#!/bin/bash

# Resize all images to max width of 1200px for better PDF rendering
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"
RESIZED_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images_resized"

mkdir -p "$RESIZED_DIR"

echo "Resizing images to max width 1200px..."
count=0

for img in "$IMAGE_DIR"/*.jpg; do
    filename=$(basename "$img")

    # Get current width
    width=$(/usr/bin/sips -g pixelWidth "$img" 2>/dev/null | grep pixelWidth | awk '{print $2}')

    if [ "$width" -gt 1200 ]; then
        # Resize to max width 1200px, maintaining aspect ratio
        /usr/bin/sips -Z 1200 "$img" --out "$RESIZED_DIR/$filename" > /dev/null 2>&1
        echo "  ✓ Resized: $filename (${width}px -> 1200px)"
        ((count++))
    else
        # Just copy if already small enough
        cp "$img" "$RESIZED_DIR/$filename"
        echo "  ✓ Copied: $filename (${width}px - no resize needed)"
    fi
done

echo ""
echo "✓ Processed $count images"
echo "Resized images saved in: $RESIZED_DIR"
