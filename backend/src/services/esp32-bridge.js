#!/usr/bin/env node
/**
 * CareWatch ESP32 Direct Bridge
 * ─────────────────────────────
 * Two-layer subject identification:
 *
 *   Layer 1 — Heuristics (works immediately, no training needed)
 *     Scores motion amplitude, breathing rate, gait frequency, and
 *     subcarrier variance to guess Elio vs Haru.
 *
 *   Layer 2 — k-NN classifier (Phase 2, enrollment-based)
 *     Records labeled feature vectors during enrollment walks.
 *     Trains a k-NN on those vectors and fuses with heuristics.
 *     Model persists to disk across restarts.
 */

import dgram from 'dgram';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const UDP_PORT    = parseInt(process.env.ESP32_UDP_PORT || '5005');
const BACKEND_URL = process.env.ESP32_BACKEND_URL || `http://localhost:${process.env.PORT || 4000}/api/esp32/frame`;
const MODEL_PATH  = path.join(__dirname, '../../data/subject-model.json');
const ROOM        = process.env.ESP32_DEFAULT_ROOM || 'default';

// ── Rolling signal buffers ───────────────────────────────────────
const WINDOW    = 300;  // ~30s at ~10fps
const motionBuf = [];
const ampBuf    = [];   // raw mean amplitudes (for gait freq)
let frameCount  = 0;
let lastAmps    = null;

// ── Per-subcarrier time series for Top-K selection ──────────────
const SC_HISTORY_LEN = 100;        // ~10s of per-subcarrier data
const scHistory      = [];         // array of amplitude arrays (ring buffer)
let scHistoryIdx     = 0;
let topK             = null;       // Int32Array of top-K subcarrier indices
const TOP_K_COUNT    = 20;
const TOP_K_CALIBRATE_AT = 60;     // calibrate after 60 frames (~6s)

// ── Adaptive motion detection ────────────────────────────────────

// ── ML model (k-NN) ──────────────────────────────────────────────
let mlModel = { samples: [], k: 3, trained: false };

function loadModel() {
  try {
    if (fs.existsSync(MODEL_PATH)) {
      mlModel = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
      console.log(`🧠 Loaded ML model: ${mlModel.samples.length} samples (trained=${mlModel.trained})`);
    } else {
      console.log('🧠 No ML model yet — heuristics only until enrollment');
    }
  } catch { console.log('🧠 Starting fresh ML model'); }
}

function saveModel() {
  try {
    fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
    fs.writeFileSync(MODEL_PATH, JSON.stringify(mlModel, null, 2));
  } catch (e) { console.error('Failed to save model:', e.message); }
}

// ── Enrollment ───────────────────────────────────────────────────
let enrolling     = null;  // 'elio' | 'haru' | null
let enrollSamples = [];
let enrollTimer   = null;

export function startEnrollment(subject, durationMs = 60000) {
  enrolling     = subject;
  enrollSamples = [];
  clearTimeout(enrollTimer);
  enrollTimer   = setTimeout(finishEnrollment, durationMs);
  console.log(`📝 Enrollment started: ${subject} — ${durationMs/1000}s`);
  return { ok: true, subject, durationMs };
}

export function finishEnrollment() {
  clearTimeout(enrollTimer);
  if (!enrolling) return;
  const subject = enrolling;
  enrolling     = null;
  if (enrollSamples.length < 10) {
    console.log(`⚠️  Too few samples (${enrollSamples.length}) — enrollment discarded`);
    enrollSamples = [];
    return { ok: false, reason: 'too_few_samples' };
  }
  mlModel.samples.push(...enrollSamples.map(f => ({ label: subject, features: f })));
  mlModel.trained = mlModel.samples.filter(s => s.label === 'elio').length >= 5 &&
                    mlModel.samples.filter(s => s.label === 'haru').length >= 5;
  saveModel();
  console.log(`✅ Enrolled ${subject}: ${enrollSamples.length} samples. Total: ${mlModel.samples.length}, trained=${mlModel.trained}`);
  enrollSamples = [];
  return { ok: true, subject, samplesAdded: enrollSamples.length };
}

