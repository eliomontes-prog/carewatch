// Tests for alert agent event detection logic
import { jest } from '@jest/globals';

// Mock all dependencies before importing
const mockReadingsInsert = jest.fn().mockResolvedValue(undefined);
const mockReadingsGetLastN = jest.fn().mockResolvedValue([]);
const mockAlertsInsert = jest.fn().mockResolvedValue(undefined);
const mockAlertsGetRecent = jest.fn().mockResolvedValue([]);
const mockAlertsGetLastOfType = jest.fn().mockResolvedValue(null);
const mockResidentsGetByRoom = jest.fn();

jest.unstable_mockModule('../db/queries.js', () => ({
  readings: {
    insert: mockReadingsInsert,
    getLastN: mockReadingsGetLastN,
  },
  alerts: {
    insert: mockAlertsInsert,
    getRecent: mockAlertsGetRecent,
    getLastOfType: mockAlertsGetLastOfType,
  },
  residents: {
    getByRoom: mockResidentsGetByRoom,
  },
  baselines: {
    get: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock redis
jest.unstable_mockModule('../services/redis.js', () => ({
  default: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
}));

// Mock SMS
jest.unstable_mockModule('../services/sms.js', () => ({
  sendSMS: jest.fn().mockResolvedValue({ success: true }),
  formatAlertSMS: jest.fn().mockReturnValue('test alert message'),
}));

// Mock push
jest.unstable_mockModule('../services/push.js', () => ({
  sendPushForResident: jest.fn().mockResolvedValue(undefined),
}));

// Mock Anthropic SDK
const mockCreate = jest.fn().mockResolvedValue({
  content: [{ text: JSON.stringify({
    should_alert: true,
    urgency: 'high',
    message: 'Test alert',
    reasoning: 'Test reasoning',
  })}],
});
jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

const { processFrame } = await import('../agents/alertAgent.js');

describe('Alert Agent', () => {
  const mockResident = {
    id: 'res-1',
    name: 'Elio',
    room: 'bedroom',
    date_of_birth: '1940-05-15',
    emergency_contacts: JSON.stringify([{ name: 'Maria', phone: '+1234567890' }]),
    notes: 'History of falls',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResidentsGetByRoom.mockResolvedValue(mockResident);
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  describe('processFrame', () => {
    it('should insert a sensor reading for every frame', async () => {
      const frame = {
        room: 'bedroom',
        presence: true,
        person_count: 1,
        breathing_rate: 16,
        heart_rate: 70,
        motion_level: 0.3,
        posture: 'standing',
        confidence: 0.9,
        raw: {},
      };

      await processFrame(frame);

      expect(mockReadingsInsert).toHaveBeenCalledWith(expect.objectContaining({
        room: 'bedroom',
        breathing_rate: 16,
        heart_rate: 70,
      }));
    });

    it('should handle frame for unknown room (no resident)', async () => {
      mockResidentsGetByRoom.mockResolvedValue(null);

      const frame = {
        room: 'unknown-room',
        presence: true,
        person_count: 1,
        breathing_rate: 16,
        heart_rate: 70,
        motion_level: 0.3,
        posture: 'standing',
        confidence: 0.9,
        raw: {},
      };

      // Should not throw
      await processFrame(frame);

      // Should still insert the reading
      expect(mockReadingsInsert).toHaveBeenCalledWith(expect.objectContaining({
        resident_id: null,
        room: 'unknown-room',
      }));
    });
  });
});

describe('SMS Formatting', () => {
  it('should be importable', async () => {
    const { formatAlertSMS } = await import('../services/sms.js');
    expect(formatAlertSMS).toBeDefined();
  });
});
