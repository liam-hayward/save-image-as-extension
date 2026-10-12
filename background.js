importScripts("settings.js", "format-size.js");   // DEFAULT_SETTINGS, loadSettings(), formatSize()

// Code that runs inside web pages lives in page.js; this file is the
// service worker, which runs in the background.

// ─── Format Definitions ───────────────────────────────────────────────────
// qualitySetting names the setting that holds that format's quality (1–100).
// PNG is lossless, so it has none.

const FORMATS = [
  { id: "jpg",  name: "JPEG", label: "JPEG (.jpg)",  mimeType: "image/jpeg", ext: "jpg",  qualitySetting: "jpgQuality"  },
  { id: "png",  name: "PNG",  label: "PNG (.png)",   mimeType: "image/png",  ext: "png",  qualitySetting: null          },
  { id: "webp", name: "WebP", label: "WebP (.webp)", mimeType: "image/webp", ext: "webp", qualitySetting: "webpQuality" },
];

// Canvas expects quality as 0–1; settings store it as 1–100
function qualityFor(format, settings) {
  return format.qualitySetting ? settings[format.qualitySetting] / 100 : 1;
}

// ─── Context Menu Setup ────────────────────────────────────────────────────

// Menu items persist across extension reloads/updates, so clear them first —
// otherwise create() fails with "Cannot create item with duplicate id".
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await loadSettings();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "saveImageAsType",
    title: "Save image as type",
    contexts: ["image"],
  });
  for (const fmt of FORMATS) {
    chrome.contextMenus.create({
      id: `saveAs_${fmt.id}`,
      parentId: "saveImageAsType",
      title: fmt.label,
      contexts: ["image"],
    });
  }
  chrome.contextMenus.create({
    id: "separator",
    parentId: "saveImageAsType",
    type: "separator",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "compareSizes",
    parentId: "saveImageAsType",
    title: "Compare sizes…",
    contexts: ["image"],
    visible: settings.showCompare,
  });
  chrome.contextMenus.create({
    id: "openSettings",
    parentId: "saveImageAsType",
    title: "Settings…",
    contexts: ["image"],
  });
});

// Show or hide "Compare sizes…" the moment the setting changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "showCompare" in changes) {
    chrome.contextMenus.update("compareSizes", { visible: changes.showCompare.newValue });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

// Turn an image URL into a safe filename without extension.
// e.g. ".../my%20photo.jpg?w=800" → "my photo"
function baseName(url) {
  // data: URLs have no real name — the "path" is the image bytes themselves
  if (url.startsWith("data:")) return "image";

  let name = url.split(/[?#]/)[0].split("/").pop();
  try {
    name = decodeURIComponent(name);            // "%20" → " "
  } catch (_) {
    // Malformed %-sequence — keep the raw name
  }
  name = name.replace(/\.[a-zA-Z0-9]+$/, "");   // drop the old extension
  return cleanFilename(name) || "image";
}

// Makes any text safe to use as a Windows filename (without extension).
function cleanFilename(name) {
  return name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")     // characters Windows forbids in filenames
    .replace(/^[.\s]+|[.\s]+$/g, "")            // leading/trailing dots and spaces
    .slice(0, 100);
}

// Names a file's real format from its first bytes. Every format starts with
// a fixed signature, so this is accurate even when the URL says ".jpg" but
// the server actually sent WebP. Returns null for anything unrecognised.
function sniffImageType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)          return "JPEG";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG")                             return "PNG";
  if (ascii(0, 4) === "GIF8")                                                 return "GIF";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")                      return "WebP";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12)))               return "AVIF";
  if (ascii(0, 2) === "BM")                                                   return "BMP";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)   return "ICO";
  if (/<svg[\s>]/i.test(ascii(0, 4096)))                                      return "SVG";
  return null;
}

// Fetch image bytes in the service worker (has full cross-origin access).
// Returns them as a base64 data URL, plus the file's real size and format.
// Chunked btoa avoids call-stack overflow on large images that a naive
// char-by-char loop would hit.
async function fetchImage(srcUrl) {
  const response = await fetch(srcUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return {
    dataUrl: `data:${blob.type};base64,${btoa(binary)}`,
    size:    bytes.length,
    type:    sniffImageType(bytes),
  };
}

// File size of a base64 data URL's contents: every 4 characters hold 3 bytes.
function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - padding;
}

// Swaps a base64 data URL's type label, e.g. when a server sent a WebP file
// labelled "application/octet-stream".
function retypeDataUrl(dataUrl, mimeType) {
  return `data:${mimeType};base64,` + dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// SVG has no fixed pixel size, so SVGs skip the in-page conversion and go
// through the fetch path, which reads the size the SVG declares. Judged by
// URL only: an SVG at a URL without ".svg" still converts, just at the size
// Chrome reports for it.
function isSvgUrl(url) {
  if (url.startsWith("data:")) return /^data:image\/svg\+xml[;,]/i.test(url);
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".svg");
  } catch (_) {
    return false;
  }
}

