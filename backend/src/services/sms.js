// backend/src/services/sms.js
import dotenv from 'dotenv';
import twilio from 'twilio';
dotenv.config();

let twilioClient = null;

function getClient() {
  if (!twilioClient) {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.warn('⚠️  Twilio not configured — SMS alerts disabled. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
      return null;
    }
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

export async function sendSMS(to, message) {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.log(`📱  [SMS MOCK] To: ${to}\n${message}\n`);
    return { success: true, mock: true };
  }

  try {
    const client = getClient();
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_FROM_NUMBER,
      to,
    });

    console.log(`📱 SMS sent to ${to}: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (err) {
    console.error(`❌ SMS failed to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

export function formatAlertSMS(residentName, alertType, message, urgency) {
  const emoji = urgency === 'high' ? '🚨' : urgency === 'medium' ? '⚠️' : 'ℹ️';
  return `${emoji} CareWatch Alert\n\nResident: ${residentName}\nType: ${alertType.replace(/_/g, ' ').toUpperCase()}\n\n${message}\n\nReply STOP to unsubscribe`;
}