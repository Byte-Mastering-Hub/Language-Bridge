const SUPPORTED_HOSTS = {
  whatsapp: "web.whatsapp.com",
  instagram: "www.instagram.com",
  messenger: "www.messenger.com",
  facebookMessenger: "www.facebook.com",
  meet: "meet.google.com"
};

const PLATFORM_CONFIG = {
  whatsapp: {
    containerSelectors: [
      "div[data-testid='conversation-panel-messages'] div.message-in",
      "div[data-testid='conversation-panel-messages'] div.message-out",
      "div[data-testid='msg-container']",
      "div[data-pre-plain-text]",
      "div.copyable-text"
    ],
    textSelectors: [
      "span.selectable-text span",
      "span.selectable-text",
      "div.copyable-text span[dir='auto']"
    ],
    composeSelectors: [
      "footer div[contenteditable='true'][role='textbox']",
      "footer div[contenteditable='true'][data-tab]",
      "div[aria-placeholder='Type a message'][contenteditable='true']"
    ]
  },
  instagram: {
    containerSelectors: [
      "div[role='listitem']",
      "div[data-testid='message-container']",
      "div[role='row']"
    ],
    textSelectors: ["div[dir='auto']", "span[dir='auto']", "span"],
    composeSelectors: [
      "div[contenteditable='true'][role='textbox']",
      "div[aria-label='Message'][contenteditable='true']"
    ]
  },
  messenger: {
    containerSelectors: ["div[role='row']", "div[role='gridcell']", "div[aria-label='Message']"],
    textSelectors: ["div[dir='auto']", "span[dir='auto']", "span"],
    composeSelectors: [
      "div[aria-label='Message'][contenteditable='true']",
      "div[role='textbox'][contenteditable='true']"
    ]
  },
  meet: {
    containerSelectors: ["div[jsname='tgaKEf']", "div[aria-live='polite'] div", "div[aria-live='assertive'] div"],
    textSelectors: ["span", "div"],
    composeSelectors: []
  }
};

const SCAN_INTERVAL_MS = 2000;
const COMPOSER_SCAN_MS = 1200;
const MIN_TRANSLATABLE_LENGTH = 2;
const MAX_TRANSLATABLE_LENGTH = 800;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VISIBLE_CANDIDATES = 40;
const MAX_TEXT_TRANSLATIONS_PER_SCAN = 6;
const TRANSLATION_CACHE_LIMIT = 300;
const UI_NOISE_MATCHERS = [/^type a message$/i, /^search$/i, /^message$/i, /^yesterday$/i, /^today$/i, /^online$/i];

let preferredLanguage = "en";
let scanTimerId = null;
let mutationObserver = null;
let messageCounter = 0;

let composerElement = null;
let composerPanel = null;
let composerPanelText = null;
let composerDebounceTimer = null;
let composerLastSource = "";
let composerLastTranslation = "";
let composerClosedForSignature = "";

const inFlightTextElements = new WeakSet();
const inFlightAudioElements = new WeakSet();
const trackedMessages = new Map();
const trackedAudioMessages = new Map();
const translationCache = new Map();

const platform = detectPlatform(window.location.hostname);

if (platform) {
  bootstrap().catch((error) => {
    console.error("[Language Bridge] bootstrap error", error);
  });
}

async function bootstrap() {
  injectOverlayStyles();
  await loadSettings();
  watchSettingsChanges();
  startObservers();
  startComposerWatcher();
  processNewMessages();
}

function detectPlatform(hostname) {
  if (hostname === SUPPORTED_HOSTS.whatsapp) return "whatsapp";
  if (hostname === SUPPORTED_HOSTS.instagram) return "instagram";
  if (hostname === SUPPORTED_HOSTS.messenger || hostname === SUPPORTED_HOSTS.facebookMessenger) return "messenger";
  if (hostname === SUPPORTED_HOSTS.meet) return "meet";
  return null;
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get({ preferredLanguage: "en" });
  preferredLanguage = settings.preferredLanguage || "en";
}

function watchSettingsChanges() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.preferredLanguage) {
      return;
    }

    preferredLanguage = changes.preferredLanguage.newValue || "en";
    composerClosedForSignature = "";
    refreshTrackedTranslations();
    refreshTrackedAudioTranslations();
    if (platform === "whatsapp") {
      handleComposerInput();
    }
  });
}

