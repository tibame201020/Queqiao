from __future__ import annotations

import argparse
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1120
HEIGHT = 620
FPS = 8
BG = (20, 22, 28)
BAR = (31, 34, 42)
TEXT = (232, 234, 240)
MUTED = (126, 132, 145)
CYAN = (76, 201, 240)
GREEN = (89, 211, 118)
YELLOW = (238, 198, 82)
RED = (239, 107, 115)

GLYPHS = {
    "active": "◆",
    "complete": "◇",
    "guide": "│",
    "end": "└",
    "focus": "›",
    "selected": "■",
    "unselected": "□",
    "success": "✓",
    "warning": "!",
    "danger": "×",
}


def font_path() -> str:
    for candidate in (
        r"C:\Windows\Fonts\CascadiaMono.ttf",
        r"C:\Windows\Fonts\CascadiaCode.ttf",
        r"C:\Windows\Fonts\consola.ttf",
    ):
        if os.path.exists(candidate):
            return candidate
    raise RuntimeError("No supported monospace font found")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    if bold:
        for candidate in (
            r"C:\Windows\Fonts\CascadiaMono-Bold.ttf",
            r"C:\Windows\Fonts\CascadiaCode-Bold.ttf",
            r"C:\Windows\Fonts\consolab.ttf",
        ):
            if os.path.exists(candidate):
                return ImageFont.truetype(candidate, size=size)
    return ImageFont.truetype(font_path(), size=size)


FONT = font(24)
FONT_BOLD = font(24, True)
FONT_SMALL = font(18)


def base(title: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 44), fill=BAR)
    draw.text((28, 12), title, font=FONT_SMALL, fill=MUTED)
    return image, draw


def text(draw: ImageDraw.ImageDraw, x: int, y: int, value: str, color=TEXT, strong=False) -> None:
    draw.text((x, y), value, font=FONT_BOLD if strong else FONT, fill=color)


def prompt(draw: ImageDraw.ImageDraw, y: int, label: str, complete: bool = False, value: str | None = None) -> int:
    symbol = GLYPHS["complete" if complete else "active"]
    text(draw, 36, y, symbol, GREEN if complete else CYAN, strong=True)
    text(draw, 72, y, label, TEXT, strong=True)
    if value:
        text(draw, 72, y + 36, GLYPHS["guide"], MUTED)
        text(draw, 108, y + 36, value, TEXT)
        return y + 82
    return y + 46


def select_frame(focus: int, complete: bool = False) -> Image.Image:
    image, draw = base("Queqiao CLI · Select")
    y = prompt(draw, 74, "Gateway", complete=complete, value="stable" if complete else None)
    if complete:
        return image
    choices = [("stable", "running"), ("shadow", "running"), ("New Gateway", "")]
    for i, (label, suffix) in enumerate(choices):
        text(draw, 72, y, GLYPHS["guide"], MUTED)
        text(draw, 108, y, GLYPHS["focus"] if i == focus else " ", CYAN if i == focus else MUTED, strong=i == focus)
        rendered = label + (f"  ({suffix})" if suffix else "")
        text(draw, 144, y, rendered, CYAN if i == focus else TEXT, strong=i == focus)
        y += 38
    text(draw, 72, y + 8, GLYPHS["end"], MUTED)
    text(draw, 108, y + 8, "↑/↓ navigate · Enter confirm", MUTED)
    return image


def multiselect_frame(focus: int, selected: set[int], complete: bool = False) -> Image.Image:
    image, draw = base("Queqiao CLI · Multiselect")
    if complete:
        prompt(draw, 74, "Tools", complete=True, value=f"{len(selected)} selected")
        return image
    y = prompt(draw, 74, "Tools")
    choices = [
        ("read_file", "Read UTF-8 text from a workspace-relative path."),
        ("write_file", "Write a UTF-8 text file."),
        ("edit_file", "Replace one exact text occurrence."),
        ("run", "Run one allowlisted executable without a shell."),
    ]
    for i, (label, description) in enumerate(choices):
        text(draw, 72, y, GLYPHS["guide"], MUTED)
        text(draw, 108, y, GLYPHS["focus"] if i == focus else " ", CYAN if i == focus else MUTED, strong=i == focus)
        mark = GLYPHS["selected"] if i in selected else GLYPHS["unselected"]
        text(draw, 144, y, mark, CYAN if (i == focus or i in selected) else TEXT, strong=i in selected)
        text(draw, 182, y, label, CYAN if i == focus else TEXT, strong=(i == focus or i in selected))
        text(draw, 182, y + 30, description, TEXT if (i == focus or i in selected) else MUTED)
        y += 76
    text(draw, 72, y, GLYPHS["end"], MUTED)
    text(draw, 108, y, "↑/↓ navigate · Space toggle · Enter confirm", MUTED)
    return image


