#!/usr/bin/env python3
"""Welcome-home poster generator (Talent Search Initiative CEO homecoming).

Parametric Pillow layout rendered at print (A3 300dpi) and social sizes.
Placeholder assets (photo, TSI logo) are swapped for real files automatically
when they exist in assets/.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
ASSETS = os.path.join(HERE, "assets")
OUT = os.path.join(HERE, "out")

# ---------------------------------------------------------------- palette ---
INK = (20, 20, 22)
CREAM = (251, 247, 239)
WHITE = (255, 255, 255)
UG_BLACK = (0, 0, 0)
UG_YELLOW = (252, 220, 97)
UG_RED = (217, 0, 0)
GREY_TXT = (82, 82, 86)
GREY_SOFT = (125, 125, 129)
PH_BG = (233, 227, 214)
PH_FIG = (201, 194, 180)

# ----------------------------------------------------------------- content --
CONTENT = {
    "org": "TALENT SEARCH INITIATIVE",
    "script": "Welcome home,",
    "name": "[FULL NAME]",
    "title": "Chief Executive Officer, Talent Search Initiative",
    "message": [
        "Back home. Back to the mission.",
        "A new chapter for Talent Search Initiative begins in Uganda.",
    ],
    "sponsors_label": "SUPPORTED BY",
    "footer": "Created by ScottsTechX Enterprises Ltd",
}

PHOTO_PATH = os.path.join(ASSETS, "ceo-photo.jpg")
TSI_LOGO = os.path.join(ASSETS, "tsi-logo.png")
STX_LOGO = os.path.join(ASSETS, "scottstechx-logo.jpg")
PIZZA_LOGO = os.path.join(ASSETS, "pizza-origin-logo.jpg")


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), max(6, int(round(size))))


def tracked_width(d, text, f, tracking):
    ws = [d.textlength(ch, font=f) for ch in text]
    return sum(ws) + tracking * (len(text) - 1), ws


def draw_tracked(d, cx, y, text, f, fill, tracking):
    total, ws = tracked_width(d, text, f, tracking)
    x = cx - total / 2
    for ch, w in zip(text, ws):
        d.text((x, y), ch, font=f, fill=fill, anchor="lt")
        x += w + tracking
    return total


def text_h(f):
    a, dd = f.getmetrics()
    return a + dd


def trim_whitespace(im, pad_frac=0.02):
    """Crop away near-white borders of a logo image."""
    rgb = im.convert("RGB")
    g = rgb.convert("L").point(lambda p: 255 if p < 246 else 0)
    bbox = g.getbbox()
    if not bbox:
        return im
    pad = int(max(im.size) * pad_frac)
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.size[0], r + pad); b = min(im.size[1], b + pad)
    return im.crop((l, t, r, b))


def fit_image(path, box):
    im = Image.open(path).convert("RGB")
    bw, bh = box
    iw, ih = im.size
    sc = max(bw / iw, bh / ih)
    im = im.resize((round(iw * sc), round(ih * sc)), Image.LANCZOS)
    iw, ih = im.size
    l = (iw - bw) // 2
    t = (ih - bh) // 2
    return im.crop((l, t, l + bw, t + bh))


def photo_disc(d_px, s):
    """Circular photo (or placeholder silhouette) with flag-colour rings."""
    ring_out = round(5 * s)
    ring_y = round(13 * s)
    ring_r = round(13 * s)
    gap = round(7 * s)
    pad = ring_out + ring_y + ring_r + gap
    size = d_px + 2 * pad
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    c = size / 2
    ld.ellipse([0, 0, size, size], fill=UG_BLACK)
    ld.ellipse([ring_out, ring_out, size - ring_out, size - ring_out], fill=UG_YELLOW)
    y2 = ring_out + ring_y
    ld.ellipse([y2, y2, size - y2, size - y2], fill=UG_RED)
    r2 = y2 + ring_r
    ld.ellipse([r2, r2, size - r2, size - r2], fill=WHITE)
    g2 = r2 + gap
    if os.path.exists(PHOTO_PATH):
        ph = fit_image(PHOTO_PATH, (d_px, d_px))
        mask = Image.new("L", (d_px, d_px), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, d_px, d_px], fill=255)
        layer.paste(ph, (round(g2), round(g2)), mask)
    else:
        ld.ellipse([g2, g2, size - g2, size - g2], fill=PH_BG)
        hd = d_px * 0.30
        ld.ellipse([c - hd / 2, c - d_px * 0.34, c + hd / 2, c - d_px * 0.34 + hd], fill=PH_FIG)
        sw = d_px * 0.62
        ld.ellipse([c - sw / 2, c - d_px * 0.02, c + sw / 2, c - d_px * 0.02 + sw * 0.78], fill=PH_FIG)
        interior = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        interior.paste(layer, (0, 0), None)
        disc_mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(disc_mask).ellipse([g2, g2, size - g2, size - g2], fill=255)
        clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        clipped.paste(interior, (0, 0), disc_mask)
        layer = Image.composite(clipped, layer, disc_mask)
    return layer


def mono_badge(d_px, s, text, bg, fg, f_size):
    im = Image.new("RGBA", (d_px, d_px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, d_px, d_px], radius=round(d_px * 0.28), fill=bg)
    f = font("Montserrat-ExtraBold.ttf", f_size)
    d.text((d_px / 2, d_px / 2), text, font=f, fill=fg, anchor="mm")
    return im


def mini_flag(w, h):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cols = [UG_BLACK, UG_YELLOW, UG_RED] * 2
    sh = h / 6
    for i, c in enumerate(cols):
        d.rectangle([0, i * sh, w, (i + 1) * sh + 1], fill=c)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w, h], radius=round(h * 0.18), fill=255)
    im.putalpha(mask)
    return im


def logo_fitted(path, max_h, max_w):
    im = trim_whitespace(Image.open(path).convert("RGBA"))
    iw, ih = im.size
    sc = min(max_w / iw, max_h / ih)
    return im.resize((max(1, round(iw * sc)), max(1, round(ih * sc))), Image.LANCZOS)


class Layout:
    """Measures the vertical stack for a given scale s."""

    def __init__(self, W, H, s):
        self.W, self.H, self.s = W, H, s
        self.margin = 64 * s
        self.top_band = 34 * s
        self.foot_h = 92 * s
        self.f_org = font("Montserrat-SemiBold.ttf", 25 * s)
        self.f_script = font("GreatVibes-Regular.ttf", 98 * s)
        self.f_name = font("Montserrat-ExtraBold.ttf", 76 * s)
        self.f_title = font("Montserrat-SemiBold.ttf", 32 * s)
        self.f_msg = font("Montserrat-Medium.ttf", 28 * s)
        self.f_label = font("Montserrat-Bold.ttf", 23 * s)
        self.f_foot = font("Montserrat-SemiBold.ttf", 30 * s)
        self.hdr_h = 58 * s
        self.d_px = min(430 * s, 0.33 * H)
        self.disc_size = self.d_px + 2 * (5 + 13 + 13 + 7) * s
        self.card_h = 172 * s
        self.gaps_base = [30 * s, 34 * s, 12 * s, 16 * s, 26 * s, 30 * s, 40 * s]

    def name_font_fit(self, d):
        f = self.f_name
        w = d.textlength(CONTENT["name"], font=f)
        maxw = self.W - 2 * self.margin
        if w > maxw:
            f = font("Montserrat-ExtraBold.ttf", 76 * self.s * maxw / w)
        return f

    def title_font_fit(self, d):
        f = self.f_title
        w = d.textlength(CONTENT["title"], font=f)
        maxw = self.W - 2 * self.margin
        if w > maxw:
            f = font("Montserrat-SemiBold.ttf", 32 * self.s * maxw / w)
        return f

    def heights(self, d):
        self.f_name = self.name_font_fit(d)
        self.f_title = self.title_font_fit(d)
        self.script_h = text_h(self.f_script)
        self.name_h = text_h(self.f_name)
        self.title_h = text_h(self.f_title)
        self.rule_h = 6 * self.s
        self.msg_h = text_h(self.f_msg) * len(CONTENT["message"]) + 10 * self.s * (len(CONTENT["message"]) - 1)
        self.spons_h = 30 * self.s + 18 * self.s + self.card_h
        self.stack_h = (self.hdr_h + self.disc_size + self.script_h + self.name_h
                        + self.title_h + self.rule_h + self.msg_h + self.spons_h
                        + sum(self.gaps_base))
        self.avail = self.H - self.top_band - self.foot_h - 40 * self.s - 30 * self.s
        return self.stack_h <= self.avail


def build(W, H, out_png, pdf=False):
    img = Image.new("RGBA", (W, H), CREAM + (255,))
    d = ImageDraw.Draw(img)
    s0 = W / 1080.0
    # auto-fit: shrink scale until the stack fits the available height
    s = s0
    for _ in range(6):
        lo = Layout(W, H, s)
        if lo.heights(d):
            break
        s *= 0.94
    L = lo
    extra = max(0.0, L.avail - L.stack_h)
    gaps = [g + extra / len(L.gaps_base) for g in L.gaps_base]
    s = L.s

    y = float(L.top_band + 34 * s)

    # ---- top flag band ----------------------------------------------------
    cols = [UG_BLACK, UG_YELLOW, UG_RED] * 2
    sh = L.top_band / 6
    for i, c in enumerate(cols):
        d.rectangle([0, i * sh, W, (i + 1) * sh + 1], fill=c)

    # ---- header row -------------------------------------------------------
    hy = y + L.hdr_h / 2
    if os.path.exists(TSI_LOGO):
        lg = logo_fitted(TSI_LOGO, L.hdr_h, W * 0.4)
        img.paste(lg, (round(L.margin), round(hy - lg.size[1] / 2)), lg)
        d.text((L.margin + lg.size[0] + 16 * s, hy), CONTENT["org"], font=L.f_org, fill=INK, anchor="lm")
    else:
        bd = mono_badge(round(L.hdr_h), s, "TSI", INK, CREAM, 20 * s)
        img.paste(bd, (round(L.margin), round(y)), bd)
        d.text((L.margin + L.hdr_h + 16 * s, hy), CONTENT["org"], font=L.f_org, fill=INK, anchor="lm")
    fl = mini_flag(round(96 * s), round(64 * s))
    img.paste(fl, (round(W - L.margin - fl.size[0]), round(hy - fl.size[1] / 2)), fl)
    y += L.hdr_h + gaps[0]

    # ---- photo disc --------------------------------------------------------
    disc = photo_disc(round(L.d_px), s)
    img.paste(disc, (round(W / 2 - disc.size[0] / 2), round(y)), disc)
    y += disc.size[0] + gaps[1]

    # ---- script + name + title --------------------------------------------
    d.text((W / 2, y), CONTENT["script"], font=L.f_script, fill=UG_RED, anchor="mt")
    y += L.script_h - 20 * s + gaps[2]
    d.text((W / 2, y), CONTENT["name"], font=L.f_name, fill=INK, anchor="mt")
    y += L.name_h - 14 * s + gaps[3]
    d.text((W / 2, y), CONTENT["title"], font=L.f_title, fill=GREY_TXT, anchor="mt")
    y += L.title_h + gaps[4]

    # ---- divider: three flag-colour dots ------------------------------------
    r = 7 * s
    yc = y + L.rule_h / 2 + 4 * s
    for i, c in enumerate([UG_BLACK, UG_YELLOW, UG_RED]):
        cx = W / 2 + (i - 1) * 42 * s
        d.ellipse([cx - r, yc - r, cx + r, yc + r], fill=c)
    y += L.rule_h + 8 * s + gaps[5]

    # ---- message ------------------------------------------------------------
    for line in CONTENT["message"]:
        d.text((W / 2, y), line, font=L.f_msg, fill=GREY_TXT, anchor="mt")
        y += text_h(L.f_msg) + 10 * s
    y += gaps[6] - 10 * s

    # ---- sponsors -----------------------------------------------------------
    lw, _ = tracked_width(d, CONTENT["sponsors_label"], L.f_label, 6 * s)
    draw_tracked(d, W / 2, y, CONTENT["sponsors_label"], L.f_label, GREY_SOFT, 6 * s)
    ly = y + text_h(L.f_label) / 2
    dash = 60 * s
    d.rectangle([W / 2 - lw / 2 - dash - 20 * s, ly, W / 2 - lw / 2 - 20 * s, ly + 2 * s], fill=GREY_SOFT)
    d.rectangle([W / 2 + lw / 2 + 20 * s, ly, W / 2 + lw / 2 + dash + 20 * s, ly + 2 * s], fill=GREY_SOFT)
    y += text_h(L.f_label) + 18 * s

    cards = []
    inset = 8 * s
    pz = logo_fitted(PIZZA_LOGO, L.card_h - 2 * inset, L.card_h - 2 * inset)
    pw = pz.size[0] + 2 * inset
    card = Image.new("RGBA", (round(pw), round(L.card_h)), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle([0, 0, pw, L.card_h], radius=18 * s, fill=WHITE)
    card.paste(pz, (round((pw - pz.size[0]) / 2), round((L.card_h - pz.size[1]) / 2)), pz)
    cards.append(card)

    if os.path.exists(STX_LOGO):
        # logo ships on its own dark background -> use it as a rounded dark tile
        sx = logo_fitted(STX_LOGO, L.card_h, L.card_h * 1.8)
        m = Image.new("L", sx.size, 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, sx.size[0], sx.size[1]],
                                            radius=18 * s, fill=255)
        sx.putalpha(m)
        cards.append(sx)
    else:
        f_wm = font("Montserrat-Bold.ttf", 34 * s)
        wm = "ScottsTechX"
        bw = mono_badge(round(72 * s), s, "STX", INK, UG_YELLOW, 22 * s)
        twm = d.textlength(wm, font=f_wm)
        cw = round(bw.size[0] + 16 * s + twm + 2 * 30 * s)
        card = Image.new("RGBA", (cw, round(L.card_h)), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, cw, L.card_h], radius=18 * s, fill=WHITE)
        cx0 = round(30 * s)
        card.paste(bw, (cx0, round((L.card_h - bw.size[0]) / 2)), bw)
        cd.text((cx0 + bw.size[0] + 16 * s, L.card_h / 2), wm, font=f_wm, fill=INK, anchor="lm")
        cards.append(card)

    gap_c = 26 * s
    total_w = sum(c.size[0] for c in cards) + gap_c * (len(cards) - 1)
    cx = W / 2 - total_w / 2
    for c in cards:
        sh_l = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh_l).rounded_rectangle(
            [cx, y + 6 * s, cx + c.size[0], y + c.size[1] + 6 * s],
            radius=18 * s, fill=(30, 25, 15, 70))
        sh_l = sh_l.filter(ImageFilter.GaussianBlur(round(10 * s)))
        img = Image.alpha_composite(img, sh_l)
        img.paste(c, (round(cx), round(y)), c)
        cx += c.size[0] + gap_c
    d = ImageDraw.Draw(img)

    # ---- footer -------------------------------------------------------------
    fy = H - L.foot_h
    d.rectangle([0, fy - 5 * s, W, fy], fill=UG_YELLOW)
    d.rectangle([0, fy - 9 * s, W, fy - 5 * s], fill=UG_RED)
    d.rectangle([0, fy, W, H], fill=INK)
    d.text((W / 2, fy + L.foot_h / 2 - 2 * s), CONTENT["footer"], font=L.f_foot, fill=CREAM, anchor="mm")

    img = img.convert("RGB")
    img.save(out_png, dpi=(300, 300))
    if pdf:
        img.save(out_png.replace(".png", ".pdf"), resolution=300.0)
    return out_png


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    build(3508, 4961, os.path.join(OUT, "poster_A3_print.png"), pdf=True)
    build(1080, 1350, os.path.join(OUT, "poster_social_feed_1080x1350.png"))
    build(1080, 1920, os.path.join(OUT, "poster_story_1080x1920.png"))
    for n, w in [("poster_A3_print.png", 760), ("poster_social_feed_1080x1350.png", 520),
                 ("poster_story_1080x1920.png", 450)]:
        im = Image.open(os.path.join(OUT, n))
        im.resize((w, round(w * im.size[1] / im.size[0])), Image.LANCZOS).save(
            os.path.join(OUT, "_prev_" + n))
    print("done")
