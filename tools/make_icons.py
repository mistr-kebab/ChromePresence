#!/usr/bin/env python3
"""Generate Chrome Presence icons and the optional Discord Rich Presence asset."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
ASSETS = ROOT / "assets"
SCALE = 10
SIZES = (16, 32, 48, 128)

BG_TOP = (32, 34, 38, 255)
BG_BOTTOM = (17, 18, 20, 255)
WHITE = (255, 255, 255, 255)
RED = (234, 67, 53, 255)
GREEN = (52, 168, 83, 255)
YELLOW = (251, 188, 5, 255)
BLUE = (66, 133, 244, 255)
PRESENCE = (35, 165, 90, 255)

GAP_DEGREES = 4.5


def gradient(size):
    image = Image.new("RGBA", (size, size), BG_TOP)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(
            round(BG_TOP[channel] * (1 - t) + BG_BOTTOM[channel] * t)
            for channel in range(4)
        )
        draw.line([(0, y), (size, y)], fill=color)
    return image


def draw_chrome(draw, cx, cy, radius):
    box = (cx - radius, cy - radius, cx + radius, cy + radius)
    draw.ellipse(box, fill=WHITE)

    gap = GAP_DEGREES / 2
    draw.pieslice(
        box,
        start=270 - 60 + gap,
        end=270 + 60 - gap,
        fill=RED,
    )
    draw.pieslice(
        box,
        start=150 - 60 + gap,
        end=150 + 60 - gap,
        fill=GREEN,
    )
    draw.pieslice(
        box,
        start=30 - 60 + gap,
        end=30 + 60 - gap,
        fill=YELLOW,
    )

    inner_white = radius * 0.56
    draw.ellipse(
        (cx - inner_white, cy - inner_white, cx + inner_white, cy + inner_white),
        fill=WHITE,
    )
    inner_blue = radius * 0.47
    draw.ellipse(
        (cx - inner_blue, cy - inner_blue, cx + inner_blue, cy + inner_blue),
        fill=BLUE,
    )


def rounded_background(canvas):
    radius = round(canvas * 28 / 128)
    mask = Image.new("L", (canvas, canvas), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, canvas - 1, canvas - 1),
        radius=radius,
        fill=255,
    )
    background = gradient(canvas)
    result = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    result.paste(background, (0, 0), mask)
    return result, mask


def make_icon(size):
    canvas = size * SCALE
    image, _mask = rounded_background(canvas)
    draw = ImageDraw.Draw(image)

    logo_radius = canvas * 40 / 128
    logo_center = canvas * 60 / 128
    draw_chrome(draw, logo_center, logo_center, logo_radius)

    dot_radius = canvas * 15 / 128
    dot_center = canvas * 99 / 128
    ring = canvas * 4.5 / 128
    draw.ellipse(
        (
            dot_center - dot_radius - ring,
            dot_center - dot_radius - ring,
            dot_center + dot_radius + ring,
            dot_center + dot_radius + ring,
        ),
        fill=BG_BOTTOM,
    )
    draw.ellipse(
        (
            dot_center - dot_radius,
            dot_center - dot_radius,
            dot_center + dot_radius,
            dot_center + dot_radius,
        ),
        fill=PRESENCE,
    )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def make_asset(size=512):
    canvas = size * 3
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw_chrome(draw, canvas / 2, canvas / 2, canvas * 0.46)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        make_icon(size).save(ICONS / f"icon{size}.png")
        print(f"wrote icons/icon{size}.png")

    make_asset().save(ASSETS / "discord-asset.png")
    print("wrote assets/discord-asset.png")


if __name__ == "__main__":
    main()
