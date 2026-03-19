// backend/src/services/ruviewClient.js
// Connects to RuView WebSocket and emits parsed sensor frames
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export class RuViewClient extends EventEmitter {
  constructor(wsUrl, restUrl) {
    super();
    this.on('error', () => {}); // prevent unhandled error crashes
    this.wsUrl = wsUrl || process.env.RUVIEW_WS_URL || 'ws://localhost:3001/ws/sensing';
    this.restUrl = restUrl || process.env.RUVIEW_REST_URL || 'http://localhost:3000';
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 2000;
    this.connected = false;
  }

  connect() {
    console.log(`🔌 Connecting to RuView at ${this.wsUrl}`);
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => {
        console.log('✅ RuView WebSocket connected');
        this.connected = true;
        this.reconnectDelay = 2000;
        this.emit('connected');
      });
      this.ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString());
          const parsed = this.parseFrame(frame);
          if (parsed) {
            this.emit('frame', parsed);
          }
        } catch (err) {
          console.warn('⚠️ Failed to parse RuView frame:', err.message);
        }
      });
      this.ws.on('close', () => {
        console.log('🔌 RuView WebSocket disconnected — reconnecting...');
        this.connected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });
      this.ws.on('error', (err) => {
        console.warn('⚠️ RuView unavailable (using ESP32 bridge)');
      });
    } catch (err) {
      console.error('❌ Failed to create WebSocket:', err.message);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  parseFrame(raw) {
    const persons = raw.persons || [];
    const vitals = raw.vital_signs || raw.vitals || {};
    const classification = raw.classification || {};
    return {
      timestamp: raw.timestamp || new Date().toISOString(),
      room: raw.room || 'default',
      presence: (classification.presence ?? persons.length > 0),
      person_count: persons.length || (classification.presence ? 1 : 0),
      breathing_rate: vitals.breathing_rate_bpm ?? vitals.breathing_rate ?? null,
      heart_rate: vitals.heart_rate_bpm ?? vitals.heart_rate ?? null,
      motion_level: raw.features?.motion_band_power ?? raw.features?.variance ?? raw.motion_level ?? null,
      posture: persons[0]?.posture || null,
      confidence: vitals.breathing_confidence ?? vitals.confidence ?? raw.confidence ?? null,
      persons,
      raw,
    };
  }

  async getHealth() {
    try {
      const res = await fetch(`${this.restUrl}/health`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async getLatestFrame() {
    try {
      const res = await fetch(`${this.restUrl}/api/v1/sensing/latest`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}