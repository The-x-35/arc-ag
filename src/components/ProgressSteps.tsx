'use client';

import React from 'react';

export interface StepStatus {
  id: number;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message?: string;
  signature?: string;
}

interface ProgressStepsProps {
  steps: StepStatus[];
}

export default function ProgressSteps({ steps }: ProgressStepsProps) {
  const getStatusColor = (status: StepStatus['status']) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'running': return '#3b82f6';
      case 'error': return '#ef4444';
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

  return (
    <div>
      {steps.map((step) => (
        <div 
          key={step.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '12px',
            background: '#0a0a0a',
            borderRadius: '8px',
            marginBottom: '8px',
            borderLeft: `3px solid ${getStatusColor(step.status)}`
          }}
        >
          <span style={{ 
            color: getStatusColor(step.status),
            fontWeight: 'bold',
            fontSize: '14px',
            marginTop: '2px'
          }}>
            {getStatusIcon(step.status)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
              {step.label}
            </div>
            {step.message && (
              <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                {step.message}
              </div>
            )}
            {step.signature && (
              <a
                href={`https://solscan.io/tx/${step.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ 
                  display: 'block',
                  fontSize: '12px', 
                  color: '#3b82f6',
                  marginTop: '4px'
                }}
              >
                View TX →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
