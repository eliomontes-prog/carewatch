# CareWatch Development Guide

## Project Overview

CareWatch is a three-layer system:

1. **RuView** — WiFi sensing engine (open source, Docker image)
2. **CareWatch Backend** — Node.js server with Claude AI alert agent
3. **CareWatch Frontend** — React dashboard for caregivers

---

## Getting Started

### Step 1: Clone and configure

```bash
git clone <your-repo>
cd carewatch
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...      # Required for AI alerts
TWILIO_ACCOUNT_SID=AC...          # Optional — SMS alerts
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1555...
```

### Step 2: Start RuView (simulated mode — no hardware)

```bash
docker compose up ruview -d
# Verify: curl http://localhost:3000/health
```

### Step 3: Start Backend

```bash
cd backend
npm install
npm run dev

# In another terminal, seed demo residents:
node src/db/seed.js
```

### Step 4: Start Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## Hardware Setup (ESP32-S3)

### What you need
- 2-3x ESP32-S3-DevKitC-1 (~$8 each)
- USB-C cables
- A WiFi router
- A computer with a USB port

### Flash and provision

```bash
cd hardware

# Flash single board (default port /dev/ttyUSB0)
./flash.sh

# Flash with WiFi credentials
./flash.sh /dev/ttyUSB0 192.168.1.20 "MyWiFiName" "MyPassword"

# On Windows use COM port:
./flash.sh COM7 192.168.1.20 "MyWiFiName" "MyPassword"
```

### Verify hardware working

```bash
# Start aggregator and watch for frames
docker compose up ruview-esp32 -d
docker compose logs ruview-esp32 -f

# You should see: [node:1 seq:N] sc=64 rssi=-49 amp=9.5
```

---

## Adding Residents

### Via seed script (dev)

Edit `backend/src/db/seed.js` with real resident info, then:
```bash
node src/db/seed.js
```

### Via API

```bash
curl -X POST http://localhost:4000/api/residents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "room": "default",
    "date_of_birth": "1940-05-20",
    "emergency_contacts": [
      { "name": "Tom Smith", "relationship": "Son", "phone": "+15551234567" }
    ],
    "notes": "Diabetes Type 2. Check vitals after meals."
  }'
```

### Room assignment
Each resident is assigned to a `room` string that matches the RuView room identifier.
In simulated mode, the default room is `"default"`.
With multiple ESP32 nodes, configure each mesh with its room ID.

---

## Alert System

### How alerts work

1. RuView streams sensor frames every ~50ms via WebSocket
2. CareWatch backend processes each frame through event detectors
3. When an event is detected, Claude evaluates whether it's genuinely concerning
4. If Claude decides to alert, SMS is sent to emergency contacts

### Alert types

| Type | Default trigger | Urgency |
|------|----------------|---------|
| `fall` | Lying posture during daytime >30 seconds | HIGH |
| `no_motion` | Presence but no movement >2 hours (day) | MEDIUM |
| `abnormal_breathing` | Rate >25% from personal baseline | MEDIUM |
| `elevated_heart_rate` | HR >25% from baseline at rest | MEDIUM |
| `missing_at_mealtime` | Not present at 8am/12pm/6pm for 30+ min | LOW |

### Tuning thresholds

In `.env`:
```
ALERT_COOLDOWN_MINUTES=15        # Suppress duplicate alerts
FALL_RECOVERY_SECONDS=30         # How long on floor before alert
NO_MOTION_DAY_MINUTES=120        # Inactivity threshold (minutes)
BREATHING_DEVIATION_THRESHOLD=0.25  # 25% = alert threshold
```

### Testing alerts

```bash
# Trigger a test alert via API (useful for testing SMS)
curl -X POST http://localhost:4000/api/alerts/test \
  -H "Content-Type: application/json" \
  -d '{ "resident_id": "<id>", "type": "fall" }'
```

---

## Daily Summaries

At 8pm daily, CareWatch generates natural language summaries for each resident
using Claude, based on the day's sensor data and any alerts.

Summaries appear in the resident detail view on the dashboard.

To generate summaries manually:
```bash
curl -X POST http://localhost:4000/api/summaries/generate
```

---

## Architecture Decisions

### Why Claude for alerts (not just rules)?
Rule-based systems generate too many false positives. A caregiver who gets 20
alerts a day for things that turn out to be nothing will stop paying attention.
Claude can reason about context: "It's 2am, breathing is slower than baseline,
but slower breathing at night is normal for this resident."

### Why SQLite?
For an MVP/pilot with 1-50 residents, SQLite is perfect — no ops overhead,
data is a single file you can back up easily. Migrate to Postgres if you scale
to hundreds of facilities.

### Why baseline profiling?
Every person's normal is different. A breathing rate of 10 BPM is concerning
for one person but normal for another. The exponential moving average baseline
learns each person's normal and alerts on deviations from *their* baseline,
not a population average.

---

## Production Checklist

Before deploying to a real care facility:

- [ ] Replace SQLite with Postgres for reliability
- [ ] Add authentication to the dashboard (JWT + login page)
- [ ] Set up HTTPS (Let's Encrypt via Nginx/Caddy)
- [ ] Add rate limiting to API endpoints
- [ ] Set up automated database backups
- [ ] Configure proper logging (Winston/Pino → CloudWatch/Datadog)
- [ ] Add monitoring/alerting for the backend itself (uptime)
- [ ] Test SMS delivery reliability with Twilio
- [ ] Legal: Draft privacy notice for residents (what data is collected)
- [ ] Legal: Review local regulations on health monitoring devices
- [ ] Hardware: Add UPS battery backup for ESP32 power
- [ ] Hardware: Test WiFi dropout recovery

---

## API Reference

### Residents
- `GET /api/residents` — List all residents
- `GET /api/residents/:id` — Get resident with baseline and summaries
- `POST /api/residents` — Create resident
- `PUT /api/residents/:id` — Update resident

### Alerts
- `GET /api/alerts` — Recent alerts (all residents)
- `GET /api/alerts/resident/:id` — Alerts for one resident
- `POST /api/alerts/:id/acknowledge` — Acknowledge alert

### Live
- `GET /api/rooms` — Latest sensor status per room
- `GET /health` — System health
- `WS /ws` — Real-time frame stream for dashboard

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/add-push-notifications`
3. Make changes + test
4. Open a PR with description of what and why

Issues and feature requests welcome.