function startObservers() {
  mutationObserver = new MutationObserver(() => {
    processNewMessages();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scanTimerId = window.setInterval(processNewMessages, SCAN_INTERVAL_MS);
}

function startComposerWatcher() {
  if (platform !== "whatsapp") {
    return;
  }

  bindComposerInput();
  window.setInterval(bindComposerInput, COMPOSER_SCAN_MS);
  window.addEventListener("resize", positionComposerPanel);
  window.addEventListener("scroll", positionComposerPanel, true);
}

function bindComposerInput() {
  const nextComposer = findComposerElement();

  if (!nextComposer) {
    detachComposerListeners();
    hideComposerPanel();
    return;
  }

  if (composerElement === nextComposer) {
    positionComposerPanel();
    return;
  }

  detachComposerListeners();
  composerElement = nextComposer;
  composerElement.addEventListener("input", handleComposerInput);
  composerElement.addEventListener("keyup", handleComposerInput);
  composerElement.addEventListener("focus", handleComposerInput);

  ensureComposerPanel();
  positionComposerPanel();
}

function detachComposerListeners() {
  if (!composerElement) {
    return;
  }

  composerElement.removeEventListener("input", handleComposerInput);
  composerElement.removeEventListener("keyup", handleComposerInput);
  composerElement.removeEventListener("focus", handleComposerInput);
  composerElement = null;
}

function findComposerElement() {
  const selectors = PLATFORM_CONFIG[platform]?.composeSelectors || [];

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (!isVisible(node)) {
        continue;
      }

      return node;
    }
  }

  return null;
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

function handleComposerInput() {
  if (!composerElement) {
    return;
  }

  const text = normalizeText(getComposerText(composerElement));

  if (!isCandidateFragment(text)) {
    composerLastSource = "";
    composerLastTranslation = "";
    hideComposerPanel();
    return;
  }

  const signature = `${hashText(text)}:${preferredLanguage}`;

  if (composerClosedForSignature && composerClosedForSignature === signature) {
    hideComposerPanel();
    return;
  }

  if (composerLastSource === text && composerLastTranslation) {
    showComposerSuggestion(composerLastTranslation);
    return;
  }

  if (composerDebounceTimer) {
    clearTimeout(composerDebounceTimer);
  }

  composerDebounceTimer = window.setTimeout(async () => {
    const response = await requestTranslation(text, {
      context: "compose",
      logToFeed: false
    });

    if (!response || !response.ok || !response.translatedText) {
      hideComposerPanel();
      return;
    }

    const translatedText = normalizeText(response.translatedText);

    if (!translatedText || translatedText === text) {
      hideComposerPanel();
      return;
    }

    composerLastSource = text;
    composerLastTranslation = translatedText;
    showComposerSuggestion(translatedText);
  }, 650);
}

function getComposerText(inputElement) {
  if (!inputElement) {
    return "";
  }

  if (inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement) {
    return inputElement.value || "";
  }

  return inputElement.innerText || inputElement.textContent || "";
}

function ensureComposerPanel() {
  if (composerPanel) {
    return;
  }

  composerPanel = document.createElement("div");
  composerPanel.className = "lb-compose-panel";
  composerPanel.hidden = true;

  const title = document.createElement("p");
  title.className = "lb-compose-title";
  title.textContent = "Language Bridge Suggestion";

  composerPanelText = document.createElement("p");
  composerPanelText.className = "lb-compose-text";

  const actionRow = document.createElement("div");
  actionRow.className = "lb-compose-actions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "lb-compose-copy";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", copyComposerSuggestion);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "lb-compose-close";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", closeComposerSuggestion);

  actionRow.appendChild(copyButton);
  actionRow.appendChild(closeButton);

  composerPanel.appendChild(title);
  composerPanel.appendChild(composerPanelText);
  composerPanel.appendChild(actionRow);

  document.body.appendChild(composerPanel);
}

function showComposerSuggestion(translatedText) {
  ensureComposerPanel();

  composerPanelText.textContent = translatedText;
  composerPanel.hidden = false;
  positionComposerPanel();
}

function hideComposerPanel() {
  if (!composerPanel) {
    return;
  }

  composerPanel.hidden = true;
}

function closeComposerSuggestion() {
  if (!composerElement) {
    hideComposerPanel();
    return;
  }

  const text = normalizeText(getComposerText(composerElement));
  composerClosedForSignature = `${hashText(text)}:${preferredLanguage}`;
  hideComposerPanel();
}

