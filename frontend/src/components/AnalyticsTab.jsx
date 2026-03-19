// frontend/src/components/AnalyticsTab.jsx
import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
} from 'recharts';

const API = import.meta.env.VITE_API_URL || '';

const METRICS = [
  { key: 'avg_breathing',   label: 'Breathing Rate', unit: 'br/min', color: '#10B981', refLow: 12, refHigh: 20 },
  { key: 'avg_heart_rate',  label: 'Heart Rate',     unit: 'bpm',    color: '#DC2626', refLow: 60, refHigh: 100 },
  { key: 'avg_motion',      label: 'Motion Level',   unit: '',       color: '#F59E0B', refLow: null, refHigh: null },
];

const sectionLabel = {
  fontSize: 'clamp(10px,1.3vw,11px)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  color: 'var(--cw-text-tertiary)',
  textTransform: 'uppercase',
  marginBottom: 16,
};

const card = {
  background: 'var(--cw-surface)',
  border: '1px solid var(--cw-border)',
  borderRadius: 'var(--cw-radius)',
  padding: '20px 24px',
};

function CustomTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(255,255,255,.97)', border: '1px solid var(--cw-border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--cw-text)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value != null ? `${p.value} ${unit || ''}` : '—'}
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsTab({ residentId, residentName }) {
  const [days, setDays]   = useState(7);
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!residentId) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/api/analytics/resident/${residentId}?days=${days}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        // Format dates for display
        setData(d.map(r => ({
          ...r,
          label: new Date(r.date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        })));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [residentId, days]);

  if (!residentId) {
    return (
      <div style={{ ...card, textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Select a resident to view trends</div>
        <div style={{ color: 'var(--cw-text-secondary)', fontSize: 13 }}>
          Choose a resident from the Overview tab to see their 7-day and 30-day health trends.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={sectionLabel}>Health Trends</div>
          <div style={{ fontSize: 'clamp(16px,3vw,20px)', fontWeight: 300 }}>{residentName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--cw-radius-sm)',
                border: `1px solid ${days === d ? '#2563EB' : 'var(--cw-border)'}`,
                background: days === d ? '#2563EB' : 'transparent',
                color: days === d ? '#fff' : 'var(--cw-text)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--cw-text-secondary)' }}>
          Loading {days}-day trend data…
        </div>
      )}

      {error && (
        <div style={{ ...card, background: 'rgba(220,38,38,.05)', border: '1px solid rgba(220,38,38,.2)', color: '#DC2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No data for last {days} days</div>
          <div style={{ fontSize: 13, color: 'var(--cw-text-secondary)' }}>Data will appear as the sensor accumulates readings.</div>
        </div>
      )}

      {/* Vitals Charts */}
      {!loading && data.length > 0 && METRICS.map(metric => (
        <div key={metric.key} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={sectionLabel}>{metric.label}</div>
            {metric.refLow && (
              <div style={{ fontSize: 11, color: 'var(--cw-text-tertiary)' }}>
                Normal: {metric.refLow}–{metric.refHigh} {metric.unit}
              </div>
            )}
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cw-border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={{ stroke: 'var(--cw-border)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={false} width={32}
                  domain={metric.refLow ? [`dataMin - ${Math.round((metric.refHigh - metric.refLow) * 0.3)}`, `dataMax + ${Math.round((metric.refHigh - metric.refLow) * 0.3)}`] : ['auto', 'auto']} />
                {metric.refLow && <ReferenceLine y={metric.refLow}  stroke={metric.color} strokeDasharray="4 4" strokeOpacity={0.4} />}
                {metric.refHigh && <ReferenceLine y={metric.refHigh} stroke={metric.color} strokeDasharray="4 4" strokeOpacity={0.4} />}
                <Line type="monotone" dataKey={metric.key} stroke={metric.color} strokeWidth={2.5} dot={{ r: 3, fill: metric.color }} isAnimationActive={false} connectNulls name={metric.label} />
                <Tooltip content={<CustomTooltip unit={metric.unit} />} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ))}

      {/* Alert frequency chart */}
      {!loading && data.length > 0 && (
        <div style={card}>
          <div style={sectionLabel}>Daily Alerts</div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cw-border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={{ stroke: 'var(--cw-border)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={false} width={24} allowDecimals={false} />
                <Bar dataKey="high_alerts" name="High Urgency" stackId="a" fill="#DC2626" radius={[0,0,0,0]} isAnimationActive={false} />
                <Bar dataKey="alerts"      name="Total Alerts" stackId="b" fill="#F59E0B" radius={[4,4,0,0]} isAnimationActive={false} />
                <Tooltip content={<CustomTooltip unit="alerts" />} />
                <Legend iconSize={10} iconType="square" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Presence summary */}
      {!loading && data.length > 0 && (
        <div style={card}>
          <div style={sectionLabel}>Room Presence</div>
          <div style={{ height: 120 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cw-border)" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={{ stroke: 'var(--cw-border)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--cw-text-tertiary)' }} tickLine={false} axisLine={false} width={32} unit="%" domain={[0, 100]} />
                <ReferenceLine y={80} stroke="#2563EB" strokeDasharray="4 4" strokeOpacity={0.3} />
                <Bar dataKey="presence_pct" name="Presence %" fill="#2563EB" radius={[4,4,0,0]} isAnimationActive={false} />
                <Tooltip content={<CustomTooltip unit="%" />} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
