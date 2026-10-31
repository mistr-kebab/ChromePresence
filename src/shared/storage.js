import { normalizeSettings, SESSION_KEY, STORAGE_KEY } from './defaults.js';

export async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return normalizeSettings(stored?.[STORAGE_KEY]);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export async function getSession() {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    return stored?.[SESSION_KEY] ?? {};
  } catch {
    return {};
  }
}

export async function saveSession(runtime) {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: runtime });
  } catch {
    // Session storage is a convenience; presence still works without it.
  }
}
