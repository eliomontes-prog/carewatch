// Tests for SMS service formatting
import { jest } from '@jest/globals';

// Mock twilio before import
jest.unstable_mockModule('twilio', () => ({
  default: jest.fn(() => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM123' }) },
  })),
}));

const { formatAlertSMS, sendSMS } = await import('../services/sms.js');

describe('SMS Service', () => {
  describe('formatAlertSMS', () => {
    it('should format high urgency alert with correct emoji', () => {
      const msg = formatAlertSMS('Elio', 'fall', 'Fall detected in bedroom', 'high');
      expect(msg).toContain('CareWatch Alert');
      expect(msg).toContain('Elio');
      expect(msg).toContain('FALL');
      expect(msg).toContain('Fall detected in bedroom');
    });

    it('should format medium urgency alert', () => {
      const msg = formatAlertSMS('Elio', 'abnormal_breathing', 'Breathing rate elevated', 'medium');
      expect(msg).toContain('ABNORMAL BREATHING');
    });

    it('should format low urgency alert', () => {
      const msg = formatAlertSMS('Elio', 'missing_at_mealtime', 'Not present at mealtime', 'low');
      expect(msg).toContain('MISSING AT MEALTIME');
    });

    it('should include unsubscribe notice', () => {
      const msg = formatAlertSMS('Elio', 'fall', 'Test', 'high');
      expect(msg).toContain('Reply STOP to unsubscribe');
    });
  });

  describe('sendSMS', () => {
    it('should use mock mode when Twilio is not configured', async () => {
      delete process.env.TWILIO_ACCOUNT_SID;
      const result = await sendSMS('+1234567890', 'Test message');
      expect(result).toEqual({ success: true, mock: true });
    });
  });
});
