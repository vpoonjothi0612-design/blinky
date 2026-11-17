
import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Enterprise Analog Clock Time Picker
 * Supports 12-hour analog dial with AM/PM toggle, interactive clock hand,
 * minute snapping, direct digital click, and quick presets.
 * Emits time in standard HH:mm (24-hour) format.
 */
const ClockTimePicker = ({
  value = '',
  onChange,
  label,
  placeholder = 'Select time',
  required = false,
  error = '',
  optional = false,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState('hours'); // 'hours' | 'minutes'

  // Parse value into 12-hour parts
  const parsedTime = useMemo(() => {
    if (!value || typeof value !== 'string' || !value.includes(':')) {
      const now = new Date();
      const h24 = now.getHours();
      const m = now.getMinutes();
      return {
        hours12: h24 % 12 === 0 ? 12 : h24 % 12,
        minutes: m,
        period: h24 >= 12 ? 'PM' : 'AM',
      };
    }

    const [hStr, mStr] = value.split(':');
    const h24 = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;
    return {
      hours12: h24 % 12 === 0 ? 12 : h24 % 12,
      minutes: m,
      period: h24 >= 12 ? 'PM' : 'AM',
    };
  }, [value]);

  const [selectedHour, setSelectedHour] = useState(parsedTime.hours12);
  const [selectedMinute, setSelectedMinute] = useState(parsedTime.minutes);
  const [period, setPeriod] = useState(parsedTime.period);
  const [isDragging, setIsDragging] = useState(false);

  const clockRef = useRef(null);

  // Sync internal state when opened or value changes
  useEffect(() => {
    if (isOpen) {
      setSelectedHour(parsedTime.hours12);
      setSelectedMinute(parsedTime.minutes);
      setPeriod(parsedTime.period);
      setMode('hours');
    }
  }, [isOpen, parsedTime]);

  // Convert 12h to 24h string
  const format24h = (h12, min, ampm) => {
    let h24 = h12 % 12;
    if (ampm === 'PM') h24 += 12;
    return `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  };

  // Human readable display string
  const displayString = useMemo(() => {
    if (!value) return '';
    const [hStr, mStr] = value.split(':');
    const h24 = parseInt(hStr, 10) || 0;
    const m = parseInt(mStr, 10) || 0;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  }, [value]);

  // Clock Geometry (240px dial)
  const DIAL_RADIUS = 120;
  const CENTER = 120;
  const NUMBER_RADIUS = 88;

  // Compute angles
  const hourAngle = (selectedHour % 12) * 30; // 30 deg per hour
  const minuteAngle = selectedMinute * 6; // 6 deg per minute

  const currentAngle = mode === 'hours' ? hourAngle : minuteAngle;
  const angleRad = (currentAngle * Math.PI) / 180;
  const handX = CENTER + NUMBER_RADIUS * Math.sin(angleRad);
  const handY = CENTER - NUMBER_RADIUS * Math.cos(angleRad);

  // Handle pointer down / move on dial
  const handlePointerCalc = (e) => {
    if (!clockRef.current) return;
    const rect = clockRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
    if (clientX === undefined || clientY === undefined) return;

    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);

    let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;

    if (mode === 'hours') {
      let h = Math.round(angleDeg / 30);
      if (h === 0) h = 12;
      setSelectedHour(h);
    } else {
      let m = Math.round(angleDeg / 6) % 60;
      setSelectedMinute(m);
    }
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
    handlePointerCalc(e);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    handlePointerCalc(e);
  };

  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false);
      // Auto-advance to minutes mode when hour is clicked
      if (mode === 'hours') {
        setTimeout(() => setMode('minutes'), 180);
      }
    }
  };

  const handleConfirm = () => {
    const time24 = format24h(selectedHour, selectedMinute, period);
    onChange(time24);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const setPreset = (h24, min) => {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    setSelectedHour(h12);
    setSelectedMinute(min);
    setPeriod(ampm);
  };

  const handleSetCurrentTime = () => {
    const now = new Date();
    setPreset(now.getHours(), now.getMinutes());
  };

  return (
    <div className="clock-picker-wrapper" style={{ position: 'relative' }}>
      {label && (
        <label htmlFor={id} className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            {label} {required && <span className="required-star">*</span>}
          </span>
          {optional && <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 'normal' }}>(Optional)</span>}
        </label>
      )}

      {/* Trigger Button */}
      <div
        id={id}
        tabIndex={0}
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        className={`form-input clock-input-trigger ${error ? 'input-error' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          padding: '0 12px',
          height: '40px',
        }}
      >
        <span
          style={{
            color: displayString ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: displayString ? 600 : 400,
            fontSize: '14px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
          }}
        >
          {displayString || placeholder}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {value && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'var(--surface-2)',
                color: 'var(--text-muted)',
              }}
            >
              24h: {value}
            </span>
          )}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
      </div>

      {error && <span className="error-text">{error}</span>}

      {/* Modal Dialog for the Analog Clock Face */}
      {isOpen && (
        <div
          className="clock-modal-backdrop"
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '16px',
            animation: 'fadeIn 0.18s ease-out',
          }}
        >
          <div
            className="clock-modal-card"
            onClick={(e) => e.stopPropagation()}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              background: 'var(--surface)',
              borderRadius: '20px',
              border: '1px solid var(--border)',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.35)',
              width: '100%',
              maxWidth: '340px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              animation: 'modalScaleIn 0.2s ease-out',
            }}
          >
            {/* Header: Digital readout + AM/PM toggle */}
            <div
              style={{
                background: 'linear-gradient(135deg, #065f46 0%, #059669 50%, #10b981 100%)',
                color: '#ffffff',
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                {/* Hours Button */}
                <button
                  type="button"
                  onClick={() => setMode('hours')}
                  style={{
                    background: mode === 'hours' ? 'rgba(255, 255, 255, 0.28)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '36px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    fontFamily: 'inherit',
                    lineHeight: 1,
                  }}
                >
                  {String(selectedHour).padStart(2, '0')}
                </button>
                <span style={{ fontSize: '32px', fontWeight: 600, opacity: 0.8 }}>:</span>
                {/* Minutes Button */}
                <button
                  type="button"
                  onClick={() => setMode('minutes')}
                  style={{
                    background: mode === 'minutes' ? 'rgba(255, 255, 255, 0.28)' : 'transparent',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '36px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    fontFamily: 'inherit',
                    lineHeight: 1,
                  }}
                >
                  {String(selectedMinute).padStart(2, '0')}
                </button>
              </div>

              {/* AM / PM Segmented Control */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'rgba(0, 0, 0, 0.2)',
                  borderRadius: '8px',
                  padding: '3px',
                  gap: '2px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setPeriod('AM')}
                  style={{
                    background: period === 'AM' ? '#ffffff' : 'transparent',
                    color: period === 'AM' ? '#1e3a8a' : 'rgba(255, 255, 255, 0.85)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('PM')}
                  style={{
                    background: period === 'PM' ? '#ffffff' : 'transparent',
                    color: period === 'PM' ? '#1e3a8a' : 'rgba(255, 255, 255, 0.85)',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  PM
                </button>
              </div>
            </div>

            {/* Mode Guide Pill */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px 16px 0',
                fontSize: '12px',
                color: 'var(--text-muted)',
                fontWeight: 500,
              }}
            >
              <span>Selecting:</span>
              <span
                style={{
                  color: 'var(--primary)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {mode === 'hours' ? 'Hour (1 - 12)' : 'Minute (00 - 59)'}
              </span>
            </div>

            {/* Analog Clock Face */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '16px',
              }}
            >
              <svg
                ref={clockRef}
                width={240}
                height={240}
                onPointerDown={handlePointerDown}
                style={{
                  touchAction: 'none',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {/* Clock Face Circle */}
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={DIAL_RADIUS - 4}
                  fill="var(--surface-2)"
                  stroke="var(--border)"
                  strokeWidth="2"
                />

                {/* Clock Hand Line */}
                <line
                  x1={CENTER}
                  y1={CENTER}
                  x2={handX}
                  y2={handY}
                  stroke="#059669"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Center Pivot Point */}
                <circle cx={CENTER} cy={CENTER} r={4.5} fill="#059669" />

                {/* Pointer Active Bubble */}
                <circle
                  cx={handX}
                  cy={handY}
                  r={16}
                  fill="#059669"
                  style={{ filter: 'drop-shadow(0 2px 5px rgba(5,150,105,0.4))' }}
                />

                {/* Dial Numbers */}
                {mode === 'hours'
                  ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => {
                      const angle = (h % 12) * 30 * (Math.PI / 180);
                      const x = CENTER + NUMBER_RADIUS * Math.sin(angle);
                      const y = CENTER - NUMBER_RADIUS * Math.cos(angle);
                      const isSelected = selectedHour === h;

                      return (
                        <text
                          key={h}
                          x={x}
                          y={y + 5}
                          textAnchor="middle"
                          fill={isSelected ? '#ffffff' : 'var(--text-primary)'}
                          fontSize={isSelected ? '14px' : '13px'}
                          fontWeight={isSelected ? '700' : '600'}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {h}
                        </text>
                      );
                    })
                  : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => {
                      const angle = m * 6 * (Math.PI / 180);
                      const x = CENTER + NUMBER_RADIUS * Math.sin(angle);
                      const y = CENTER - NUMBER_RADIUS * Math.cos(angle);
                      const isSelected = selectedMinute === m;

                      return (
                        <text
                          key={m}
                          x={x}
                          y={y + 4.5}
                          textAnchor="middle"
                          fill={isSelected ? '#ffffff' : 'var(--text-secondary)'}
                          fontSize={isSelected ? '13px' : '12px'}
                          fontWeight={isSelected ? '700' : '500'}
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {String(m).padStart(2, '0')}
                        </text>
                      );
                    })}
              </svg>
            </div>

            {/* Quick Presets Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '0 16px 14px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={handleSetCurrentTime}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Now
              </button>
              <button
                type="button"
                onClick={() => setPreset(9, 0)}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                09:00 AM
              </button>
              <button
                type="button"
                onClick={() => setPreset(13, 0)}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                01:00 PM
              </button>
              <button
                type="button"
                onClick={() => setPreset(17, 0)}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                05:00 PM
              </button>
              <button
                type="button"
                onClick={() => setPreset(18, 0)}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                06:00 PM
              </button>
            </div>

            {/* Footer Buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderTop: '1px solid var(--border)',
                background: 'var(--surface-2)',
              }}
            >
              <div>
                {optional && value && (
                  <button
                    type="button"
                    onClick={handleClear}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--danger)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    border: '1px solid var(--border-strong)',
                    background: 'var(--surface)',
                    color: 'var(--text-secondary)',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  style={{
                    border: 'none',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    color: '#ffffff',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(5,150,105,0.25)',
                  }}
                >
                  Set Time
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClockTimePicker;
