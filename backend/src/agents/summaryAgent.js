// backend/src/agents/summaryAgent.js
import Anthropic from '@anthropic-ai/sdk';
import { residents, readings, alerts, activityLog, users } from '../db/queries.js';
import { sendDailySummaryEmail } from '../services/email.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateDailySummaries() {
  const allResidents = await residents.getAll();
  const date = new Date().toISOString().split('T')[0];

  console.log(`📊 Generating daily summaries for ${allResidents.length} residents...`);

  for (const resident of allResidents) {
    try {
      await generateSummaryForResident(resident, date);
    } catch (err) {
      console.error(`❌ Failed to generate summary for ${resident.name}:`, err.message);
    }
  }
}

async function generateSummaryForResident(resident, date) {
  const stats          = await readings.getDailyStats(resident.id, date);
  const dayAlerts      = await alerts.getRecent(resident.id, 24);
  const recentSummaries = await activityLog.getForResident(resident.id, 3);

  if (!stats || stats.reading_count === 0) {
    console.log(`⚠️  No data for ${resident.name} on ${date}`);
    return;
  }

  const prompt = `You are a care monitoring AI generating a daily health summary for a caregiver or family member.

RESIDENT: ${resident.name}
DATE: ${date}

TODAY'S SENSOR DATA:
- Total readings: ${stats.reading_count}
- Presence detected: ${stats.presence_count} of ${stats.reading_count} readings (${Math.round(stats.presence_count / stats.reading_count * 100)}% of day)
- Average breathing rate: ${stats.avg_breathing?.toFixed(1) || 'N/A'} breaths/min
- Average heart rate: ${stats.avg_heart_rate?.toFixed(1) || 'N/A'} BPM
- Average motion level: ${stats.avg_motion?.toFixed(2) || 'N/A'}

ALERTS TODAY (${dayAlerts.length} total):
${dayAlerts.length ? dayAlerts.map(a => `- ${a.urgency.toUpperCase()}: ${a.message} at ${new Date(a.created_at).toLocaleTimeString()}`).join('\n') : 'No alerts today'}

RECENT TREND (previous 3 days):
${recentSummaries.map(s => `${s.date}: ${s.summary}`).join('\n') || 'No previous summaries'}

Write a warm, clear daily summary (3-4 sentences) that:
1. Describes how the resident's day went in plain language
2. Notes any health or safety concerns
3. Highlights any positive signs
4. Suggests anything a caregiver should be aware of

Keep it human and compassionate — this will be read by family members. Do not use technical jargon.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const summary = response.content[0].text.trim();

  await activityLog.insert({
    resident_id: resident.id,
    date,
    summary,
    metrics: JSON.stringify(stats),
  });

  console.log(`✅ Summary for ${resident.name}: ${summary.substring(0, 80)}...`);

  // Send email to all assigned caregivers and family
  try {
    const assignedUsers = await users.getForResident(resident.id);
    const contactEmails = JSON.parse(resident.emergency_contacts || '[]')
      .map(c => c.email).filter(Boolean);
    const userEmails = assignedUsers.map(u => u.email).filter(Boolean);
    const allEmails  = [...new Set([...userEmails, ...contactEmails])];

    if (allEmails.length > 0) {
      await sendDailySummaryEmail({
        toEmails:     allEmails,
        residentName: resident.name,
        date,
        summary,
        stats,
        alerts:       dayAlerts,
      });
    }
  } catch (err) {
    console.error(`❌ Email summary error for ${resident.name}:`, err.message);
  }
}