async function copyComposerSuggestion() {
  if (!composerLastTranslation) {
    return;
  }

  const copied = await copyTextToClipboard(composerLastTranslation);
  if (!copied) {
    return;
  }

  const copyButton = composerPanel?.querySelector(".lb-compose-copy");
  if (copyButton instanceof HTMLButtonElement) {
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      if (copyButton.isConnected) {
        copyButton.textContent = "Copy";
      }
    }, 1000);
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const tempNode = document.createElement("textarea");
    tempNode.value = value;
    tempNode.style.position = "fixed";
    tempNode.style.opacity = "0";
    tempNode.style.pointerEvents = "none";
    document.body.appendChild(tempNode);
    tempNode.focus();
    tempNode.select();

    let copied = false;
    try {
      copied = Boolean(document.execCommand && document.execCommand("copy"));
    } catch {
      copied = false;
    } finally {
      tempNode.remove();
    }

    return copied;
  }
}

function positionComposerPanel() {
  if (!composerPanel || composerPanel.hidden || !composerElement || !isVisible(composerElement)) {
    return;
  }

  const rect = composerElement.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width * 0.62, 280), 360);

  composerPanel.style.width = `${Math.round(width)}px`;

  const desiredLeft = Math.min(
    Math.max(rect.left, 8),
    window.innerWidth - width - 8
  );

  const panelHeight = composerPanel.offsetHeight || 120;
  let desiredTop = rect.top - panelHeight - 10;

  if (desiredTop < 8) {
    desiredTop = rect.bottom + 8;
  }

  if (desiredTop + panelHeight > window.innerHeight - 8) {
    desiredTop = Math.max(8, window.innerHeight - panelHeight - 8);
  }

  composerPanel.style.left = `${Math.round(desiredLeft)}px`;
  composerPanel.style.top = `${Math.round(desiredTop)}px`;
}

function processNewMessages() {
  const candidates = getCandidateElements();
  processTextMessages(candidates);
  processAudioMessages(candidates);
  cleanupDisconnectedEntries();
}

function processTextMessages(candidates) {
  let processedInThisScan = 0;

  for (const element of candidates) {
    if (platform === "whatsapp" && !isIncomingWhatsAppElement(element)) {
      continue;
    }

    if (processedInThisScan >= MAX_TEXT_TRANSLATIONS_PER_SCAN) {
      break;
    }

    if (!element || inFlightTextElements.has(element)) {
      continue;
    }

    if (getAudioElement(element)) {
      continue;
    }

    const text = extractMessageText(element);
    if (!isValidText(text)) {
      continue;
    }

    const messageId = ensureMessageId(element);
    const trackingRecord = trackedMessages.get(messageId);
    const signature = `text:${hashText(text)}:${preferredLanguage}`;

    if (trackingRecord && trackingRecord.signature === signature) {
      continue;
    }

    const cacheKey = getTranslationCacheKey(text, preferredLanguage);
    const cachedTranslation = translationCache.get(cacheKey);
    if (cachedTranslation) {
      const overlay = ensureOverlayNode(element);
      overlay.textContent = `🌐 ${cachedTranslation}`;
      trackedMessages.set(messageId, {
        element,
        originalText: text,
        overlay,
        signature
      });
      continue;
    }

    inFlightTextElements.add(element);
    processedInThisScan += 1;
    translateAndRender(element, text, messageId, signature, true, cacheKey)
      .catch((error) => {
        console.error("[Language Bridge] translate/render failed", error);
      })
      .finally(() => {
        inFlightTextElements.delete(element);
      });
  }
}

function processAudioMessages(candidates) {
  for (const element of candidates) {
    if (!element || inFlightAudioElements.has(element)) {
      continue;
    }

    const audioElement = getAudioElement(element);
    if (!audioElement) {
      continue;
    }

    const messageId = ensureMessageId(element);
    const audioFingerprint = fingerprintAudio(audioElement);
    const signature = `audio:${audioFingerprint}:${preferredLanguage}`;
    const trackingRecord = trackedAudioMessages.get(messageId);

    if (trackingRecord && trackingRecord.signature === signature) {
      continue;
    }

    inFlightAudioElements.add(element);
    transcribeAndRender(element, audioElement, messageId, signature, audioFingerprint, true)
      .catch((error) => {
        console.error("[Language Bridge] transcribe/render failed", error);
      })
      .finally(() => {
        inFlightAudioElements.delete(element);
      });
  }
}

