// src/services/remoteControl.js
import { supabase } from './supabase';

let activeChannel = null;

/**
 * Start listening for remote commands sent to this booth.
 * @param {string} boothId - the booth's UUID from the booths table
 * @param {function} onCommand - called with { action, payload } when a command arrives
 * @returns {function} unsubscribe function
 */
export function subscribeToRemoteCommands(boothId, onCommand) {
  if (activeChannel) {
    activeChannel.unsubscribe();
    activeChannel = null;
  }

  const channel = supabase.channel(`booth:${boothId}`, {
    config: { broadcast: { self: false } }
  });

  channel
    .on('broadcast', { event: 'remote-command' }, ({ payload }) => {
      console.log('[remoteControl] received command:', payload);
      if (typeof onCommand === 'function') {
        onCommand(payload);
      }
    })
    .subscribe((status) => {
      console.log('[remoteControl] channel status:', status);
    });

  activeChannel = channel;

  return () => {
    channel.unsubscribe();
    activeChannel = null;
  };
}

function waitForSubscribed(channel, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} channel timed out`)), 5000);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        reject(new Error(`${label} channel failed: ${status}`));
      }
    });
  });
}

/**
 * Send a command to a specific booth.
 * @param {string} boothId - target booth UUID
 * @param {string} action - command name, e.g. 'update-event' or 'restart-booth'
 * @param {object} payload - action-specific data
 */
export async function sendRemoteCommand(boothId, action, payload = {}) {
  if (!boothId) return { ok: false, error: 'Missing booth id' };

  const channel = supabase.channel(`booth:${boothId}`, {
    config: { broadcast: { self: false } }
  });

  try {
    await waitForSubscribed(channel, 'Remote command');

    const result = await channel.send({
      type: 'broadcast',
      event: 'remote-command',
      payload: {
        action,
        payload,
        sentAt: new Date().toISOString(),
      },
    });

    return { ok: result === 'ok', status: result };
  } finally {
    channel.unsubscribe();
  }
}

/**
 * Send a command to a booth AND wait for its acknowledgement.
 * Uses ONE channel that both sends and listens, avoiding a double-subscription race.
 *
 * stop-booth is treated as fire-and-forget because the booth closes the app before
 * it can send an ACK — it returns { ok: true } immediately after the send.
 *
 * @param {string} boothId
 * @param {string} action
 * @param {object} commandPayload
 * @param {number} timeoutMs  — how long to wait for ACK (default 7 s)
 */
export async function sendCommandAndWaitForAck(boothId, action, commandPayload = {}, timeoutMs = 7000) {
  if (!boothId) return { ok: false, error: 'Missing booth id' };

  // stop-booth closes the app — no ACK will ever arrive
  if (action === 'stop-booth') {
    return sendRemoteCommand(boothId, action, commandPayload);
  }

  return new Promise((resolve) => {
    let settled = false;
    let channel = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      // Delay unsubscribe so any in-flight message can land
      setTimeout(() => { try { channel?.unsubscribe(); } catch {} }, 200);
      resolve(result);
    };

    const timer = setTimeout(() => settle({ ok: false, timedOut: true }), timeoutMs);

    // Single channel: subscribe first to catch the ACK, then send the command
    channel = supabase.channel(`booth:${boothId}`);

    channel
      .on('broadcast', { event: 'remote-command-ack' }, ({ payload }) => {
        if (!action || payload?.action === action) {
          clearTimeout(timer);
          settle({ ok: true, payload });
        }
      })
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        // Send on the same channel we are already subscribed to
        const result = await channel.send({
          type: 'broadcast',
          event: 'remote-command',
          payload: { action, payload: commandPayload, sentAt: new Date().toISOString() },
        });
        if (result !== 'ok') {
          clearTimeout(timer);
          settle({ ok: false, error: `Send failed: ${result}` });
        }
      });
  });
}

export async function sendRemoteAck(boothId, action, payload = {}) {
  if (!boothId) return { ok: false, error: 'Missing booth id' };

  const channel = supabase.channel(`booth:${boothId}`);

  try {
    await waitForSubscribed(channel, 'Remote ack');

    return channel.send({
      type: 'broadcast',
      event: 'remote-command-ack',
      payload: {
        action,
        payload,
        acknowledgedAt: new Date().toISOString(),
      },
    });
  } finally {
    channel.unsubscribe();
  }
}
