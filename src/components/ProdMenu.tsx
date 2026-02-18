'use client';

import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSessionRecovery, SessionData } from '@/hooks/useSessionRecovery';
import { useSolPrice, formatSolAmount } from '@/hooks/useSolPrice';

interface ProdMenuProps {
  onShowBurners?: () => void;
  onShowSettings?: () => void;
  onRecoverSession?: (session: SessionData) => void;
}

export default function ProdMenu({ 
  onShowBurners, 
  onShowSettings,
  onRecoverSession 
}: ProdMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const { connected, publicKey } = useWallet();
  const { getSessionHistory } = useSessionRecovery();
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const { price: solPrice } = useSolPrice();

  useEffect(() => {
    if (isOpen && showSessions && connected && publicKey) {
      loadSessions();
    }
  }, [isOpen, showSessions, connected, publicKey]);

  const loadSessions = async () => {
    if (!publicKey) return;
    setLoadingSessions(true);
    try {
      const sessionList = await getSessionHistory(publicKey.toBase58(), { limit: 20 });
      setSessions(sessionList);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSessionClick = (session: SessionData) => {
    if (onRecoverSession) {
      onRecoverSession(session);
      setIsOpen(false);
      setShowSessions(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px',
          background: isOpen ? '#e5e5e5' : 'transparent',
          border: '1px solid #ddd',
          borderRadius: '6px',
          color: '#000',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '36px',
          height: '36px',
          fontSize: '18px'
        }}
        title={isOpen ? "Close Menu" : "Menu"}
      >
        {isOpen ? '✕' : '☰'}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 998
            }}
            onClick={() => {
              setIsOpen(false);
              setShowSessions(false);
            }}
          />

          {/* Menu Dropdown */}
          <div style={{
            position: 'absolute',
            top: '44px',
            right: 0,
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '8px',
            minWidth: '280px',
            maxWidth: '400px',
            zIndex: 999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}>
            {/* Menu Items */}
            <div style={{ padding: '8px' }}>
              {onShowBurners && (
                <button
                  type="button"
                  onClick={() => {
                    onShowBurners();
                    setIsOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#000',
                    fontSize: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#e5e5e5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span>👛</span>
                  <span>View Burner Wallets</span>
                </button>
              )}

              {onShowSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onShowSettings();
                    setIsOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#000',
                    fontSize: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#e5e5e5';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span>⚙️</span>
                  <span>Settings</span>
                </button>
              )}

              {connected && publicKey && (
                <button
                  type="button"
                  onClick={() => setShowSessions(!showSessions)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: showSessions ? '#e5e5e5' : 'transparent',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#000',
                    fontSize: '14px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    if (!showSessions) {
                      e.currentTarget.style.background = '#e5e5e5';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!showSessions) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span>📋</span>
                    <span>Sessions</span>
                  </div>
                  <span>{showSessions ? '▼' : '▶'}</span>
                </button>
              )}
            </div>

            {/* Sessions List */}
            {showSessions && connected && publicKey && (
              <div style={{
                borderTop: '1px solid #ddd',
                padding: '8px',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                {loadingSessions ? (
                  <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: '#666',
                    fontSize: '13px'
                  }}>
                    Loading sessions...
                  </div>
                ) : sessions.length === 0 ? (
                  <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: '#999',
                    fontSize: '13px'
                  }}>
                    No sessions found
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sessions.map((session) => {
                      const statusColors: Record<string, string> = {
                        completed: '#22c55e',
                        in_progress: '#3b82f6',
                        pending: '#f59e0b',
                        failed: '#ef4444',
                      };
                      
                      const date = new Date(session.created_at);
                      const params = session.transaction_params;
                      
                      return (
                        <div
                          key={session.id}
                          style={{
                            padding: '10px',
                            background: '#fafafa',
                            border: `1px solid ${statusColors[session.status] || '#ccc'}`,
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: (session.status === 'pending' || session.status === 'in_progress') ? 'pointer' : 'default'
                          }}
                          onClick={() => {
                            if (session.status === 'pending' || session.status === 'in_progress') {
                              handleSessionClick(session);
                            }
                          }}
                          onMouseEnter={(e) => {
                            if (session.status === 'pending' || session.status === 'in_progress') {
                              e.currentTarget.style.background = '#f0f0f0';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#fafafa';
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '6px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: '#000', fontWeight: '600', marginBottom: '2px' }}>
                                {date.toLocaleString()}
                              </div>
                              <div style={{ color: '#666', fontSize: '11px', fontFamily: 'monospace' }}>
                                {session.id.slice(0, 8)}...{session.id.slice(-8)}
                              </div>
                            </div>
                            <span style={{
                              padding: '2px 6px',
                              background: statusColors[session.status] || '#999',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: '600',
                              textTransform: 'uppercase',
                              color: '#fff'
                            }}>
                              {session.status}
                            </span>
                          </div>
                          
                          <div style={{ color: '#666', marginTop: '6px', fontSize: '11px' }}>
                            <div>Amount: {formatSolAmount(params.amount, solPrice, 6)}</div>
                            <div>Parts: {params.numChunks}</div>
                            <div>Step: {session.current_step} / 13</div>
                          </div>

                          {(session.status === 'pending' || session.status === 'in_progress') && (
                            <div style={{
                              marginTop: '6px',
                              padding: '4px 8px',
                              background: '#000',
                              borderRadius: '4px',
                              fontSize: '11px',
                              color: '#fff',
                              textAlign: 'center',
                              fontWeight: '500'
                            }}>
                              Click to Continue
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
