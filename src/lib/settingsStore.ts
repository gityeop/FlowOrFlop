import { LazyStore } from "@tauri-apps/plugin-store";

import { AppSettings, DEFAULT_SETTINGS } from "./types";

const STORE_PATH = "floworflop.settings.json";
const SETTINGS_KEY = "appSettings";

const settingsStore = new LazyStore(STORE_PATH, {
  defaults: {
    [SETTINGS_KEY]: DEFAULT_SETTINGS,
  },
  autoSave: 150,
});

let isReady = false;

async function ensureStoreReady(): Promise<void> {
  if (isReady) {
    return;
  }

  await settingsStore.init();
  isReady = true;

  const current = await settingsStore.get<AppSettings>(SETTINGS_KEY);
  if (!current) {
    await settingsStore.set(SETTINGS_KEY, DEFAULT_SETTINGS);
    await settingsStore.save();
  }
}

export async function loadSettings(): Promise<AppSettings> {
  await ensureStoreReady();
  const current = await settingsStore.get<Partial<AppSettings>>(SETTINGS_KEY);

  return {
    ...DEFAULT_SETTINGS,
    ...(current ?? {}),
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await ensureStoreReady();
  await settingsStore.set(SETTINGS_KEY, settings);
  await settingsStore.save();
}

export async function patchSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await loadSettings();
  const next = {
    ...current,
    ...patch,
  };

  await saveSettings(next);
  return next;
}