def input_frame(kind: str, value: str, hint: str, cursor: bool = True) -> Image.Image:
    title = "Workspace path" if kind == "path" else "Allowed executables"
    image, draw = base(f"Queqiao CLI · {title}")
    y = prompt(draw, 74, title)
    text(draw, 72, y, GLYPHS["guide"], MUTED)
    text(draw, 108, y, value + ("▌" if cursor else ""), CYAN, strong=True)
    text(draw, 72, y + 48, GLYPHS["end"], MUTED)
    text(draw, 108, y + 48, hint, MUTED)
    return image


def results_frame(stage: int) -> Image.Image:
    image, draw = base("Queqiao CLI · Results")
    if stage == 0:
        text(draw, 36, 78, "Worker wins-worker", TEXT, strong=True)
        text(draw, 72, 126, "Status:", MUTED)
        text(draw, 210, 126, "Running", GREEN, strong=True)
        text(draw, 72, 164, "Managed:", MUTED)
        text(draw, 210, 164, "Yes", TEXT, strong=True)
        text(draw, 72, 202, "PID:", MUTED)
        text(draw, 210, 202, "1234", TEXT, strong=True)
    elif stage == 1:
        text(draw, 36, 78, f"{GLYPHS['success']} Worker joined Gateway: wins-worker", GREEN, strong=True)
        text(draw, 72, 130, "Worker Id:", MUTED)
        text(draw, 230, 130, "<worker-id>", CYAN, strong=True)
    else:
        text(draw, 36, 78, "Next", TEXT, strong=True)
        text(draw, 72, 130, "queqiao worker serve --bg --worker wins-worker", CYAN)
    return image


def help_error_frame(error: bool) -> Image.Image:
    image, draw = base("Queqiao CLI · Help / Error")
    if not error:
        text(draw, 36, 76, "Usage: queqiao worker workspace <command> [options]", CYAN, strong=True)
        text(draw, 36, 132, "Commands:", CYAN, strong=True)
        text(draw, 72, 180, "add [--worker <worker>] [--root <dir>] [--display-name <name>]", TEXT)
        text(draw, 72, 218, "list [--worker <worker>]", TEXT)
        text(draw, 72, 256, "profile set [--worker <worker>] [--workspace <id>]", TEXT)
    else:
        text(draw, 36, 84, f"{GLYPHS['danger']} --worker is required outside an interactive terminal.", RED, strong=True)
        text(draw, 72, 140, 'Run "queqiao worker list".', MUTED)
    return image


def save(frames: list[Image.Image], path: Path, durations: list[int] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if durations is None:
        durations = [500] * len(frames)
    frames[0].save(path, save_all=True, append_images=frames[1:], optimize=True, duration=durations, loop=0, disposal=2)
    print(f"{path}: {path.stat().st_size} bytes")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    out = args.output_dir

    save([select_frame(0), select_frame(1), select_frame(0), select_frame(0, True)], out / "01-select.gif", [700, 700, 700, 1200])
    save([
        multiselect_frame(0, {0}),
        multiselect_frame(1, {0}),
        multiselect_frame(1, {0, 1}),
        multiselect_frame(2, {0, 1}),
        multiselect_frame(2, {0, 1, 2}),
        multiselect_frame(2, {0, 1, 2}, True),
    ], out / "02-multiselect.gif", [650, 650, 650, 650, 650, 1200])
    save([
        input_frame("path", r"C:\\Users\\Public\\QueqiaoDemo", "Tab complete · Enter confirm"),
        input_frame("path", r"C:\\Users\\Public\\QueqiaoDemo\\workspace", "Tab complete · Enter confirm", False),
    ], out / "03-path-input.gif", [900, 1400])
    save([
        input_frame("command", "git,node", "↑/↓ history · Enter confirm"),
        input_frame("command", "git,node,python", "↑/↓ history · Enter confirm"),
        input_frame("command", "git,node", "↑/↓ history · Enter confirm", False),
    ], out / "04-command-history.gif", [700, 700, 1300])
    save([results_frame(0), results_frame(1), results_frame(2)], out / "05-results.gif", [1200, 1200, 1500])
    save([help_error_frame(False), help_error_frame(True)], out / "06-help-error.gif", [1700, 1700])


if __name__ == "__main__":
    main()
