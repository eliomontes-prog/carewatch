// backend/src/api/wearables.js
// Import and query wearable data (Apple Health, Oura Ring) for accuracy validation
import { Router } from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import { readFileSync, unlinkSync } from 'fs';
import { db } from '../db/pool.js';

const router = Router();
const upload = multer({ dest: '/tmp/carewatch-uploads/', limits: { fileSize: 500 * 1024 * 1024 } });

// ── Apple Health XML Parser ──────────────────────────────────────
function parseAppleHealthXML(filePath) {
  console.log('📱 Parsing Apple Health export...');
  const xml = readFileSync(filePath, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => name === 'Record',
  });
  const parsed = parser.parse(xml);
  const records = parsed?.HealthData?.Record || [];
  const heartRateRecords = records.filter(r => r.type === 'HKQuantityTypeIdentifierHeartRate');
  console.log(`  Found ${heartRateRecords.length} heart rate records`);
  return heartRateRecords.map(r => ({
    source: 'apple_watch',
    metric: 'heart_rate',
    value: parseFloat(r.value),
    recorded_at: r.startDate,
  }));
}

// ── Oura Ring JSON Parser ────────────────────────────────────────
function parseOuraJSON(filePath) {
  console.log('💍 Parsing Oura Ring export...');
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const results = [];

  if (data.heart_rate) {
    for (const entry of data.heart_rate) {
      if (entry.bpm && entry.timestamp) {
        results.push({
          source: 'oura_ring',
          metric: 'heart_rate',
          value: entry.bpm,
          recorded_at: entry.timestamp,
        });
      }
    }
  }

  // Direct array of heart rate samples
  if (Array.isArray(data) && data[0]?.bpm) {
    for (const entry of data) {
      if (entry.bpm && entry.timestamp) {
        results.push({
          source: 'oura_ring',
          metric: 'heart_rate',
          value: entry.bpm,
          recorded_at: entry.timestamp,
        });
      }
    }
  }

  console.log(`  Found ${results.length} readings from Oura JSON`);
  return results;
}

// ── Oura CSV Parser ──────────────────────────────────────────────
function parseOuraCSV(filePath) {
  console.log('💍 Parsing Oura CSV export...');
  const csv = readFileSync(filePath, 'utf-8');
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const bpmIdx  = headers.findIndex(h => h.includes('bpm') || h.includes('heart'));
  const tsIdx   = headers.findIndex(h => h.includes('time') || h.includes('date') || h.includes('timestamp'));

  if (bpmIdx === -1 || tsIdx === -1) return [];

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
    const bpm  = parseFloat(cols[bpmIdx]);
    const ts   = cols[tsIdx];
    if (!isNaN(bpm) && bpm > 0 && ts) {
      results.push({ source: 'oura_ring', metric: 'heart_rate', value: bpm, recorded_at: ts });
    }
  }
  console.log(`  Found ${results.length} readings from Oura CSV`);
  return results;
}