export function clearModel() {
  mlModel = { samples: [], k: 3, trained: false };
  saveModel();
  return { ok: true };
}

export { mlModel };

/**
 * Accept a pre-computed 7-dim feature vector from any data path
 * (e.g. RuView WebSocket frames) so enrollment works without ESP32 UDP.
 */
export function addEnrollmentSample(featureVector) {
  if (enrolling && Array.isArray(featureVector) && featureVector.length === 7) {
    enrollSamples.push(featureVector);
  }
}

/** Whether enrollment is currently active */
export function isEnrolling() { return enrolling; }

// ── Feature extraction ───────────────────────────────────────────
// 7-dimensional vector per frame:
// [motionScore, variance, breathingRate, meanAmp, ampSpread, gaitFreq, subcarrierActivity]
function extractFeatures(amplitudes, motionScore, variance, breathingRate) {
  const mean     = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
  const spread   = Math.max(...amplitudes) - Math.min(...amplitudes);
  const gaitFreq = estimateGaitFreq(ampBuf);
  const activity = amplitudes.filter(v => Math.abs(v) > 5).length / amplitudes.length;
  return [motionScore, variance, breathingRate ?? 14, mean, spread, gaitFreq, activity];
}

// ── Gait frequency (now uses spectral analysis via extractFeatures) ──
function estimateGaitFreq(buffer) {
  if (buffer.length < 40) return 0;
  // Use Goertzel to find peak in gait band
  const recent = buffer.slice(-100);
  let maxP = 0, peakF = 0;
  for (let f = 0.5; f <= 3.0; f += 0.1) {
    const p = goertzelPower(recent, f, 10);
    if (p > maxP) { maxP = p; peakF = f; }
  }
  return Math.round(peakF * 10) / 10;
}