function getCandidateElements() {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return [];
  }

  const unique = new Set();
  const elements = [];

  for (const selector of config.containerSelectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const normalizedNode = normalizeCandidateNode(node);
      if (!normalizedNode) {
        continue;
      }

      if (unique.has(normalizedNode)) {
        continue;
      }

      if (!normalizedNode.isConnected || !isVisible(normalizedNode)) {
        continue;
      }

      const rawText = normalizeText(normalizedNode.innerText || normalizedNode.textContent || "");
      if (rawText.length > 3000) {
        continue;
      }

      unique.add(normalizedNode);
      elements.push(normalizedNode);
    }
  }

  return elements.slice(-MAX_VISIBLE_CANDIDATES);
}

function normalizeCandidateNode(node) {
  if (!(node instanceof HTMLElement)) {
    return null;
  }

  if (platform !== "whatsapp") {
    return node;
  }

  const host = node.closest("div[data-testid='msg-container'], div.message-in, div.message-out, div[data-pre-plain-text]");
  return host instanceof HTMLElement ? host : node;
}

function extractMessageText(element) {
  if (!element) {
    return "";
  }

  const clone = element.cloneNode(true);
  clone.querySelectorAll(".lb-translation").forEach((node) => node.remove());

  const config = PLATFORM_CONFIG[platform];
  const foundText = [];

  for (const selector of config?.textSelectors || []) {
    const nodes = clone.querySelectorAll(selector);
    for (const node of nodes) {
      const text = normalizeText(node.textContent || node.innerText || "");
      if (isCandidateFragment(text)) {
        foundText.push(text);
      }
    }
  }

  const uniqueText = Array.from(new Set(foundText));

  if (uniqueText.length > 0) {
    if (platform === "meet") {
      return uniqueText[uniqueText.length - 1];
    }

    uniqueText.sort((a, b) => b.length - a.length);
    return uniqueText[0];
  }

  return normalizeText(clone.innerText || clone.textContent || "");
}

function isCandidateFragment(text) {
  if (!text) {
    return false;
  }

  if (text.length < MIN_TRANSLATABLE_LENGTH || text.length > MAX_TRANSLATABLE_LENGTH) {
    return false;
  }

  if (text.startsWith("🌐") || text.startsWith("🎙")) {
    return false;
  }

  if (!/[\p{L}\p{N}]/u.test(text)) {
    return false;
  }

  for (const matcher of UI_NOISE_MATCHERS) {
    if (matcher.test(text)) {
      return false;
    }
  }

  return true;
}

function isValidText(text) {
  return isCandidateFragment(text);
}

function ensureMessageId(element) {
  let id = element.getAttribute("data-lb-id");
  if (!id) {
    messageCounter += 1;
    id = `lb-${messageCounter}`;
    element.setAttribute("data-lb-id", id);
  }
  return id;
}

function isIncomingWhatsAppElement(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.classList.contains("message-in")) {
    return true;
  }

  return Boolean(element.closest(".message-in"));
}

async function translateAndRender(element, text, messageId, signature, logToFeed, cacheKey = null) {
  const response = await requestTranslation(text, { logToFeed, context: "chat" });
  if (!response || !response.ok || !response.translatedText) {
    return;
  }

  const translatedText = response.translatedText.trim();
  if (!translatedText) {
    return;
  }

  if (cacheKey) {
    setCachedTranslation(cacheKey, translatedText);
  }

  const overlay = ensureOverlayNode(element);
  overlay.textContent = `🌐 ${translatedText}`;
  overlay.setAttribute(
    "title",
    `Detected: ${response.detectedLanguage || "unknown"} | Target: ${response.targetLanguage || preferredLanguage}`
  );

  trackedMessages.set(messageId, {
    element,
    originalText: text,
    overlay,
    signature
  });
}

