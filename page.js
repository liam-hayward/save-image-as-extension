// ─── page.js: everything that runs inside the web page ────────────────────
// background.js injects this file (after format-size.js) into the page just
// before calling one of its functions (see runInPage). It is injected again on every use, so:
// only function declarations at the top level. A top-level const or let
// would throw "already declared" the second time this file runs.

// ─── Shared image helpers ─────────────────────────────────────────────────

// Loads src into an <img>. useCors asks the image's server for permission
// to read its pixels; without that permission the canvas is "tainted" and
// can't be exported.
function siatLoadImage(src, useCors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) img.crossOrigin = "anonymous";
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load."));
    img.src = src;
  });
}

// Reads the size an SVG declares for itself from a data: URL, or null.
function siatSvgDimensions(dataUrl) {
  try {
    // The header is everything before the first comma, and may carry
    // extra parameters, e.g. "data:image/svg+xml; charset=utf-8;base64"
    const comma  = dataUrl.indexOf(",");
    const header = dataUrl.slice(0, comma);
    const body   = dataUrl.slice(comma + 1);
    if (!/^data:image\/svg\+xml/i.test(header)) return null;
    const svgText = /;base64$/i.test(header) ? atob(body) : decodeURIComponent(body);

    const svg = new DOMParser()
      .parseFromString(svgText, "image/svg+xml")
      .querySelector("svg");
    if (!svg) return null;

    // Only plain numbers or "px" are pixel sizes; "100%" or "2em" are not
    const px = v => /^\s*[\d.]+(px)?\s*$/.test(v ?? "") ? parseFloat(v) : 0;
    const aw = px(svg.getAttribute("width"));
    const ah = px(svg.getAttribute("height"));
    if (aw > 0 && ah > 0) return { w: aw, h: ah };

    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const [,, w, h] = vb.trim().split(/[\s,]+/).map(Number);
      if (w > 0 && h > 0) return { w, h };
    }
  } catch (_) {}
  return null;
}

// Pixel size to export at. SVGs use their declared size when available.
function siatImageSize(img, src) {
  const dims = src.startsWith("data:image/svg") ? siatSvgDimensions(src) : null;
  return {
    w: dims?.w || img.naturalWidth  || img.width  || 512,
    h: dims?.h || img.naturalHeight || img.height || 512,
  };
}

