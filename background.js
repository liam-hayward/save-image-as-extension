// ─── Format Definitions ───────────────────────────────────────────────────

const FORMATS = [
  { id: "jpg",  label: "JPEG (.jpg)",  mimeType: "image/jpeg", ext: "jpg",  quality: 0.92 },
  { id: "png",  label: "PNG (.png)",   mimeType: "image/png",  ext: "png",  quality: 1.0  },
  { id: "webp", label: "WebP (.webp)", mimeType: "image/webp", ext: "webp", quality: 0.92 },
];

const STANDALONE_EXTS = ["svg","png","jpg","jpeg","webp","gif","avif","bmp","ico"];
const STANDALONE_PATTERNS = STANDALONE_EXTS.flatMap(e => [
  `*://*/*/*.${e}`, `*://*/*/*.${e}?*`,
]);

// ─── Context Menu Setup ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Right-clicking an <img> element on a normal page
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

  // Right-clicking anywhere on a standalone image/SVG tab
  chrome.contextMenus.create({
    id: "savePageImageAsType",
    title: "Save image as type",
    contexts: ["page"],
    documentUrlPatterns: STANDALONE_PATTERNS,
  });
  for (const fmt of FORMATS) {
    chrome.contextMenus.create({
      id: `savePageAs_${fmt.id}`,
      parentId: "savePageImageAsType",
      title: fmt.label,
      contexts: ["page"],
    });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function baseName(url) {
  let name = url.split("/").pop().split("?")[0] || "image";
  name = name.replace(/\.[a-zA-Z0-9]+$/, "").trim();
  return name || "image";
}

async function fetchImageAsDataUrl(srcUrl) {
  const response = await fetch(srcUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${blob.type};base64,${btoa(binary)}`;
}

// ─── Offscreen document helpers ───────────────────────────────────────────
// Service workers have no DOM/canvas. For standalone image tabs where we
// can't inject into the page, we spin up a hidden offscreen document that
// CAN use canvas, do the conversion there, and pass the result back.

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url:    "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Convert image to canvas data URL for download",
    });
  }
}

async function convertViaOffscreen(fetchedDataUrl, mimeType, ext, quality, base) {
  await ensureOffscreenDocument();

  return new Promise((resolve) => {
    const handler = (message) => {
      if (message.type === "SIAT_CONVERT_RESULT") {
        chrome.runtime.onMessage.removeListener(handler);
        resolve(message.result);
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    chrome.runtime.sendMessage({
      type:          "SIAT_CONVERT",
      fetchedDataUrl,
      mimeType,
      ext,
      quality,
      base,
    });
  });
}

// ─── Context Menu Click Handler ────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const imgMatch  = info.menuItemId.match(/^saveAs_(.+)$/);
    const pageMatch = info.menuItemId.match(/^savePageAs_(.+)$/);

    const formatId = imgMatch?.[1] ?? pageMatch?.[1];
    if (!formatId) return;

    const format = FORMATS.find(f => f.id === formatId);
    if (!format) return;

    const srcUrl = info.srcUrl || (pageMatch ? tab.url : null);
    if (!srcUrl) return;

    if (pageMatch) {
      // ── Standalone image tab ─────────────────────────────────────────
      // We cannot inject scripts into Chrome's built-in image viewer, so
      // fetch the bytes here and convert via the offscreen document instead.
      let fetchedDataUrl;
      try {
        fetchedDataUrl = await fetchImageAsDataUrl(srcUrl);
      } catch (fetchErr) {
        console.error("Save Image As Type: fetch failed:", fetchErr);
        return;
      }

      const result = await convertViaOffscreen(
        fetchedDataUrl, format.mimeType, format.ext, format.quality, baseName(srcUrl)
      );

      if (result?.error) {
        console.error("Save Image As Type:", result.error);
        return;
      }
      if (result?.dataUrl) {
        await chrome.downloads.download({
          url:      result.dataUrl,
          filename: result.filename,
          saveAs:   false,
        });
      }

    } else {
      // ── Normal page: inject into the tab ─────────────────────────────
      let results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: convertImageInPage,
        args: [srcUrl, format.mimeType, format.ext, format.quality],
      });

      let result = results?.[0]?.result;

      if (result?.crossOriginFailed) {
        let fetchedDataUrl;
        try {
          fetchedDataUrl = await fetchImageAsDataUrl(srcUrl);
        } catch (fetchErr) {
          console.error("Save Image As Type: background fetch failed:", fetchErr);
          return;
        }

        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: convertDataUrlInPage,
          args: [fetchedDataUrl, format.mimeType, format.ext, format.quality, baseName(srcUrl)],
        });
        result = results?.[0]?.result;
      }

      if (result?.error) {
        console.error("Save Image As Type:", result.error);
        return;
      }
      if (result?.dataUrl) {
        await chrome.downloads.download({
          url:      result.dataUrl,
          filename: result.filename,
          saveAs:   false,
        });
      }
    }

  } catch (err) {
    console.error("Save Image As Type: unhandled error:", err);
  }
});

// ─── Injected Function 1: page-side conversion ────────────────────────────

function convertImageInPage(srcUrl, mimeType, ext, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        let w = img.naturalWidth  || img.width;
        let h = img.naturalHeight || img.height;

        if ((!w || !h) && /\.svg(\?|$)/i.test(srcUrl)) {
          const domImg = [...document.querySelectorAll("img")].find(
            el => el.src === srcUrl || el.currentSrc === srcUrl
          );
          if (domImg) {
            w = domImg.naturalWidth  || domImg.offsetWidth  || w;
            h = domImg.naturalHeight || domImg.offsetHeight || h;
          }
        }

        w = w || 512;
        h = h || 512;

        const canvas = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (mimeType === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL(mimeType, quality);

        let base = srcUrl.split("/").pop().split("?")[0] || "image";
        base = base.replace(/\.[a-zA-Z0-9]+$/, "") || "image";

        resolve({ dataUrl, filename: `${base}.${ext}` });
      } catch (e) {
        resolve({ crossOriginFailed: true });
      }
    };

    img.onerror = () => resolve({ crossOriginFailed: true });
    img.src = srcUrl;
  });
}

// ─── Injected Function 2: convert a pre-fetched data URL ──────────────────

function convertDataUrlInPage(fetchedDataUrl, mimeType, ext, quality, base) {
  return new Promise((resolve) => {

    function svgDimensions(dataUrl) {
      try {
        let svgText;
        if (dataUrl.startsWith("data:image/svg+xml;base64,")) {
          svgText = atob(dataUrl.slice("data:image/svg+xml;base64,".length));
        } else if (dataUrl.startsWith("data:image/svg+xml,")) {
          svgText = decodeURIComponent(dataUrl.slice("data:image/svg+xml,".length));
        } else {
          return null;
        }
        const parser = new DOMParser();
        const doc    = parser.parseFromString(svgText, "image/svg+xml");
        const svg    = doc.querySelector("svg");
        if (!svg) return null;
        const aw = parseFloat(svg.getAttribute("width"));
        const ah = parseFloat(svg.getAttribute("height"));
        if (aw > 0 && ah > 0) return { w: aw, h: ah };
        const vb = svg.getAttribute("viewBox");
        if (vb) {
          const parts = vb.trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4 && parts[2] > 0 && parts[3] > 0)
            return { w: parts[2], h: parts[3] };
        }
      } catch (_) {}
      return null;
    }

    const isSvg = fetchedDataUrl.startsWith("data:image/svg");
    const dims  = isSvg ? svgDimensions(fetchedDataUrl) : null;
    const img   = new Image();

    img.onload = () => {
      try {
        const w = dims?.w || img.naturalWidth  || img.width  || 512;
        const h = dims?.h || img.naturalHeight || img.height || 512;
        const canvas = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (mimeType === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve({ dataUrl, filename: `${base}.${ext}` });
      } catch (e) {
        resolve({ error: e.message });
      }
    };

    img.onerror = () => resolve({ error: "Could not decode fetched image data." });
    img.src = fetchedDataUrl;
  });
}