async function transcribeAndRender(element, audioElement, messageId, signature, audioFingerprint, logToFeed) {
  const payload = await buildAudioPayload(audioElement);
  if (!payload) {
    return;
  }

  const response = await requestTranscription(payload.base64, payload.filename, payload.mimeType, {
    logToFeed,
    context: "voice"
  });

  if (!response || !response.ok || !response.transcript) {
    return;
  }

  const transcript = response.transcript.trim();
  const translatedText = (response.translatedText || "").trim();

  if (!transcript) {
    return;
  }

  const overlay = ensureOverlayNode(element);
  const lines = [`🎙 ${transcript}`];
  if (translatedText) {
    lines.push(`🌐 ${translatedText}`);
  }
  overlay.textContent = lines.join("\n");
  overlay.setAttribute(
    "title",
    `Detected: ${response.detectedLanguage || "unknown"} | Target: ${response.targetLanguage || preferredLanguage}`
  );

  trackedAudioMessages.set(messageId, {
    element,
    overlay,
    transcript,
    audioFingerprint,
    signature
  });
}

function ensureOverlayNode(element) {
  const anchor = resolveOverlayAnchor(element);
  const messageId = ensureMessageId(element);
  let overlay = document.querySelector(`.lb-translation[data-lb-overlay='true'][data-lb-for='${messageId}']`);

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "lb-translation";
    overlay.setAttribute("data-lb-overlay", "true");
    overlay.setAttribute("data-lb-for", messageId);
  }

  if (anchor.parentElement && overlay.parentElement !== anchor.parentElement) {
    anchor.parentElement.insertBefore(overlay, anchor.nextSibling);
  } else if (anchor.parentElement && overlay.previousElementSibling !== anchor) {
    anchor.parentElement.insertBefore(overlay, anchor.nextSibling);
  }

  return overlay;
}

function resolveOverlayAnchor(element) {
  if (!(element instanceof HTMLElement)) {
    return element;
  }

  if (platform !== "whatsapp") {
    return element;
  }

  const bubble =
    element.querySelector("div[data-testid='msg-container']") ||
    element.querySelector("div[data-pre-plain-text]")?.closest("div[data-testid='msg-container']") ||
    element;

  return bubble instanceof HTMLElement ? bubble : element;
}

function requestTranslation(text, options = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "TRANSLATE_TEXT",
        text,
        targetLanguage: preferredLanguage,
        platform,
        context: options.context || "chat",
        logToFeed: options.logToFeed !== false
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { ok: false, error: "No response" });
      }
    );
  });
}

function requestTranscription(audioBase64, filename, mimeType, options = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "TRANSCRIBE_AUDIO_BASE64",
        audioBase64,
        filename,
        mimeType,
        targetLanguage: preferredLanguage,
        platform,
        context: options.context || "voice",
        logToFeed: options.logToFeed !== false
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { ok: false, error: "No response" });
      }
    );
  });
}

function refreshTrackedTranslations() {
  for (const [messageId, record] of trackedMessages.entries()) {
    if (!record.element.isConnected) {
      trackedMessages.delete(messageId);
      continue;
    }

    if (inFlightTextElements.has(record.element)) {
      continue;
    }

    inFlightTextElements.add(record.element);
    translateAndRender(
      record.element,
      record.originalText,
      messageId,
      `text:${hashText(record.originalText)}:${preferredLanguage}`,
      false,
      getTranslationCacheKey(record.originalText, preferredLanguage)
    )
      .catch((error) => {
        console.error("[Language Bridge] refresh translation failed", error);
      })
      .finally(() => {
        inFlightTextElements.delete(record.element);
      });
  }
}

function refreshTrackedAudioTranslations() {
  for (const [messageId, record] of trackedAudioMessages.entries()) {
    if (!record.element.isConnected) {
      trackedAudioMessages.delete(messageId);
      continue;
    }

    if (inFlightAudioElements.has(record.element) || !record.transcript) {
      continue;
    }

    inFlightAudioElements.add(record.element);
    requestTranslation(record.transcript, { logToFeed: false, context: "voice" })
      .then((response) => {
        if (!response || !response.ok || !response.translatedText) {
          return;
        }

        const translatedText = response.translatedText.trim();
        if (!translatedText) {
          return;
        }

        record.overlay.textContent = `🎙 ${record.transcript}\n🌐 ${translatedText}`;
        record.overlay.setAttribute(
          "title",
          `Detected: ${response.detectedLanguage || "unknown"} | Target: ${response.targetLanguage || preferredLanguage}`
        );
        record.signature = `audio:${record.audioFingerprint}:${preferredLanguage}`;
      })
      .catch((error) => {
        console.error("[Language Bridge] refresh audio translation failed", error);
      })
      .finally(() => {
        inFlightAudioElements.delete(record.element);
      });
  }
}

