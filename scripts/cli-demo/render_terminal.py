from __future__ import annotations

import argparse
import json
import math
import os
import textwrap
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1120
HEIGHT = 760
FPS = 10
MARGIN = 32
TOP = 58
FONT_SIZE = 24
LINE_GAP = 7
BG = (20, 22, 28)
BAR = (31, 34, 42)
TEXT = (232, 234, 240)
MUTED = (154, 160, 174)
PROMPT = (109, 199, 132)
ACCENT = (107, 166, 255)
DOT_RED = (255, 95, 86)
DOT_YELLOW = (255, 189, 46)
DOT_GREEN = (39, 201, 63)


def font_path() -> str:
    candidates = [
        r"C:\Windows\Fonts\CascadiaMono.ttf",
        r"C:\Windows\Fonts\CascadiaCode.ttf",
        r"C:\Windows\Fonts\consola.ttf",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    raise RuntimeError("No supported monospace font found")


def load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(font_path(), size=size)


def normalize_lines(text: str) -> list[str]:
    clean = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    return clean.split("\n") if clean else []


def wrap(line: str, width: int) -> list[str]:
    if not line:
        return [""]
    return textwrap.wrap(line, width=width, replace_whitespace=False, drop_whitespace=False) or [""]


def render_frame(title: str, visible: list[tuple[str, str]]) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    font = load_font(FONT_SIZE)
    small = load_font(19)

    draw.rectangle((0, 0, WIDTH, 44), fill=BAR)
    for x, color in [(22, DOT_RED), (46, DOT_YELLOW), (70, DOT_GREEN)]:
        draw.ellipse((x - 7, 22 - 7, x + 7, 22 + 7), fill=color)
    draw.text((96, 11), title, font=small, fill=MUTED)

    line_height = FONT_SIZE + LINE_GAP
    max_cols = 78
    rows: list[tuple[str, str]] = []
    for kind, text in visible:
        for line in normalize_lines(text) or [""]:
            parts = wrap(line, max_cols)
            if kind == "prompt":
                rows.append(("prompt", parts[0]))
                rows.extend(("prompt-cont", part) for part in parts[1:])
            else:
                rows.extend((kind, part) for part in parts)

    max_rows = max(1, (HEIGHT - TOP - MARGIN) // line_height)
    rows = rows[-max_rows:]
    y = TOP
    for kind, line in rows:
        if kind == "prompt":
            draw.text((MARGIN, y), "PS C:\\QueqiaoDemo> ", font=font, fill=PROMPT)
            prefix_width = draw.textlength("PS C:\\QueqiaoDemo> ", font=font)
            draw.text((MARGIN + prefix_width, y), line, font=font, fill=ACCENT)
        elif kind == "prompt-cont":
            prefix_width = draw.textlength("PS C:\\QueqiaoDemo> ", font=font)
            draw.text((MARGIN + prefix_width, y), line, font=font, fill=ACCENT)
        elif kind == "muted":
            draw.text((MARGIN, y), line, font=font, fill=MUTED)
        else:
            draw.text((MARGIN, y), line, font=font, fill=TEXT)
        y += line_height
    return image


def append_hold(frames: list[Image.Image], title: str, visible: list[tuple[str, str]], seconds: float) -> None:
    count = max(1, round(seconds * FPS))
    frame = render_frame(title, visible)
    frames.extend([frame.copy() for _ in range(count)])


def build_frames(data: dict) -> list[Image.Image]:
    title = data.get("title", "Queqiao CLI")
    frames: list[Image.Image] = []
    visible: list[tuple[str, str]] = []
    append_hold(frames, title, visible, 0.5)

    for step in data["steps"]:
        command = step["command"]
        chars_per_frame = max(1, math.ceil(len(command) / max(5, round(step.get("typingSeconds", 0.9) * FPS))))
        typed = ""
        for i in range(0, len(command), chars_per_frame):
            typed = command[: i + chars_per_frame]
            transient = visible + [("prompt", typed)]
            frames.append(render_frame(title, transient))
        visible.append(("prompt", command))
        append_hold(frames, title, visible, 0.15)

        output = step.get("output", "")
        if output:
            lines = normalize_lines(output)
            for line in lines:
                visible.append(("output", line))
                append_hold(frames, title, visible, 0.10)
        append_hold(frames, title, visible, step.get("holdSeconds", 0.7))

    append_hold(frames, title, visible, 1.5)
    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("transcript", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = json.loads(args.transcript.read_text(encoding="utf-8-sig"))
    frames = build_frames(data)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    duration = round(1000 / FPS)
    frames[0].save(
        args.output,
        save_all=True,
        append_images=frames[1:],
        optimize=True,
        duration=duration,
        loop=0,
        disposal=2,
    )
    print(json.dumps({"frames": len(frames), "fps": FPS, "output": str(args.output), "bytes": args.output.stat().st_size}))


if __name__ == "__main__":
    main()
