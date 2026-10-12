# Save Image As Type

A Chrome extension that adds a **"Save image as type"** sub-menu to the right-click menu on any image, letting you download it as JPEG, PNG or WebP. Conversion happens entirely in your browser, with no external services.

---

## Features

- Right-click any image → **Save image as type** → pick a format
- Converts in-browser using the Canvas API - no uploads, no servers
- Handles cross-origin images via a service-worker fetch fallback
- Keeps the original filename, swapping only the extension (dimensions and file size can be added - see [Settings](#settings))
- Never makes a same-format copy bigger: saving a WebP as WebP (etc.) keeps the original file if re-encoding would grow it
- White background fill for JPEG exports (JPEG has no transparency)
- **Compare sizes…** panel: converts an image to every format and shows the exact file sizes before you download
- Three ways to save: straight to Downloads, ask for a filename first, or Chrome's full Save dialog
- A toast confirms each download; pages that block extensions get a system notification instead
- Light and dark mode, following Chrome's Appearance setting

---

## Supported Formats

**Output:**

| Format | Extension | Notes |
|--------|-----------|-------|
| JPEG | `.jpg` | Lossy, small file size, 92% quality by default. Transparency filled white. |
| PNG | `.png` | Lossless, full transparency support. |
| WebP | `.webp` | Modern format, good compression with transparency, 99% quality by default. |

**Input:** anything Chrome can display in an `<img>` - JPEG, PNG, GIF, WebP, AVIF, SVG, BMP and ICO. The menu appears on `<img>` images only, not on CSS background images, inline `<svg>`, `<canvas>` or video.

---

## Installation

This extension is not on the Chrome Web Store. Install it in developer mode:

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right corner)
4. Click **Load unpacked**
5. Select the repository folder
6. The extension is active immediately - no restart needed
7. *(Optional)* To convert local images opened in Chrome (`file:///...`), click **Details** on the extension and turn on **Allow access to file URLs**

**Updating:** after pulling new code, click the reload icon on the extension in `chrome://extensions`. Close any Compare panel left open from before the reload; its buttons stop working.

---

## Usage

### Save as a format

1. Right-click any image on a webpage
2. Hover **"Save image as type"**
3. Select a format from the sub-menu
4. The file is saved according to your [save setting](#settings) - by default, straight to your Downloads folder

### Compare sizes

Right-click an image → **Save image as type** → **Compare sizes…**

A panel opens in the bottom-right corner showing:

- **The original:** its real format (read from the file itself, not the URL), dimensions and file size
- **Each format's exact size** once converted, with the smallest highlighted in green
- **A Quality slider** for JPEG and WebP. Dragging it re-converts and updates the size. It affects this panel only; your defaults live in Settings.
- **The original file, marked "original"**, on the row matching the image's own format, whenever re-converting would make it bigger

Click the download icon on the row you want. Hover it to see exactly what it saves. The icon dims while saving, then shows a green tick (saved) or a red warning (failed).

The panel closes when you:

- download successfully (unless **Keep the panel open after downloading** is on)
- click anywhere outside it
- press Esc or click ✕

### Settings

Open with right-click an image → **Save image as type** → **Settings…**, or **Details** → **Extension options** in `chrome://extensions`. Changes save instantly.

| Setting | Default | What it does |
|---------|---------|--------------|
| JPEG / WebP quality | 92% / 99% | Higher means sharper images and bigger files |
| Saving | Straight to Downloads | Or **ask for a filename** (a small box top-right; Enter saves, Esc cancels), or **Chrome's Save dialog** (filename and folder) |
| Add dimensions to filename | Off | `photo.jpg` → `photo_1920x1080.jpg` |
| Add file size to filename | Off | `photo.jpg` → `photo_29.5KB.jpg` |
| Round file sizes | Off | `30 KB` instead of `29.5 KB`, in the panel and filenames |
| Show "Compare sizes…" in the right-click menu | On | Hides the menu item when off |
| Keep the panel open after downloading | Off | Stops the panel closing after a download |

File sizes use powers of 1024, like Windows, and switch units at 1000 (so `0.99 MB`, never `1010 KB`).

---

## File Structure

```
├── manifest.json    Extension manifest (Manifest V3)
├── background.js    Service worker — context menus, fetching, downloads
├── page.js          Runs inside the web page — conversion, toast, Compare panel, rename box
├── settings.js      Default settings, shared by background.js and the settings page
├── format-size.js   File size formatting, shared by background.js and page.js
├── options.html     Settings page
├── options.js       Settings page logic
├── style.css        Toast styles (injected only when a toast is shown)
├── LICENSE          MIT licence
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
| `downloads` | Save the converted file |
| `notifications` | Show a message on pages where the in-page toast can't appear (e.g. `chrome://` pages) |
| `scripting` | Run the conversion, toast, Compare panel and rename box inside the page |
| `storage` | Remember your settings (stored on this computer only, not synced) |
| `host_permissions: <all_urls>` | Run inside any page, and re-download images from any site in the background |

The extension does not use the `cookies` permission and never reads or sends cookies.

---

## Known Limitations

- **Animated GIFs / WebP**: only the first frame is saved - animation is not preserved
- **TIFF, HEIC, RAW**: not supported - Chrome cannot decode these
- **Pages that block extensions** (`chrome://` pages, the Chrome Web Store, local files without **Allow access to file URLs**): images can't be converted there, and a notification explains why instead
- **Images that need a login**: the background re-download doesn't carry your login, so it can fail for private images. Same-site images usually still save; SVGs and images from other sites may show "Failed to fetch image". The Compare panel then shows dimensions only.
- **Hotlink-protected images**: some sites return a placeholder or an error when the image is fetched outside the page
- **Very large images**: Chrome's canvas is limited to 32,767px on a side and about 268 million pixels in total (e.g. 16,384 × 16,384)
- **Colour profiles**: embedded ICC profiles are discarded; output is always sRGB

---

## Privacy

All conversion happens locally in your browser. The extension makes one kind of network request: it re-downloads the image you clicked from the site it came from, to read its real format and size. Nothing is sent to any other server, and your settings stay on this computer.

---

## Credits

Icons in the Compare sizes panel are from [Tabler Icons](https://tabler.io/icons) (MIT licence, © Paweł Kuna).

---

## License

MIT
