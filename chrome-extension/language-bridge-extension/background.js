const DEFAULT_SETTINGS = {
  preferredLanguage: "en",
  backendUrl: "http://127.0.0.1:8000"
};

const STORAGE_KEYS = {
  recentTranslations: "lbRecentTranslations"
};

const RECENT_LIMIT = 50;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set(current);

  const localState = await chrome.storage.local.get({
    [STORAGE_KEYS.recentTranslations]: []
  });

  if (!Array.isArray(localState[STORAGE_KEYS.recentTranslations])) {
    await chrome.storage.local.set({ [STORAGE_KEYS.recentTranslations]: [] });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  dispatchMessage(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error?.message || "Unknown background error"
      })
    );

  return true;
});

async function dispatchMessage(message) {
  if (!message || !message.type) {
    return { ok: false, error: "Invalid message payload" };
  }

  switch (message.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, settings };
    }

    case "TRANSLATE_TEXT":
      return handleTranslateRequest(message);

    case "MANUAL_TRANSLATE":
      return handleTranslateRequest({
        ...message,
        context: "manual",
        platform: "popup",
        logToFeed: true
      });

    case "MANUAL_TRANSLATE_MULTI":
      return handleManualMultiTranslate(message);

    case "TRANSCRIBE_AUDIO_BASE64":
      return handleTranscribeRequest(message);

    case "GET_RECENT_TRANSLATIONS": {
      const items = await getRecentTranslations();
      return { ok: true, items };
    }

    case "CLEAR_RECENT_TRANSLATIONS":
      await clearRecentTranslations();
      return { ok: true };

    default:
      return { ok: false, error: `Unsupported message type: ${message.type}` };
  }
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

function getBackendUrl(settings) {
  return (settings.backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "");
}

async function handleTranslateRequest(message) {
  const settings = await getSettings();
  const backendUrl = getBackendUrl(settings);
  const targetLanguage =
    message.targetLanguage ||
    settings.preferredLanguage ||
    DEFAULT_SETTINGS.preferredLanguage;
  const sourceText = (message.text || "").trim();

  if (!sourceText) {
    return {
      ok: false,
      error: "Empty text"
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${backendUrl}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: sourceText,
        source_language: message.sourceLanguage || null,
        target_language: targetLanguage,
        platform: message.platform || "unknown"
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Translation API returned ${response.status}`);
    }

    const payload = await response.json();
    const result = {
      ok: true,
      sourceText,
      translatedText: payload.translated_text,
      detectedLanguage: payload.detected_language,
      targetLanguage: payload.target_language,
      model: payload.model,
      degraded: Boolean(payload.degraded)
    };

    if (message.logToFeed !== false) {
      await appendTranslationToFeed({
        context: message.context || "chat",
        platform: message.platform || "unknown",
        sourceText,
        translatedText: result.translatedText,
        detectedLanguage: result.detectedLanguage,
        targetLanguage: result.targetLanguage,
        model: result.model,
        degraded: result.degraded
      });
    }

    return result;
  } catch (error) {
    const result = {
      ok: false,
      sourceText,
      translatedText: sourceText,
      detectedLanguage: message.sourceLanguage || "unknown",
      targetLanguage,
      model: "fallback",
      degraded: true,
      error: error?.message || "Backend unavailable"
    };

    if (message.logToFeed !== false) {
      await appendTranslationToFeed({
        context: message.context || "chat",
        platform: message.platform || "unknown",
        sourceText,
        translatedText: result.translatedText,
        detectedLanguage: result.detectedLanguage,
        targetLanguage: result.targetLanguage,
        model: result.model,
        degraded: true
      });
    }

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleManualMultiTranslate(message) {
  const sourceText = (message.text || "").trim();
  const uniqueTargets = Array.from(
    new Set((message.targetLanguages || []).map((item) => String(item || "").trim()))
  ).filter(Boolean);

  if (!sourceText) {
    return { ok: false, error: "Please paste text first." };
  }

  if (uniqueTargets.length === 0) {
    return { ok: false, error: "Select at least one output language." };
  }

  const results = await Promise.all(
    uniqueTargets.map((targetLanguage) =>
      handleTranslateRequest({
        type: "MANUAL_TRANSLATE",
        text: sourceText,
        targetLanguage,
        platform: "popup",
        context: "manual",
        logToFeed: true
      })
    )
  );

  return {
    ok: true,
    sourceText,
    results: results.filter((item) => item && item.ok)
  };
}

async function handleTranscribeRequest(message) {
  const settings = await getSettings();
  const backendUrl = getBackendUrl(settings);
  const targetLanguage =
    message.targetLanguage ||
    settings.preferredLanguage ||
    DEFAULT_SETTINGS.preferredLanguage;
  const audioBase64 = (message.audioBase64 || "").trim();

  if (!audioBase64) {
    return { ok: false, error: "Missing audio payload" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${backendUrl}/transcribe/base64`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audio_base64: audioBase64,
        filename: message.filename || "voice-note.webm",
        target_language: targetLanguage,
        source_language: message.sourceLanguage || null
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Transcription API returned ${response.status}`);
    }

    const payload = await response.json();
    const result = {
      ok: true,
      transcript: payload.transcript,
      translatedText: payload.translated_text,
      detectedLanguage: payload.detected_language,
      targetLanguage: payload.target_language,
      model: payload.model,
      degraded: Boolean(payload.degraded)
    };

    if (message.logToFeed !== false) {
      await appendTranslationToFeed({
        context: "voice",
        platform: message.platform || "unknown",
        sourceText: payload.transcript || "",
        translatedText: payload.translated_text || "",
        detectedLanguage: payload.detected_language || "unknown",
        targetLanguage: payload.target_language || targetLanguage,
        model: payload.model || "unknown",
        degraded: Boolean(payload.degraded)
      });
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "Transcription unavailable"
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getRecentTranslations() {
  const state = await chrome.storage.local.get({
    [STORAGE_KEYS.recentTranslations]: []
  });

  const items = state[STORAGE_KEYS.recentTranslations];
  return Array.isArray(items) ? items : [];
}

async function clearRecentTranslations() {
  await chrome.storage.local.set({ [STORAGE_KEYS.recentTranslations]: [] });
}

async function appendTranslationToFeed(entry) {
  const normalizedEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    context: entry.context || "chat",
    platform: entry.platform || "unknown",
    sourceText: (entry.sourceText || "").trim(),
    translatedText: (entry.translatedText || "").trim(),
    detectedLanguage: entry.detectedLanguage || "unknown",
    targetLanguage: entry.targetLanguage || "unknown",
    model: entry.model || "unknown",
    degraded: Boolean(entry.degraded)
  };

  if (!normalizedEntry.sourceText || !normalizedEntry.translatedText) {
    return;
  }

  const current = await getRecentTranslations();
  const duplicate = current[0];
  if (
    duplicate &&
    duplicate.sourceText === normalizedEntry.sourceText &&
    duplicate.translatedText === normalizedEntry.translatedText &&
    duplicate.targetLanguage === normalizedEntry.targetLanguage &&
    duplicate.context === normalizedEntry.context
  ) {
    return;
  }

  const nextItems = [normalizedEntry, ...current].slice(0, RECENT_LIMIT);
  await chrome.storage.local.set({ [STORAGE_KEYS.recentTranslations]: nextItems });

  chrome.runtime.sendMessage({ type: "TRANSLATION_EVENT", entry: normalizedEntry }, () => {
    void chrome.runtime.lastError;
  });
}
