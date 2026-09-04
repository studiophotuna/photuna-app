/**
 * photoPrinter.js
 *
 * Unified printing service for the iPad photobooth.
 * Consumed by print screens in AdminDashboard and the kiosk flow.
 *
 * All methods resolve — they never throw. Check the `ok` field on the result.
 *
 * Platform routing:
 *   iOS (Capacitor)  → native PhotoPrinterPlugin via window.electron (capacitorShim)
 *   Electron/Windows → window.electron (existing Electron IPC bridge)
 *   Web/PWA          → graceful no-op with informative error
 */

function getNative() {
  return window.electron ?? null;
}

// ── Printer discovery ─────────────────────────────────────────────────────────

/**
 * Discover all printers visible on the local WiFi network.
 * @returns {Promise<Array<{id, name, model, brand, status, mediaRemaining, simulated?}>>}
 */
export async function discoverPrinters() {
  const native = getNative();
  if (!native) return [];
  try {
    const result = await native.listPrinters?.();
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Get status of a specific printer.
 * @param {string} printerId
 * @param {'dnp'|'hiti'} brand
 * @returns {Promise<{status: string, mediaRemaining?: number, error?: string}>}
 */
export async function getPrinterStatus(printerId, brand = 'dnp') {
  const native = getNative();
  if (!native) return { status: 'unavailable' };
  try {
    return await native.getPrinterStatus?.({ printerId, brand }) ?? { status: 'unknown' };
  } catch (err) {
    return { status: 'error', error: err?.message };
  }
}

// ── Printing ──────────────────────────────────────────────────────────────────

/**
 * Print a composed image to a DNP or HiTi printer over WiFi.
 *
 * @param {object} opts
 * @param {string}  opts.dataUrl     - composed image as a data URL (jpeg or png)
 * @param {string} [opts.printerId]  - from discoverPrinters(); uses first found if omitted
 * @param {'dnp'|'hiti'} [opts.brand] - printer brand (default: 'dnp')
 * @param {'4x6'|'2x6'} [opts.mediaType] - print size (default: '4x6')
 * @param {number} [opts.copies]     - number of prints (default: 1)
 * @returns {Promise<{ok: boolean, jobId?: string, error?: string, simulated?: boolean}>}
 */
export async function printPhoto({
  dataUrl,
  printerId,
  brand = 'dnp',
  mediaType = '4x6',
  copies = 1,
} = {}) {
  const native = getNative();

  if (!native) {
    return { ok: false, error: 'Printing is not available on this platform.' };
  }

  if (!dataUrl) {
    return { ok: false, error: 'No image provided for printing.' };
  }

  // Convert data URL → base64 string (strip the "data:image/...;base64," prefix)
  let imageBase64 = dataUrl;
  if (dataUrl.includes(',')) {
    imageBase64 = dataUrl.split(',')[1];
  }

  if (!imageBase64) {
    return { ok: false, error: 'Failed to extract image data from data URL.' };
  }

  try {
    const result = await native.printPhoto({
      imageBase64,
      printerId,
      brand,
      mediaType,
      copies,
    });
    return result ?? { ok: false, error: 'No response from printer plugin.' };
  } catch (err) {
    return { ok: false, error: err?.message ?? 'Print failed.' };
  }
}

/**
 * Send a single test print (1 copy) to verify printer connectivity.
 * @param {string} dataUrl  - test image as a data URL
 * @param {string} printerId
 * @param {'dnp'|'hiti'} brand
 */
export async function testPrint(dataUrl, printerId, brand = 'dnp') {
  return printPhoto({ dataUrl, printerId, brand, copies: 1 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the current platform has a printer plugin available.
 * Use to conditionally show/hide print UI.
 */
export function isPrintingSupported() {
  const native = getNative();
  return !!(native?.printPhoto || native?.listPrinters);
}
