// backend/src/agents/escalationAgent.js
// Checks for unacknowledged alerts and escalates them in two tiers

import { alerts } from '../db/queries.js';
import { sendSMS, formatAlertSMS } from '../services/sms.js';
import { sendPushForResident } from '../services/push.js';

const TIER1_MINUTES = parseInt(process.env.ESCALATION_TIER1_MINUTES || '10');
const TIER2_MINUTES = parseInt(process.env.ESCALATION_TIER2_MINUTES || '25');

export async function runEscalationCheck() {
  // ── Tier 1: re-notify same contacts if alert unacknowledged for TIER1_MINUTES ──
  const unacked = await alerts.getUnacknowledgedSent(TIER1_MINUTES);

  for (const alert of unacked) {
    const contacts = JSON.parse(alert.emergency_contacts || '[]');

    if (alert.escalation_tier === 0) {
      // First escalation — re-ping primary contact + push all assigned users
      console.log(`⬆️  Escalation Tier 1 — Alert ${alert.id} for ${alert.resident_name}`);

      const msg = `[ESCALATION] Unacknowledged alert for ${alert.resident_name}: ${alert.message}`;
      const primaryContact = contacts[0];
      if (primaryContact?.phone) {
        await sendSMS(primaryContact.phone, msg).catch(err =>
          console.warn('SMS escalation error:', err.message)
        );
      }

      await sendPushForResident(alert.resident_id, {
        title: `⚠️ Unacknowledged Alert — ${alert.resident_name}`,
        body: msg,
        urgency: 'high',
        alertId: String(alert.id),
        url: '/?tab=alerts',
      });

      await alerts.markEscalated(alert.id, 1);
    }

    if (alert.escalation_tier === 1) {
      // Check if it's now past the Tier 2 threshold
      const minutesSince = (Date.now() - new Date(alert.created_at).getTime()) / 60_000;
      if (minutesSince < TIER2_MINUTES) continue;

      // Tier 2: notify ALL emergency contacts (not just primary)
      console.log(`🚨 Escalation Tier 2 — Alert ${alert.id} for ${alert.resident_name} — ${minutesSince.toFixed(0)}min unacknowledged`);

      const secondaryContacts = contacts.slice(1);
      const urgentMsg = `[URGENT UNACKNOWLEDGED] ${alert.resident_name}: ${alert.message}. This alert has been unacknowledged for ${Math.round(minutesSince)} minutes.`;

      for (const c of secondaryContacts) {
        if (c.phone) {
          await sendSMS(c.phone, urgentMsg).catch(err =>
            console.warn('SMS Tier2 escalation error:', err.message)
          );
        }
      }

      await alerts.markEscalated(alert.id, 2);
    }
  }
}
