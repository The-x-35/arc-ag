'use client';

import React, { useState } from 'react';

interface WalletInfo {
  type: 'swig' | 'eoa' | 'source';
  label: string;
  address: string;
  privateKey?: string;
  evmPrivateKey?: string;
  explorerUrl: string;
}

interface KeyDisplayProps {
  wallets: WalletInfo[];
  title?: string;
}

export default function KeyDisplay({ wallets, title = 'Wallet Keys (For Testing)' }: KeyDisplayProps) {
  const [expandedWallet, setExpandedWallet] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedWallet(expandedWallet === index ? null : index);
  };

  const getTypeColor = (type: WalletInfo['type']) => {
    switch (type) {
      case 'source': return '#a855f7';
      case 'swig': return '#3b82f6';
      case 'eoa': return '#22c55e';
      default: return '#888';
    }
  };

  if (wallets.length === 0) return null;

  return (
    <div style={{ 
      background: '#111', 
      border: '1px solid #333', 
      borderRadius: '12px', 
      padding: '24px' 
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#fff' }}>{title}</h3>
        <span style={{ color: '#f59e0b', fontSize: '12px' }}>⚠️ Save these keys</span>
      </div>

      {wallets.map((wallet, index) => (
        <div key={index} style={{ 
          background: '#0a0a0a', 
          borderRadius: '8px',
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div 
            onClick={() => toggleExpand(index)}
            style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '12px 16px',
              cursor: 'pointer'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ 
                padding: '2px 8px', 
                background: getTypeColor(wallet.type),
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: '600',
                color: '#fff',
                textTransform: 'uppercase'
              }}>
                {wallet.type}
              </span>
              <span style={{ color: '#fff', fontSize: '14px' }}>{wallet.label}</span>
            </div>
            <span style={{ color: '#888' }}>{expandedWallet === index ? '▼' : '▶'}</span>
          </div>

          {expandedWallet === index && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                  Address:
                </label>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  background: '#000',
                  padding: '8px 12px',
                  borderRadius: '6px'
                }}>
                  <code style={{ 
                    flex: 1, 
                    fontSize: '11px', 
                    color: '#fff',
                    wordBreak: 'break-all'
                  }}>
                    {wallet.address}
                  </code>
                  <button 
                    onClick={() => copyToClipboard(wallet.address, `addr-${index}`)}
                    style={{
                      padding: '4px 8px',
                      background: '#222',
                      border: 'none',
                      borderRadius: '4px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {copiedField === `addr-${index}` ? '✓' : 'Copy'}
                  </button>
                  <a 
                    href={wallet.explorerUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{
                      padding: '4px 8px',
                      background: '#222',
                      borderRadius: '4px',
                      color: '#fff',
                      fontSize: '12px',
                      textDecoration: 'none'
                    }}
                  >
                    ↗
                  </a>
                </div>
              </div>

              {wallet.privateKey && (
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                    Private Key (SOL):
                  </label>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    background: '#200',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #400'
                  }}>
                    <code style={{ 
                      flex: 1, 
                      fontSize: '10px', 
                      color: '#fff',
                      wordBreak: 'break-all'
                    }}>
                      {wallet.privateKey}
                    </code>
                    <button 
                      onClick={() => copyToClipboard(wallet.privateKey!, `pk-${index}`)}
                      style={{
                        padding: '4px 8px',
                        background: '#333',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {copiedField === `pk-${index}` ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {wallet.evmPrivateKey && (
                <div>
                  <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                    EVM Private Key:
                  </label>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    background: '#200',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #400'
                  }}>
                    <code style={{ 
                      flex: 1, 
                      fontSize: '10px', 
                      color: '#fff',
                      wordBreak: 'break-all'
                    }}>
                      {wallet.evmPrivateKey}
                    </code>
                    <button 
                      onClick={() => copyToClipboard(wallet.evmPrivateKey!, `evm-${index}`)}
                      style={{
                        padding: '4px 8px',
                        background: '#333',
                        border: 'none',
                        borderRadius: '4px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {copiedField === `evm-${index}` ? '✓' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
