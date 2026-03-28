// content.js – injected into every page
// Responsible for showing a lightweight toast notification when a download
// is triggered. The actual image conversion happens inside background.js via
// chrome.scripting.executeScript (which also runs in the page context).

// ─── Toast Notification ───────────────────────────────────────────────────

function showToast(message, type = "success") {
  // Remove any existing toast
  const old = document.getElementById("__siat_toast__");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.id = "__siat_toast__";
  toast.className = `siat-toast siat-toast--${type}`;

  const icon = type === "success" ? "✓" : "✕";

  toast.innerHTML = `
    <span class="siat-toast__icon">${icon}</span>
    <span class="siat-toast__msg">${message}</span>
  `;

  document.body.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("siat-toast--visible"));
  });

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove("siat-toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3000);
}

// ─── Message Listener ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SIAT_TOAST") {
    showToast(msg.message, msg.variant ?? "success");
  }
});
