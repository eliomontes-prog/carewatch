// backend/src/services/baseline.js
// Builds and maintains a "normal" profile per resident for anomaly detection

import { baselines, readings } from '../db/queries.js';

const BASELINE_LEARNING_DAYS = parseInt(process.env.BASELINE_LEARNING_DAYS || '7');

// Per-metric anomaly thresholds (breathing has wider normal variance than heart rate)
const DEVIATION_THRESHOLDS = {
  breathing_rate: parseFloat(process.env.BREATHING_DEVIATION_THRESHOLD || '0.25'),
  heart_rate: parseFloat(process.env.HEART_RATE_DEVIATION_THRESHOLD || '0.15'),
};
const DEFAULT_THRESHOLD = 0.25;

export class BaselineProfiler {
  // Update baseline with latest reading (called on every frame if resident present)
  async updateFromReading(residentId, frame) {
    if (!residentId) return;

    const hour = new Date().getHours();
    const isDaytime = hour >= 7 && hour < 22;

    if (frame.breathing_rate && frame.confidence > 0.7) {
      await baselines.update(residentId, 'breathing_rate', frame.breathing_rate);
    }

    if (frame.heart_rate && frame.confidence > 0.7) {
      await baselines.update(residentId, 'heart_rate', frame.heart_rate);
    }

    if (frame.motion_level !== null && isDaytime) {
      await baselines.update(residentId, 'motion_level_day', frame.motion_level);
    }

    if (frame.motion_level !== null && !isDaytime) {
      await baselines.update(residentId, 'motion_level_night', frame.motion_level);
    }
  }

  // Get baseline for a resident
  async getBaseline(residentId) {
    return baselines.get(residentId);
  }

  // Check if a value deviates significantly from baseline
  async isAnomalous(residentId, metric, currentValue) {
    const baseline = await baselines.get(residentId);
    const baselineValue = baseline[metric];

    if (!baselineValue || currentValue === null) return false;

    const threshold = DEVIATION_THRESHOLDS[metric] ?? DEFAULT_THRESHOLD;
    const deviation = Math.abs(currentValue - baselineValue) / baselineValue;

    return deviation > threshold;
  }

  // Build context summary for AI agent
  async buildContext(residentId, recentReadings) {
    const baseline = await baselines.get(residentId);
    const recent = recentReadings.slice(0, 10);

    const avgBreathing = this.average(recent.map(r => r.breathing_rate).filter(Boolean));
    const avgHeartRate = this.average(recent.map(r => r.heart_rate).filter(Boolean));
    const avgMotion = this.average(recent.map(r => r.motion_level).filter(Boolean));
    const presenceRatio = recent.filter(r => r.presence).length / Math.max(recent.length, 1);

    return {
      baseline,
      recent_averages: {
        breathing_rate: avgBreathing,
        heart_rate: avgHeartRate,
        motion_level: avgMotion,
        presence_ratio: presenceRatio,
      },
      deviations: {
        breathing: baseline.breathing_rate && avgBreathing
          ? ((avgBreathing - baseline.breathing_rate) / baseline.breathing_rate * 100).toFixed(1) + '%'
          : 'no baseline yet',
        heart_rate: baseline.heart_rate && avgHeartRate
          ? ((avgHeartRate - baseline.heart_rate) / baseline.heart_rate * 100).toFixed(1) + '%'
          : 'no baseline yet',
      },
    };
  }

  average(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
}
