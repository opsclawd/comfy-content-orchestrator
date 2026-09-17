#!/usr/bin/env python3
import io
import os
import sys

def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: extract_webp_frames.py <input.webp> <output_dir>\n")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    try:
        from PIL import Image, ImageSequence
    except ImportError as e:
        sys.stderr.write(f"PIL/Pillow not available: {e}\n")
        sys.exit(2)

    try:
        with open(input_path, "rb") as f:
            buf = bytearray(f.read())
    except Exception as e:
        sys.stderr.write(f"Failed to read input file: {e}\n")
        sys.exit(3)

    # Strip any non-ANMF trailing chunks (such as ComfyUI EXIF metadata with invalid TIFF headers)
    offset = 12
    last_anmf_end = len(buf)
    while offset + 8 <= len(buf):
        fourcc = buf[offset:offset+4].decode("ascii", errors="ignore")
        size = int.from_bytes(buf[offset+4:offset+8], "little")
        chunk_end = offset + 8 + size + (size % 2)
        if fourcc == "ANMF":
            last_anmf_end = chunk_end
        offset = chunk_end

    clean_buf = buf[:last_anmf_end]
    clean_buf[4:8] = (len(clean_buf) - 8).to_bytes(4, "little")

    try:
        im = Image.open(io.BytesIO(clean_buf))
    except Exception as e:
        sys.stderr.write(f"Failed to open WebP image: {e}\n")
        sys.exit(4)

    durations = []
    frame_filenames = []

    for i, frame in enumerate(ImageSequence.Iterator(im)):
        frame_name = f"frame-{i:05d}.bmp"
        frame_path = os.path.join(output_dir, frame_name)
        frame.convert("RGB").save(frame_path, format="BMP")
        dur_ms = frame.info.get("duration", 41)
        durations.append(dur_ms if dur_ms > 0 else 41)
        frame_filenames.append(frame_name)

    if not durations:
        sys.stderr.write("No frames extracted from WebP\n")
        sys.exit(5)

    concat_path = os.path.join(output_dir, "concat.txt")
    with open(concat_path, "w") as f:
        f.write("ffconcat version 1.0\n")
        for name, dur in zip(frame_filenames, durations):
            f.write(f"file '{name}'\n")
            f.write(f"duration {dur / 1000.0:.6f}\n")

    print(f'{{"frameCount": {len(durations)}, "width": {im.width}, "height": {im.height}}}')

if __name__ == "__main__":
    main()
