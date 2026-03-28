// offscreen.js — runs in the hidden offscreen document
// Listens for SIAT_CONVERT messages from the service worker,
// uses canvas to convert the image, and sends the result back.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "SIAT_CONVERT") return;

  const { fetchedDataUrl, mimeType, ext, quality, base } = message;

  convertImage(fetchedDataUrl, mimeType, ext, quality, base)
    .then(result => {
      chrome.runtime.sendMessage({ type: "SIAT_CONVERT_RESULT", result });
    });

  return true; // keep message channel open
});

// ── Parse SVG viewBox/width/height from a data URL ──────────────────────
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

function convertImage(fetchedDataUrl, mimeType, ext, quality, base) {
  return new Promise((resolve) => {
    const isSvg = fetchedDataUrl.startsWith("data:image/svg");
    const dims  = isSvg ? svgDimensions(fetchedDataUrl) : null;

    const img = new Image();

    img.onload = () => {
      try {
        const w = dims?.w || img.naturalWidth  || img.width  || 512;
        const h = dims?.h || img.naturalHeight || img.height || 512;

        const canvas = document.getElementById("c");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, w, h);
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

    img.onerror = () => resolve({ error: "Could not load image in offscreen document." });
    img.src = fetchedDataUrl;
  });
}
