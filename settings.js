// ─── Settings ─────────────────────────────────────────────────────────────
// Shared by background.js (via importScripts) and options.html.
// Stored with chrome.storage.local, so settings stay on this computer and are
// never synced to a Google account.

const DEFAULT_SETTINGS = {
  jpgQuality:  92,     // 1–100
  webpQuality: 99,     // 1–100
  saveMode:    "direct", // "direct": straight to Downloads
                         // "rename": ask for a filename, then save to Downloads
                         // "dialog": Chrome's Save dialog (filename and folder)
  appendDimensions: false,   // photo.jpg → photo_1920x1080.jpg
  appendSize:       false,   // photo.jpg → photo_245KB.jpg
  roundSizes:       false,   // "30 KB" instead of "29.5 KB" (panel and filenames)
  showCompare: true,   // show "Compare sizes…" in the right-click menu
  keepPanelOpen:    false,   // keep the Compare panel open after a download
};

// Any setting not saved yet comes back as its default, so adding a new
// setting later needs no extra code for existing users.
function loadSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}
