/**
 * Per-channel state machine for ad-blocking escalation.
 *
 * States: IDLE -> SUBSTITUTING
 * Each channel escalates independently when a layer reports failure.
 * Channels de-escalate after a cooldown with no ad activity.
 */

const ChannelState = {
  IDLE: 'IDLE',
  SUBSTITUTING: 'SUBSTITUTING',
};

const ESCALATION_ORDER = [
  ChannelState.IDLE,
  ChannelState.SUBSTITUTING,
];

const STATE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES_BEFORE_ESCALATION = 2;

const channels = new Map();

function findChannel(channelName) {
  if (!channelName) return null;
  const key = channelName.toLowerCase();
  const ch = channels.get(key);
  if (ch) ch.lastActivity = Date.now();
  return ch || null;
}

function getChannel(channelName) {
  if (!channelName) return null;
  const key = channelName.toLowerCase();
  if (!channels.has(key)) {
    channels.set(key, {
      name: key,
      state: ChannelState.IDLE,
      failures: 0,
      lastActivity: Date.now(),
      adActive: false,
      adsBlocked: 0,
    });
  }
  const ch = channels.get(key);
  ch.lastActivity = Date.now();
  return ch;
}

function escalate(channelName) {
  const ch = getChannel(channelName);
  if (!ch) return;
  ch.failures++;
  if (ch.failures < MAX_FAILURES_BEFORE_ESCALATION) return;

  const idx = ESCALATION_ORDER.indexOf(ch.state);
  if (idx < ESCALATION_ORDER.length - 1) {
    ch.state = ESCALATION_ORDER[idx + 1];
    ch.failures = 0;
    console.log(`[TTV] ${ch.name} escalated to ${ch.state}`);
  }
}

function deescalate(channelName) {
  const ch = findChannel(channelName);
  if (!ch) return;
  ch.state = ChannelState.IDLE;
  ch.failures = 0;
  ch.adActive = false;
  console.log(`[TTV] ${ch.name} de-escalated to IDLE`);
}

function recordFailure(channelName) {
  escalate(channelName);
}

// Periodic cleanup of stale channels
setInterval(() => {
  const now = Date.now();
  for (const [key, ch] of channels) {
    if (now - ch.lastActivity > STATE_TTL_MS) {
      channels.delete(key);
    }
  }
}, 60 * 1000);
