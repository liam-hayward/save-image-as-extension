// ─── File size formatting ─────────────────────────────────────────────────
// Shared by background.js (via importScripts) and the page (injected with
// page.js), so the Compare panel and filenames always agree. Function
// declarations only: this file is injected into pages repeatedly, and a
// top-level const or let would throw "already declared" the second time.

// Human-readable size in powers of 1024, as Windows uses.
//   round = false: three significant figures, e.g. "29.5 KB", "245 KB", "1.24 MB"
//   round = true:  whole KB, one decimal for MB and up, e.g. "30 KB", "1.2 MB"
function formatSize(bytes, round) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  // Move up a unit at 1000, not 1024, so sizes never show 4 digits
  // ("1010 KB" becomes "0.99 MB"), as Windows file Properties does
  while (value >= 1000 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  let text;
  if (i === 0)        text = String(bytes);
  else if (round)     text = i === 1 ? String(Math.round(value)) : value.toFixed(1);
  else if (value >= 100) text = String(Math.round(value));
  else if (value >= 10)  text = value.toFixed(1);
  else                   text = value.toFixed(2);
  return `${text} ${units[i]}`;
}
