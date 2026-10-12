// ─── Settings Page ────────────────────────────────────────────────────────
// Changes save immediately; there is no Save button.

const QUALITY_IDS  = ["jpgQuality", "webpQuality"];
const CHECKBOX_IDS = ["appendDimensions", "appendSize", "roundSizes", "showCompare", "keepPanelOpen"];
const SAVE_MODE_RADIOS = document.querySelectorAll('input[name="saveMode"]');

function showQuality(id, value) {
  document.getElementById(`${id}Value`).textContent = `${value}%`;
}

async function render() {
  const settings = await loadSettings();
  for (const id of QUALITY_IDS) {
    document.getElementById(id).value = settings[id];
    showQuality(id, settings[id]);
  }
  for (const id of CHECKBOX_IDS) {
    document.getElementById(id).checked = settings[id];
  }
  for (const radio of SAVE_MODE_RADIOS) {
    radio.checked = radio.value === settings.saveMode;
  }
}

let statusTimer;
async function save(changes) {
  await chrome.storage.local.set(changes);
  const status = document.getElementById("status");
  status.textContent = "Saved";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.textContent = ""), 1500);
}

for (const id of QUALITY_IDS) {
  const slider = document.getElementById(id);
  // "input" fires continuously while dragging; "change" fires once on release
  slider.addEventListener("input",  () => showQuality(id, slider.value));
  slider.addEventListener("change", () => save({ [id]: Number(slider.value) }));
}

for (const id of CHECKBOX_IDS) {
  document.getElementById(id).addEventListener("change", (e) => {
    save({ [id]: e.target.checked });
  });
}

for (const radio of SAVE_MODE_RADIOS) {
  radio.addEventListener("change", () => save({ saveMode: radio.value }));
}

document.getElementById("reset").addEventListener("click", async () => {
  await save(DEFAULT_SETTINGS);
  render();
});

render();
