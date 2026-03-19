// backend/src/services/email.js — SendGrid email delivery
import sgMail from '@sendgrid/mail';

let _configured = false;

function configure() {
  if (_configured) return;
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    _configured = true;
  }
}

export async function sendDailySummaryEmail({ toEmails, residentName, date, summary, stats, alerts }) {
  configure();

  if (!_configured) {
    console.log(`[Email MOCK] Summary for ${residentName} → ${toEmails.join(', ')}`);
    return;
  }
  if (!toEmails.length) return;

  const alertSection = alerts?.length
    ? alerts.map(a => `<li><strong>${(a.urgency || '').toUpperCase()}</strong>: ${a.message}</li>`).join('')
    : '<li>No alerts today — a great sign!</li>';

  const presencePct = stats?.reading_count
    ? Math.round((stats.presence_count / stats.reading_count) * 100)
    : 0;

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:24px;border-radius:12px;">
      <div style="background:#2563EB;padding:24px 28px;border-radius:10px 10px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">CareWatch Daily Report</h1>
        <p style="color:rgba(255,255,255,.75);margin:6px 0 0;font-size:13px;">${residentName} &mdash; ${date}</p>
      </div>
      <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;">
        <h2 style="font-size:15px;color:#111827;margin:0 0 10px;">How ${residentName.split(' ')[0]}'s day went</h2>
        <p style="color:#374151;line-height:1.7;margin:0 0 24px;">${summary}</p>

        <h2 style="font-size:15px;color:#111827;margin:0 0 12px;">Vitals at a Glance</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
          <tr style="background:#f9fafb;">
            <td style="padding:10px 12px;border:1px solid #e5e7eb;color:#6b7280;">Avg Breathing Rate</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;color:#111827;">${stats?.avg_breathing?.toFixed(1) ?? '—'} breaths/min</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;color:#6b7280;">Avg Heart Rate</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;color:#111827;">${stats?.avg_heart_rate?.toFixed(1) ?? '—'} bpm</td>
          </tr>
          <tr style="background:#f9fafb;">
            <td style="padding:10px 12px;border:1px solid #e5e7eb;color:#6b7280;">Room Presence</td>
            <td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;color:#111827;">${presencePct}% of day</td>
          </tr>
        </table>

        <h2 style="font-size:15px;color:#111827;margin:0 0 12px;">Alerts Today</h2>
        <ul style="color:#374151;font-size:13px;line-height:1.8;padding-left:20px;margin:0 0 24px;">${alertSection}</ul>
      </div>
      <div style="padding:16px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;text-align:center;background:#f9fafb;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">
          CareWatch Monitoring &mdash;
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" style="color:#2563EB;text-decoration:none;">Open Dashboard</a>
        </p>
      </div>
    </div>`;

  const msg = {
    to: toEmails,
    from: {
      name: 'CareWatch',
      email: process.env.SENDGRID_FROM_EMAIL || 'alerts@carewatch.app',
    },
    subject: `CareWatch Daily Report: ${residentName} — ${date}`,
    html,
    text: `CareWatch Daily Report\n${residentName} — ${date}\n\n${summary}\n\nAvg Breathing: ${stats?.avg_breathing?.toFixed(1) ?? '—'} breaths/min\nAvg Heart Rate: ${stats?.avg_heart_rate?.toFixed(1) ?? '—'} bpm\nPresence: ${presencePct}%\n\nAlerts:\n${(alerts || []).map(a => `${(a.urgency || '').toUpperCase()}: ${a.message}`).join('\n') || 'None'}`,
  };

  try {
    await sgMail.send(msg);
    console.log(`📧 Email sent to ${toEmails.length} recipient(s) for ${residentName}`);
  } catch (err) {
    console.error('❌ SendGrid error:', err.response?.body?.errors || err.message);
  }
}
