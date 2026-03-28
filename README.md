# Save Image As Type

A minimal Chrome extension that adds a **"Save image as type"** sub-menu to the right-click context menu on any image, letting you download it as JPEG, PNG, or WebP — converted entirely in the browser with no external services.

---

## Features

- Right-click any image → **Save image as type** → pick a format
- Converts in-browser using the Canvas API — no uploads, no servers
- Handles cross-origin images via a service-worker fetch fallback
- Preserves original filename, swapping only the extension
- White background fill for JPEG exports (no alpha channel support in JPEG)
- Lightweight toast notification confirms each download

---

## Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| JPEG | `.jpg` | Lossy, small file size. Transparency filled white. |
| PNG | `.png` | Lossless, full transparency support. |
| WebP | `.webp` | Modern format, good compression with transparency. |

---

## Installation

This extension is not on the Chrome Web Store. Install it in developer mode:

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right corner)
4. Click **Load unpacked**
5. Select the repository folder
6. The extension is active immediately — no restart needed

---

## Usage

1. Right-click any image on a webpage
2. Hover **"Save image as type"**
3. Select your desired format from the sub-menu
4. The converted file downloads to your default downloads folder

---

## File Structure

```
├── manifest.json    Extension manifest (Manifest V3)
├── background.js    Service worker — context menus, conversion, download
├── content.js       Injected into pages — toast notifications only
├── style.css        Toast styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `contextMenus` | Add the right-click sub-menu |
| `downloads` | Trigger the file download |
| `scripting` | Inject the canvas conversion function into the page |
| `activeTab` | Target the current tab for script injection |
| `host_permissions: <all_urls>` | Fetch cross-origin images from the service worker |

---

## Known Limitations

- **Animated GIFs / WebP**: only the first frame is saved — animation is not preserved
- **TIFF, HEIC, RAW**: not supported — Chrome cannot decode these natively
- **Hotlink-protected images**: some CDNs return a placeholder or 403 when fetched outside the page context
- **Very large images**: subject to browser canvas size limits (max ~32,767 × 32,767px in Chrome)
- **Colour profiles**: embedded ICC profiles are discarded; output is always sRGB

---

## Privacy

All processing happens locally in your browser. No image data, metadata, or usage information is sent anywhere.

---

## License

MIT
