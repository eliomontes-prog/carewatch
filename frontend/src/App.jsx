// frontend/src/App.jsx
// Modern minimal redesign for CareWatch
import { useState, useEffect, useRef, useCallback, Component } from 'react';
import { AreaChart, LineChart, BarChart, Bar, Line, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import AnalyticsTab from './components/AnalyticsTab.jsx';
import RoomView from './RoomView.jsx';
import { API_BASE, wsUrl } from './lib/api.js';
import { setupNotifications } from './lib/notifications.js';

// ── Error Boundary ──────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] ${this.props.label || 'Section'}:`, error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px', textAlign: 'center', borderRadius: 16,
          background: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.15)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>!</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            {this.props.label || 'This section'} encountered an error
          </div>
          <div style={{ fontSize: 13, color: 'var(--cw-text-secondary)', marginBottom: 16 }}>
            {this.state.error?.message || 'Something went wrong'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 20px', borderRadius: 22, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              background: 'rgba(0,0,0,.08)', color: 'var(--cw-text)',
            }}
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const API = API_BASE;
const WS  = wsUrl('/ws');

const BOARDS = [
  { id: 1, mac: '10:20:ba:4e:22:bc', ip: '192.168.0.212', label: 'Node A' },
  { id: 2, mac: '10:20:ba:4e:39:dc', ip: '192.168.0.45',  label: 'Node B' },
  { id: 3, mac: '10:20:ba:4e:3a:68', ip: '192.168.0.8',   label: 'Node C' },
];

const SUBJECTS = {
  elio: {
    id: 'elio', name: 'Elio', emoji: '🧑', sub: 'Resident', accent: '#2563EB',
    vitals: [
      { key: 'br', label: 'Breathing Rate', unit: 'per minute', color: '#2563EB', min: 6,  max: 35,  refLow: 12,  refHigh: 20,  refStr: '12 – 20'  },
      { key: 'hr', label: 'Heart Rate',     unit: 'per minute', color: '#DC2626', min: 30, max: 130, refLow: 60,  refHigh: 100, refStr: '60 – 100' },
      { key: 'mo', label: 'Motion',         unit: 'activity level', color: '#059669', min: 0,  max: 30,  refLow: 0,   refHigh: 15,  refStr: '0 – 15'   },
    ],
    brStatus: br => !br ? 'Waiting…' : br < 12 ? 'Below normal' : br > 20 ? 'Elevated' : 'Breathing normally',
    hrStatus: hr => !hr ? 'Waiting…' : hr < 60 ? 'Below normal' : hr > 100 ? 'Elevated' : 'Heart rate is healthy',
    moStatus: mo => !mo ? 'No data'  : mo > 15 ? 'Very active' : mo > 5 ? 'Moving around' : 'Resting',
  },
};

// ── Hooks ────────────────────────────────────────────────────────
function useWebSocket(url, onMessage) {
  const ws = useRef(null);
  const rt = useRef(null);
  const cbRef = useRef(onMessage);
  const backoff = useRef(1000);
  const [connected, setConnected] = useState(false);
  cbRef.current = onMessage;
  useEffect(() => {
    let alive = true;
    function connect() {
      if (!alive) return;
      try {
        const sock = new WebSocket(url);
        ws.current = sock;
        sock.onopen = () => {
          setConnected(true);
          backoff.current = 1000;
        };
        sock.onclose = () => {
          setConnected(false);
          if (alive) {
            const jitter = Math.random() * 500;
            rt.current = setTimeout(connect, backoff.current + jitter);
            backoff.current = Math.min(backoff.current * 2, 15000);
          }
        };
        sock.onerror = () => sock.close();
        sock.onmessage = e => { try { cbRef.current(JSON.parse(e.data)); } catch {} };
      } catch {}
    }
    connect();
    return () => { alive = false; clearTimeout(rt.current); ws.current?.close(); };
  }, [url]);
  return connected;
}

// ── Shared Components ────────────────────────────────────────────
function StatusDot({ status }) {
  const colors = {
    good: '#059669',
    warning: '#D97706',
    danger: '#DC2626',
    neutral: '#9CA3AF',
  };
  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || colors.neutral,
      flexShrink: 0,
    }} />
  );
}

function Card({ children, style = {}, ...props }) {
  return (
    <div style={{
      background: 'var(--cw-surface)',
      border: '1px solid var(--cw-border)',
      borderRadius: 'var(--cw-radius)',
      padding: '24px',
      ...style,
    }} {...props}>
      {children}
    </div>
  );
}

function Badge({ children, variant = 'default' }) {
  const variants = {
    default: { bg: 'var(--cw-bg)', text: 'var(--cw-text-secondary)' },
    success: { bg: 'rgba(5, 150, 105, 0.1)', text: '#059669' },
    warning: { bg: 'rgba(217, 119, 6, 0.1)', text: '#D97706' },
    danger: { bg: 'rgba(220, 38, 38, 0.1)', text: '#DC2626' },
  };
  const v = variants[variant] || variants.default;
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '20px',
      fontSize: 'clamp(11px, 1.2vw, 12px)',
      fontWeight: 500,
      background: v.bg,
      color: v.text,
    }}>
      {children}
    </span>
  );
}

function ArcRing({ value, min, max, color, size = 100 }) {
  const pct = Math.max(0, Math.min(1, ((value ?? min) - min) / (max - min)));
  const r   = (size / 2) - 8;
  const cx  = size / 2, cy = size / 2;
  const s0  = -215 * (Math.PI / 180);
  const arc = (a1, a2) => {
    const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
    const p2 = { x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2) };
    return `M${p1.x},${p1.y} A${r},${r} 0 ${a2-a1>Math.PI?1:0} 1 ${p2.x},${p2.y}`;
  };
  return (
    <svg width={size} height={size} style={{ overflow: 'visible', flexShrink: 0 }}>
      <path d={arc(s0, s0+250*(Math.PI/180))} fill="none" stroke="var(--cw-border)" strokeWidth={6} strokeLinecap="round"/>
      <path d={arc(s0, s0+pct*250*(Math.PI/180))} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
        style={{ transition: 'all 0.7s cubic-bezier(.4,0,.2,1)', filter: `drop-shadow(0 0 4px ${color}40)` }}/>
    </svg>
  );
}

function StatusIndicator({ status, label }) {
  const statusConfig = {
    good: { color: '#059669', label: 'Good' },
    warning: { color: '#D97706', label: 'Attention' },
    danger: { color: '#DC2626', label: 'Alert' },
    neutral: { color: '#9CA3AF', label: 'Waiting' },
  };
  const config = statusConfig[status] || statusConfig.neutral;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: config.color,
        boxShadow: `0 0 8px ${config.color}40`,
      }} />
      <span style={{ fontSize: 'clamp(12px, 1.5vw, 14px)', color: 'var(--cw-text-secondary)', fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

// SubjectToggle removed — single-subject (human-only) mode

function SubjectBadge({ subjectId }) {
  if (!subjectId?.detected) return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 20,
      background: 'var(--cw-bg)',
      fontSize: 'clamp(11px, 1.2vw, 12px)',
      fontWeight: 500,
      color: 'var(--cw-text-secondary)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--cw-text-tertiary)',
      }} />
      Standby
    </div>
  );
  const S = SUBJECTS[subjectId.detected];
  const color = S?.accent ?? 'var(--cw-text-secondary)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px', borderRadius: 20,
      background: `${color}15`,
      fontSize: 'clamp(11px, 1.2vw, 12px)',
      fontWeight: 500,
      color: color,
      border: `1px solid ${color}30`,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color,
        animation: 'pulse 2s ease-in-out infinite',
      }} />
      {S?.emoji} {S?.name} ({subjectId.confidence}%)
    </div>
  );
}

