'use client';

import React from 'react';

interface PrivacySliderProps {
  value: number; // 0-100 (0 = 2 chunks/0min, 100 = 10 chunks/240min)
  onChange: (value: number) => void;
  onSettingsClick?: () => void;
  disabled?: boolean;
}

export default function PrivacySlider({ value, onChange, onSettingsClick, disabled }: PrivacySliderProps) {
  // Linear mapping: value 0-100 maps to chunks 2-10 and time 0-240
  const chunks = Math.round(2 + (value / 100) * 8);
  const timeMinutes = Math.round((value / 100) * 240);
  const timeHours = Math.floor(timeMinutes / 60);
  const timeMins = timeMinutes % 60;
  
  const formatTime = () => {
    if (timeMinutes === 0) return '<1 min';
    if (timeHours === 0) return `${timeMinutes} min`;
    if (timeMins === 0) return `${timeHours} hr`;
    return `${timeHours} hr ${timeMins} min`;
  };

  // Calculate gradient position (0-100%)
  const gradientPosition = value;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <label style={{ 
          color: '#000', 
          fontSize: '14px', 
          fontWeight: '600'
        }}>
          Privacy Level
        </label>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px'
        }}>
          <span style={{ 
            color: '#888', 
            fontSize: '13px',
            fontFamily: 'monospace'
          }}>
            {chunks} parts, {formatTime()}
          </span>
          {onSettingsClick && (
            <button
              type="button"
              onClick={onSettingsClick}
              disabled={disabled}
              style={{
                padding: '6px',
                background: 'transparent',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#888',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                opacity: disabled ? 0.5 : 1
              }}
              title="Advanced Settings"
            >
              ⚙️
            </button>
          )}
        </div>
      </div>

      {/* Slider Container with Gradient Background */}
      <div style={{ 
        position: 'relative',
        width: '100%',
        height: '8px',
        borderRadius: '4px',
        background: `linear-gradient(to right, 
          #ef4444 0%, 
          #f59e0b ${gradientPosition * 0.5}%, 
          #22c55e ${gradientPosition}%, 
          #22c55e 100%)`,
        marginBottom: '8px'
      }}>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          disabled={disabled}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            opacity: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            zIndex: 2
          }}
        />
        {/* Custom Thumb */}
        <div style={{
          position: 'absolute',
          left: `calc(${value}% - 12px)`,
          top: '50%',
          transform: 'translateY(-50%)',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: '#fff',
          border: '3px solid #3b82f6',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
          zIndex: 3,
          transition: 'left 0.1s ease-out'
        }} />
      </div>

      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        fontSize: '11px',
        color: '#666'
      }}>
        <span>Low Privacy (2 parts, &lt;1 min)</span>
        <span>High Privacy (10 parts, 4 hr)</span>
      </div>
    </div>
  );
}
