const INDIAN_LANGUAGES = [
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" }
];

const INTERNATIONAL_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" }
];

const ALL_LANGUAGES = [...INDIAN_LANGUAGES, ...INTERNATIONAL_LANGUAGES];
const LANGUAGE_NAME_BY_CODE = new Map(ALL_LANGUAGES.map((item) => [item.code, item.name]));

const statusNode = document.getElementById("status");

const manualInput = document.getElementById("manual-input");
const manualTarget = document.getElementById("manual-target");
const translateNowButton = document.getElementById("translate-now");
const clearInputButton = document.getElementById("clear-input");
const singleOutput = document.getElementById("single-output");

const feedList = document.getElementById("feed-list");
const refreshFeedButton = document.getElementById("refresh-feed");
const clearFeedButton = document.getElementById("clear-feed");

let feedItems = [];

initialize().catch((error) => {
  showStatus(error?.message || "Failed to initialize popup", true);
});

async function initialize() {
  const ping = await sendMessage({ type: "GET_SETTINGS" });
  if (!ping?.ok) {
    showStatus("Extension background disconnected. Please reload extension.", true);
    return;
  }

  fillLanguageSelect(manualTarget);

  await loadPreferredLanguage();
  await loadFeed();

  manualTarget.addEventListener("change", persistPreferredLanguage);
  clearInputButton.addEventListener("click", clearManualInput);
  translateNowButton.addEventListener("click", runManualTranslate);

  refreshFeedButton.addEventListener("click", loadFeed);
  clearFeedButton.addEventListener("click", clearFeed);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TRANSLATION_EVENT" && message.entry) {
      feedItems = [message.entry, ...feedItems]
        .slice(0, 50)
        .filter((item, index, self) => index === self.findIndex((entry) => entry.id === item.id));
      renderFeed(feedItems);
    }
  });
}

function fillLanguageSelect(selectElement) {
  const indianGroup = document.createElement("optgroup");
  indianGroup.label = "Indian Languages";
  for (const option of INDIAN_LANGUAGES) {
    const node = document.createElement("option");
    node.value = option.code;
    node.textContent = option.name;
    indianGroup.appendChild(node);
  }

  const internationalGroup = document.createElement("optgroup");
  internationalGroup.label = "International Languages";
  for (const option of INTERNATIONAL_LANGUAGES) {
    const node = document.createElement("option");
    node.value = option.code;
    node.textContent = option.name;
    internationalGroup.appendChild(node);
  }

  selectElement.appendChild(indianGroup);
  selectElement.appendChild(internationalGroup);
}

async function loadPreferredLanguage() {
  const settings = await chrome.storage.sync.get({ preferredLanguage: "en" });
  manualTarget.value = settings.preferredLanguage || "en";
}

async function persistPreferredLanguage() {
  const selectedLanguage = manualTarget.value || "en";
  await chrome.storage.sync.set({ preferredLanguage: selectedLanguage });
  showStatus("Language updated for live chat translation.", false);
}

function clearManualInput() {
  manualInput.value = "";
  singleOutput.textContent = "Translation will appear here.";
}

async function runManualTranslate() {
  const text = (manualInput.value || "").trim();
  if (!text) {
    showStatus("Paste text first.", true);
    singleOutput.textContent = "Paste text first.";
    return;
  }

  translateNowButton.disabled = true;
  translateNowButton.textContent = "Translating...";

  try {
    const response = await translateText(text, manualTarget.value || "en");
    if (!response.ok) {
      showStatus(response.error || "Translation failed.", true);
      singleOutput.textContent = response.error || "Translation failed.";
      return;
    }

    singleOutput.textContent = response.translatedText || "No translation output.";
    showStatus("Translation ready.", false);
  } finally {
    translateNowButton.disabled = false;
    translateNowButton.textContent = "Translate";
  }
}

async function translateText(text, targetLanguage) {
  const response = await sendMessage({
    type: "TRANSLATE_TEXT",
    text,
    targetLanguage,
    platform: "popup",
    context: "manual",
    logToFeed: true
  });

  if (!response?.ok) {
    return {
      ok: false,
      error: response?.error || "No response from extension background. Please reload extension."
    };
  }

  return response;
}

async function loadFeed() {
  const response = await sendMessage({ type: "GET_RECENT_TRANSLATIONS" });
  if (!response?.ok) {
    showStatus(response?.error || "Could not load feed.", true);
    return;
  }

  feedItems = Array.isArray(response.items) ? response.items : [];
  renderFeed(feedItems);
}

async function clearFeed() {
  const response = await sendMessage({ type: "CLEAR_RECENT_TRANSLATIONS" });
  if (!response?.ok) {
    showStatus(response?.error || "Could not clear feed.", true);
    return;
  }

  feedItems = [];
  renderFeed(feedItems);
}

function renderFeed(items) {
  feedList.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "feed-empty";
    empty.textContent = "No translated chat messages yet.";
    feedList.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 20)) {
    const row = document.createElement("li");
    row.className = "feed-item";

    const meta = document.createElement("p");
    meta.className = "feed-meta";
    const platform = formatPlatform(item.platform);
    const when = formatTime(item.createdAt);
    const target = formatLanguage(item.targetLanguage);
    meta.textContent = `${platform} | ${target} | ${when}`;

    const source = document.createElement("p");
    source.className = "feed-source";
    source.textContent = item.sourceText || "";

    const translated = document.createElement("p");
    translated.className = "feed-translation";
    translated.textContent = `🌐 ${item.translatedText || ""}`;

    row.appendChild(meta);
    row.appendChild(source);
    row.appendChild(translated);
    feedList.appendChild(row);
  }
}

function showStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.className = isError ? "error" : "success";
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve(response || { ok: false, error: "No response" });
    });
  });
}

function formatLanguage(code) {
  return LANGUAGE_NAME_BY_CODE.get(code) || String(code || "unknown").toUpperCase();
}

function formatPlatform(platform) {
  const key = String(platform || "unknown").toLowerCase();
  if (key === "whatsapp") return "WhatsApp";
  if (key === "instagram") return "Instagram";
  if (key === "messenger") return "Messenger";
  if (key === "meet") return "Google Meet";
  if (key === "popup") return "Manual";
  return "Unknown";
}

function formatTime(isoTime) {
  if (!isoTime) return "now";

  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return "now";

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
