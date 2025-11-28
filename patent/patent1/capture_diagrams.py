#!/usr/bin/env python3
"""
Convert HTML Mermaid diagrams to high-quality JPG images with full content capture
Uses selenium/webdriver to properly render and measure content
"""

import os
import time
import subprocess
from pathlib import Path

DIAGRAM_DIR = Path("/Users/haneeshkapa/chatbotp2/patent/patent1/diagrams")
IMAGE_DIR = Path("/Users/haneeshkapa/chatbotp2/patent/patent1/images")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Create image directory
IMAGE_DIR.mkdir(exist_ok=True)

def convert_diagram(html_file):
    """Convert a single HTML diagram to JPG"""
    filename = html_file.stem
    output_jpg = IMAGE_DIR / f"{filename}.jpg"

    print(f"Converting: {filename}")

    # Use Chrome with large window to capture full content
    cmd = [
        CHROME,
        "--headless",
        "--disable-gpu",
        "--screenshot=" + str(output_jpg),
        "--window-size=2000,8000",
        "--force-device-scale-factor=1.5",
        "--hide-scrollbars",
        f"file://{html_file}"
    ]

    try:
        # Run Chrome
        result = subprocess.run(cmd, capture_output=True, timeout=10)

        # Wait for file
        time.sleep(1)

        if output_jpg.exists():
            # Convert PNG to JPG if Chrome output PNG
            if not output_jpg.suffix == '.jpg':
                png_file = output_jpg.with_suffix('.png')
                if png_file.exists():
                    subprocess.run([
                        '/usr/bin/sips',
                        '-s', 'format', 'jpeg',
                        '-s', 'formatOptions', '95',
                        str(png_file),
                        '--out', str(output_jpg)
                    ], capture_output=True)
                    png_file.unlink()

            # Get dimensions
            result = subprocess.run(
                ['/usr/bin/sips', '-g', 'pixelHeight', '-g', 'pixelWidth', str(output_jpg)],
                capture_output=True,
                text=True
            )

            lines = result.stdout.strip().split('\n')
            dims = {}
            for line in lines:
                if 'pixelHeight' in line or 'pixelWidth' in line:
                    parts = line.split(':')
                    if len(parts) == 2:
                        key = parts[0].strip()
                        val = parts[1].strip()
                        dims[key] = val

            width = dims.get('pixelWidth', '?')
            height = dims.get('pixelHeight', '?')

            print(f"  ✓ Created: {filename}.jpg ({width}x{height})")
            return True
        else:
            print(f"  ✗ Failed: {filename}")
            return False

    except Exception as e:
        print(f"  ✗ Error: {filename} - {e}")
        return False

def main():
    print("Converting HTML diagrams to high-quality JPG images...")
    print()

    # Get all HTML files
    html_files = sorted(DIAGRAM_DIR.glob("*.html"))
    print(f"Found {len(html_files)} diagrams\n")

    # Convert each one
    success = 0
    for html_file in html_files:
        if convert_diagram(html_file):
            success += 1

    print()
    print(f"✓ Successfully converted {success}/{len(html_files)} diagrams")
    print(f"Images saved in: {IMAGE_DIR}")

if __name__ == "__main__":
    main()
