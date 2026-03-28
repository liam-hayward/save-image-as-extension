// ─── Format Definitions ───────────────────────────────────────────────────

const FORMATS = [
  { id: "jpg",  label: "JPEG (.jpg)",  mimeType: "image/jpeg", ext: "jpg",  quality: 0.92 },
  { id: "png",  label: "PNG (.png)",   mimeType: "image/png",  ext: "png",  quality: 1.0  },
  { id: "webp", label: "WebP (.webp)", mimeType: "image/webp", ext: "webp", quality: 0.92 },
];

// ─── Context Menu Setup ────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
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
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function baseName(url) {
  let name = url.split("/").pop().split("?")[0] || "image";
  name = name.replace(/\.[a-zA-Z0-9]+$/, "").trim();
  return name || "image";
}

// Fetch image bytes in the service worker (has full cross-origin access)
// and return as a base64 data URL. Chunked btoa avoids call-stack overflow
// on large images that a naive char-by-char loop would hit.
async function fetchImageAsDataUrl(srcUrl) {
  const response = await fetch(srcUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching image`);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function sendToast(tabId, message, variant = "success") {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SIAT_TOAST", message, variant });
  } catch (_) {
    // Tab may not have the content script (e.g. chrome:// pages) — fail silently
  }
}

// ─── Context Menu Click Handler ────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const match = info.menuItemId.match(/^saveAs_(.+)$/);
  if (!match) return;

  const format = FORMATS.find(f => f.id === match[1]);
  if (!format) return;

  const srcUrl = info.srcUrl;
  if (!srcUrl) return;

  try {
    // Step 1: try converting inside the page (fast, works for same-origin images)
    let results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: convertImageInPage,
      args: [srcUrl, format.mimeType, format.ext, format.quality],
    });

    let result = results?.[0]?.result;

    // Step 2: cross-origin fallback — fetch in the service worker, convert in page
    if (result?.crossOriginFailed) {
      let fetchedDataUrl;
      try {
        fetchedDataUrl = await fetchImageAsDataUrl(srcUrl);
      } catch (fetchErr) {
        console.error("Save Image As Type: fetch failed:", fetchErr);
        await sendToast(tab.id, "Failed to fetch image.", "error");
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
      await sendToast(tab.id, "Could not convert image.", "error");
      return;
    }

    if (result?.dataUrl) {
      await chrome.downloads.download({
        url:      result.dataUrl,
        filename: result.filename,
        saveAs:   false,
      });
      await sendToast(tab.id, `Saved as ${format.ext.toUpperCase()}: ${result.filename}`);
    }

  } catch (err) {
    console.error("Save Image As Type:", err);
    await sendToast(tab.id, "Something went wrong.", "error");
  }
});

// ─── Injected Function 1: page-side conversion ────────────────────────────
// Returns { crossOriginFailed: true } if the canvas is tainted.

function convertImageInPage(srcUrl, mimeType, ext, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const w = img.naturalWidth  || img.width  || 512;
        const h = img.naturalHeight || img.height || 512;

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
// The service worker fetched the bytes; this converts them inside the page.
// Parses SVG viewBox for accurate dimensions when width/height are absent.

function convertDataUrlInPage(fetchedDataUrl, mimeType, ext, quality, base) {
  return new Promise((resolve) => {

    function svgDimensions(dataUrl) {
      try {
        let svgText;
        if (dataUrl.startsWith("data:image/svg+xml;base64,"))
          svgText = atob(dataUrl.slice("data:image/svg+xml;base64,".length));
        else if (dataUrl.startsWith("data:image/svg+xml,"))
          svgText = decodeURIComponent(dataUrl.slice("data:image/svg+xml,".length));
        else
          return null;

        const svg = new DOMParser()
          .parseFromString(svgText, "image/svg+xml")
          .querySelector("svg");
        if (!svg) return null;

        const aw = parseFloat(svg.getAttribute("width"));
        const ah = parseFloat(svg.getAttribute("height"));
        if (aw > 0 && ah > 0) return { w: aw, h: ah };

        const vb = svg.getAttribute("viewBox");
        if (vb) {
          const [,, w, h] = vb.trim().split(/[\s,]+/).map(Number);
          if (w > 0 && h > 0) return { w, h };
        }
      } catch (_) {}
      return null;
    }

    const dims = fetchedDataUrl.startsWith("data:image/svg")
      ? svgDimensions(fetchedDataUrl)
      : null;

    const img = new Image();
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
        resolve({ dataUrl: canvas.toDataURL(mimeType, quality), filename: `${base}.${ext}` });
      } catch (e) {
        resolve({ error: e.message });
      }
    };
    img.onerror = () => resolve({ error: "Could not decode fetched image data." });
    img.src = fetchedDataUrl;
  });
}