// ── Enrollment Panel ─────────────────────────────────────────────
function EnrollmentPanel({ onEnrolled }) {
  const [enrolling, setEnrolling] = useState(null);
  const [countdown, setCountdown] = useState(60);
  const [modelStatus, setModelStatus] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/enroll/status`).then(r => r.json()).then(setModelStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enrolling) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [enrolling]);

  useEffect(() => {
    if (countdown <= 0 && enrolling) finishEnroll();
  }, [countdown]);

  const startEnroll = async (subjectId) => {
    setEnrolling(subjectId);
    setCountdown(60);
    await fetch(`${API}/api/enroll/${subjectId}`, { method: 'POST' }).catch(() => {});
  };

  const finishEnroll = async () => {
    await fetch(`${API}/api/enroll`, { method: 'PUT' }).catch(() => {});
    setEnrolling(null);
    const status = await fetch(`${API}/api/enroll/status`).then(r => r.json()).catch(() => null);
    if (status) setModelStatus(status);
    onEnrolled?.();
  };

  const clearModel = async () => {
    await fetch(`${API}/api/enroll`, { method: 'DELETE' });
    setModelStatus({ mlTrained: false, samples: 0, bySubject: { elio: 0 } });
  };

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 'clamp(10px, 1.3vw, 11px)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--cw-text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          Subject Identification
        </div>
        <p style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', lineHeight: 1.5 }}>
          Train the ML classifier by enrolling the resident. The more walks, the more accurate.
        </p>
      </div>

      {modelStatus && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {Object.values(SUBJECTS).map(s => (
            <div key={s.id} style={{
              padding: '12px 14px',
              borderRadius: 'var(--cw-radius-sm)',
              background: `${s.accent}10`,
              border: `1px solid ${s.accent}30`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{s.emoji}</span>
                <span style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', fontWeight: 600 }}>{s.name}</span>
              </div>
              <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
                {modelStatus.bySubject?.[s.id] ?? 0} samples
              </div>
            </div>
          ))}
          <div style={{
            padding: '12px 14px',
            borderRadius: 'var(--cw-radius-sm)',
            background: modelStatus.mlTrained ? 'rgba(5, 150, 105, 0.1)' : 'var(--cw-bg)',
            border: `1px solid ${modelStatus.mlTrained ? 'rgba(5, 150, 105, 0.3)' : 'var(--cw-border)'}`,
          }}>
            <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', fontWeight: 600, marginBottom: 4 }}>
              {modelStatus.mlTrained ? '✓ Active' : '⏳ Training'}
            </div>
            <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
              {modelStatus.samples} total
            </div>
          </div>
        </div>
      )}

      {enrolling ? (
        <div style={{
          padding: '16px',
          borderRadius: 'var(--cw-radius-sm)',
          background: `${SUBJECTS[enrolling].accent}12`,
          border: `1px solid ${SUBJECTS[enrolling].accent}30`,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 28 }}>
              {SUBJECTS[enrolling].emoji}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 600, marginBottom: 4 }}>
                Enrolling {SUBJECTS[enrolling].name}
              </div>
              <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
                Move naturally around the room — {countdown}s remaining
              </div>
            </div>
          </div>
          <div style={{ height: 4, background: 'var(--cw-bg)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{
              height: '100%',
              borderRadius: 2,
              background: SUBJECTS[enrolling].accent,
              width: `${((60 - countdown) / 60) * 100}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <button onClick={finishEnroll} style={{
            padding: '8px 16px',
            borderRadius: 20,
            fontSize: 'clamp(12px, 1.5vw, 13px)',
            fontFamily: 'inherit',
            fontWeight: 500,
            cursor: 'pointer',
            background: 'rgba(0,0,0,0.06)',
            border: 'none',
            color: 'var(--cw-text)',
            transition: 'all 0.2s ease',
          }}>
            Finish early
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
          {Object.values(SUBJECTS).map(s => (
            <button key={s.id} onClick={() => startEnroll(s.id)} style={{
              padding: '12px',
              borderRadius: 'var(--cw-radius-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'clamp(12px, 1.5vw, 13px)',
              fontWeight: 600,
              background: `${s.accent}12`,
              border: `1.5px solid ${s.accent}40`,
              color: s.accent,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}>
              <span style={{ fontSize: 18 }}>{s.emoji}</span>
              Enroll
            </button>
          ))}
        </div>
      )}

      {modelStatus?.samples > 0 && !enrolling && (
        <button onClick={clearModel} style={{
          fontSize: 'clamp(11px, 1.2vw, 12px)',
          color: 'var(--cw-text-secondary)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: '4px 0',
        }}>
          Clear training data
        </button>
      )}
    </Card>
  );
}

// ── Tab Components ──────────────────────────────────────────────