// Draws the image onto a new canvas, ready to export as mimeType.
function siatDrawToCanvas(img, w, h, mimeType) {
  const canvas = document.createElement("canvas");
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (mimeType === "image/jpeg") {
    // JPEG has no transparency; without this, transparent areas turn black
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

// ─── Save: convert one image to one format ────────────────────────────────

// Converts the image at its original URL. Returns { crossOriginFailed: true }
// if the page isn't allowed to read its pixels.
async function convertImageInPage(srcUrl, mimeType, quality) {
  try {
    const img = await siatLoadImage(srcUrl, true);
    const { w, h } = siatImageSize(img, srcUrl);
    return { dataUrl: siatDrawToCanvas(img, w, h, mimeType).toDataURL(mimeType, quality), width: w, height: h };
  } catch (_) {
    return { crossOriginFailed: true };
  }
}

// Converts bytes the service worker already fetched (as a data: URL).
async function convertDataUrlInPage(fetchedDataUrl, mimeType, quality) {
  let img;
  try {
    img = await siatLoadImage(fetchedDataUrl, false);
  } catch (_) {
    return { error: "Could not decode fetched image data." };
  }
  try {
    const { w, h } = siatImageSize(img, fetchedDataUrl);
    return { dataUrl: siatDrawToCanvas(img, w, h, mimeType).toDataURL(mimeType, quality), width: w, height: h };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Toast notification ───────────────────────────────────────────────────
// Styles come from style.css, inserted by sendToast() just before this runs.

function showToastInPage(message, variant) {
  document.getElementById("__siat_toast__")?.remove();

  const toast = document.createElement("div");
  toast.id = "__siat_toast__";
  toast.className = `siat-toast siat-toast--${variant}`;

  const icon = document.createElement("span");
  icon.className = "siat-toast__icon";
  icon.textContent = variant === "success" ? "✓" : "✕";

  // textContent, not innerHTML: the message contains a filename taken from
  // the image URL, which must never be interpreted as HTML.
  const msg = document.createElement("span");
  msg.className = "siat-toast__msg";
  msg.textContent = message;

  toast.append(icon, msg);
  document.body.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("siat-toast--visible"));
  });

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove("siat-toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Backup in case no transition runs (e.g. tab hidden mid-fade) — the
    // fade is 200ms, so by 500ms the toast should be gone either way.
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// ─── Compare sizes panel ──────────────────────────────────────────────────
// Built inside a shadow root: a sealed-off piece of the page that the
// site's own CSS can't reach, so its styles can't distort the panel.

// Colours and shapes follow Chrome's own menus and dialogs, in light and
// dark mode. Dark mode follows Chrome's Appearance setting. Shared by the
// Compare panel and the rename box.
function siatThemeCss() {
  return `
    :host {
      all: initial !important;
      position: fixed !important;
      z-index: 2147483647 !important;
      --surface: #ffffff;
      --text: #1f1f1f;
      --text-2: #444746;
      --divider: #e1e3e1;
      --outline: #747775;
      --primary: #0b57d0;
      --on-primary: #ffffff;
      --tonal: #d3e3fd;
      --on-tonal: #041e49;
      --hover: rgba(31, 31, 31, 0.08);
      --good: #146c2e;
      --bad: #b3261e;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --surface: #282a2c;
        --text: #e3e3e3;
        --text-2: #c4c7c5;
        --divider: #444746;
        --outline: #8e918f;
        --primary: #a8c7fa;
        --on-primary: #062e6f;
        --tonal: #004a77;
        --on-tonal: #c2e7ff;
        --hover: rgba(227, 227, 227, 0.08);
        --good: #6dd58c;
        --bad: #f2b8b5;
      }
    }
  `;
}

function siatPanelCss() {
  return siatThemeCss() + `
    :host { bottom: 24px !important; right: 24px !important; }
    .panel {
      box-sizing: border-box;
      width: 360px;
      padding: 16px 20px 12px;
      background: var(--surface);
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15);
      font: 400 13px/1.45 system-ui, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
    }
    header { display: flex; align-items: center; justify-content: space-between; }
    h1 { margin: 0; font-size: 15px; font-weight: 500; }
    .close {
      all: unset; cursor: pointer; width: 28px; height: 28px; margin-right: -6px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      color: var(--text-2);
    }
    .close:hover { background: var(--hover); }
    .close svg { width: 16px; height: 16px; }
    .original { margin: 2px 0 8px; color: var(--text-2); font-size: 12px; }
    .row {
      display: grid;
      grid-template-columns: 1fr auto auto;
      grid-template-areas: "name size dl" "quality quality quality";
      align-items: center;
      column-gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--divider);
    }
    .name { grid-area: name; font-weight: 500; }
    .note { margin-left: 6px; font-size: 11.5px; font-weight: 400; color: var(--text-2); }
    .note.good { color: var(--good); }
    .size { grid-area: size; font-variant-numeric: tabular-nums; }
    .size.good { color: var(--good); font-weight: 500; }
    .dl {
      all: unset; grid-area: dl; cursor: pointer;
      width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--tonal); color: var(--on-tonal);
    }
    .dl svg { width: 18px; height: 18px; }
    .dl:hover:not(:disabled) { box-shadow: inset 0 0 0 100px var(--hover); }
    .dl:disabled { cursor: default; opacity: 0.38; }
    .dl[data-state="saved"]  { color: var(--good); }
    .dl[data-state="failed"] { color: var(--bad); }
    .quality { grid-area: quality; display: flex; align-items: center; gap: 10px; margin-top: 6px; }
    .qlabel { font-size: 12px; color: var(--text-2); }
    .quality input { flex: 1; margin: 0; accent-color: var(--primary); }
    .quality output { width: 36px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; }
  `;
}

// Icons from Tabler Icons (tabler.io/icons, MIT licence), drawn as inline
// SVG so nothing is downloaded. name: "download", "check" or "alert".
function siatIcon(name) {
  const paths = {
    download: ["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2", "M7 11l5 5l5 -5", "M12 4l0 12"],
    check:    ["M5 12l5 5l10 -10"],
    alert:    ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 8v4", "M12 16h.01"],
  }[name];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// Shows a Download button's state as an icon, with a matching tooltip and
// screen-reader label. state: "ready", "saving", "saved" or "failed".
function siatSetDownloadButton(button, state, label) {
  const icon = { ready: "download", saving: "download", saved: "check", failed: "alert" }[state];
  button.replaceChildren(siatIcon(icon));
  button.dataset.state = state;
  button.title = label;
  button.setAttribute("aria-label", label);
}

// Opens the panel at once with placeholder rows, so the user sees something
// while the image is fetched and converted.
// outputs: [{ id, name, quality }]; quality is 0–1, or null for PNG.
function showComparePanel(outputs) {
  // Close any panel already open, through its own close routine so its
  // page-wide listeners are removed too
  document.getElementById("__siat_panel__")?.dispatchEvent(new Event("siat-close"));

  const host = document.createElement("siat-panel");
  host.id = "__siat_panel__";
  const root = host.attachShadow({ mode: "open" });
  // A constructed stylesheet, not a <style> tag: some sites' security rules
  // (CSP) block <style> tags added by scripts.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(siatPanelCss());
  root.adoptedStyleSheets = [sheet];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const panel = el("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Compare sizes");

  const header = el("header");
  const close = el("button", "close");
  close.setAttribute("aria-label", "Close");
  // Chrome's close icon (an X), drawn as SVG so it's crisp at any zoom
  const svgNs = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNs, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M4 4l8 8M12 4l-8 8");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  icon.append(path);
  close.append(icon);
  header.append(el("h1", null, "Compare sizes"), close);

  panel.append(header, el("div", "original", "Reading image…"));

  for (const out of outputs) {
    const row = el("div", "row");
    row.dataset.id = out.id;
    const name = el("span", "name", out.name);
    name.append(el("span", "note"));
    const dl = el("button", "dl");
    siatSetDownloadButton(dl, "ready", `Download ${out.name}`);
    dl.disabled = true;
    row.append(name, el("span", "size", "…"), dl);

    if (out.quality != null) {
      const quality = el("label", "quality");
      const slider = el("input");
      slider.type = "range";
      slider.min = "1";
      slider.max = "100";
      slider.value = String(Math.round(out.quality * 100));
      slider.disabled = true;
      slider.setAttribute("aria-label", `${out.name} quality`);
      quality.append(el("span", "qlabel", "Quality"), slider, el("output", null, `${slider.value}%`));
      row.append(quality);
    }
    panel.append(row);
  }

  root.append(panel);
  document.documentElement.appendChild(host);

  const onKey = (e) => { if (e.key === "Escape") closePanel(); };
  // Clicking anywhere outside the panel closes it. The rename box counts as
  // inside: it's part of saving from the panel.
  const onPointerDown = (e) => {
    const path = e.composedPath();
    if (path.includes(host) || path.some(n => n.id === "__siat_rename__")) return;
    closePanel();
  };
  function closePanel() {
    host.remove();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onPointerDown, true);
  }
  close.addEventListener("click", closePanel);
  // fillComparePanel and the next panel close this one through this event
  host.addEventListener("siat-close", closePanel);
  document.addEventListener("keydown", onKey);
  // Capture phase: runs even if the page stops the click reaching document
  document.addEventListener("pointerdown", onPointerDown, true);
}

// Converts the image to every format and fills in the panel's rows.
// data: { srcUrl, fetchedDataUrl, original, outputs, roundSizes, keepPanelOpen }
//   fetchedDataUrl: the bytes the service worker fetched, or null if it couldn't
//   original:       { type, size } read from those bytes, or null
//   outputs:        [{ id, name, type, mimeType, quality }]
//   roundSizes:     the "Round file sizes" setting
//   keepPanelOpen:  the "Keep open after downloading" setting
async function fillComparePanel(data) {
  const host = document.getElementById("__siat_panel__");
  const root = host?.shadowRoot;
  if (!root) return;   // closed before the image was ready

  // formatSize comes from format-size.js, injected alongside this file
  const size = (bytes) => formatSize(bytes, data.roundSizes);
  const originalEl = root.querySelector(".original");
  const src = data.fetchedDataUrl || data.srcUrl;
  let img;
  try {
    img = await siatLoadImage(src, !data.fetchedDataUrl);
  } catch (_) {
    originalEl.textContent = "Couldn't read this image.";
    for (const s of root.querySelectorAll(".size")) s.textContent = "—";
    return;
  }

  const { w, h } = siatImageSize(img, src);
  originalEl.textContent = "Original: " + [
    data.original?.type,
    `${Math.round(w)} × ${Math.round(h)}`,
    data.original ? size(data.original.size) : null,
  ].filter(Boolean).join(" · ");

  // One state object per format. "size" is the size of what Download
  // will save: the converted file, or the original if that's smaller.
  const rows = data.outputs.map(out => {
    const row = root.querySelector(`.row[data-id="${out.id}"]`);
    return {
      out,
      quality:  out.quality,
      blob:     null,
      size:     null,
      useOriginal: false,
      // Same format as the original, so the original itself is an option
      matchesOriginal: data.original?.type === out.type,
      encodeCount: 0,
      canvas:   null,
      nameNote: row.querySelector(".note"),
      sizeEl:   row.querySelector(".size"),
      dl:       row.querySelector(".dl"),
      slider:   row.querySelector(".quality input"),
      output:   row.querySelector(".quality output"),
    };
  });

  // Labels the smallest download, and any row offering the original file
  function refreshNotes() {
    const sized = rows.filter(r => r.size != null);
    const min = Math.min(...sized.map(r => r.size));
    for (const r of rows) {
      const smallest = sized.length > 1 && r.size === min;
      const notes = [];
      if (r.useOriginal) notes.push("original");
      if (smallest) notes.push("smallest");
      r.nameNote.textContent = notes.join(" · ");
      r.nameNote.classList.toggle("good", smallest);
      r.sizeEl.classList.toggle("good", smallest);
    }
  }

  function applyResult(r) {
    const originalSize = data.original?.size;
    // Re-encoding a file into its own format can't add quality, so if the
    // result is bigger than the original, offer the original instead
    r.useOriginal = r.matchesOriginal && originalSize != null &&
                    (!r.blob || originalSize <= r.blob.size);
    r.size = r.useOriginal ? originalSize : (r.blob?.size ?? null);
    r.sizeEl.textContent = r.size == null ? "Failed" : size(r.size);
    // The button is icon-only, so its tooltip says exactly what it saves
    r.dlLabel = r.size == null
      ? `${r.out.name} conversion failed`
      : `Download ${r.out.name} (${size(r.size)})` + (r.useOriginal && r.blob
          ? `. Converting would make it ${size(r.blob.size)}, so this saves the original file unchanged.`
          : "");
    siatSetDownloadButton(r.dl, "ready", r.dlLabel);
    r.dl.disabled = r.size == null;
    refreshNotes();
  }

  async function encode(r) {
    const count = ++r.encodeCount;
    r.sizeEl.textContent = "…";
    r.dl.disabled = true;
    let blob = null;
    try {
      // Drawn once per format, then re-encoded at each new quality
      r.canvas ??= siatDrawToCanvas(img, w, h, r.out.mimeType);
      // toBlob, not toDataURL: it encodes without freezing the page
      blob = await new Promise(res => r.canvas.toBlob(res, r.out.mimeType, r.quality ?? undefined));
    } catch (_) {
      // Tainted canvas (no permission to read pixels) or canvas too large
    }
    // A newer slider position started its own encode: drop this result
    if (count !== r.encodeCount || !host.isConnected) return;
    r.blob = blob;
    applyResult(r);
  }

  async function download(r) {
    r.dl.disabled = true;   // dims the icon while saving
    siatSetDownloadButton(r.dl, "saving", "Saving…");
    try {
      let dataUrl;
      if (r.useOriginal) {
        // fetchedDataUrl is always base64; relabel it with this format's
        // type, since servers sometimes send a generic type
        dataUrl = `data:${r.out.mimeType};base64,` +
                  data.fetchedDataUrl.slice(data.fetchedDataUrl.indexOf(",") + 1);
      } else {
        dataUrl = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload  = () => res(reader.result);
          reader.onerror = () => rej(reader.error);
          reader.readAsDataURL(r.blob);
        });
      }
      // The service worker does the download, so the filename rules and
      // the Saving setting match the menu items exactly
      const reply = await chrome.runtime.sendMessage({
        type: "siat-download", srcUrl: data.srcUrl, formatId: r.out.id, dataUrl,
        width: w, height: h,   // for the "add dimensions to filename" setting
      });
      // confirmed: saved under a known name. Not the case if the user
      // cancelled the rename box, or Chrome's Save dialog took over.
      if (!reply?.ok)          siatSetDownloadButton(r.dl, "failed", "Download failed. Click to try again.");
      else if (reply.confirmed) {
        siatSetDownloadButton(r.dl, "saved", "Saved. Click to download again.");
        // Close after a moment, so the green tick is seen first
        if (!data.keepPanelOpen) {
          setTimeout(() => host.dispatchEvent(new Event("siat-close")), 800);
        }
      }
      else                      siatSetDownloadButton(r.dl, "ready", r.dlLabel);
    } catch (_) {
      siatSetDownloadButton(r.dl, "failed", "Download failed. Click to try again.");
    }
    r.dl.disabled = false;
  }

  for (const r of rows) {
    r.dl.addEventListener("click", () => download(r));
    if (r.slider) {
      let timer;
      r.slider.addEventListener("input", () => {
        r.output.textContent = `${r.slider.value}%`;
        r.quality = Number(r.slider.value) / 100;
        // Wait until the slider pauses, rather than encoding at every step
        clearTimeout(timer);
        timer = setTimeout(() => encode(r), 150);
      });
    }
  }

  // First pass: one format at a time, so the page stays responsive
  for (const r of rows) {
    if (!host.isConnected) return;   // panel closed mid-way: stop converting
    await encode(r);
    if (r.slider) r.slider.disabled = false;
  }
}

// ─── Rename box ───────────────────────────────────────────────────────────
// Asks for a filename before saving to Downloads. Shown top-right, so it
// doesn't cover the Compare panel. Resolves { name } or { cancelled: true }.

function siatRenameCss() {
  return siatThemeCss() + `
    :host { top: 16px !important; right: 16px !important; }
    form {
      box-sizing: border-box;
      width: 380px;
      margin: 0;
      padding: 18px 20px 16px;
      background: var(--surface);
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15);
      font: 400 13px/1.45 system-ui, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
    }
    h1 { margin: 0 0 12px; font-size: 15px; font-weight: 500; }
    .field {
      display: flex; align-items: center;
      padding: 0 12px;
      border: 1px solid var(--outline);
      border-radius: 8px;
    }
    .field:focus-within { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); }
    input {
      all: unset; flex: 1; min-width: 0; padding: 9px 0;
      font: inherit; color: var(--text);
    }
    .ext { color: var(--text-2); padding-left: 2px; }
    .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    button {
      all: unset; cursor: pointer;
      padding: 7px 18px; border-radius: 100px;
      font-size: 13px; font-weight: 500;
    }
    .cancel { color: var(--primary); box-shadow: inset 0 0 0 1px var(--outline); }
    .cancel:hover { background: var(--hover); }
    .save { background: var(--primary); color: var(--on-primary); }
    .save:hover { box-shadow: inset 0 0 0 100px var(--hover); }
  `;
}

function askFilenameInPage(stem, ext) {
  return new Promise((resolve) => {
    document.getElementById("__siat_rename__")?.remove();

    const host = document.createElement("siat-rename");
    host.id = "__siat_rename__";
    const root = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(siatRenameCss());
    root.adoptedStyleSheets = [sheet];

    const form = document.createElement("form");
    form.setAttribute("aria-label", "Save image as");

    const title = document.createElement("h1");
    title.textContent = "Save image as";

    const field = document.createElement("label");
    field.className = "field";
    const input = document.createElement("input");
    input.value = stem;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Filename");
    const extEl = document.createElement("span");
    extEl.className = "ext";
    extEl.textContent = `.${ext}`;
    field.append(input, extEl);

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cancel";
    cancel.textContent = "Cancel";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "save";
    save.textContent = "Save";
    buttons.append(cancel, save);

    form.append(title, field, buttons);
    root.append(form);

    // Stop typing from reaching the page: many sites have single-key
    // shortcuts (e.g. "k" to pause a video) that would fire while typing.
    for (const type of ["keydown", "keyup", "keypress"]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    function finish(result) {
      host.remove();
      resolve(result);
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      finish({ name: input.value });
    });
    cancel.addEventListener("click", () => finish({ cancelled: true }));
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") finish({ cancelled: true });
    });

    document.documentElement.appendChild(host);
    input.focus();
    input.select();
  });
}