// Runs a function from page.js inside the page and returns its result, or
// { blocked: true } if Chrome won't let extensions script this page.
// page.js is injected first every time, so its functions exist even in tabs
// opened before the extension was installed or reloaded.
async function runInPage(target, fnName, args = []) {
  try {
    await chrome.scripting.executeScript({ target, files: ["format-size.js", "page.js"] });
    const results = await chrome.scripting.executeScript({
      target,
      func: (name, fnArgs) => globalThis[name](...fnArgs),
      args: [fnName, args],
    });
    return results?.[0]?.result;
  } catch (_) {
    return { blocked: true };
  }
}

// Explains why a page blocked the extension. Local files are the fixable case.
function blockedPageMessage(info) {
  const pageUrl = info.frameUrl || info.pageUrl || "";
  return pageUrl.startsWith("file:")
    ? 'Can\'t read local files. In chrome://extensions, open this extension\'s Details and turn on "Allow access to file URLs".'
    : "Chrome doesn't allow extensions to run on this page.";
}

// System notification, for pages where an in-page toast can't be shown.
function notify(message) {
  chrome.notifications.create({
    type:    "basic",
    iconUrl: "icons/icon128.png",
    title:   "Save Image As Type",
    message,
  });
}

// Shows a toast in the page, or a system notification if the page blocks it.
async function sendToast(tabId, message, variant = "success") {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["style.css"] });
  } catch (_) {
    // Page doesn't allow injection; runInPage below reports it as blocked
  }
  const result = await runInPage({ tabId }, "showToastInPage", [message, variant]);
  if (result?.blocked) notify(message);
}

// The filename without its extension: e.g. "photo", or with both filename
// options on "photo_1920x1080_245KB". width/height may be missing (e.g. the
// conversion failed but the original was kept); the dimensions are then
// left out.
function buildStem(srcUrl, settings, { width, height, bytes }) {
  const parts = [baseName(srcUrl)];
  if (settings.appendDimensions && width > 0 && height > 0) parts.push(`${width}x${height}`);
  // Same format as the Compare panel, minus the space: "29.5KB"
  if (settings.appendSize) parts.push(formatSize(bytes, settings.roundSizes).replace(" ", ""));
  return parts.join("_");
}

// Shows the rename box in the tab. Returns { name }, { cancelled: true },
// or { blocked: true } if the page doesn't allow it.
async function askFilename(tabId, stem, ext) {
  // Chrome stops a service worker after 30 seconds without extension
  // activity, which would lose the user's answer. Any extension API call
  // resets that timer, so make a harmless one while the box is open.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try {
    return await runInPage({ tabId }, "askFilenameInPage", [stem, ext]);
  } finally {
    clearInterval(keepAlive);
  }
}

// Downloads a converted image. Shared by the menu items and the Compare panel.
// Returns the filename, or null if the user cancelled the rename box.
async function downloadConverted(dataUrl, srcUrl, format, settings, dims, tabId) {
  let stem = buildStem(srcUrl, settings, {
    width:  Math.round(dims.width),
    height: Math.round(dims.height),
    bytes:  dataUrlBytes(dataUrl),
  });

  if (settings.saveMode === "rename") {
    const answer = await askFilename(tabId, stem, format.ext);
    if (answer?.cancelled) return null;
    if (typeof answer?.name === "string") {
      // Drop the extension if the user typed it too, then make it safe.
      // An empty name keeps the suggested one.
      const typed = answer.name.trim().replace(new RegExp(`\\.${format.ext}$`, "i"), "");
      stem = cleanFilename(typed) || stem;
    }
    // { blocked: true }: the page can't show the box, so save as suggested
  }

  const filename = `${stem}.${format.ext}`;
  await chrome.downloads.download({
    url:    dataUrl,
    filename,
    saveAs: settings.saveMode === "dialog",
  });
  return filename;
}

// ─── Context Menu Click Handler ────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "openSettings") {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (!info.srcUrl) return;

  if (info.menuItemId === "compareSizes") {
    await compareSizes(info, tab);
    return;
  }

  const match = info.menuItemId.match(/^saveAs_(.+)$/);
  if (!match) return;
  const format = FORMATS.find(f => f.id === match[1]);
  if (!format) return;

  await saveAsFormat(info, tab, format);
});

// ─── Save: one image, one format ──────────────────────────────────────────

