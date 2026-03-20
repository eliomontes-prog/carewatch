// Tests for escalation agent logic
import { jest } from '@jest/globals';

const mockGetUnacknowledgedSent = jest.fn();
const mockMarkEscalated = jest.fn().mockResolvedValue(undefined);

jest.unstable_mockModule('../db/queries.js', () => ({
  alerts: {
    getUnacknowledgedSent: mockGetUnacknowledgedSent,
    markEscalated: mockMarkEscalated,
  },
}));

const mockSendSMS = jest.fn().mockResolvedValue({ success: true });
jest.unstable_mockModule('../services/sms.js', () => ({
  sendSMS: mockSendSMS,
  formatAlertSMS: jest.fn().mockReturnValue('alert msg'),
}));

const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.unstable_mockModule('../services/push.js', () => ({
  sendPushForResident: mockSendPush,
}));

const { runEscalationCheck } = await import('../agents/escalationAgent.js');

describe('Escalation Agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCALATION_TIER1_MINUTES = '10';
    process.env.ESCALATION_TIER2_MINUTES = '25';
  });

  it('should do nothing when no unacknowledged alerts exist', async () => {
    mockGetUnacknowledgedSent.mockResolvedValue([]);

    await runEscalationCheck();

    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
    expect(mockMarkEscalated).not.toHaveBeenCalled();
  });

  it('should escalate tier 0 to tier 1 — re-notify primary contact', async () => {
    mockGetUnacknowledgedSent.mockResolvedValue([{
      id: 1,
      resident_id: 'res-1',
      resident_name: 'Elio',
      message: 'Fall detected',
      escalation_tier: 0,
      emergency_contacts: JSON.stringify([
        { name: 'Maria', phone: '+1111111111' },
        { name: 'Carlos', phone: '+2222222222' },
      ]),
      created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    }]);

    await runEscalationCheck();

    // Should SMS the primary contact only
    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(mockSendSMS).toHaveBeenCalledWith('+1111111111', expect.stringContaining('Elio'));
    // Should send push notification
    expect(mockSendPush).toHaveBeenCalledWith('res-1', expect.objectContaining({
      urgency: 'high',
    }));
    // Should mark as tier 1
    expect(mockMarkEscalated).toHaveBeenCalledWith(1, 1);
  });

  it('should escalate tier 1 to tier 2 — notify all secondary contacts', async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    mockGetUnacknowledgedSent.mockResolvedValue([{
      id: 2,
      resident_id: 'res-1',
      resident_name: 'Elio',
      message: 'No motion detected',
      escalation_tier: 1,
      emergency_contacts: JSON.stringify([
        { name: 'Maria', phone: '+1111111111' },
        { name: 'Carlos', phone: '+2222222222' },
        { name: 'Ana', phone: '+3333333333' },
      ]),
      created_at: thirtyMinutesAgo,
    }]);

    await runEscalationCheck();

    // Should SMS secondary contacts (skip primary)
    expect(mockSendSMS).toHaveBeenCalledTimes(2);
    expect(mockSendSMS).toHaveBeenCalledWith('+2222222222', expect.any(String));
    expect(mockSendSMS).toHaveBeenCalledWith('+3333333333', expect.any(String));
    // Should mark as tier 2
    expect(mockMarkEscalated).toHaveBeenCalledWith(2, 2);
  });

  it('should not escalate tier 1 alert before tier 2 threshold', async () => {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    mockGetUnacknowledgedSent.mockResolvedValue([{
      id: 3,
      resident_id: 'res-1',
      resident_name: 'Elio',
      message: 'Test alert',
      escalation_tier: 1,
      emergency_contacts: JSON.stringify([{ name: 'Maria', phone: '+1111111111' }]),
      created_at: fifteenMinutesAgo, // only 15 min ago, tier 2 needs 25 min
    }]);

    await runEscalationCheck();

    // Should not escalate or send SMS
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockMarkEscalated).not.toHaveBeenCalled();
  });
});