// ── Bulk insert helper (PostgreSQL) ──────────────────────────────
async function bulkInsertWearable(readings) {
  if (!readings.length) return;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of readings) {
      await client.query(
        'INSERT INTO wearable_readings (source, metric, value, recorded_at) VALUES ($1,$2,$3,$4)',
        [r.source, r.metric, r.value, r.recorded_at]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Upload endpoint ──────────────────────────────────────────────
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { originalname, path: filePath, mimetype } = req.file;
    const source = req.body.source || 'auto';
    let readings = [];

    try {
      if (source === 'apple_health' || originalname.endsWith('.xml') || originalname.includes('export')) {
        readings = parseAppleHealthXML(filePath);
      } else if (source === 'oura' && (originalname.endsWith('.json') || mimetype === 'application/json')) {
        readings = parseOuraJSON(filePath);
      } else if (source === 'oura' && originalname.endsWith('.csv')) {
        readings = parseOuraCSV(filePath);
      } else {
        try      { readings = parseOuraJSON(filePath); }
        catch    { try { readings = parseAppleHealthXML(filePath); } catch { readings = parseOuraCSV(filePath); } }
      }
    } finally {
      try { unlinkSync(filePath); } catch {}
    }

    if (readings.length === 0) {
      return res.status(400).json({
        error: 'No heart rate data found in file',
        hint: 'Supported formats: Apple Health XML export, Oura JSON/CSV export',
      });
    }

    await bulkInsertWearable(readings);

    const dateRange = {
      from: readings[0]?.recorded_at,
      to:   readings[readings.length - 1]?.recorded_at,
    };

    console.log(`✅ Imported ${readings.length} wearable readings (${readings[0]?.source})`);
    res.json({ ok: true, source: readings[0]?.source, metric: 'heart_rate', count: readings.length, dateRange });
  } catch (err) {
    console.error('❌ Wearable import error:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// ── Query wearable data ──────────────────────────────────────────
router.get('/readings', async (req, res) => {
  const { source, metric = 'heart_rate', from, to, limit = 5000 } = req.query;
  const params = [metric];
  let query = 'SELECT source, metric, value, recorded_at FROM wearable_readings WHERE metric = $1';
  let idx = 2;

  if (source) { query += ` AND source = $${idx++}`;      params.push(source); }
  if (from)   { query += ` AND recorded_at >= $${idx++}`; params.push(from);   }
  if (to)     { query += ` AND recorded_at <= $${idx++}`; params.push(to);     }

  query += ` ORDER BY recorded_at ASC LIMIT $${idx}`;
  params.push(Number(limit));

  res.json(await db.all(query, params));
});

// ── Query CareWatch sensor readings for comparison ───────────────
router.get('/carewatch-readings', async (req, res) => {
  const { from, to, limit = 5000 } = req.query;
  const params = [];
  let query = 'SELECT heart_rate, breathing_rate, motion_level, recorded_at FROM sensor_readings WHERE heart_rate IS NOT NULL';
  let idx = 1;

  if (from) { query += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to)   { query += ` AND recorded_at <= $${idx++}`; params.push(to);   }

  query += ` ORDER BY recorded_at ASC LIMIT $${idx}`;
  params.push(Number(limit));

  res.json(await db.all(query, params));
});

// ── Comparison chart (server-side bucketed by hour) ───────────────
router.get('/comparison-chart', async (req, res) => {
  const { from, to, bucket = 'hour' } = req.query;

  // PostgreSQL date_trunc instead of SQLite strftime
  const trunc = bucket === 'day' ? 'day' : 'hour';
  const params = [];
  let dateFilter = '';
  let idx = 1;

  if (from) { dateFilter += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to)   { dateFilter += ` AND recorded_at <= $${idx++}`; params.push(to);   }

  const [wearableRows, cwRows] = await Promise.all([
    db.all(
      `SELECT
         date_trunc('${trunc}', recorded_at::TIMESTAMPTZ)::TEXT AS bucket,
         source,
         ROUND(AVG(value)::NUMERIC, 1) AS avg_hr
       FROM wearable_readings
       WHERE metric = 'heart_rate' ${dateFilter}
       GROUP BY 1, source
       ORDER BY 1 ASC`,
      params
    ),
    db.all(
      `SELECT
         date_trunc('${trunc}', recorded_at::TIMESTAMPTZ)::TEXT AS bucket,
         ROUND(AVG(heart_rate)::NUMERIC, 1) AS avg_hr
       FROM sensor_readings
       WHERE heart_rate IS NOT NULL ${dateFilter}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    ),
  ]);

  const merged = {};
  for (const r of wearableRows) {
    if (!merged[r.bucket]) merged[r.bucket] = { bucket: r.bucket };
    if (r.source === 'apple_watch') merged[r.bucket].appleHR = parseFloat(r.avg_hr);
    if (r.source === 'oura_ring')   merged[r.bucket].ouraHR  = parseFloat(r.avg_hr);
  }
  for (const r of cwRows) {
    if (!merged[r.bucket]) merged[r.bucket] = { bucket: r.bucket };
    merged[r.bucket].cwHR = parseFloat(r.avg_hr);
  }

  res.json(Object.values(merged).sort((a, b) => a.bucket.localeCompare(b.bucket)));
});

// ── Comparison stats ─────────────────────────────────────────────
router.get('/comparison', async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let dateFilter = '';
  let idx = 1;

  if (from) { dateFilter += ` AND recorded_at >= $${idx++}`; params.push(from); }
  if (to)   { dateFilter += ` AND recorded_at <= $${idx++}`; params.push(to);   }

  const [sources, cw] = await Promise.all([
    db.all(
      `SELECT source, metric,
              COUNT(*) AS count,
              MIN(recorded_at) AS earliest, MAX(recorded_at) AS latest,
              AVG(value) AS avg_value, MIN(value) AS min_value, MAX(value) AS max_value
       FROM wearable_readings
       WHERE 1=1 ${dateFilter}
       GROUP BY source, metric`,
      params
    ),
    db.get(
      `SELECT COUNT(*) AS count,
              MIN(recorded_at) AS earliest, MAX(recorded_at) AS latest,
              AVG(heart_rate) AS avg_hr, MIN(heart_rate) AS min_hr, MAX(heart_rate) AS max_hr,
              AVG(breathing_rate) AS avg_br
       FROM sensor_readings
       WHERE heart_rate IS NOT NULL ${dateFilter}`,
      params
    ),
  ]);

  res.json({
    wearables: sources,
    carewatch: cw,
    hasData: sources.length > 0 && (parseInt(cw?.count) ?? 0) > 0,
  });
});

// ── Oura API Direct Sync ─────────────────────────────────────────
const OURA_BASE = 'https://api.ouraring.com';

router.post('/oura/sync', async (req, res) => {
  try {
    const { token, start_date, end_date } = req.body;
    if (!token) return res.status(400).json({ error: 'Oura Personal Access Token required' });

    const end   = end_date   || new Date().toISOString().slice(0, 10);
    const start = start_date || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const headers = { Authorization: `Bearer ${token}` };

    const hrUrl = `${OURA_BASE}/v2/usercollection/heartrate?start_datetime=${start}T00:00:00&end_datetime=${end}T23:59:59`;
    console.log(`💍 Fetching Oura HR: ${start} to ${end}`);

    const hrRes = await fetch(hrUrl, { headers });
    if (!hrRes.ok) {
      const errText = await hrRes.text();
      return res.status(hrRes.status).json({
        error: `Oura API returned ${hrRes.status}`,
        detail: errText,
        hint: hrRes.status === 401 ? 'Check your Personal Access Token' : undefined,
      });
    }

    const hrData = await hrRes.json();
    const heartRateReadings = (hrData.data || []).map(r => ({
      source: 'oura_ring', metric: 'heart_rate', value: r.bpm, recorded_at: r.timestamp,
    }));

    let sleepReadings = [];
    try {
      const sleepRes = await fetch(`${OURA_BASE}/v2/usercollection/daily_sleep?start_date=${start}&end_date=${end}`, { headers });
      if (sleepRes.ok) {
        const sleepData = await sleepRes.json();
        for (const day of (sleepData.data || [])) {
          if (day.contributors?.resting_heart_rate) {
            sleepReadings.push({
              source: 'oura_ring', metric: 'resting_heart_rate',
              value: day.contributors.resting_heart_rate,
              recorded_at: day.day + 'T00:00:00',
            });
          }
        }
      }
    } catch (e) { console.warn('Oura sleep fetch failed (non-fatal):', e.message); }

    const allReadings = [...heartRateReadings, ...sleepReadings];

    if (allReadings.length === 0) {
      return res.json({ ok: true, count: 0, message: 'No heart rate data found for the selected period.' });
    }

    // Clear previous Oura data for this date range then bulk insert
    await db.run(
      'DELETE FROM wearable_readings WHERE source = $1 AND recorded_at >= $2 AND recorded_at <= $3',
      ['oura_ring', `${start}T00:00:00`, `${end}T23:59:59`]
    );
    await bulkInsertWearable(allReadings);

    const dateRange = { from: allReadings[0]?.recorded_at, to: allReadings[allReadings.length - 1]?.recorded_at };
    console.log(`✅ Synced ${allReadings.length} Oura readings`);

    res.json({ ok: true, source: 'oura_ring', count: allReadings.length, heartRate: heartRateReadings.length, restingHR: sleepReadings.length, dateRange });
  } catch (err) {
    console.error('❌ Oura sync error:', err.message);
    res.status(500).json({ error: 'Oura sync failed: ' + err.message });
  }
});

// ── Oura token management ────────────────────────────────────────
router.post('/oura/token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const testRes = await fetch(`${OURA_BASE}/v2/usercollection/personal_info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!testRes.ok) return res.status(401).json({ error: 'Invalid token — Oura API returned ' + testRes.status });
    const info = await testRes.json();
    process.env.OURA_PAT = token;
    res.json({ ok: true, verified: true, email: info.email });
  } catch (err) {
    res.status(500).json({ error: 'Token verification failed: ' + err.message });
  }
});

router.get('/oura/status', (req, res) => res.json({ connected: !!process.env.OURA_PAT }));

// ── Clear wearable data ──────────────────────────────────────────
router.delete('/readings', async (req, res) => {
  const { source } = req.query;
  if (source) {
    await db.run('DELETE FROM wearable_readings WHERE source = $1', [source]);
  } else {
    await db.run('DELETE FROM wearable_readings');
  }
  res.json({ ok: true });
});

export default router;
