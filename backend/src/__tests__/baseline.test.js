// Tests for BaselineProfiler
import { jest } from '@jest/globals';

// Mock the database queries
const mockBaselinesGet = jest.fn();
const mockBaselinesUpdate = jest.fn();
jest.unstable_mockModule('../db/queries.js', () => ({
  baselines: { get: mockBaselinesGet, update: mockBaselinesUpdate },
  readings: { getRecent: jest.fn(), getLastN: jest.fn() },
}));

const { BaselineProfiler } = await import('../services/baseline.js');

describe('BaselineProfiler', () => {
  let profiler;

  beforeEach(() => {
    profiler = new BaselineProfiler();
    jest.clearAllMocks();
  });

  describe('average', () => {
    it('should calculate average of array', () => {
      expect(profiler.average([10, 20, 30])).toBe(20);
    });

    it('should return null for empty array', () => {
      expect(profiler.average([])).toBeNull();
    });

    it('should handle single element', () => {
      expect(profiler.average([42])).toBe(42);
    });
  });

  describe('isAnomalous', () => {
    it('should detect anomalous breathing rate (>25% deviation)', async () => {
      mockBaselinesGet.mockResolvedValue({ breathing_rate: 16 });

      // 25% deviation = 4, so 21 should be anomalous
      const result = await profiler.isAnomalous('res-1', 'breathing_rate', 21);
      expect(result).toBe(true);
    });

    it('should not flag normal breathing rate', async () => {
      mockBaselinesGet.mockResolvedValue({ breathing_rate: 16 });

      // Within 25% threshold
      const result = await profiler.isAnomalous('res-1', 'breathing_rate', 18);
      expect(result).toBe(false);
    });

    it('should detect anomalous heart rate (>15% deviation)', async () => {
      mockBaselinesGet.mockResolvedValue({ heart_rate: 70 });

      // 15% of 70 = 10.5, so 81 should be anomalous
      const result = await profiler.isAnomalous('res-1', 'heart_rate', 81);
      expect(result).toBe(true);
    });

    it('should not flag normal heart rate', async () => {
      mockBaselinesGet.mockResolvedValue({ heart_rate: 70 });

      const result = await profiler.isAnomalous('res-1', 'heart_rate', 75);
      expect(result).toBe(false);
    });

    it('should return false when no baseline exists', async () => {
      mockBaselinesGet.mockResolvedValue({});

      const result = await profiler.isAnomalous('res-1', 'breathing_rate', 20);
      expect(result).toBe(false);
    });

    it('should return false when current value is null', async () => {
      mockBaselinesGet.mockResolvedValue({ breathing_rate: 16 });

      const result = await profiler.isAnomalous('res-1', 'breathing_rate', null);
      expect(result).toBe(false);
    });
  });

  describe('updateFromReading', () => {
    it('should skip update when no residentId', async () => {
      await profiler.updateFromReading(null, {});
      expect(mockBaselinesUpdate).not.toHaveBeenCalled();
    });

    it('should update breathing rate when confidence is high enough', async () => {
      const frame = { breathing_rate: 16, heart_rate: 70, confidence: 0.8, motion_level: 0.3 };
      await profiler.updateFromReading('res-1', frame);

      expect(mockBaselinesUpdate).toHaveBeenCalledWith('res-1', 'breathing_rate', 16);
    });

    it('should skip breathing update when confidence is low', async () => {
      const frame = { breathing_rate: 16, confidence: 0.5, motion_level: null };
      await profiler.updateFromReading('res-1', frame);

      // Should not update breathing_rate due to low confidence
      expect(mockBaselinesUpdate).not.toHaveBeenCalledWith('res-1', 'breathing_rate', expect.anything());
    });
  });

  describe('buildContext', () => {
    it('should build context with baseline and recent averages', async () => {
      mockBaselinesGet.mockResolvedValue({ breathing_rate: 16, heart_rate: 70 });

      const recentReadings = [
        { breathing_rate: 17, heart_rate: 72, motion_level: 0.3, presence: 1 },
        { breathing_rate: 15, heart_rate: 68, motion_level: 0.2, presence: 1 },
        { breathing_rate: 16, heart_rate: 71, motion_level: 0.4, presence: 0 },
      ];

      const context = await profiler.buildContext('res-1', recentReadings);

      expect(context.baseline).toEqual({ breathing_rate: 16, heart_rate: 70 });
      expect(context.recent_averages.breathing_rate).toBe(16);
      expect(context.recent_averages.heart_rate).toBeCloseTo(70.33, 1);
      expect(context.recent_averages.motion_level).toBe(0.3);
      expect(context.recent_averages.presence_ratio).toBeCloseTo(0.667, 2);
      expect(context.deviations.breathing).toBe('0.0%');
    });

    it('should handle empty readings', async () => {
      mockBaselinesGet.mockResolvedValue({});

      const context = await profiler.buildContext('res-1', []);

      expect(context.recent_averages.breathing_rate).toBeNull();
      expect(context.deviations.breathing).toBe('no baseline yet');
    });
  });
});
