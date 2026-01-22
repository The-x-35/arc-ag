'use client';

import React from 'react';

interface PoolInfo {
  id: string;
  name: string;
  description: string;
  isAvailable: boolean;
  transactionCount?: number;
}

interface PoolSelectorProps {
  pools: PoolInfo[];
  selectedPools: string[];
  onSelectionChange: (poolIds: string[]) => void;
  loading?: boolean;
}

export default function PoolSelector({ 
  pools, 
  selectedPools, 
  onSelectionChange,
  loading = false,
}: PoolSelectorProps) {
  const togglePool = (poolId: string) => {
    if (selectedPools.includes(poolId)) {
      onSelectionChange(selectedPools.filter(id => id !== poolId));
    } else {
      onSelectionChange([...selectedPools, poolId]);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px',
        color: '#888'
      }}>
        <span>Loading pools...</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#fff', margin: 0 }}>
          Available Pools
        </h4>
        <span style={{ 
          fontSize: '12px', 
          color: '#888',
          background: '#222',
          padding: '2px 8px',
          borderRadius: '4px'
        }}>
          {pools.length} pool{pools.length !== 1 ? 's' : ''}
        </span>
      </div>

      {pools.map((pool) => (
        <div 
          key={pool.id}
          onClick={() => pool.isAvailable && togglePool(pool.id)}
          style={{ 
            display: 'flex', 
            gap: '12px',
            padding: '12px 16px',
            background: selectedPools.includes(pool.id) ? '#1a1a2e' : '#0a0a0a',
            border: `1px solid ${selectedPools.includes(pool.id) ? '#3b82f6' : '#222'}`,
            borderRadius: '8px',
            marginBottom: '8px',
            cursor: pool.isAvailable ? 'pointer' : 'not-allowed',
            opacity: pool.isAvailable ? 1 : 0.5
          }}
        >
          <div style={{ 
            width: '20px', 
            height: '20px', 
            border: `2px solid ${selectedPools.includes(pool.id) ? '#3b82f6' : '#444'}`,
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: selectedPools.includes(pool.id) ? '#3b82f6' : 'transparent',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 'bold',
            flexShrink: 0
          }}>
            {selectedPools.includes(pool.id) ? '✓' : ''}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ 
              fontWeight: '500', 
              color: '#fff', 
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {pool.name}
              {!pool.isAvailable && (
                <span style={{ 
                  fontSize: '10px', 
                  background: '#400',
                  color: '#f88',
                  padding: '1px 6px',
                  borderRadius: '4px'
                }}>
                  Offline
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
              {pool.description}
            </div>
          </div>
        </div>
      ))}

      {pools.length === 0 && (
        <div style={{ textAlign: 'center', color: '#888', padding: '16px' }}>
          No pools registered
        </div>
      )}
    </div>
  );
}
