'use client';

import React, { useState } from 'react';

export interface StepStatus {
  id: number;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message?: string;
}

interface PrivacyProgressBarProps {
  steps: StepStatus[];
  onDetailsClick?: () => void;
}

const STEP_LABELS = [
  'Validate Inputs',
  'Generate First Burner',
  'Send to First Burner',
  'First Burner Deposits',
  'Wait for Indexing',
  'Privacy Delay',
  'Generate Burner Keypairs',
  'Generate Final Burner',
  'Withdraw to Burners',
  'Re-deposit from Burners',
  'Wait for Indexing',
  'Final Burner Withdraws',
  'Final Transfer',
];

export default function PrivacyProgressBar({ steps, onDetailsClick }: PrivacyProgressBarProps) {
  const [expanded, setExpanded] = useState(false);

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const totalSteps = 13;
  const progress = (completedCount / totalSteps) * 100;

  const getStatusColor = (status: StepStatus['status']) => {
    switch (status) {
      case 'completed': return '#00CC65';
      case 'running': return '#3489FF';
      case 'error': return '#FF2232';
      default: return '#666';
    }
  };

  const getStatusIcon = (status: StepStatus['status']) => {
    switch (status) {
      case 'completed': return '✓';
      case 'running': return '●';
      case 'error': return '✗';
      default: return '○';
    }
  };

  const handleDetailsClick = () => {
    setExpanded(!expanded);
    if (onDetailsClick) {
      onDetailsClick();
    }
  };

  return (
    <div style={{ width: '100%' }}>
      {/* Compact Progress Bar */}
      <div style={{
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: expanded ? '12px' : '0'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#000',
              fontFamily: 'monospace'
            }}>
              {completedCount}/{totalSteps}
            </div>
            <span style={{ color: '#666', fontSize: '13px' }}>done</span>
          </div>
          <button
            type="button"
            onClick={handleDetailsClick}
            style={{
              padding: '6px 12px',
              background: expanded ? '#3489FF' : '#e5e5e5',
              border: '1px solid #ccc',
              borderRadius: '6px',
              color: expanded ? '#fff' : '#000',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: '500',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif'
            }}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </div>

        {/* Progress Bar */}
        <div style={{
          width: '100%',
          height: '8px',
          background: '#e5e5e5',
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative'
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: progress === 100 
              ? '#00CC65' 
              : steps.some(s => s.status === 'running')
                ? '#3489FF'
                : steps.some(s => s.status === 'error')
                  ? '#FF2232'
                  : '#666',
            transition: 'width 0.3s ease, background 0.3s ease',
            borderRadius: '4px'
          }} />
        </div>

        {/* Current Step Info */}
        {steps.length > 0 && (
          <div style={{
            marginTop: '12px',
            fontSize: '12px',
            color: '#666'
          }}>
            {(() => {
              const currentStep = steps.find(s => s.status === 'running') || 
                                 steps.find(s => s.status === 'error') ||
                                 steps[steps.length - 1];
              if (currentStep) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: getStatusColor(currentStep.status) }}>
                      {getStatusIcon(currentStep.status)}
                    </span>
                    <span>{currentStep.label}</span>
                    {currentStep.message && (
                      <span style={{ color: '#666', fontSize: '11px' }}>
                        • {currentStep.message}
                      </span>
                    )}
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>

      {/* Expanded Details View */}
      {expanded && (
        <div style={{
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '16px',
          maxHeight: '400px',
          overflowY: 'auto'
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: '#000',
            marginBottom: '12px'
          }}>
            Transaction Steps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {STEP_LABELS.map((label, index) => {
              const stepId = index + 1;
              const step = steps.find(s => s.id === stepId);
              const status = step?.status || 'pending';
              const message = step?.message;
              
              return (
                <div
                  key={stepId}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '10px',
                    background: status === 'running' ? '#E3EAF9' : 
                               status === 'completed' ? '#E3F9F3' : 
                               status === 'error' ? '#FFC5C6' : '#FEFAF5',
                    borderRadius: '6px',
                    borderLeft: `3px solid ${getStatusColor(status)}`
                  }}
                >
                  <span style={{
                    minWidth: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    background: status === 'running' ? getStatusColor(status) : 'transparent',
                    border: `2px solid ${getStatusColor(status)}`,
                    color: status === 'running' ? '#fff' : getStatusColor(status),
                    fontWeight: 'bold',
                    fontSize: '12px'
                  }}>
                    {getStatusIcon(status)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      color: status === 'pending' ? '#666' : '#000',
                      fontSize: '13px',
                      fontWeight: status === 'running' ? '600' : '400'
                    }}>
                      {stepId}. {label}
                    </div>
                    {message && (
                      <div style={{
                        color: '#666',
                        fontSize: '11px',
                        marginTop: '4px'
                      }}>
                        {message}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
