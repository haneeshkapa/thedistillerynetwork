#!/bin/bash

# Extract Mermaid code from HTML and convert to high-quality JPG
DIAGRAM_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams"
IMAGE_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/images"
TEMP_DIR="/Users/haneeshkapa/chatbotp2/patent/patent1/temp_mmd"

mkdir -p "$IMAGE_DIR"
mkdir -p "$TEMP_DIR"

echo "Extracting Mermaid code and converting to JPG..."
echo ""

count=0

for html_file in "$DIAGRAM_DIR"/*.html; do
    filename=$(basename "$html_file" .html)
    mmd_file="$TEMP_DIR/${filename}.mmd"
    output_jpg="$IMAGE_DIR/${filename}.jpg"

    echo "Processing: $filename"

    # Extract Mermaid code (between <div class="mermaid"> and </div>)
    sed -n '/<div class="mermaid">/,/<\/div>/p' "$html_file" | \
        sed '/<div class="mermaid">/d' | \
        sed '/<\/div>/d' | \
        sed '/^$/d' > "$mmd_file"

    # Check if extraction was successful
    if [ -s "$mmd_file" ]; then
        # Convert to PNG first using mermaid-cli (with large size to avoid cutoff)
        temp_png="$TEMP_DIR/${filename}.png"
        mmdc -i "$mmd_file" -o "$temp_png" -t default -b white -w 2000 -s 2 2>/dev/null

        # Convert PNG to JPG
        if [ -f "$temp_png" ]; then
            /usr/bin/sips -s format jpeg -s formatOptions 95 "$temp_png" --out "$output_jpg" > /dev/null 2>&1
            rm "$temp_png"
        fi

        if [ -f "$output_jpg" ]; then
            # Get dimensions
            width=$(/usr/bin/sips -g pixelWidth "$output_jpg" 2>/dev/null | grep pixelWidth | awk '{print $2}')
            height=$(/usr/bin/sips -g pixelHeight "$output_jpg" 2>/dev/null | grep pixelHeight | awk '{print $2}')

            echo "  ✓ Created: ${filename}.jpg (${width}x${height})"
            ((count++))
        else
            echo "  ✗ Failed to convert: $filename"
        fi
    else
        echo "  ✗ Failed to extract Mermaid code: $filename"
    fi
done

# Clean up temp files
rm -rf "$TEMP_DIR"

echo ""
echo "✓ Successfully converted $count diagrams"
echo "Images saved in: $IMAGE_DIR"