function OverviewTab({ vitals, subjectId, nodesOn, S, history }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Resident card */}
      <Card style={{
        border: `2px solid ${S.accent}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            fontSize: 32,
            lineHeight: 1,
          }}>
            {S.emoji}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'clamp(15px, 2vw, 18px)', fontWeight: 600, marginBottom: 4 }}>
              {S.name}
            </div>
            <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
              {S.sub}
            </div>
          </div>
          <div style={{
            padding: '12px 16px',
            borderRadius: 'var(--cw-radius-sm)',
            background: `${S.accent}08`,
            border: `1px solid ${S.accent}20`,
          }}>
            <StatusIndicator status={vitals.presence ? 'good' : 'neutral'} label={vitals.presence ? 'Active' : 'Standby'} />
          </div>
        </div>
      </Card>

      {/* Key vitals summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {S.vitals.map(v => {
          const current = vitals[v.key === 'br' ? 'breathing_rate' : v.key === 'hr' ? 'heart_rate' : 'motion_level'];
          const isNormal = current != null && current >= v.refLow && current <= v.refHigh;
          const status = current == null ? 'neutral' : isNormal ? 'good' : current > v.refHigh ? 'danger' : 'warning';
          const statusColor = status === 'good' ? 'var(--cw-success)' : status === 'danger' ? 'var(--cw-danger)' : status === 'warning' ? 'var(--cw-warning)' : 'var(--cw-text-tertiary)';
          return (
            <Card key={v.key}>
              <div style={{
                fontSize: 'clamp(10px, 1.3vw, 11px)',
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: 'var(--cw-text-tertiary)',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}>
                {v.label}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{
                    fontSize: 'clamp(36px, 5vw, 52px)',
                    fontWeight: 200,
                    letterSpacing: '-0.03em',
                    color: 'var(--cw-text)',
                    lineHeight: 1,
                    marginBottom: 6,
                  }}>
                    {current != null ? (current % 1 === 0 ? Math.round(current) : current.toFixed(1)) : '—'}
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-tertiary)' }}>
                    {v.unit}
                  </div>
                </div>
                <ArcRing value={current} min={v.min} max={v.max} color={v.color} size={100} />
              </div>
              <div style={{
                paddingTop: 14,
                borderTop: '1px solid var(--cw-border)',
              }}>
                <StatusIndicator status={status} label={v.key === 'br' ? S.brStatus(current) : v.key === 'hr' ? S.hrStatus(current) : S.moStatus(current)} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sparkline chart */}
      {history.length > 5 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{
              fontSize: 'clamp(10px, 1.3vw, 11px)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--cw-text-tertiary)',
              textTransform: 'uppercase',
            }}>
              Last {history.length} readings
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              {[[S.vitals[0].color, 'Breathing'], [S.vitals[1].color, 'Heart Rate']].map(([c, l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 16, height: 2, borderRadius: 1, background: c }} />
                  <span style={{ fontSize: 'clamp(10px, 1.2vw, 11px)', color: 'var(--cw-text-tertiary)' }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 100, marginLeft: -8, marginRight: -8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="gbrO" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={S.vitals[0].color} stopOpacity={0.15} /><stop offset="100%" stopColor={S.vitals[0].color} stopOpacity={0} /></linearGradient>
                  <linearGradient id="ghrO" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={S.vitals[1].color} stopOpacity={0.15} /><stop offset="100%" stopColor={S.vitals[1].color} stopOpacity={0} /></linearGradient>
                </defs>
                <YAxis yAxisId="br" domain={['dataMin - 2', 'dataMax + 2']} hide />
                <YAxis yAxisId="hr" orientation="right" domain={['dataMin - 5', 'dataMax + 5']} hide />
                <Area yAxisId="br" type="monotone" dataKey="br" stroke={S.vitals[0].color} fill="url(#gbrO)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Area yAxisId="hr" type="monotone" dataKey="hr" stroke={S.vitals[1].color} fill="url(#ghrO)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Tooltip contentStyle={{ background: 'rgba(255,255,255,.97)', border: '1px solid var(--cw-border)', borderRadius: 8, fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }} formatter={(v, n) => [v?.toFixed(1), n === 'br' ? 'Breathing' : 'Heart Rate']} labelFormatter={() => ''} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Sensor nodes status */}
      <Card>
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 'clamp(10px, 1.3vw, 11px)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--cw-text-tertiary)',
            textTransform: 'uppercase',
          }}>
            Sensor Nodes
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {BOARDS.map(b => (
            <div key={b.id} style={{
              padding: '12px 14px',
              borderRadius: 'var(--cw-radius-sm)',
              background: nodesOn[b.id] ? 'rgba(5, 150, 105, 0.06)' : 'var(--cw-bg)',
              border: `1px solid ${nodesOn[b.id] ? 'rgba(5, 150, 105, 0.3)' : 'var(--cw-border)'}`,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 8,
              }}>
                <div style={{
                  width: 6, height: 6,
                  borderRadius: '50%',
                  background: nodesOn[b.id] ? '#059669' : 'var(--cw-text-tertiary)',
                }} />
                <span style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', fontWeight: 600 }}>
                  {b.label}
                </span>
              </div>
              <div style={{
                fontSize: 'clamp(11px, 1.2vw, 12px)',
                color: 'var(--cw-text-secondary)',
                fontFamily: 'monospace',
              }}>
                {b.ip}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function VitalsTab({ S, vitals, history }) {
  const fmt = v => v != null ? (v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1)) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card style={{
        background: `${S.accent}08`,
        border: `1px solid ${S.accent}20`,
        padding: '16px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 28 }}>{S.emoji}</div>
          <div>
            <div style={{ fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 600, marginBottom: 2 }}>
              {S.name} · {S.sub}
            </div>
            <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
              Normal ranges: Breathing {S.vitals[0].refStr} · Heart Rate {S.vitals[1].refStr} per minute
            </div>
          </div>
        </div>
      </Card>

      {S.vitals.map((v, i) => {
        const current = vitals[v.key === 'br' ? 'breathing_rate' : v.key === 'hr' ? 'heart_rate' : 'motion_level'];
        const isNormal = current != null && current >= v.refLow && current <= v.refHigh;

        return (
          <Card key={v.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{
                  fontSize: 'clamp(10px, 1.3vw, 11px)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  color: 'var(--cw-text-tertiary)',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}>
                  {v.label}
                </div>
                <div style={{
                  fontSize: 'clamp(32px, 6vw, 48px)',
                  fontWeight: 300,
                  letterSpacing: '-0.02em',
                  color: 'var(--cw-text)',
                  marginBottom: 8,
                }}>
                  {fmt(current)}
                </div>
                <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
                  {v.key === 'br' ? S.brStatus(current) : v.key === 'hr' ? S.hrStatus(current) : S.moStatus(current)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 'clamp(11px, 1.2vw, 12px)',
                  color: 'var(--cw-text-secondary)',
                  marginBottom: 4,
                }}>
                  Normal for {S.name}
                </div>
                <div style={{
                  fontSize: 'clamp(13px, 1.5vw, 14px)',
                  fontWeight: 500,
                  fontFamily: 'monospace',
                }}>
                  {v.refStr}
                </div>
              </div>
            </div>

            <div style={{ height: 120, marginLeft: -20, marginRight: -20 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`gv${v.key}${S.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={v.color} stopOpacity={0.15} />
                      <stop offset="100%" stopColor={v.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey={v.key} stroke={v.color} fill={`url(#gv${v.key}${S.id})`} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  <Tooltip contentStyle={{
                    background: 'var(--cw-surface)',
                    border: '1px solid var(--cw-border)',
                    borderRadius: 8,
                    fontSize: 12,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  }} formatter={val => [val?.toFixed(1), v.label]} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {current != null && (
              <div style={{ marginTop: 12, marginBottom: 0 }}>
                <StatusIndicator
                  status={isNormal ? 'good' : current > v.refHigh ? 'danger' : 'warning'}
                  label={isNormal ? `Within normal range for ${S.name}` : `Outside normal range for ${S.name}`}
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function AlertsTab({ alerts, onAck }) {
  if (alerts.length === 0) {
    return (
      <Card style={{ textAlign: 'center', padding: '60px 24px' }}>
        <div style={{ fontSize: 'clamp(32px, 6vw, 48px)', marginBottom: 16, lineHeight: 1 }}>✓</div>
        <div style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', fontWeight: 600, marginBottom: 8 }}>
          All Clear
        </div>
        <div style={{ fontSize: 'clamp(12px, 1.5vw, 14px)', color: 'var(--cw-text-secondary)' }}>
          No alerts at this time
        </div>
      </Card>
    );
  }

  // Group alerts by date and deduplicate
  const grouped = {};
  alerts.forEach(a => {
    const date = new Date(a.created_at).toLocaleDateString();
    if (!grouped[date]) grouped[date] = {};
    const key = `${a.alert_type}_${a.message}`;
    if (!grouped[date][key]) {
      grouped[date][key] = { ...a, count: 1 };
    } else {
      grouped[date][key].count += 1;
    }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {Object.entries(grouped).reverse().map(([date, items]) => (
        <div key={date}>
          <div style={{
            fontSize: 'clamp(11px, 1.2vw, 12px)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--cw-text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            {date === new Date().toLocaleDateString() ? 'Today' : date}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.values(items).map((a, i) => {
              const variantMap = {
                HIGH: { variant: 'danger', icon: '🔴' },
                MEDIUM: { variant: 'warning', icon: '🟡' },
                LOW: { variant: 'default', icon: '🔵' },
              };
              const { variant, icon } = variantMap[a.urgency] || variantMap.LOW;
              return (
                <Card key={`${a.id}_${i}`} style={{
                  borderLeft: `3px solid ${
                    a.urgency === 'HIGH' ? '#DC2626' :
                    a.urgency === 'MEDIUM' ? '#D97706' :
                    '#9CA3AF'
                  }`,
                  opacity: a.acknowledged ? 0.5 : 1,
                  transition: 'opacity 0.3s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ fontSize: 20, lineHeight: 1, marginTop: 2, flexShrink: 0 }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                      }}>
                        <span style={{
                          fontSize: 'clamp(10px, 1.3vw, 11px)',
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          color: a.urgency === 'HIGH' ? '#DC2626' : a.urgency === 'MEDIUM' ? '#D97706' : 'var(--cw-text-secondary)',
                          textTransform: 'uppercase',
                        }}>
                          {a.alert_type?.replace(/_/g, ' ')}
                        </span>
                        {a.count > 1 && (
                          <Badge variant={variant}>{a.count}x</Badge>
                        )}
                      </div>
                      <div style={{
                        fontSize: 'clamp(13px, 1.6vw, 14px)',
                        color: 'var(--cw-text)',
                        lineHeight: 1.5,
                        marginBottom: 8,
                      }}>
                        {a.message}
                      </div>
                      <div style={{
                        fontSize: 'clamp(11px, 1.2vw, 12px)',
                        color: 'var(--cw-text-secondary)',
                      }}>
                        {new Date(a.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    {!a.acknowledged && (
                      <button onClick={() => onAck(a.id)} style={{
                        padding: '6px 14px',
                        fontSize: 'clamp(11px, 1.2vw, 12px)',
                        borderRadius: 20,
                        fontFamily: 'inherit',
                        fontWeight: 500,
                        background: 'var(--cw-bg)',
                        border: 'none',
                        color: 'var(--cw-text)',
                        cursor: 'pointer',
                        flexShrink: 0,
                        transition: 'all 0.2s ease',
                      }}>
                        Dismiss
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function NodesTab({ nodesOn }) {
  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 'clamp(10px, 1.3vw, 11px)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--cw-text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}>
          Sensor Network
        </div>
        <p style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
          3 ESP32-S3 nodes · WiFi CSI · UDP → 192.168.0.168:5005
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {BOARDS.map((b, i) => (
          <div key={b.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 0',
            borderTop: i > 0 ? '1px solid var(--cw-border)' : 'none',
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--cw-radius-sm)',
              flexShrink: 0,
              background: nodesOn[b.id] ? 'rgba(37, 99, 235, 0.08)' : 'var(--cw-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}>
              📡
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 600, marginBottom: 2 }}>
                {b.label}
              </div>
              <div style={{
                fontSize: 'clamp(11px, 1.2vw, 12px)',
                color: 'var(--cw-text-secondary)',
                fontFamily: 'monospace',
              }}>
                {b.mac} · {b.ip}
              </div>
            </div>
            <StatusIndicator
              status={nodesOn[b.id] ? 'good' : 'neutral'}
              label={nodesOn[b.id] ? 'Active' : 'Offline'}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function IdentifyTab({ subjectId }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 'clamp(10px, 1.3vw, 11px)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--cw-text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Live Detection
          </div>
        </div>
        {subjectId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 48 }}>
              {subjectId.detected ? SUBJECTS[subjectId.detected]?.emoji ?? '❓' : '🔍'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'clamp(18px, 3vw, 24px)', fontWeight: 600, marginBottom: 6 }}>
                {subjectId.detected ? SUBJECTS[subjectId.detected]?.name : 'Waiting for movement'}
              </div>
              <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', marginBottom: 12 }}>
                {subjectId.detected
                  ? `${subjectId.confidence}% confidence · ${subjectId.method}`
                  : 'Stand up or move to be detected'}
              </div>
              {subjectId.detected && (
                <div style={{
                  height: 4,
                  background: 'var(--cw-bg)',
                  borderRadius: 2,
                  overflow: 'hidden',
                  maxWidth: 200,
                }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 2,
                    background: SUBJECTS[subjectId.detected]?.accent ?? '#2563EB',
                    width: `${subjectId.confidence}%`,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
              <div style={{ marginBottom: 4 }}>ML: {subjectId.ml_trained ? '✓ Active' : '⏳ Heuristics'}</div>
              <div>{subjectId.ml_samples} samples</div>
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--cw-text-secondary)', fontSize: 'clamp(12px, 1.5vw, 13px)' }}>
            Waiting for signal…
          </div>
        )}
      </Card>

      <Card style={{
        background: 'rgba(37, 99, 235, 0.06)',
        border: '1px solid rgba(37, 99, 235, 0.2)',
        padding: '16px 20px',
      }}>
        <div style={{
          fontSize: 'clamp(12px, 1.5vw, 13px)',
          color: 'var(--cw-text-secondary)',
          lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--cw-text)', fontWeight: 600 }}>How it works</strong>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <strong style={{ color: 'var(--cw-text)', fontWeight: 600 }}>Heuristics</strong> — Breathing rate, gait frequency, and signal patterns work immediately.
            </div>
            <div>
              <strong style={{ color: 'var(--cw-text)', fontWeight: 600 }}>Machine Learning</strong> — After enrollment, k-NN learns your personal signatures.
            </div>
            <div>
              <strong style={{ color: 'var(--cw-text)', fontWeight: 600 }}>Fusion</strong> — Combined methods increase accuracy and confidence.
            </div>
          </div>
        </div>
      </Card>

      <EnrollmentPanel onEnrolled={() => {}} />
    </div>
  );
}

function RoomTab({ vitals, subjectId }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{
          fontSize: 'clamp(10px, 1.3vw, 11px)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'var(--cw-text-tertiary)',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}>
          Live Room View
        </div>
        <p style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', marginBottom: 16 }}>
          Heatmap, movement trails, and vitals overlay
        </p>
      </div>
      <RoomView frame={vitals.raw ?? vitals} subjectId={subjectId} />

      <Card style={{
        background: `${SUBJECTS.elio.accent}08`,
        border: `1px solid ${SUBJECTS.elio.accent}20`,
        padding: '14px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{SUBJECTS.elio.emoji}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'clamp(13px, 1.6vw, 14px)', fontWeight: 600, marginBottom: 2 }}>
              {SUBJECTS.elio.name}
            </div>
            <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
              BR {vitals.breathing_rate?.toFixed(1) ?? '—'} · HR {vitals.heart_rate?.toFixed(0) ?? '—'}
            </div>
          </div>
          {subjectId?.detected === 'elio' && (
            <div style={{
              fontSize: 'clamp(10px, 1.3vw, 11px)',
              fontWeight: 700,
              color: SUBJECTS.elio.accent,
              background: `${SUBJECTS.elio.accent}18`,
              padding: '3px 8px',
              borderRadius: 8,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              flexShrink: 0,
            }}>
              {subjectId.confidence}%
            </div>
          )}
        </div>
      </Card>

      <div style={{
        padding: '14px 16px',
        borderRadius: 'var(--cw-radius)',
        background: 'var(--cw-bg)',
        border: '1px solid var(--cw-border)',
        fontSize: 'clamp(12px, 1.5vw, 13px)',
        color: 'var(--cw-text-secondary)',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--cw-text)' }}>Note</strong> — Position is estimated from multi-node signal trilateration (~0.5–1.5m accuracy). Trails show the last 6 seconds of movement.
      </div>
    </div>
  );
}

// ── Validation Tab ──────────────────────────────────────────────
function ValidateTab() {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [stats, setStats] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Oura direct connect state
  const [ouraToken, setOuraToken] = useState('');
  const [ouraConnected, setOuraConnected] = useState(false);
  const [ouraEmail, setOuraEmail] = useState('');
  const [ouraSyncing, setOuraSyncing] = useState(false);
  const [ouraSyncResult, setOuraSyncResult] = useState(null);
  const [ouraShowToken, setOuraShowToken] = useState(false);
  const [ouraDays, setOuraDays] = useState(7);

  // Check Oura connection on mount
  useEffect(() => {
    fetch(`${API}/api/wearables/oura/status`)
      .then(r => r.json())
      .then(d => setOuraConnected(d.connected))
      .catch(() => {});
  }, []);

  const connectOura = async () => {
    if (!ouraToken.trim()) return;
    setOuraSyncing(true);
    try {
      const res = await fetch(`${API}/api/wearables/oura/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ouraToken.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setOuraConnected(true);
        setOuraEmail(data.email || '');
        setOuraShowToken(false);
      } else {
        setOuraSyncResult({ error: data.error });
      }
    } catch (err) {
      setOuraSyncResult({ error: err.message });
    } finally {
      setOuraSyncing(false);
    }
  };

  const syncOura = async () => {
    setOuraSyncing(true);
    setOuraSyncResult(null);
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - ouraDays * 86400000).toISOString().slice(0, 10);
    try {
      const res = await fetch(`${API}/api/wearables/oura/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: ouraToken.trim() || undefined,
          start_date: start,
          end_date: end,
        }),
      });
      const data = await res.json();
      setOuraSyncResult(data);
      if (data.ok && data.count > 0) {
        // Refresh comparison data
        setUploadResult({ ok: true, source: 'oura_ring', count: data.count, dateRange: data.dateRange });
      }
    } catch (err) {
      setOuraSyncResult({ error: err.message });
    } finally {
      setOuraSyncing(false);
    }
  };

  // Load comparison summary on mount
  useEffect(() => {
    fetch(`${API}/api/wearables/comparison`)
      .then(r => r.json())
      .then(setComparison)
      .catch(() => {});
  }, [uploadResult]);

  // Load chart data when comparison shows data exists
  useEffect(() => {
    if (!comparison?.hasData) return;

    // Use the overlapping window between wearable and CareWatch data
    const wearableEarliest = comparison.wearables[0]?.earliest;
    const carewatchEarliest = comparison.carewatch?.earliest;
    const to = comparison.wearables[0]?.latest;
    if (!wearableEarliest || !to) return;
    const from = carewatchEarliest
      ? new Date(Math.max(new Date(wearableEarliest), new Date(carewatchEarliest))).toISOString()
      : wearableEarliest;

    // Use server-side bucketed endpoint — avoids row-limit issues with dense data
    const days = (new Date(to) - new Date(from)) / 86400000;
    const bucket = days > 3 ? 'hour' : 'hour';

    fetch(`${API}/api/wearables/comparison-chart?from=${from}&to=${to}&bucket=${bucket}`)
      .then(r => r.json())
      .then(rows => {
        const data = rows.map(r => ({
          ...r,
          time: days > 2
            ? new Date(r.bucket).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
            : new Date(r.bucket).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false }),
          fullTime: r.bucket,
        }));
        setChartData(data);

      // Compute accuracy stats for overlapping points
      const paired = data.filter(d => d.cwHR != null && (d.appleHR != null || d.ouraHR != null));
      if (paired.length > 0) {
        let totalError = 0;
        let totalAbsError = 0;
        let count = 0;
        const errors = [];

        for (const p of paired) {
          const ref = p.appleHR ?? p.ouraHR;
          const err = p.cwHR - ref;
          errors.push(err);
          totalError += err;
          totalAbsError += Math.abs(err);
          count++;
        }

        const meanError = totalError / count;
        const mae = totalAbsError / count;
        const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / count);
        const correlation = computeCorrelation(
          paired.map(p => p.appleHR ?? p.ouraHR),
          paired.map(p => p.cwHR)
        );

        setStats({ meanError, mae, rmse, correlation, pairedCount: count });
      }
      })
      .catch(err => console.error('Chart data error:', err));
  }, [comparison]);

  function computeCorrelation(x, y) {
    const n = x.length;
    if (n < 3) return null;
    const mx = x.reduce((a, v) => a + v, 0) / n;
    const my = y.reduce((a, v) => a + v, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - mx) * (y[i] - my);
      dx += (x[i] - mx) ** 2;
      dy += (y[i] - my) ** 2;
    }
    return dx && dy ? +(num / Math.sqrt(dx * dy)).toFixed(3) : null;
  }

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);

    // Auto-detect source from filename
    const name = file.name.toLowerCase();
    if (name.includes('export') && name.endsWith('.xml')) {
      formData.append('source', 'apple_health');
    } else if (name.endsWith('.json')) {
      formData.append('source', 'oura');
    } else if (name.endsWith('.csv')) {
      formData.append('source', 'oura');
    }

    try {
      const res = await fetch(`${API}/api/wearables/import`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setUploadResult(data);
    } catch (err) {
      setUploadResult({ error: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  const clearData = async (source) => {
    await fetch(`${API}/api/wearables/readings${source ? `?source=${source}` : ''}`, { method: 'DELETE' });
    setComparison(null);
    setChartData([]);
    setStats(null);
    setUploadResult({ ok: true, cleared: true });
    // Re-fetch
    fetch(`${API}/api/wearables/comparison`).then(r => r.json()).then(setComparison).catch(() => {});
  };

  const hasApple = comparison?.wearables?.some(w => w.source === 'apple_watch');
  const hasOura = comparison?.wearables?.some(w => w.source === 'oura_ring');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <Card style={{
        background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.06), rgba(139, 92, 246, 0.06))',
        border: '1px solid rgba(37, 99, 235, 0.2)',
      }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 'clamp(10px, 1.3vw, 11px)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--cw-text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}>
            Accuracy Validation
          </div>
          <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: 600 }}>
            Compare CareWatch against wearable ground truth
          </div>
        </div>
        <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6 }}>
          Upload heart rate data from your Apple Watch or Oura Ring to validate WiFi CSI sensing accuracy. CareWatch readings will be overlaid against your wearable data.
        </div>
      </Card>

      {/* Oura Direct Connect */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ fontSize: 32, lineHeight: 1 }}>💍</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: 600 }}>
                Oura Ring
              </div>
              {ouraConnected && (
                <Badge variant="success">Connected{ouraEmail ? ` · ${ouraEmail}` : ''}</Badge>
              )}
            </div>

            {!ouraConnected ? (
              <div>
                <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  Connect your Oura Ring to pull heart rate data directly via the API. Get your Personal Access Token from{' '}
                  <a href="https://cloud.ouraring.com/personal-access-tokens" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cw-accent)', fontWeight: 500 }}>
                    cloud.ouraring.com
                  </a>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={ouraShowToken ? 'text' : 'password'}
                    placeholder="Paste your Personal Access Token"
                    value={ouraToken}
                    onChange={e => setOuraToken(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && connectOura()}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      borderRadius: 'var(--cw-radius-sm)',
                      border: '1px solid var(--cw-border)',
                      fontFamily: 'monospace',
                      fontSize: 'clamp(12px, 1.5vw, 13px)',
                      background: 'var(--cw-bg)',
                      color: 'var(--cw-text)',
                      outline: 'none',
                    }}
                  />
                  <button onClick={() => setOuraShowToken(p => !p)} style={{
                    padding: '10px 12px', borderRadius: 'var(--cw-radius-sm)', border: '1px solid var(--cw-border)',
                    background: 'var(--cw-bg)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit',
                  }}>
                    {ouraShowToken ? '🙈' : '👁'}
                  </button>
                  <button onClick={connectOura} disabled={!ouraToken.trim() || ouraSyncing} style={{
                    padding: '10px 20px', borderRadius: 'var(--cw-radius-sm)', border: 'none',
                    background: ouraToken.trim() ? 'var(--cw-accent)' : 'var(--cw-border)',
                    color: ouraToken.trim() ? '#fff' : 'var(--cw-text-tertiary)',
                    fontFamily: 'inherit', fontSize: 'clamp(12px, 1.5vw, 13px)', fontWeight: 600,
                    cursor: ouraToken.trim() ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                  }}>
                    {ouraSyncing ? '…' : 'Connect'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', marginBottom: 12 }}>
                  Sync heart rate data directly from the Oura API.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <select
                    value={ouraDays}
                    onChange={e => setOuraDays(Number(e.target.value))}
                    style={{
                      padding: '10px 14px', borderRadius: 'var(--cw-radius-sm)',
                      border: '1px solid var(--cw-border)', background: 'var(--cw-bg)',
                      fontFamily: 'inherit', fontSize: 'clamp(12px, 1.5vw, 13px)',
                      color: 'var(--cw-text)', cursor: 'pointer',
                    }}
                  >
                    <option value={1}>Last 24 hours</option>
                    <option value={3}>Last 3 days</option>
                    <option value={7}>Last 7 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={30}>Last 30 days</option>
                  </select>
                  <button onClick={syncOura} disabled={ouraSyncing} style={{
                    padding: '10px 20px', borderRadius: 'var(--cw-radius-sm)', border: 'none',
                    background: 'var(--cw-accent)', color: '#fff',
                    fontFamily: 'inherit', fontSize: 'clamp(12px, 1.5vw, 13px)', fontWeight: 600,
                    cursor: ouraSyncing ? 'default' : 'pointer', opacity: ouraSyncing ? 0.6 : 1,
                    transition: 'all 0.2s ease',
                  }}>
                    {ouraSyncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                </div>
              </div>
            )}

            {ouraSyncResult?.error && (
              <div style={{
                marginTop: 10, padding: '10px 14px', borderRadius: 'var(--cw-radius-sm)',
                background: 'rgba(220, 38, 38, 0.06)', border: '1px solid rgba(220, 38, 38, 0.2)',
                fontSize: 'clamp(12px, 1.5vw, 13px)', color: '#DC2626',
              }}>
                {ouraSyncResult.error}
                {ouraSyncResult.hint && <div style={{ marginTop: 4, color: 'var(--cw-text-secondary)' }}>{ouraSyncResult.hint}</div>}
              </div>
            )}
            {ouraSyncResult?.ok && ouraSyncResult?.count > 0 && (
              <div style={{
                marginTop: 10, padding: '10px 14px', borderRadius: 'var(--cw-radius-sm)',
                background: 'rgba(5, 150, 105, 0.06)', border: '1px solid rgba(5, 150, 105, 0.2)',
                fontSize: 'clamp(12px, 1.5vw, 13px)', color: '#059669',
              }}>
                Synced {ouraSyncResult.count.toLocaleString()} readings ({ouraSyncResult.heartRate} HR + {ouraSyncResult.restingHR} resting HR)
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Apple Watch upload + general file drop */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 32, lineHeight: 1 }}>⌚</div>
          <div>
            <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: 600, marginBottom: 4 }}>
              Apple Watch
            </div>
            <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6 }}>
              Export from the Health app on your iPhone: Profile → Export All Health Data. Unzip and drop the <code style={{ background: 'var(--cw-bg)', padding: '2px 6px', borderRadius: 4, fontSize: '0.9em' }}>export.xml</code> below.
            </div>
          </div>
        </div>
      </Card>

      {/* Upload zone */}
      <Card
        style={{
          border: dragOver ? '2px dashed var(--cw-accent)' : '2px dashed var(--cw-border)',
          background: dragOver ? 'rgba(37, 99, 235, 0.04)' : 'var(--cw-surface)',
          textAlign: 'center',
          padding: '40px 24px',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.json,.csv"
          style={{ display: 'none' }}
          onChange={(e) => handleUpload(e.target.files[0])}
        />
        {uploading ? (
          <div>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 600 }}>
              Parsing and importing…
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
            <div style={{ fontSize: 'clamp(13px, 1.6vw, 15px)', fontWeight: 600, marginBottom: 8 }}>
              Drop your export file here
            </div>
            <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
              Apple Health XML · Oura JSON · Oura CSV
            </div>
          </div>
        )}
      </Card>

      {/* Upload result */}
      {uploadResult && (
        <Card style={{
          background: uploadResult.error
            ? 'rgba(220, 38, 38, 0.06)'
            : uploadResult.cleared
            ? 'var(--cw-surface)'
            : 'rgba(5, 150, 105, 0.06)',
          border: `1px solid ${uploadResult.error ? 'rgba(220, 38, 38, 0.2)' : uploadResult.cleared ? 'var(--cw-border)' : 'rgba(5, 150, 105, 0.2)'}`,
          padding: '16px 20px',
        }}>
          {uploadResult.error ? (
            <div style={{ color: '#DC2626', fontSize: 'clamp(12px, 1.5vw, 13px)' }}>
              {uploadResult.error}
              {uploadResult.hint && <div style={{ marginTop: 6, color: 'var(--cw-text-secondary)' }}>{uploadResult.hint}</div>}
            </div>
          ) : uploadResult.cleared ? (
            <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)' }}>
              Data cleared successfully.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>✓</div>
              <div>
                <div style={{ fontSize: 'clamp(13px, 1.6vw, 14px)', fontWeight: 600, color: '#059669' }}>
                  Imported {uploadResult.count?.toLocaleString()} readings
                </div>
                <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)', marginTop: 4 }}>
                  {uploadResult.source === 'apple_watch' ? 'Apple Watch' : 'Oura Ring'} · {uploadResult.dateRange?.from?.slice(0, 10)} to {uploadResult.dateRange?.to?.slice(0, 10)}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Data sources summary */}
      {comparison && comparison.wearables?.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {comparison.wearables.map((w, i) => (
            <Card key={i} style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 22 }}>
                  {w.source === 'apple_watch' ? '⌚' : '💍'}
                </span>
                <div>
                  <div style={{ fontSize: 'clamp(13px, 1.6vw, 14px)', fontWeight: 600 }}>
                    {w.source === 'apple_watch' ? 'Apple Watch' : 'Oura Ring'}
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
                    {w.count.toLocaleString()} readings
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6 }}>
                Avg HR: {w.avg_value?.toFixed(1)} bpm<br />
                Range: {w.min_value?.toFixed(0)} – {w.max_value?.toFixed(0)} bpm<br />
                {w.earliest?.slice(0, 10)} to {w.latest?.slice(0, 10)}
              </div>
              <button onClick={(e) => { e.stopPropagation(); clearData(w.source); }} style={{
                marginTop: 10,
                fontSize: 'clamp(11px, 1.2vw, 12px)',
                color: 'var(--cw-text-secondary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                padding: '4px 0',
              }}>
                Clear data
              </button>
            </Card>
          ))}

          {comparison.carewatch && (
            <Card style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 22 }}>📡</span>
                <div>
                  <div style={{ fontSize: 'clamp(13px, 1.6vw, 14px)', fontWeight: 600 }}>
                    CareWatch CSI
                  </div>
                  <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)' }}>
                    {(comparison.carewatch.count ?? 0).toLocaleString()} readings
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6 }}>
                Avg HR: {comparison.carewatch.avg_hr?.toFixed(1) ?? '—'} bpm<br />
                Range: {comparison.carewatch.min_hr?.toFixed(0) ?? '—'} – {comparison.carewatch.max_hr?.toFixed(0) ?? '—'} bpm
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Accuracy stats */}
      {stats && (
        <Card>
          <div style={{
            fontSize: 'clamp(10px, 1.3vw, 11px)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--cw-text-tertiary)',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}>
            Accuracy Metrics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {[
              { label: 'Mean Absolute Error', value: `${stats.mae.toFixed(1)} bpm`, desc: 'Avg distance from wearable' },
              { label: 'RMSE', value: `${stats.rmse.toFixed(1)} bpm`, desc: 'Root mean square error' },
              { label: 'Correlation', value: stats.correlation != null ? `r = ${stats.correlation}` : '—', desc: 'Pearson correlation' },
              { label: 'Paired Readings', value: stats.pairedCount.toLocaleString(), desc: 'Overlapping data points' },
            ].map(s => (
              <div key={s.label} style={{
                padding: '14px',
                borderRadius: 'var(--cw-radius-sm)',
                background: 'var(--cw-bg)',
              }}>
                <div style={{
                  fontSize: 'clamp(22px, 4vw, 32px)',
                  fontWeight: 300,
                  letterSpacing: '-0.02em',
                  marginBottom: 4,
                  color: 'var(--cw-text)',
                }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', fontWeight: 600, marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 'clamp(10px, 1.1vw, 11px)', color: 'var(--cw-text-tertiary)' }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Comparison chart */}
      {chartData.length > 5 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{
              fontSize: 'clamp(10px, 1.3vw, 11px)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--cw-text-tertiary)',
              textTransform: 'uppercase',
            }}>
              Heart Rate Overlay
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                { color: '#2563EB', label: 'CareWatch', dashed: false },
                ...(hasApple ? [{ color: '#34D399', label: 'Apple Watch', dashed: false }] : []),
                ...(hasOura ? [{ color: '#8B5CF6', label: 'Oura Ring', dashed: true }] : []),
              ].map(({ color, label, dashed }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="20" height="6">
                    <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '6 3' : 'none'} strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 'clamp(10px, 1.2vw, 11px)', color: 'var(--cw-text-tertiary)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: 260, marginLeft: -10, marginRight: -10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cw-border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--cw-border)' }}
                  interval="preserveStartEnd"
                  label={{ value: 'Time', position: 'insideBottom', offset: -10, fontSize: 10, fill: 'var(--cw-text-tertiary)' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }}
                  tickLine={false}
                  axisLine={false}
                  domain={['dataMin - 5', 'dataMax + 5']}
                  width={36}
                  label={{ value: 'bpm', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: 'var(--cw-text-tertiary)' }}
                />
                <Line type="monotone" dataKey="cwHR" stroke="#2563EB" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
                {hasApple && <Line type="monotone" dataKey="appleHR" stroke="#34D399" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                {hasOura && <Line type="monotone" dataKey="ouraHR" stroke="#8B5CF6" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls strokeDasharray="6 3" />}
                <Tooltip contentStyle={{
                  background: 'rgba(255,255,255,.97)',
                  border: '1px solid var(--cw-border)',
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                }} formatter={(v, n) => {
                  const labels = { cwHR: 'CareWatch', appleHR: 'Apple Watch', ouraHR: 'Oura Ring' };
                  return [v ? `${v} bpm` : '—', labels[n] || n];
                }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {(!comparison || comparison.wearables?.length === 0) && !uploadResult && (
        <Card style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 'clamp(32px, 6vw, 48px)', marginBottom: 16, lineHeight: 1 }}>📊</div>
          <div style={{ fontSize: 'clamp(14px, 2vw, 16px)', fontWeight: 600, marginBottom: 8 }}>
            No wearable data imported yet
          </div>
          <div style={{ fontSize: 'clamp(12px, 1.5vw, 13px)', color: 'var(--cw-text-secondary)', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
            Export your heart rate data from Apple Health or Oura Ring and drop the file above to see how CareWatch WiFi sensing compares.
          </div>
        </Card>
      )}

      {/* Privacy note */}
      <div style={{
        padding: '14px 16px',
        borderRadius: 'var(--cw-radius)',
        background: 'var(--cw-bg)',
        border: '1px solid var(--cw-border)',
        fontSize: 'clamp(12px, 1.5vw, 13px)',
        color: 'var(--cw-text-secondary)',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--cw-text)' }}>Privacy</strong> — Your wearable data stays on this device. Tokens are stored only in server memory and never logged or sent to third parties.
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────
// ── Login Screen ──────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cw-bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏥</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>CareWatch</div>
          <div style={{ fontSize: 13, color: 'var(--cw-text-secondary)', marginTop: 4 }}>Sign in to your account</div>
        </div>
        <form onSubmit={submit} style={{ background: 'var(--cw-surface)', border: '1px solid var(--cw-border)', borderRadius: 'var(--cw-radius)', padding: 28 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--cw-text-secondary)' }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              placeholder="admin@care.local"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--cw-border)', borderRadius: 'var(--cw-radius-sm)', fontSize: 14, background: 'var(--cw-bg)', color: 'var(--cw-text)', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--cw-text-secondary)' }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--cw-border)', borderRadius: 'var(--cw-radius-sm)', fontSize: 14, background: 'var(--cw-bg)', color: 'var(--cw-text)', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          {error && <div style={{ padding: '8px 12px', background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 'var(--cw-radius-sm)', color: '#DC2626', fontSize: 13, marginBottom: 16 }}>{error}</div>}
          <button
            type="submit" disabled={loading}
            style={{ width: '100%', padding: '11px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 'var(--cw-radius-sm)', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--cw-text-tertiary)', marginTop: 16 }}>
          Default: admin@care.local / CareWatch2024!
        </p>
      </div>
    </div>
  );
}

export default function App() {
  // ── Auth state ─────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  // ── Service Worker + Push Notifications ────────────────────────
  const [pushEnabled, setPushEnabled] = useState(false);

  // Register service worker (web/PWA) on mount
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW registration failed:', err));
    }
  }, []);

  const enablePush = async () => {
    const ok = await setupNotifications(API_BASE);
    if (ok) setPushEnabled(true);
  };

  const [vitals, setVitals] = useState({
    breathing_rate: null,
    heart_rate: null,
    motion_level: null,
    presence: false,
  });
  const [subjectId, setSubjectId] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [nodesOn, setNodesOn] = useState({ 1: false, 2: false, 3: false });
  const [lastUp, setLastUp] = useState(null);
  const [view, setView] = useState('overview');
  const subject = 'elio'; // Single-subject (human-only) mode

  const onMsg = useCallback(msg => {
    if (msg.type === 'frame') {
      const f = msg.data;
      setVitals({
        breathing_rate: f.breathing_rate,
        heart_rate: f.heart_rate,
        motion_level: f.motion_level,
        presence: f.presence,
        raw: f.raw,
      });
      if (f.raw?.subject_id) setSubjectId(f.raw.subject_id);
      setLastUp(new Date());
      const activeNodes = {};
      (f.raw?.nodes || []).forEach(n => {
        activeNodes[n.node_id] = true;
      });
      setNodesOn(prev => ({
        ...prev,
        ...Object.fromEntries(BOARDS.map(b => [b.id, !!activeNodes[b.id]])),
      }));
      setHistory(p =>
        [
          ...p,
          {
            t: new Date().toLocaleTimeString('en', { hour12: false }),
            br: f.breathing_rate ? +f.breathing_rate.toFixed(1) : null,
            hr: f.heart_rate ? +f.heart_rate.toFixed(0) : null,
            mo: f.motion_level ? +f.motion_level.toFixed(1) : null,
          },
        ].slice(-80)
      );
    }
    if (msg.type === 'alert') setAlerts(p => [msg.data, ...p].slice(0, 50));
    if (msg.type === 'enrollment_started') console.log('Enrollment started:', msg.subject);
    if (msg.type === 'enrollment_finished') console.log('Enrollment finished');
  }, []);

  const wsOn = useWebSocket(WS, onMsg);

  useEffect(() => {
    fetch(`${API}/api/alerts?limit=10`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => Array.isArray(d) && setAlerts(d))
      .catch(() => {});
  }, []);

  const ack = async id => {
    await fetch(`${API}/api/alerts/${id}/acknowledge`, { method: 'POST', credentials: 'include' }).catch(() => {});
    setAlerts(p => p.map(a => (a.id === id ? { ...a, acknowledged: true } : a)));
  };

  const unacked = alerts.filter(a => !a.acknowledged).length;
  const stale = lastUp && Date.now() - lastUp > 10000;
  const S = SUBJECTS[subject];

  // ── Auth gates ────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cw-bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏥</div>
          <div style={{ color: 'var(--cw-text-secondary)', fontSize: 13 }}>Loading CareWatch…</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'vitals', label: 'Vitals' },
    { id: 'trends', label: 'Trends' },
    { id: 'validate', label: 'Validate' },
    { id: 'identify', label: 'Identify' },
    { id: 'room', label: 'Room' },
    { id: 'alerts', label: unacked ? `Alerts (${unacked})` : 'Alerts' },
    { id: 'nodes', label: 'Nodes' },
  ];

  return (
    <>
      <style>{`
        :root {
          --cw-bg: #FAFBFC;
          --cw-surface: #FFFFFF;
          --cw-text: #1A1D21;
          --cw-text-secondary: #6B7280;
          --cw-text-tertiary: #9CA3AF;
          --cw-border: #E5E7EB;
          --cw-accent: #2563EB;
          --cw-success: #059669;
          --cw-warning: #D97706;
          --cw-danger: #DC2626;
          --cw-radius: 16px;
          --cw-radius-sm: 8px;
        }

        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        html, body {
          height: 100%;
        }

        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--cw-bg);
          color: var(--cw-text);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-size: clamp(13px, 1.5vw, 15px);
          line-height: 1.6;
        }

        a {
          color: var(--cw-accent);
          text-decoration: none;
        }

        button {
          transition: all 0.2s ease;
        }

        button:hover {
          opacity: 0.85;
        }

        @keyframes up {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }

        ::-webkit-scrollbar {
          width: 8px;
        }

        ::-webkit-scrollbar-track {
          background: transparent;
        }

        ::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }

        @media (max-width: 767px) {
          body {
            padding-bottom: 70px;
          }

          main {
            padding-bottom: 80px !important;
          }

          .nav-top {
            display: none;
          }

          .nav-bottom {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 70px;
            background: var(--cw-surface);
            border-top: 1px solid var(--cw-border);
            display: flex;
            justify-content: space-around;
            align-items: center;
            z-index: 200;
            padding-bottom: max(10px, env(safe-area-inset-bottom));
          }

          .nav-bottom button {
            flex: 1;
            height: 100%;
            border: none;
            background: none;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 500;
            color: var(--cw-text-secondary);
            transition: all 0.2s ease;
          }

          .nav-bottom button.active {
            color: var(--cw-accent);
          }

          .nav-bottom button span {
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        }

        @media (min-width: 768px) {
          .nav-bottom {
            display: none;
          }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'var(--cw-bg)' }}>
        {/* Top Navigation */}
        <header className="nav-top" style={{
          position: 'sticky',
          top: 0,
          zIndex: 200,
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--cw-border)',
          padding: 'clamp(12px, 2vh, 16px) clamp(16px, 5vw, 32px)',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            maxWidth: 1400,
            margin: '0 auto',
          }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 700,
                background: `linear-gradient(135deg, var(--cw-accent), #60A5FA)`,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                flexShrink: 0,
              }}>
                ◎
              </div>
              <span style={{
                fontSize: 'clamp(16px, 2.5vw, 18px)',
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}>
                CareWatch
              </span>
            </div>

            {/* Tabs */}
            <nav style={{
              display: 'flex',
              gap: 2,
              background: 'var(--cw-bg)',
              borderRadius: 24,
              padding: 3,
            }}>
              {tabs.map(t => (
                <button key={t.id} onClick={() => setView(t.id)} style={{
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 'clamp(12px, 1.5vw, 13px)',
                  fontWeight: 500,
                  padding: '8px 14px',
                  borderRadius: 20,
                  color: view === t.id ? 'var(--cw-text)' : 'var(--cw-text-secondary)',
                  background: view === t.id ? 'var(--cw-surface)' : 'transparent',
                  boxShadow: view === t.id ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                }}>
                  {t.label}
                </button>
              ))}
            </nav>

            {/* Right side */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
              <SubjectBadge subjectId={subjectId} />
              {stale && (
                <span style={{ fontSize: 'clamp(11px, 1.2vw, 12px)', color: 'var(--cw-warning)', fontWeight: 500 }}>
                  ⚠ Signal lost
                </span>
              )}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                background: wsOn ? 'rgba(5, 150, 105, 0.1)' : 'var(--cw-bg)',
                fontSize: 'clamp(11px, 1.2vw, 12px)',
                fontWeight: 500,
              }}>
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: wsOn ? '#059669' : 'var(--cw-text-tertiary)',
                  animation: wsOn ? 'pulse 2s ease-in-out infinite' : 'none',
                }} />
                {wsOn ? 'Live' : 'No Sensor'}
              </div>

              {/* User + Push + Logout */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!pushEnabled && 'Notification' in window && (
                  <button onClick={enablePush} title="Enable push notifications" style={{
                    padding: '5px 10px', borderRadius: 'var(--cw-radius-sm)',
                    border: '1px solid var(--cw-border)', background: 'transparent',
                    color: 'var(--cw-text-secondary)', fontSize: 11, cursor: 'pointer',
                  }}>
                    🔔 Enable Alerts
                  </button>
                )}
                {pushEnabled && <span style={{ fontSize: 11, color: '#059669' }}>🔔 Alerts On</span>}
                <div style={{ fontSize: 11, color: 'var(--cw-text-tertiary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.name}
                </div>
                <button onClick={async () => {
                  await fetch(`${API}/api/auth/logout`, { method: 'POST', credentials: 'include' });
                  setUser(null);
                }} style={{
                  padding: '5px 10px', borderRadius: 'var(--cw-radius-sm)',
                  border: '1px solid var(--cw-border)', background: 'transparent',
                  color: 'var(--cw-text-secondary)', fontSize: 11, cursor: 'pointer',
                }}>
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Connection banner */}
        {!wsOn && (
          <div style={{
            background: 'rgba(217, 119, 6, 0.1)',
            borderBottom: '1px solid rgba(217, 119, 6, 0.2)',
            padding: '10px clamp(16px, 5vw, 32px)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 'clamp(12px, 1.5vw, 13px)',
            color: '#92400E',
          }}>
            <span style={{ fontSize: 16 }}>📡</span>
            <span style={{ fontWeight: 500 }}>No sensor connected — waiting for ESP32 nodes</span>
          </div>
        )}

        {/* Main content */}
        <main style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: 'clamp(20px, 5vw, 40px) clamp(16px, 5vw, 32px)',
        }}>
          {view === 'overview' && (
            <ErrorBoundary label="Overview">
              <OverviewTab vitals={vitals} subjectId={subjectId} nodesOn={nodesOn} S={S} history={history} />
            </ErrorBoundary>
          )}

          {view === 'vitals' && (
            <ErrorBoundary label="Vitals">
              <VitalsTab S={S} vitals={vitals} history={history} />
            </ErrorBoundary>
          )}

          {view === 'trends' && (
            <ErrorBoundary label="Trends">
              <AnalyticsTab residentId={S?.residentId || 'default'} residentName={S?.name || 'Resident'} />
            </ErrorBoundary>
          )}

          {view === 'validate' && (
            <ErrorBoundary label="Validate">
              <ValidateTab />
            </ErrorBoundary>
          )}

          {view === 'alerts' && (
            <ErrorBoundary label="Alerts">
              <AlertsTab alerts={alerts} onAck={ack} />
            </ErrorBoundary>
          )}

          {view === 'identify' && (
            <ErrorBoundary label="Identify">
              <IdentifyTab subjectId={subjectId} />
            </ErrorBoundary>
          )}

          {view === 'nodes' && (
            <ErrorBoundary label="Nodes">
              <NodesTab nodesOn={nodesOn} />
            </ErrorBoundary>
          )}

          {view === 'room' && (
            <ErrorBoundary label="Room">
              <RoomTab vitals={vitals} subjectId={subjectId} />
            </ErrorBoundary>
          )}
        </main>

        {/* Bottom Navigation (Mobile) */}
        <nav className="nav-bottom">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={view === t.id ? 'active' : ''}
            >
              <span>
                {t.id === 'overview'  ? '📊' :
                 t.id === 'vitals'    ? '❤️' :
                 t.id === 'trends'    ? '📈' :
                 t.id === 'validate'  ? '✓' :
                 t.id === 'identify'  ? '👤' :
                 t.id === 'room'      ? '🎥' :
                 t.id === 'alerts'    ? (unacked > 0 ? '🔔' : '🔕') :
                 t.id === 'nodes'     ? '📡' : ''}
              </span>
              <span>{t.label.split('(')[0].trim()}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
