# 🏥 CareWatch — Elderly Care Monitoring + AI Alert Agent

Privacy-first elderly care monitoring using WiFi sensing (RuView) + Claude AI reasoning.
No cameras. No wearables. Just WiFi signals already in the room.

## Architecture

```
ESP32-S3 Mesh (2-3 nodes/room)
        ↓ UDP CSI frames (port 5005)
RuView Sensing Server (Docker :3000/:3001)
        ↓ WebSocket stream
CareWatch Backend (Node.js :4000)
        ↓ Claude API reasoning
Alert Engine → SMS (Twilio) / Dashboard
        ↓
React Dashboard (:5173)
```

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- Node.js 18+
- Anthropic API key
- Twilio account (for SMS alerts)
- 2-3x ESP32-S3-DevKitC-1 boards (optional — runs on simulated data without them)

### 2. Environment Setup
```bash
cp .env.example .env
# Fill in your API keys
```

### 3. Start Everything
```bash
# Start RuView sensing server (simulated mode — no hardware needed)
docker compose up -d ruview

# Install and start backend
cd backend && npm install && npm run dev

# Install and start frontend
cd frontend && npm install && npm run dev
```

### 4. With Real Hardware (ESP32-S3)
```bash
# Flash firmware to ESP32-S3 boards
cd hardware && ./flash.sh --port /dev/ttyUSB0

# Start with hardware source
docker compose up -d ruview-esp32
```

Open http://localhost:5173 for the dashboard.

## Project Structure

```
carewatch/
├── backend/                    # Node.js AI agent + API server
│   ├── src/
│   │   ├── agents/             # Claude AI reasoning agents
│   │   │   ├── alertAgent.js   # Main alert decision agent
│   │   │   └── summaryAgent.js # Daily summary generator
│   │   ├── api/                # REST API routes
│   │   │   ├── residents.js
│   │   │   ├── alerts.js
│   │   │   └── dashboard.js
│   │   ├── db/                 # SQLite database layer
│   │   │   ├── schema.js
│   │   │   └── queries.js
│   │   ├── services/           # Core services
│   │   │   ├── ruviewClient.js # RuView WebSocket client
│   │   │   ├── baseline.js     # Resident baseline profiler
│   │   │   ├── alertEngine.js  # Alert orchestration
│   │   │   └── sms.js          # Twilio SMS sender
│   │   └── index.js            # Entry point
│   ├── package.json
│   └── .env.example
├── frontend/                   # React dashboard
│   ├── src/
│   │   ├── components/         # UI components
│   │   ├── pages/              # Dashboard pages
│   │   └── App.jsx
│   └── package.json
├── hardware/                   # ESP32 setup scripts
│   └── flash.sh
├── docker-compose.yml
└── README.md
```

## Alert Types

| Alert | Trigger | Urgency |
|-------|---------|---------|
| Fall detected | Sudden pose change + no recovery | HIGH |
| No movement (day) | Presence but no motion >2 hours | MEDIUM |
| Abnormal breathing | Rate outside personal baseline | MEDIUM |
| Missing at mealtime | No presence at expected time | LOW |
| Elevated heart rate | HR >20% above resting baseline | MEDIUM |

## License
MIT
