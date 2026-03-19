// backend/src/db/seed.js
// Bootstrap script — creates default admin user + demo residents
// Usage:
//   node src/db/seed.js                  (default admin@care.local / CareWatch2024!)
//   node src/db/seed.js --email x --password y --name "Admin"

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { randomUUID } from 'crypto';
import { initSchema } from './schema.js';
import { residents, users } from './queries.js';
import { hashPassword } from '../services/auth.js';

const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const email    = get('--email')    || 'admin@care.local';
const password = get('--password') || 'CareWatch2024!';
const name     = get('--name')     || 'Admin';
const role     = get('--role')     || 'admin';

const demoResidents = [
  {
    id: randomUUID(),
    name: 'Elio Montes',
    room: 'default',
    date_of_birth: '1990-01-01',
    emergency_contacts: JSON.stringify([
      { name: 'Emergency Contact', relationship: 'Family', phone: '+15551234567', email: '' },
    ]),
    notes: 'Primary monitored subject. WiFi CSI sensing with ESP32-S3 nodes.',
  },
  {
    id: randomUUID(),
    name: 'Robert Chen',
    room: 'room-2',
    date_of_birth: '1938-07-22',
    emergency_contacts: JSON.stringify([
      { name: 'Amy Chen', relationship: 'Daughter', phone: '+15552223333', email: '' },
    ]),
    notes: 'Mild cognitive decline. Wandering risk at night.',
  },
  {
    id: randomUUID(),
    name: 'Dorothy Walsh',
    room: 'room-3',
    date_of_birth: '1945-11-08',
    emergency_contacts: JSON.stringify([
      { name: 'Michael Walsh', relationship: 'Husband', phone: '+15554445555', email: '' },
    ]),
    notes: 'COPD diagnosed 2022. Monitor breathing closely.',
  },
];

async function seed() {
  await initSchema();

  // ── Admin user ──────────────────────────────────────────────────
  const existing = await users.getByEmail(email);
  if (existing) {
    console.log(`✅ Admin user already exists: ${email}`);
  } else {
    const password_hash = await hashPassword(password);
    await users.create({ id: randomUUID(), email, password_hash, name, role, resident_ids: '[]' });
    console.log(`✅ Admin user created: ${email} / ${password}`);
    console.log('⚠️  Change this password immediately after first login!');
  }

  // ── Demo residents ──────────────────────────────────────────────
  for (const r of demoResidents) {
    try {
      await residents.create(r);
      console.log(`✅ Created resident: ${r.name} (${r.room})`);
    } catch (err) {
      if (err.message.includes('unique') || err.message.includes('duplicate') || err.code === '23505') {
        console.log(`⚠️  ${r.name} may already exist — skipping`);
      } else {
        console.error(`❌ Failed to create ${r.name}:`, err.message);
      }
    }
  }

  console.log('\n🎉 Seed complete! Start the backend to begin monitoring.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
