// What device is this, for the purpose of a booth-device seat?
//
// One answer for every platform the app runs on, so LicenseContext, the
// Devices tab and the limit screen never branch on platform themselves:
//
//   Windows app       → seat. Identity comes from the main process (SMBIOS UUID
//                       + MachineGuid), plus the legacy fingerprint so an
//                       existing seat carries over instead of taking a new one.
//   iPad / Android    → seat. A tablet runs the booth the same way a PC does.
//   tablet (native)
//   Phone (native)    → null. Phones are remote controls, never booths.
//   Browser           → null. Same reason, and nothing stable to identify it by.
//
// Returns { deviceId, legacyFingerprint, deviceName, deviceType, platform } or
// null. null means "does not take a seat" — callers skip registration entirely,
// so the device can never be refused.

import { Capacitor } from "@capacitor/core";
import { SecureStoragePlugin } from "capacitor-secure-storage-plugin";
import { Preferences } from "@capacitor/preferences";

const TABLET_ID_KEY = "photuna.device.id";

// iPadOS 13+ reports a desktop Safari user agent, so the UA alone misses modern
// iPads; a Mac with a touch screen does not exist, which makes the second test
// safe.
function isIpad() {
  if (typeof navigator === "undefined") return false;
  if (/iPad/i.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

// Android's own tablet threshold: smallest width of at least 600dp.
function isAndroidTablet() {
  if (typeof window === "undefined" || !window.screen) return false;
  return Math.min(window.screen.width, window.screen.height) >= 600;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A tablet has no hardware id the web layer can read, so it gets a random one
// on first launch. The Keychain (iOS) and Keystore-backed storage (Android)
// survive reinstalling the app, which Preferences does not — reinstalling
// should not cost a seat. Preferences is only the fallback if secure storage
// is unavailable.
async function getOrCreateTabletId() {
  try {
    const { value } = await SecureStoragePlugin.get({ key: TABLET_ID_KEY });
    if (value) return value;
  } catch { /* not stored yet, or plugin unavailable */ }

  try {
    const { value } = await Preferences.get({ key: TABLET_ID_KEY });
    if (value) return value;
  } catch { /* ignore */ }

  const id = `tablet-${randomId()}`;
  try { await SecureStoragePlugin.set({ key: TABLET_ID_KEY, value: id }); }
  catch { try { await Preferences.set({ key: TABLET_ID_KEY, value: id }); } catch { /* ignore */ } }
  return id;
}

export async function getDeviceIdentity() {
  // Windows (Electron)
  if (typeof window !== "undefined" && window.system?.getFingerprint) {
    const res = await window.system.getFingerprint().catch(() => null);
    if (!res?.ok || !res.deviceId) return null;
    return {
      deviceId: res.deviceId,
      legacyFingerprint: res.fingerprint || null,
      deviceName: res.hostname || null,
      deviceType: res.deviceType || "windows",
      platform: (window.process && window.process.platform) || "win32",
    };
  }

  // Native mobile (Capacitor)
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    const tablet = platform === "ios" ? isIpad() : platform === "android" ? isAndroidTablet() : false;
    if (!tablet) return null;
    return {
      deviceId: await getOrCreateTabletId(),
      legacyFingerprint: null,
      deviceName: platform === "ios" ? "iPad" : "Android tablet",
      deviceType: platform === "ios" ? "ipad" : "android_tablet",
      platform,
    };
  }

  return null;
}

// Human label for a device_type, shared by every screen that lists devices.
export function deviceTypeLabel(type, platformFallback) {
  switch (String(type || "").toLowerCase()) {
    case "windows": return "Windows PC";
    case "mac": return "Mac";
    case "ipad": return "iPad";
    case "android_tablet": return "Android tablet";
    default: {
      const p = String(platformFallback || "").toLowerCase();
      if (p.includes("win")) return "Windows PC";
      if (p.includes("mac") || p.includes("darwin")) return "Mac";
      if (p.includes("ios")) return "iPad";
      if (p.includes("android")) return "Android tablet";
      return "Device";
    }
  }
}

// Whether a row takes a seat. Rows from before per-device naming that have not
// checked in since do not — see migration 022 for why.
export function takesSeat(row) {
  return row?.seat_counted !== false;
}

// The name an operator sees for a device row: their own label first, then the
// device's own name, then its type.
export function deviceDisplayName(row) {
  return (row?.custom_name && row.custom_name.trim())
    || (row?.device_name && row.device_name.trim())
    || deviceTypeLabel(row?.device_type, row?.platform);
}
