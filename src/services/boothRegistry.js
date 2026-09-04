// src/services/boothRegistry.js
import { supabase } from './supabase';

let heartbeatInterval = null;
let registeredBoothId = null;

export async function registerBooth({ userId, boothName, fingerprint, platform, appVersion }) {
  if (!userId) return null;

  // When fingerprint is null (web, IPC failure) fall back to a stable per-user key
  // so the upsert still deduplicates instead of inserting a new row every launch.
  const effectiveFingerprint = fingerprint || `user-${userId}-default`;

  // Upsert by user_id + fingerprint. The booths table must have a UNIQUE constraint
  // on (user_id, fingerprint) for this onConflict to take effect.
  const { data, error } = await supabase
    .from('booths')
    .upsert({
      user_id: userId,
      name: boothName || 'My Booth',
      fingerprint: effectiveFingerprint,
      platform,
      app_version: appVersion,
      is_online: true,
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,fingerprint',
      returning: 'representation',
    })
    .select()
    .single();

  if (error) {
    console.error('[boothRegistry] register failed:', error);
    return null;
  }

  registeredBoothId = data.id;

  // Heartbeat every 30 seconds to maintain online status
  heartbeatInterval = setInterval(async () => {
    if (!registeredBoothId) return;
    await supabase
      .from('booths')
      .update({ is_online: true, last_seen_at: new Date().toISOString() })
      .eq('id', registeredBoothId);
  }, 30_000);

  return data;
}

export async function unregisterBooth() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (!registeredBoothId) return;

  await supabase
    .from('booths')
    .update({ is_online: false })
    .eq('id', registeredBoothId);

  registeredBoothId = null;
}

export function getRegisteredBoothId() {
  return registeredBoothId;
}