async function saveAsFormat(info, tab, format) {
  const srcUrl = info.srcUrl;

  // Convert inside the frame the image is in. For an image inside an iframe,
  // the top page may be a different origin and unable to read it.
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };

  // Fetch the original alongside the conversion. It's the fallback if the
  // page can't read the image, and it shows whether the image is already in
  // this format. null if it can't be fetched (blob: URLs, login-only images).
  const originalPromise = fetchImage(srcUrl).catch((err) => {
    console.warn("Save Image As Type: fetch failed:", err);
    return null;
  });

  try {
    const settings = await loadSettings();
    const quality  = qualityFor(format, settings);

    // Step 1: try converting inside the page (fast, works for same-origin images)
    let result = isSvgUrl(srcUrl)
      ? { crossOriginFailed: true }
      : await runInPage(target, "convertImageInPage", [srcUrl, format.mimeType, quality]);

    if (result?.blocked) {
      notify(blockedPageMessage(info));
      return;
    }

    // Step 2: cross-origin (and SVG) fallback — fetch in the service worker, convert in page
    if (result?.crossOriginFailed) {
      const fetched = await originalPromise;
      if (!fetched) {
        await sendToast(tab.id, "Failed to fetch image.", "error");
        return;
      }

      result = await runInPage(target, "convertDataUrlInPage", [fetched.dataUrl, format.mimeType, quality]);
      if (result?.blocked) {
        notify(blockedPageMessage(info));
        return;
      }
    }

    // Images over Chrome's canvas size limit don't throw — toDataURL just
    // returns the empty "data:," instead, which would download a 0-byte file.
    const converted = result?.dataUrl && result.dataUrl !== "data:," ? result.dataUrl : null;

    // Re-encoding a file into its own format can't add quality, and often
    // makes it bigger. If the original is already this format and no
    // bigger, save the original unchanged.
    const original = await originalPromise;
    const keepOriginal = original?.type === format.name &&
                         (!converted || original.size <= dataUrlBytes(converted));

    if (!keepOriginal && !converted) {
      console.error("Save Image As Type:", result?.error ?? "Canvas produced no data (image may be too large).");
      await sendToast(tab.id, "Could not convert image.", "error");
      return;
    }

    const dataUrl  = keepOriginal ? retypeDataUrl(original.dataUrl, format.mimeType) : converted;
    const filename = await downloadConverted(dataUrl, srcUrl, format, settings,
                                             { width: result?.width, height: result?.height }, tab.id);
    if (!filename) return;   // user cancelled the rename box
    // With the Save dialog on, the user may cancel or rename the file, so a
    // "Saved as <filename>" toast could be wrong. The dialog is feedback enough.
    if (settings.saveMode !== "dialog") {
      await sendToast(tab.id, keepOriginal
        ? `Already ${format.name}, saved the original: ${filename}`
        : `Saved as ${format.ext.toUpperCase()}: ${filename}`);
    }

  } catch (err) {
    console.error("Save Image As Type:", err);
    await sendToast(tab.id, "Something went wrong.", "error");
  }
}

// ─── Compare sizes: one image, every format ───────────────────────────────
// The panel opens in the top frame so it's never squeezed inside a small
// iframe. The conversions happen in the page, and the results stay there
// until the user clicks Download.

async function compareSizes(info, tab) {
  const srcUrl   = info.srcUrl;
  const target   = { tabId: tab.id, frameIds: [0] };
  const settings = await loadSettings();
  const outputs  = FORMATS.map(f => ({
    id:       f.id,
    name:     f.name,
    type:     f.name,       // compared with the original's detected type
    mimeType: f.mimeType,
    quality:  f.qualitySetting ? qualityFor(f, settings) : null,   // null: no slider
  }));

  const opened = await runInPage(target, "showComparePanel", [outputs]);
  if (opened?.blocked) {
    notify(blockedPageMessage(info));
    return;
  }

  // The original's bytes give its exact format and file size. This fails for
  // blob: URLs and images that need a login; the panel then reads the image
  // straight from the page and shows its dimensions only.
  let fetched = null;
  try {
    fetched = await fetchImage(srcUrl);
  } catch (err) {
    console.warn("Save Image As Type: compare fetch failed:", err);
  }

  await runInPage(target, "fillComparePanel", [{
    srcUrl,
    fetchedDataUrl: fetched?.dataUrl ?? null,
    original:       fetched ? { type: fetched.type, size: fetched.size } : null,
    outputs,
    roundSizes: settings.roundSizes,
    keepPanelOpen: settings.keepPanelOpen,
  }]);
}

// Download requests from the Compare panel's buttons
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "siat-download") return;

  const format = FORMATS.find(f => f.id === msg.formatId);
  // Only accept an image of the format the button claims to be
  if (!format || typeof msg.dataUrl !== "string" || !msg.dataUrl.startsWith(`data:${format.mimeType}`)) {
    sendResponse({ ok: false });
    return;
  }

  loadSettings()
    .then(settings => downloadConverted(msg.dataUrl, msg.srcUrl, format, settings,
                                        { width: Number(msg.width), height: Number(msg.height) },
                                        sender.tab?.id)
      .then(filename => sendResponse({
        ok: true,
        // Saved under a name we know: not cancelled, and not handed to Chrome's Save dialog
        confirmed: filename !== null && settings.saveMode !== "dialog",
      })))
    .catch(err => {
      console.error("Save Image As Type: panel download failed:", err);
      sendResponse({ ok: false });
    });
  return true;   // keeps the reply channel open until the download starts
});
