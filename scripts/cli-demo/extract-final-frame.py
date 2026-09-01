#!/usr/bin/env python3
import sys
from pathlib import Path
from PIL import Image


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract-final-frame.py <file.gif>")
    source = Path(sys.argv[1])
    target = source.with_suffix(".png")
    with Image.open(source) as image:
        image.seek(max(0, getattr(image, "n_frames", 1) - 1))
        frame = image.convert("RGB")
        frame.save(target, format="PNG", optimize=True)
    print(target)


if __name__ == "__main__":
    main()
