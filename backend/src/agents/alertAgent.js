// backend/src/agents/alertAgent.js
// Claude-powered agent that reasons about sensor data and decides whether to alert

import Anthropic from '@anthropic-ai/sdk';
import { alerts, readings, residents } from '../db/queries.js';
import { BaselineProfiler } from '../services/baseline.js';
import { sendSMS, formatAlertSMS } from '../services/sms.js';
import { sendPushForResident } from '../services/push.js';
import redis from '../services/redis.js';

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}
const profiler = new BaselineProfiler();

const ALERT_COOLDOWN_MINUTES = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '15');
const FALL_RECOVERY_SECONDS  = parseInt(process.env.FALL_RECOVERY_SECONDS  || '30');
const NO_MOTION_DAY_MINUTES  = parseInt(process.env.NO_MOTION_DAY_MINUTES  || '120');

// Transient per-room state
const state = new Map();

// L1 in-memory cooldown (fast path, lost on restart)
const alertCooldowns = new Map();

// L1 resident cache
const residentCache = new Map();
const CACHE_TTL_MS = 60_000;

// ── Cooldown helpers with Redis L2 ───────────────────────────────

async function getCooldownTimestamp(key) {
  const mem = alertCooldowns.get(key);
  if (mem) return mem;
  try {
    const ts = await redis.get(`cooldown:${key}`);
    return ts ? parseInt(ts) : null;
  } catch { return null; }
}

async function setCooldown(key) {
  const now = Date.now();
  alertCooldowns.set(key, now);
  try {
    await redis.set(`cooldown:${key}`, now, 'EX', ALERT_COOLDOWN_MINUTES * 60);
  } catch { /* non-fatal */ }
}

// ── Resident cache with Redis L2 ──────────────────────────────────

async function getResidentCached(room) {
  const cached = residentCache.get(room);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.resident;

  try {
    const json = await redis.get(`resident:room:${room}`);
    if (json) {
      const resident = JSON.parse(json);
      residentCache.set(room, { resident, cachedAt: Date.now() });
      return resident;
    }
  } catch { /* fallthrough to DB */ }

  const resident = await residents.getByRoom(room);
  residentCache.set(room, { resident, cachedAt: Date.now() });
  try {
    await redis.set(`resident:room:${room}`, JSON.stringify(resident), 'EX', 60);
  } catch { /* non-fatal */ }
  return resident;
}

export function invalidateResidentCache(room) {
  residentCache.delete(room);
  try { redis.del(`resident:room:${room}`); } catch { /* non-fatal */ }
}

function getRoomState(room) {
  if (!state.has(room)) {
    state.set(room, {
      lastMotionTime: Date.now(),
      fallCandidateTime: null,
      lastPresenceTime: Date.now(),
      frameBuffer: [],
    });
  }
  return state.get(room);
}

// ── Main entry point ──────────────────────────────────────────────

export async function processFrame(frame) {
  const resident  = await getResidentCached(frame.room);
  const roomState = getRoomState(frame.room);

  await readings.insert({
    resident_id:    resident?.id || null,
    room:           frame.room,
    presence:       frame.presence ? 1 : 0,
    person_count:   frame.person_count,
    breathing_rate: frame.breathing_rate,
    heart_rate:     frame.heart_rate,
    motion_level:   frame.motion_level,
    posture:        frame.posture,
    confidence:     frame.confidence,
    raw_json:       JSON.stringify(frame.raw),
  });

  if (resident && frame.presence && (frame.confidence || 0) > 0.6) {
    await profiler.updateFromReading(resident.id, frame);
  }

  if (frame.motion_level > 0.1) roomState.lastMotionTime    = Date.now();
  if (frame.presence)          roomState.lastPresenceTime   = Date.now();
  roomState.frameBuffer.push(frame);
  if (roomState.frameBuffer.length > 60) roomState.frameBuffer.shift();

  if (!resident) return;

  const detectedEvents = await detectEvents(frame, roomState, resident);
  for (const event of detectedEvents) {
    await evaluateAndAlert(event, resident, roomState);
  }
}

// ── Event Detectors ───────────────────────────────────────────────

async function detectEvents(frame, roomState, resident) {
  const events = [];
  const now  = Date.now();
  const hour = new Date().getHours();
  const isDaytime = hour >= 7 && hour < 22;

  // 1. FALL
  if (frame.presence && frame.posture === 'lying' && isDaytime) {
    if (!roomState.fallCandidateTime) {
      roomState.fallCandidateTime = now;
    } else if (now - roomState.fallCandidateTime > FALL_RECOVERY_SECONDS * 1000) {
      events.push({ type: 'fall', urgency: 'high', frame });
      roomState.fallCandidateTime = null;
    }
  } else {
    roomState.fallCandidateTime = null;
  }

  // 2. NO MOTION (daytime)
  if (isDaytime && frame.presence && frame.motion_level < 0.05) {
    const minutesStationary = (now - roomState.lastMotionTime) / 60_000;
    if (minutesStationary > NO_MOTION_DAY_MINUTES) {
      events.push({ type: 'no_motion', urgency: 'medium', frame, minutes: Math.round(minutesStationary) });
    }
  }

  // 3. ABNORMAL BREATHING
  if (frame.breathing_rate && (frame.confidence || 0) > 0.75) {
    if (await profiler.isAnomalous(resident.id, 'breathing_rate', frame.breathing_rate)) {
      events.push({ type: 'abnormal_breathing', urgency: 'medium', frame });
    }
  }

  // 4. ELEVATED HEART RATE at rest
  if (frame.heart_rate && frame.motion_level < 0.1) {
    if (await profiler.isAnomalous(resident.id, 'heart_rate', frame.heart_rate)) {
      events.push({ type: 'elevated_heart_rate', urgency: 'medium', frame });
    }
  }

  // 5. MISSING AT MEALTIME
  const isMealtime = (hour >= 8 && hour < 9) || (hour >= 12 && hour < 13) || (hour >= 18 && hour < 19);
  if (isMealtime && !frame.presence) {
    const minutesMissing = (now - roomState.lastPresenceTime) / 60_000;
    if (minutesMissing > 30) {
      events.push({ type: 'missing_at_mealtime', urgency: 'low', frame, minutes: Math.round(minutesMissing) });
    }
  }

  return events;
}

