# Save Image As Type — Chrome Extension

Right-click any image on the web and save it as **JPEG**, **PNG**, or **WebP** — converted entirely in the browser.

---

## File Structure

```
image-converter-extension/
├── manifest.json   — Extension manifest (MV3)
├── background.js   — Service worker: context menus + conversion logic
├── content.js      — Toast notification injected into pages
├── style.css       — Toast styles
└── icons/          — Add your own icon PNGs here (16, 48, 128 px)
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

> **Icons are required.** Chrome will refuse to load the extension without them.
> Create simple PNGs (a coloured square is fine for testing) and place them in an `icons/` folder.

---

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `image-converter-extension/` folder
5. The extension is now active — no restart needed

---

## Usage

1. Right-click any image on a webpage
2. Hover **"Save image as type"**
3. Pick a format from the sub-menu:
   - **JPEG (.jpg)** — great for photos, small file size
   - **PNG (.png)** — lossless, supports transparency
   - **WebP (.webp)** — modern, excellent compression
4. The file downloads automatically to your default downloads folder

---

## Notes

- **JPEG exports**: transparency is replaced with a white background (JPEG has no alpha channel).
- **Cross-origin images**: the extension attempts a `fetch()` fallback for images that block `crossOrigin="anonymous"`. Some heavily restricted CDNs may still block conversion.
- All conversion happens locally in the browser — no data is sent anywhere.