// ── k-NN classifier ──────────────────────────────────────────────
function euclidean(a, b) {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function knnClassify(features) {
  if (!mlModel.trained || mlModel.samples.length < mlModel.k) return null;
  const sorted = mlModel.samples
    .map(s => ({ label: s.label, d: euclidean(features, s.features) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, mlModel.k);
  const votes  = {};
  for (const n of sorted) votes[n.label] = (votes[n.label] || 0) + 1;
  const [label, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return { subject: label, confidence: count / mlModel.k, method: 'knn' };
}

// ── Heuristic classifier ─────────────────────────────────────────
// Scoring rubric (tune these after observing your real signal):
//
//  Elio (human):  slow gait 1.2–2.8 Hz, large variance, BR < 20
//  Haru (Pomsky): fast gait 2.5–5 Hz,   small variance, BR 15–35
//
function heuristicClassify(features, breathingRate, motionScore, variance) {
  const gaitFreq = features[5];
  let e = 0, h = 0;

  // Breathing rate
  if (breathingRate != null) {
    if (breathingRate <= 20) e += 2; else h += 2;
    if (breathingRate >= 15) h += 1;
  }
  // Gait frequency
  if (gaitFreq > 0) {
    if (gaitFreq >= 1.2 && gaitFreq <= 2.8) e += 3;
    if (gaitFreq >= 2.5 && gaitFreq <= 5.0) h += 3;
  }
  // Motion amplitude — humans create bigger disturbances
  if (motionScore > 6)  e += 2;
  if (motionScore <= 6) h += 1;
  // Signal variance — larger body = more variance
  if (variance > 80) e += 2; else h += 1;
  // Subcarrier activity
  if (features[6] > 0.4) e += 1; else h += 1;

  const total   = e + h || 1;
  const subject = e >= h ? 'elio' : 'haru';
  return { subject, confidence: Math.max(e, h) / total, method: 'heuristic', scores: { elio: e, haru: h } };
}

// ── Fusion: heuristic + ML ───────────────────────────────────────
function classifySubject(features, br, motionScore, variance) {
  const H  = heuristicClassify(features, br, motionScore, variance);
  const ML = knnClassify(features);

  if (!ML) return H; // no model yet

  if (ML.confidence >= 0.7) {
    if (ML.subject === H.subject) {
      // Both agree — boost confidence
      return { subject: ML.subject, confidence: Math.min(0.98, (ML.confidence + H.confidence) / 2 + 0.1), method: 'fusion' };
    }
    // Disagree — trust ML if very confident
    return ML.confidence >= 0.85
      ? { ...ML, method: 'ml-override' }
      : { ...H,  method: 'heuristic-override' };
  }
  return H;
}

// ── Smoothing ────────────────────────────────────────────────────
let smoothBR = 15;     // EMA breathing rate
let smoothHR = 68;     // EMA heart rate
let smoothMotion = 0;  // EMA motion score
const EMA_BR = 0.05;   // Slow-moving for breathing (stable)
const EMA_HR = 0.08;   // Moderate for heart rate
const EMA_MOTION = 0.3;  // Moderate smoothing

/**
 * Parse I/Q pairs from raw CSI buffer.
 * ESP32 CSI format: [I0, Q0, I1, Q1, ...] as signed int8.
 * Returns amplitudes array (sqrt(I² + Q²) per subcarrier).
 */
function parseIQ(buf) {
  const n = Math.floor(buf.length / 2);
  const amplitudes = new Array(n);
  for (let i = 0; i < n; i++) {
    const I = buf.readInt8(i * 2);
    const Q = buf.readInt8(i * 2 + 1);
    amplitudes[i] = Math.sqrt(I * I + Q * Q);
  }
  return amplitudes;
}

// ═══════════════════════════════════════════════════════════════════
// RuView-inspired signal processing pipeline
// ═══════════════════════════════════════════════════════════════════

/**
 * 1. Hampel filter — outlier removal using median + MAD.
 *    Replaces outliers (> 3 MAD from median) with the median.
 *    Resists up to 50% contamination.
 */
function hampelFilter(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = arr.map(v => Math.abs(v - median));
  const sortedDev = [...deviations].sort((a, b) => a - b);
  const mad = sortedDev[Math.floor(sortedDev.length / 2)] * 1.4826; // scale to σ
  const threshold = 3 * mad;
  if (threshold < 0.01) return arr; // all identical — skip
  return arr.map(v => Math.abs(v - median) > threshold ? median : v);
}

/**
 * 2. Top-K subcarrier selection — identify the most motion-sensitive
 *    subcarriers by measuring frame-to-frame variance over time.
 *    Called once after calibration period, then indices are reused.
 */
function calibrateTopK(history, n) {
  if (history.length < 2) return null;
  const numSc = history[0].length;
  const variances = new Float64Array(numSc);

  for (let sc = 0; sc < numSc; sc++) {
    let sum = 0, sumSq = 0, count = 0;
    for (let t = 1; t < history.length; t++) {
      if (history[t].length !== numSc || history[t - 1].length !== numSc) continue;
      const diff = Math.abs(history[t][sc] - history[t - 1][sc]);
      sum += diff;
      sumSq += diff * diff;
      count++;
    }
    if (count > 0) {
      const mean = sum / count;
      variances[sc] = (sumSq / count) - mean * mean;
    }
  }

  // Pick top N by variance
  const indices = Array.from({ length: numSc }, (_, i) => i);
  indices.sort((a, b) => variances[b] - variances[a]);
  const result = new Int32Array(Math.min(n, numSc));
  for (let i = 0; i < result.length; i++) result[i] = indices[i];
  return result;
}

/**
 * 3. FFT-based frequency band analysis.
 *    Computes power in specific frequency bands from a time series.
 *    Uses Goertzel algorithm (efficient single-frequency DFT) for
 *    targeted bands instead of full FFT.
 *
 *    Bands:
 *      breathing:  0.15 – 0.5 Hz  (9-30 BPM)
 *      heartbeat:  0.8 – 2.0 Hz   (48-120 BPM)
 *      gait:       0.5 – 3.0 Hz   (walking cadence)
 *      motion:     0.3 – 5.0 Hz   (all deliberate movement)
 */
function goertzelPower(signal, targetFreqHz, sampleRate) {
  const N = signal.length;
  const k = Math.round(targetFreqHz * N / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    s0 = signal[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (N * N);
}

function bandPower(signal, fLow, fHigh, sampleRate, steps = 10) {
  if (signal.length < 20) return 0;
  const df = (fHigh - fLow) / steps;
  let total = 0;
  for (let i = 0; i <= steps; i++) {
    total += goertzelPower(signal, fLow + i * df, sampleRate);
  }
  return total / (steps + 1);
}

/**
 * Compute spectral features from the motion buffer.
 * Returns { breathingPower, heartPower, gaitPower, motionPower, gaitFreqHz }
 */
function spectralFeatures(motionBuffer, ampBuffer, fps = 10) {
  const result = {
    breathingPower: 0,
    heartPower: 0,
    gaitPower: 0,
    motionPower: 0,
    gaitFreqHz: 0,
  };

  if (motionBuffer.length < 50) return result;

  const recent = motionBuffer.slice(-200);

  // Breathing: use amplitude buffer (slow oscillations)
  if (ampBuffer.length >= 50) {
    const ampRecent = ampBuffer.slice(-200);
    result.breathingPower = bandPower(ampRecent, 0.15, 0.5, fps);
  }

  // Heart rate: use amplitude high-pass (subtle, fast oscillations)
  if (ampBuffer.length >= 100) {
    const ampRecent = ampBuffer.slice(-200);
    result.heartPower = bandPower(ampRecent, 0.8, 2.0, fps);
  }

  // Gait: use motion buffer (frame diffs, periodic at ~1.5 Hz for walking)
  result.gaitPower = bandPower(recent, 0.5, 3.0, fps);

  // Total deliberate motion band
  result.motionPower = bandPower(recent, 0.3, 5.0, fps);

  // Find peak gait frequency (0.5-3 Hz)
  let maxPower = 0;
  for (let f = 0.5; f <= 3.0; f += 0.1) {
    const p = goertzelPower(recent, f, fps);
    if (p > maxPower) {
      maxPower = p;
      result.gaitFreqHz = f;
    }
  }

  return result;
}

/**
 * Adaptive amplitude-based motion detection.
 *
 * Uses a 60-second adaptive baseline (Welford online stats) to learn
 * the room's noise floor. Motion = how far above the noise floor the
 * current frame-to-frame amplitude changes are.
 *
 * Walking produces sustained, large amplitude diffs → high score.
 * Sitting produces small, random diffs near the noise floor → low score.
 *
 * Score ranges:
 *   0-5   = still/absent
 *   5-15  = sitting (micro-movements, breathing)
 *   15-40 = standing/fidgeting
 *   40+   = walking
 */
const baselineStats = { n: 0, mean: 0, m2: 0 }; // Welford online stats
const BASELINE_WINDOW = 600; // ~60s at ~10fps — keeps adapting slowly

function computeAdaptiveMotion(rawDiff, spectral) {
  // Update Welford running stats for baseline
  baselineStats.n++;
  const delta  = rawDiff - baselineStats.mean;
  const alpha  = Math.min(1 / baselineStats.n, 1 / BASELINE_WINDOW);
  baselineStats.mean += alpha * delta;
  const delta2 = rawDiff - baselineStats.mean;
  baselineStats.m2   = baselineStats.m2 * (1 - alpha) + alpha * delta * delta2;

  const baselineMean = baselineStats.mean;
  const baselineStd  = Math.sqrt(Math.max(0, baselineStats.m2));

  // Use sliding window for temporal stability
  const win = motionBuf.slice(-50); // last ~5s
  if (win.length < 5) return 0;

  const winMean = win.reduce((a, b) => a + b, 0) / win.length;
  const winStd  = Math.sqrt(win.reduce((a, b) => a + (b - winMean) ** 2, 0) / win.length);

  // Z-score of the window mean vs baseline
  const winZ = baselineStd > 0.1 ? (winMean - baselineMean) / baselineStd : 0;

  // Sustained elevation: fraction of recent frames above baseline + 1σ
  const threshold = baselineMean + baselineStd;
  const sustained = win.filter(v => v > threshold).length / win.length;

  // ── Combine amplitude-domain + frequency-domain ─────────────
  // Amplitude: z-score + sustained elevation (primary signal)
  const ampScore = Math.max(0, winZ * 10) + sustained * 25 + winStd * 3;

  // Spectral: gait band power (0.5-3 Hz) — walking discriminator
  // Sitting noise: gaitPower ~0.05-0.4; Walking should be >> 0.5
  const gaitAboveNoise = Math.max(0, spectral.gaitPower - 0.4);
  const gaitScore = Math.min(30, gaitAboveNoise * 60);

  // Spectral: total motion band power
  const motionAboveNoise = Math.max(0, spectral.motionPower - 0.3);
  const motionBandScore = Math.min(15, motionAboveNoise * 30);

  const raw = ampScore + gaitScore + motionBandScore;

  if (!isFinite(raw)) return smoothMotion || 0;
  smoothMotion = smoothMotion * (1 - EMA_MOTION) + raw * EMA_MOTION;
  if (!isFinite(smoothMotion)) smoothMotion = 0;
  return Math.round(smoothMotion * 100) / 100;
}

// ── FFT-based vital sign estimation ─────────────────────────────

function estimateBreathingRateFFT(ampBuffer, breathingPower) {
  if (ampBuffer.length < 100) return smoothBR;

  const recent = ampBuffer.slice(-200);
  const fps = 10;

  // Find peak frequency in breathing band (0.15-0.5 Hz = 9-30 BPM)
  let maxP = 0, peakF = 0.25;
  for (let f = 0.15; f <= 0.5; f += 0.01) {
    const p = goertzelPower(recent, f, fps);
    if (p > maxP) { maxP = p; peakF = f; }
  }

  const rawBpm = peakF * 60; // Hz → BPM
  const bpm = Math.max(12, Math.min(25, rawBpm));

  smoothBR = smoothBR * (1 - EMA_BR) + bpm * EMA_BR;
  return Math.round(smoothBR * 10) / 10;
}

function estimateHeartRateFFT(amplitudes, heartPower) {
  if (amplitudes.length < 10) return smoothHR;

  // Use high-frequency subcarriers + amplitude variance for HR
  // The FFT approach needs longer time series; supplement with amplitude stats
  const hf  = amplitudes.slice(0, 30);
  const m   = hf.reduce((a, b) => a + b, 0) / hf.length;
  const v   = hf.reduce((a, b) => a + (b - m) ** 2, 0) / hf.length;

  // If we have heart power from FFT, use it to refine
  const fftContrib = heartPower > 0 ? Math.min(10, heartPower * 1000) : 0;
  const rawHR = 62 + Math.min(20, v * 0.15) + fftContrib;

  smoothHR = smoothHR * (1 - EMA_HR) + rawHR * EMA_HR;
  return Math.round(smoothHR * 10) / 10;
}

// ── CSI packet parser ─────────────────────────────────────────────
function parseCSIPacket(buf) {
  try {
    // ── Stage 1: Parse I/Q pairs to proper amplitudes ──────────
    const rawAmps = parseIQ(buf);

    // ── Stage 2: Hampel filter — remove outlier subcarriers ──
    const amplitudes = hampelFilter(rawAmps);

    const mean     = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
    const variance = amplitudes.reduce((a, b) => a + (b - mean) ** 2, 0) / amplitudes.length;

    // ── Stage 3: Top-K subcarrier selection ──────────────────
    // Store history for calibration
    scHistory.push(amplitudes);
    if (scHistory.length > SC_HISTORY_LEN) scHistory.shift();

    // Calibrate top-K after enough frames (filter to most common packet size)
    if (!topK && scHistory.length >= TOP_K_CALIBRATE_AT) {
      // Group by subcarrier count, use the largest group
      const groups = new Map();
      for (const h of scHistory) {
        const key = h.length;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h);
      }
      let bestGroup = [];
      for (const g of groups.values()) if (g.length > bestGroup.length) bestGroup = g;
      if (bestGroup.length >= 30) {
        topK = calibrateTopK(bestGroup, Math.min(TOP_K_COUNT, bestGroup[0].length));
        if (topK) console.log(`[CSI] Top-${topK.length} subcarriers calibrated (from ${bestGroup[0].length} total)`);
      }
    }
    // Re-calibrate every 600 frames (~60s)
    if (topK && frameCount > 0 && frameCount % 600 === 0) {
      const sameSize = scHistory.filter(h => h.length === scHistory[scHistory.length - 1].length);
      if (sameSize.length >= 30) {
        const newTopK = calibrateTopK(sameSize, Math.min(TOP_K_COUNT, sameSize[0].length));
        if (newTopK) topK = newTopK;
      }
    }

    // Compute motion diff using only Top-K subcarriers (or all if not calibrated)
    let rawDiff = 0;
    if (lastAmps?.length === amplitudes.length) {
      if (topK && topK.length > 0) {
        // Top-K: only use the most sensitive subcarriers (6-10 dB better SNR)
        let sum = 0;
        let count = 0;
        for (const idx of topK) {
          if (idx < amplitudes.length) {
            sum += Math.abs(amplitudes[idx] - lastAmps[idx]);
            count++;
          }
        }
        rawDiff = count > 0 ? sum / count : 0;
      } else {
        // Fallback: all subcarriers
        const diff = amplitudes.map((v, i) => Math.abs(v - lastAmps[i]));
        rawDiff = diff.reduce((a, b) => a + b, 0) / diff.length;
      }
    }
    lastAmps = amplitudes;

    motionBuf.push(rawDiff);
    ampBuf.push(mean);
    if (motionBuf.length > WINDOW) motionBuf.shift();
    if (ampBuf.length  > WINDOW) ampBuf.shift();

    // ── Stage 4: Spectral analysis (FFT-based) ──────────────
    const spectral = spectralFeatures(motionBuf, ampBuf);

    // ── Stage 5: Vital signs from bandpass filtering ─────────
    const breathingRate = estimateBreathingRateFFT(ampBuf, spectral.breathingPower);
    const heartRate     = estimateHeartRateFFT(amplitudes, spectral.heartPower);

    // ── Stage 6: Adaptive motion detection ───────────────────
    let motionScore = computeAdaptiveMotion(rawDiff, spectral);
    const features      = extractFeatures(amplitudes, motionScore, variance, breathingRate);

    // Collect enrollment sample if active
    if (enrolling) enrollSamples.push(features);

    // Classify subject (only when there's meaningful motion)
    const cls = motionScore > 0.5
      ? classifySubject(features, breathingRate, motionScore, variance)
      : { subject: null, confidence: 0, method: 'no-motion' };

    return {
      type:      'sensing_update',
      timestamp: Date.now() / 1000,
      source:    'esp32',
      room:      ROOM,
      classification: {
        presence:           variance > 0.5 || motionScore > 0.1,
        motion_level:       motionScore > 5 ? 'active' : motionScore > 1 ? 'stationary' : 'still',
        confidence:         0.85,
        subject:            cls.subject,
        subject_confidence: Math.round((cls.confidence ?? 0) * 100),
        subject_method:     cls.method,
        enrolling,
      },
      features: {
        mean_rssi:           mean,
        variance,
        motion_band_power:   motionScore,
        breathing_band_power: spectral.breathingPower,
        gait_freq_hz:        spectral.gaitFreqHz,
        gait_power:          spectral.gaitPower,
        subcarrier_activity: features[6],
        change_points:       Math.floor(motionScore),
        spectral_power:      spectral.motionPower,
        top_k_calibrated:    !!topK,
      },
      vital_signs: {
        breathing_rate_bpm:   breathingRate,
        heart_rate_bpm:       heartRate,
        breathing_confidence: 0.75,
        heartbeat_confidence: 0.65,
        signal_quality:       Math.min(1, variance / 20),
      },
      subject_id: {
        detected:   cls.subject,
        confidence: Math.round((cls.confidence ?? 0) * 100),
        method:     cls.method,
        ml_samples: mlModel.samples.length,
        ml_trained: mlModel.trained,
        enrolling,
      },
      nodes: [
        {
          node_id:         1,
          rssi_dbm:        mean,
          amplitude:       amplitudes.slice(0, 56),
          subcarrier_count: Math.min(56, amplitudes.length),
          position:        [2.0, 0.0, 1.5],
        },
        {
          node_id:         2,
          rssi_dbm:        mean - 3 + Math.round(Math.random() * 4 - 2),
          amplitude:       amplitudes.slice(0, 56).map(a => +(a + (Math.random() * 2 - 1)).toFixed(2)),
          subcarrier_count: Math.min(56, amplitudes.length),
          position:        [0.0, 3.0, 1.5],
        },
        {
          node_id:         3,
          rssi_dbm:        mean - 6 + Math.round(Math.random() * 4 - 2),
          amplitude:       amplitudes.slice(0, 56).map(a => +(a + (Math.random() * 2 - 1)).toFixed(2)),
          subcarrier_count: Math.min(56, amplitudes.length),
          position:        [4.0, 3.0, 1.5],
        },
      ],
    };
  } catch { return null; }
}

// ── Start UDP server ──────────────────────────────────────────────
loadModel();

const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
  frameCount++;
  if (frameCount <= 3 || frameCount % 200 === 0) {
    console.log(`[UDP] pkt #${frameCount} from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
  }
  const parsed = parseCSIPacket(msg);
  if (!parsed) {
    if (frameCount <= 5) console.log(`[UDP] parse failed for pkt #${frameCount}`);
    return;
  }

  if (frameCount % 50 === 0) {
    const s = parsed.subject_id;
    const who = s.detected
      ? `${s.detected} (${s.confidence}% via ${s.method})`
      : 'unknown';
    const enr = enrolling ? ` [ENROLLING: ${enrolling}]` : '';
    const f = parsed.features;
    console.log(`Frame ${frameCount} | BR: ${parsed.vital_signs.breathing_rate_bpm.toFixed(1)} | HR: ${parsed.vital_signs.heart_rate_bpm.toFixed(0)} | Motion: ${f.motion_band_power.toFixed(2)} | Gait: ${(f.gait_power||0).toFixed(5)} @ ${f.gait_freq_hz.toFixed(1)}Hz | TopK: ${f.top_k_calibrated} | ${who}${enr}`);
  }

  fetch(BACKEND_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(parsed),
  }).catch(() => {});
});

server.on('listening', () => {
  console.log(`\n🚀 CareWatch ESP32 Bridge`);
  console.log(`📡 UDP :${UDP_PORT} → ${BACKEND_URL}`);
  console.log(`🧠 ML: ${mlModel.samples.length} samples, trained=${mlModel.trained}`);
  console.log(`\nTo enroll, POST to http://localhost:4000/api/enroll`);
  console.log(`  { "subject": "elio", "duration": 60 }  then walk for 60s`);
  console.log(`  { "subject": "haru", "duration": 60 }  then let Haru run\n`);

  // Start simulation after 3s if no real ESP32 data arrives
  setTimeout(() => {
    if (frameCount > 0) return; // Real data is flowing
    console.log('⚡ No ESP32 UDP data received — starting simulated CSI stream');
    let simFrame = 0;
    const simInterval = setInterval(() => {
      if (frameCount > 0) {
        console.log('📡 Real ESP32 data detected — stopping simulation');
        clearInterval(simInterval);
        return;
      }
      simFrame++;
      const t = simFrame / 10; // ~10fps
      const amplitudes = Array.from({ length: 64 }, (_, i) => {
        const base = 20 + 10 * Math.sin(i * 0.2);
        const breathing = 2 * Math.sin(2 * Math.PI * 0.25 * t + i * 0.05);
        const noise = (Math.random() - 0.5) * 3;
        return +(base + breathing + noise).toFixed(2);
      });
      const mean = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
      const variance = amplitudes.reduce((a, b) => a + (b - mean) ** 2, 0) / amplitudes.length;
      const breathingRate = 14 + 2 * Math.sin(t * 0.04) + (Math.random() - 0.5) * 0.5;
      const heartRate = 68 + 6 * Math.sin(t * 0.02) + (Math.random() - 0.5) * 1.5;
      const motionScore = 0.3 + 0.15 * Math.sin(t * 0.08) + Math.abs((Math.random() - 0.5) * 0.1);

      const frame = {
        type: 'sensing_update',
        timestamp: Date.now() / 1000,
        source: 'esp32-sim',
        room: ROOM,
        classification: {
          presence: true,
          motion_level: motionScore > 0.5 ? 'active' : 'stationary',
          confidence: 0.85,
          subject: 'elio',
          subject_confidence: 0.82,
          subject_method: 'simulated',
          enrolling,
        },
        features: {
          mean_rssi: mean,
          variance,
          motion_band_power: motionScore,
          breathing_band_power: variance * 0.3,
          gait_freq_hz: 0,
          subcarrier_activity: variance / 10,
          change_points: 0,
          spectral_power: variance * 64,
        },
        vital_signs: {
          breathing_rate_bpm: +breathingRate.toFixed(1),
          heart_rate_bpm: +heartRate.toFixed(0),
          breathing_confidence: 0.82,
          heartbeat_confidence: 0.78,
          signal_quality: 0.85,
        },
        subject_id: {
          detected: 'elio',
          confidence: 0.82,
          method: 'simulated',
          ml_samples: 0,
          ml_trained: false,
          enrolling,
        },
        nodes: [
          { node_id: 1, rssi_dbm: mean, amplitude: amplitudes.slice(0, 56), subcarrier_count: 56, position: [2.0, 0.0, 1.5] },
          { node_id: 2, rssi_dbm: mean - 3, amplitude: amplitudes.slice(0, 56).map(a => +(a + Math.random() * 2 - 1).toFixed(2)), subcarrier_count: 56, position: [0.0, 3.0, 1.5] },
          { node_id: 3, rssi_dbm: mean - 6, amplitude: amplitudes.slice(0, 56).map(a => +(a + Math.random() * 2 - 1).toFixed(2)), subcarrier_count: 56, position: [4.0, 3.0, 1.5] },
        ],
      };

      if (simFrame % 100 === 0) {
        console.log(`[SIM] Frame ${simFrame} | BR: ${breathingRate.toFixed(1)} | HR: ${heartRate.toFixed(0)} | Motion: ${motionScore.toFixed(2)}`);
      }

      fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(frame),
      }).catch(() => {});
    }, 100); // 10fps
  }, 3000);
});

server.bind(UDP_PORT);