// ── AI Reasoning + Alert Dispatch ────────────────────────────────

async function evaluateAndAlert(event, resident, roomState) {
  const cooldownKey = `${resident.id}:${event.type}`;

  // L1 + L2 cooldown check
  const lastAlertTime = await getCooldownTimestamp(cooldownKey);
  if (lastAlertTime) {
    const minutesSinceLast = (Date.now() - lastAlertTime) / 60_000;
    if (minutesSinceLast < ALERT_COOLDOWN_MINUTES) return;
  }

  // DB fallback (handles restart with neither L1 nor L2)
  const lastAlert = await alerts.getLastOfType(resident.id, event.type);
  if (lastAlert) {
    const minutesSinceLast = (Date.now() - new Date(lastAlert.created_at).getTime()) / 60_000;
    if (minutesSinceLast < ALERT_COOLDOWN_MINUTES) {
      await setCooldown(cooldownKey);
      return;
    }
  }

  const recentReadings = await readings.getLastN(event.frame.room, 20);
  const context        = await profiler.buildContext(resident.id, recentReadings);
  const recentAlerts   = await alerts.getRecent(resident.id, 2);

  const aiDecision = await askClaude(event, resident, context, recentAlerts);

  const alertRecord = {
    resident_id:      resident.id,
    room:             event.frame.room,
    alert_type:       event.type,
    urgency:          aiDecision.urgency || event.urgency,
    message:          aiDecision.message,
    ai_reasoning:     aiDecision.reasoning,
    sent:             aiDecision.should_alert ? 1 : 0,
    suppressed:       aiDecision.should_alert ? 0 : 1,
    suppressed_reason: aiDecision.should_alert ? null : aiDecision.reasoning,
  };

  await alerts.insert(alertRecord);
  await setCooldown(cooldownKey);

  if (aiDecision.should_alert) {
    console.log(`🚨 ALERT [${aiDecision.urgency?.toUpperCase()}] ${resident.name}: ${aiDecision.message}`);
    await dispatchAlerts(resident, event.type, aiDecision);
  } else {
    console.log(`✅ Alert suppressed by AI: ${event.type} for ${resident.name}`);
  }
}

async function askClaude(event, resident, context, recentAlerts) {
  const age = resident.date_of_birth
    ? Math.floor((Date.now() - new Date(resident.date_of_birth)) / (365.25 * 24 * 3600 * 1000))
    : 'unknown';

  const prompt = `You are a care monitoring AI for elderly residents. Analyze this sensor event and decide whether a caregiver should be alerted.

RESIDENT PROFILE:
- Name: ${resident.name}
- Age: ${age}
- Room: ${resident.room}
- Notes: ${resident.notes || 'None'}

EVENT DETECTED:
- Type: ${event.type}
- Urgency level: ${event.urgency}
- Current frame: ${JSON.stringify(event.frame, null, 2)}

CONTEXT:
- Personal baseline vitals: ${JSON.stringify(context.baseline, null, 2)}
- Recent 10-minute averages: ${JSON.stringify(context.recent_averages, null, 2)}
- Deviations from baseline: ${JSON.stringify(context.deviations, null, 2)}

RECENT ALERTS (last 2 hours):
${recentAlerts.length ? recentAlerts.map(a => `- ${a.alert_type}: ${a.message} (${a.created_at})`).join('\n') : 'None'}

CURRENT TIME: ${new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', weekday: 'long' })}

Respond ONLY with valid JSON (no markdown):
{
  "should_alert": boolean,
  "urgency": "low" | "medium" | "high",
  "message": "Clear, concise alert message for a caregiver (1-2 sentences)",
  "reasoning": "Your reasoning for this decision (2-3 sentences)"
}`;

  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    let text = response.content[0].text.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    return JSON.parse(text);
  } catch (err) {
    console.error('❌ Claude API error:', err.message);
    return {
      should_alert: event.urgency === 'high',
      urgency:      event.urgency,
      message:      `${event.type.replace(/_/g, ' ')} detected for ${resident.name}.`,
      reasoning:    'AI reasoning unavailable — fallback to rule-based alert.',
    };
  }
}

async function dispatchAlerts(resident, alertType, decision) {
  const contacts = JSON.parse(resident.emergency_contacts || '[]');
  const smsMessage = formatAlertSMS(resident.name, alertType, decision.message, decision.urgency);

  // SMS
  for (const contact of contacts) {
    if (contact.phone) await sendSMS(contact.phone, smsMessage);
  }

  // Push notification to all assigned users
  await sendPushForResident(resident.id, {
    title:   `CareWatch Alert — ${resident.name}`,
    body:    decision.message,
    urgency: decision.urgency,
    url:     '/?tab=alerts',
  });
}
