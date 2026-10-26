"""
Tạo icon app mobile từ ảnh Coal (frontend/public/coal/happy.webp) trên nền navy của thương hiệu.

    python -I mobile/scripts/make_icons.py

Ra các tệp trong mobile/assets/:
  icon.png             1024x1024, nền navy kín (iOS tự bo góc)
  adaptive-icon.png    1024x1024 trong suốt, Coal nằm trong vùng an toàn 66% (Android tự cắt hình)
  monochrome-icon.png  1024x1024 hình bóng trắng cho icon theo chủ đề của Android 13+
  splash-icon.png      Coal cắt sát, nền trong suốt, cho màn hình chờ
  notification-icon.png 96x96 hình bóng trắng cho thanh trạng thái Android khi có thông báo đẩy
  favicon.png          196x196 bo góc, cho bản web
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "frontend", "public", "coal", "happy.webp")
OUT = os.path.join(ROOT, "assets")
NAVY = "#0f1f4d"
SIZE = 1024


def coal() -> Image.Image:
    im = Image.open(SRC).convert("RGBA")
    return im.crop(im.getbbox())


def fit(sprite: Image.Image, box: int) -> Image.Image:
    k = box / max(sprite.width, sprite.height)
    return sprite.resize((round(sprite.width * k), round(sprite.height * k)), Image.LANCZOS)


def place(canvas: Image.Image, sprite: Image.Image, dy: float = 0.0) -> None:
    x = (canvas.width - sprite.width) // 2
    y = (canvas.height - sprite.height) // 2 + round(canvas.height * dy)
    canvas.alpha_composite(sprite, (x, y))


def main() -> None:
    src = coal()

    icon = Image.new("RGBA", (SIZE, SIZE), NAVY)
    place(icon, fit(src, round(SIZE * 0.74)), dy=0.01)
    icon.convert("RGB").save(os.path.join(OUT, "icon.png"))

    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    place(fg, fit(src, round(SIZE * 0.6)))
    fg.save(os.path.join(OUT, "adaptive-icon.png"))

    alpha = fg.getchannel("A").point(lambda a: 255 if a > 96 else 0)
    mono = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    mono.putalpha(alpha)
    mono.save(os.path.join(OUT, "monochrome-icon.png"))
    note = mono.crop(mono.getbbox())
    k = 80 / max(note.size)
    note = note.resize((round(note.width * k), round(note.height * k)), Image.LANCZOS)
    badge = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    badge.alpha_composite(note, ((96 - note.width) // 2, (96 - note.height) // 2))
    badge.save(os.path.join(OUT, "notification-icon.png"))

    fit(src, 600).save(os.path.join(OUT, "splash-icon.png"))

    fav = icon.resize((196, 196), Image.LANCZOS)
    mask = Image.new("L", fav.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 195, 195], radius=44, fill=255)
    out = Image.new("RGBA", fav.size, (0, 0, 0, 0))
    out.paste(fav, (0, 0), mask)
    out.save(os.path.join(OUT, "favicon.png"))
    print("icons ->", OUT)


if __name__ == "__main__":
    main()
