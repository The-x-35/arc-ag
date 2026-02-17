'use client';

import React, { useState, useEffect } from 'react';

interface PrivacySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chunks: number;
  timeMinutes: number;
  onSave: (chunks: number, timeMinutes: number) => void;
  selectedPools?: string[];
  onPoolsChange?: (pools: string[]) => void;
  availablePools?: Array<{
    id: string;
    name: string;
    description: string;
    isAvailable: boolean;
  }>;
}

export default function PrivacySettingsModal({
  isOpen,
  onClose,
  chunks: initialChunks,
  timeMinutes: initialTimeMinutes,
  onSave,
  selectedPools = ['privacy-cash'],
  onPoolsChange,
  availablePools = []
}: PrivacySettingsModalProps) {
  const [chunks, setChunks] = useState(initialChunks);
  const [timeMinutes, setTimeMinutes] = useState(initialTimeMinutes);
  const [pools, setPools] = useState(selectedPools);

  useEffect(() => {
    if (isOpen) {
      setChunks(initialChunks);
      setTimeMinutes(initialTimeMinutes);
      setPools(selectedPools);
    }
  }, [isOpen, initialChunks, initialTimeMinutes, selectedPools]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(chunks, timeMinutes);
    if (onPoolsChange) {
      onPoolsChange(pools);
    }
    onClose();
  };

  const formatTime = () => {
    if (timeMinutes === 0) return '<1 min';
    const hours = Math.floor(timeMinutes / 60);
    const mins = timeMinutes % 60;
    if (hours === 0) return `${timeMinutes} min`;
    if (mins === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}
    onClick={onClose}
    >
      <div style={{
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: '#000',
            margin: 0
          }}>
            Advanced Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #ccc',
              borderRadius: '6px',
              color: '#666',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Chunks Slider */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            color: '#000',
            display: 'block',
            marginBottom: '8px',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            Number of Parts: {chunks}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: '#666', minWidth: '20px' }}>2</span>
            <input
              type="range"
              min={2}
              max={10}
              value={chunks}
              onChange={(e) => setChunks(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: '12px', color: '#666', minWidth: '20px' }}>10</span>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#999',
            marginTop: '4px'
          }}>
            More parts = more privacy, but higher fees
          </div>
        </div>

        {/* Time Slider */}
        <div style={{ marginBottom: '24px' }}>
          <label style={{
            color: '#000',
            display: 'block',
            marginBottom: '8px',
            fontSize: '14px',
            fontWeight: '500'
          }}>
            Privacy Delay: {formatTime()}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: '#666', minWidth: '40px' }}>&lt;1 min</span>
            <input
              type="range"
              min={0}
              max={240}
              step={5}
              value={timeMinutes}
              onChange={(e) => setTimeMinutes(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: '12px', color: '#666', minWidth: '50px' }}>4 hr</span>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#999',
            marginTop: '4px'
          }}>
            {timeMinutes === 0 
              ? 'No delay - fastest transaction' 
              : 'Longer delay = more privacy, slower transaction'}
          </div>
        </div>

        {/* Pool Selection */}
        {availablePools.length > 0 && onPoolsChange && (
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#000',
              display: 'block',
              marginBottom: '8px',
              fontSize: '14px',
              fontWeight: '500'
            }}>
              Privacy Pools
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {availablePools.map((pool) => (
                <label
                  key={pool.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    background: '#fafafa',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    opacity: pool.isAvailable ? 1 : 0.5
                  }}
                >
                  <input
                    type="checkbox"
                    checked={pools.includes(pool.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPools([...pools, pool.id]);
                      } else {
                        setPools(pools.filter(p => p !== pool.id));
                      }
                    }}
                    disabled={!pool.isAvailable}
                    style={{ cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#000', fontSize: '13px', fontWeight: '500' }}>
                      {pool.name}
                    </div>
                    <div style={{ color: '#999', fontSize: '11px' }}>
                      {pool.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: '12px',
          marginTop: '24px'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              background: '#e5e5e5',
              border: '1px solid #ccc',
              borderRadius: '8px',
              color: '#000',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              flex: 1,
              padding: '12px',
              background: '#000',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