function cleanupDisconnectedEntries() {
  for (const [messageId, record] of trackedMessages.entries()) {
    if (!record.element.isConnected) {
      if (record.overlay?.isConnected) {
        record.overlay.remove();
      }
      trackedMessages.delete(messageId);
    }
  }

  for (const [messageId, record] of trackedAudioMessages.entries()) {
    if (!record.element.isConnected) {
      if (record.overlay?.isConnected) {
        record.overlay.remove();
      }
      trackedAudioMessages.delete(messageId);
    }
  }
}

function getAudioElement(element) {
  if (!element) {
    return null;
  }

  const audio = element.querySelector("audio");
  if (audio) {
    return audio;
  }

  return null;
}

function getAudioSrc(audioElement) {
  if (!audioElement) {
    return "";
  }

  if (audioElement.currentSrc) {
    return audioElement.currentSrc;
  }

  if (audioElement.src) {
    return audioElement.src;
  }

  const source = audioElement.querySelector("source[src]");
  return source ? source.src : "";
}

function fingerprintAudio(audioElement) {
  const source = getAudioSrc(audioElement);
  if (source) {
    return hashText(source);
  }

  if (audioElement.duration && Number.isFinite(audioElement.duration)) {
    return `duration-${Math.round(audioElement.duration * 100)}`;
  }

  return "audio";
}

async function buildAudioPayload(audioElement) {
  const source = getAudioSrc(audioElement);
  if (!source) {
    return null;
  }

  try {
    const response = await fetch(source, { credentials: "include" });
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    if (!blob || blob.size === 0 || blob.size > MAX_AUDIO_BYTES) {
      return null;
    }

    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.split(",")[1];
    if (!base64) {
      return null;
    }

    return {
      base64,
      filename: inferAudioFilename(source, blob.type),
      mimeType: blob.type || "audio/webm"
    };
  } catch {
    return null;
  }
}

function inferAudioFilename(source, mimeType) {
  const lower = (source || "").toLowerCase();
  if (lower.includes(".mp3")) return "voice-note.mp3";
  if (lower.includes(".m4a")) return "voice-note.m4a";
  if (lower.includes(".ogg")) return "voice-note.ogg";
  if (lower.includes(".wav")) return "voice-note.wav";

  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("mpeg")) return "voice-note.mp3";
  if (mime.includes("mp4")) return "voice-note.m4a";
  if (mime.includes("ogg")) return "voice-note.ogg";
  if (mime.includes("wav")) return "voice-note.wav";

  return "voice-note.webm";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not convert blob to data URL"));
    reader.readAsDataURL(blob);
  });
}

function injectOverlayStyles() {
  if (document.getElementById("lb-overlay-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "lb-overlay-style";
  style.textContent = `
    .lb-translation {
      display: block !important;
      font-size: 12px;
      color: #506077;
      margin: 4px 6px 0;
      line-height: 1.35;
      font-style: italic;
      white-space: pre-wrap;
      background: rgba(248, 250, 252, 0.85);
      border-left: 2px solid #9ab2c8;
      border-radius: 6px;
      padding: 2px 6px;
    }

    .lb-compose-panel {
      position: fixed;
      z-index: 2147483600;
      border: 1px solid #d6e0ee;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
      padding: 10px;
      max-width: 360px;
    }

    .lb-compose-title {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      color: #0b7669;
      letter-spacing: 0.2px;
    }

    .lb-compose-text {
      margin: 6px 0 8px;
      font-size: 13px;
      line-height: 1.4;
      color: #1f2937;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .lb-compose-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .lb-compose-copy,
    .lb-compose-close {
      border-radius: 8px;
      border: 1px solid #ccd7e6;
      background: #f8fafc;
      color: #1f2937;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .lb-compose-copy {
      background: #0c7a6d;
      color: #ffffff;
      border-color: #0c7a6d;
    }
  `;

  document.head.appendChild(style);
}

function normalizeText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTranslationCacheKey(text, targetLanguage) {
  return `${targetLanguage}::${hashText(text)}::${text.length}`;
}

function setCachedTranslation(cacheKey, translatedText) {
  if (!cacheKey || !translatedText) {
    return;
  }

  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) {
      translationCache.delete(oldestKey);
    }
  }

  translationCache.set(cacheKey, translatedText);
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
