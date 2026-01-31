'use client';

import React from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { BurnerType } from '@/types';
import { AvailableAmount, ExactSplitResult } from '@/lib/indexer/transaction-indexer';
import { formatTime } from '@/lib/swig/utils';

export interface SplitPreview {
  loading: boolean;
  result: ExactSplitResult | null;
  availableAmounts: AvailableAmount[];
  suggestions: { amount: number; sol: number; chunks: number[] }[];
}

interface SendFormProps {
  privateKey: string;
  destination: string;
  amount: string;
  privacyLevel: number;
  delayMinutes: number;
  burnerType: BurnerType;
  sponsorFees: boolean;
  splitPreview: SplitPreview;
  
  onPrivateKeyChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onPrivacyLevelChange: (value: number) => void;
  onDelayChange: (value: number) => void;
  onBurnerTypeChange: (value: BurnerType) => void;
  onSponsorFeesChange: (value: boolean) => void;
  onSelectSuggestion: (sol: number) => void;
  onSubmit: () => void;
  
  loading: boolean;
  disabled?: boolean;
}

export default function SendForm({
  destination,
  amount,
  privacyLevel,
  delayMinutes,
  splitPreview,
  onDestinationChange,
  onAmountChange,
  onPrivacyLevelChange,
  onDelayChange,
  onSelectSuggestion,
  onSubmit,
  loading,
}: SendFormProps) {
  const { connected, publicKey, disconnect } = useWallet();
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(amount);
    const minAmount = (0.035 * privacyLevel); // MIN_CHUNK_LAMPORTS per chunk
    const meetsMinimum = amountNum >= minAmount;
    
    // STRICT minimum check - block if below minimum
    if (!loading && connected && destination && amount && meetsMinimum) {
      onSubmit();
    }
  };

  // Form is valid if we have amount, destination, wallet, and STRICTLY meet minimum
  const amountNum = parseFloat(amount) || 0;
  const minAmount = (0.035 * privacyLevel); // MIN_CHUNK_LAMPORTS per chunk
  const meetsMinimum = amountNum >= minAmount;
  const isFormValid = connected && destination && amount && meetsMinimum;

  return (
    <form onSubmit={handleSubmit}>
      {/* Wallet Connect */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
          Your Wallet
        </label>
        
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px',
          padding: '16px',
          background: '#000',
          borderRadius: '8px',
          border: '1px solid #333'
        }}>
          {connected && publicKey ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Connected</div>
                <div style={{ 
                  fontFamily: 'monospace', 
                  fontSize: '13px',
                  color: '#22c55e'
                }}>
                  {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => disconnect()}
                disabled={loading}
                style={{
                  padding: '6px 12px',
                  background: '#333',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <WalletMultiButton style={{
                background: '#3b82f6',
                borderRadius: '8px',
                height: '44px',
                fontSize: '14px',
                fontWeight: '600'
              }} />
              <span style={{ fontSize: '12px', color: '#666' }}>
                Connect Phantom, Solflare, or other Solana wallets
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Destination */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
          Destination Solana Address
        </label>
        <input
          type="text"
          value={destination}
          onChange={(e) => onDestinationChange(e.target.value)}
          placeholder="Final destination wallet address"
          disabled={loading}
          required
          style={{
            width: '100%',
            padding: '12px 16px',
            background: '#000',
            border: '1px solid #333',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px'
          }}
        />
      </div>

      {/* Privacy Level Slider */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
          Number of Chunks: {privacyLevel}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>2</span>
          <input
            type="range"
            min={2}
            max={10}
            value={privacyLevel}
            onChange={(e) => onPrivacyLevelChange(parseInt(e.target.value))}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: '12px', color: '#888' }}>10</span>
        </div>
        <div style={{ 
          fontSize: '11px', 
          color: '#666',
          marginTop: '4px'
        }}>
          More chunks = more privacy, but higher fees
        </div>
      </div>

      {/* Privacy Delay Slider */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
          Privacy Delay: {delayMinutes === 0 ? 'No delay (fast mode)' : formatTime(delayMinutes * 60 * 1000)}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: '#888' }}>0min</span>
          <input
            type="range"
            min={0}
            max={240}
            step={5}
            value={delayMinutes}
            onChange={(e) => onDelayChange(parseInt(e.target.value))}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: '12px', color: '#888' }}>4h</span>
        </div>
        <div style={{ 
          fontSize: '11px', 
          color: '#666',
          marginTop: '4px'
        }}>
          {delayMinutes === 0 
            ? 'No delay - fastest transaction' 
            : 'Longer delay = more privacy, slower transaction'}
        </div>
      </div>

      {/* Amount Input */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
          Amount (SOL)
        </label>
        <input
          type="number"
          step="0.01"
          min="0.07"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="Enter amount to see split"
          disabled={loading}
          required
          style={{
            width: '100%',
            padding: '12px 16px',
            background: '#000',
            border: `1px solid ${splitPreview?.result?.valid ? '#22c55e' : splitPreview?.result?.error ? '#ef4444' : '#333'}`,
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px'
          }}
        />
        <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
          Min {(0.035 * privacyLevel).toFixed(2)} SOL ({privacyLevel} × 0.035 SOL min per chunk)
        </div>
      </div>

      {/* Split Preview */}
      {amount && parseFloat(amount) > 0 && splitPreview && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Split Preview
          </label>
          
          {splitPreview?.loading ? (
            <div style={{ 
              padding: '16px',
              background: '#0a0a0a',
              borderRadius: '8px',
              border: '1px solid #333',
              textAlign: 'center',
              color: '#888'
            }}>
              Calculating optimal split...
            </div>
          ) : splitPreview?.result?.valid ? (
            <div style={{ 
              padding: '12px',
              background: '#001a00',
              borderRadius: '8px',
              border: '1px solid #0a3a0a'
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{ color: '#22c55e', fontSize: '16px' }}>✓</span>
                <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>
                  Valid split found!
                </span>
              </div>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '6px',
                marginTop: '8px'
              }}>
                {splitPreview.result.chunks.map((chunk, i) => (
                  <div 
                    key={i}
                    style={{ 
                      padding: '6px 10px',
                      background: '#0a2a0a',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: '#4ade80',
                      border: '1px solid #1a4a1a'
                    }}
                  >
                    {chunk.sol} SOL
                    {chunk.isHistorical && (
                      <span style={{ marginLeft: '4px', fontSize: '10px', color: '#888' }}>
                        ({chunk.frequency}×)
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ 
                fontSize: '11px', 
                color: '#888',
                marginTop: '8px'
              }}>
                Total: {splitPreview.result.totalSol} SOL • Each chunk matches historical transactions
              </div>
            </div>
          ) : splitPreview?.result?.error ? (
            <div style={{ 
              padding: '12px',
              background: meetsMinimum ? '#2a1a00' : '#1a0000',
              borderRadius: '8px',
              border: `1px solid ${meetsMinimum ? '#5a3a00' : '#3a0a0a'}`
            }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{ color: meetsMinimum ? '#f59e0b' : '#ef4444', fontSize: '16px' }}>
                  {meetsMinimum ? '⚠' : '✗'}
                </span>
                <span style={{ color: meetsMinimum ? '#f59e0b' : '#ef4444', fontSize: '13px' }}>
                  {splitPreview.result.error}
                </span>
              </div>
              
              {!meetsMinimum && (
                <div style={{ 
                  marginTop: '8px',
                  padding: '8px',
                  background: '#2a0000',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#ef4444'
                }}>
                  ⚠ Amount below recommended minimum ({minAmount.toFixed(3)} SOL for {privacyLevel} chunks)
                  <br />
                  <span style={{ color: '#888', fontSize: '11px' }}>
                    Each chunk will be {(amountNum / privacyLevel).toFixed(6)} SOL (minimum recommended: 0.035 SOL per chunk)
                  </span>
                </div>
              )}
              
              {meetsMinimum && (
                <div style={{ 
                  marginTop: '8px',
                  padding: '8px',
                  background: '#1a0a00',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#f59e0b'
                }}>
                  ⚠ Custom amount: Will split equally into {privacyLevel} chunks of {(amountNum / privacyLevel).toFixed(6)} SOL each
                  <br />
                  <span style={{ color: '#888', fontSize: '11px' }}>
                    This may reduce privacy compared to using exact historical amounts
                  </span>
                </div>
              )}
              
              {splitPreview?.suggestions && splitPreview.suggestions.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>
                    Suggested amounts (click to use):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {splitPreview.suggestions.map((suggestion, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onSelectSuggestion(suggestion.sol)}
                        style={{
                          padding: '8px 12px',
                          background: '#222',
                          border: '1px solid #444',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          color: '#fff',
                          fontSize: '12px'
                        }}
                      >
                        <div style={{ fontWeight: '600' }}>{suggestion.sol} SOL</div>
                        <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                          {suggestion.chunks.map(c => c + ' SOL').join(' + ')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Common Amounts Quick Select */}
      {splitPreview?.availableAmounts && splitPreview.availableAmounts.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#888', display: 'block', marginBottom: '8px', fontSize: '12px' }}>
            Popular amounts (from historical transactions):
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {splitPreview.availableAmounts
              .filter(a => a.frequency > 0)
              .slice(0, 8)
              .map((amt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectSuggestion(amt.sol * privacyLevel)}
                  disabled={loading}
                  style={{
                    padding: '6px 10px',
                    background: amt.isHistorical ? '#1a1a2e' : '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    color: '#fff',
                    fontSize: '11px'
                  }}
                >
                  {amt.sol} SOL
                  <span style={{ color: '#666', marginLeft: '4px' }}>
                    ({amt.frequency}×)
                  </span>
                </button>
              ))}
          </div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '6px' }}>
            Click to set as chunk size (total = chunk × {privacyLevel} chunks)
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button 
        type="submit" 
        disabled={loading || !isFormValid}
        style={{
          width: '100%',
          padding: '14px',
          background: loading || !isFormValid ? '#333' : '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '600',
          cursor: loading || !isFormValid ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Processing...' : splitPreview?.result?.valid ? `Send ${splitPreview.result.totalSol} SOL Privately` : meetsMinimum ? `Send ${amountNum.toFixed(6)} SOL (Custom Split)` : 'Enter valid amount'}
      </button>

      {/* Flow info */}
      <div style={{ 
        marginTop: '16px', 
        padding: '12px',
        background: '#0a0a0a',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#888'
      }}>
        <strong style={{ color: '#fff' }}>How it works:</strong>
        <br />
        1. Your funds go to privacy pool as {privacyLevel} exact historical amounts
        <br />
        2. Each chunk withdrawn to a separate burner wallet
        <br />
        3. Burners re-deposit to pool (UTXOs belong to final burner)
        <br />
        4. Final burner withdraws all funds and sends to destination
        <br />
        <span style={{ color: '#f59e0b' }}>Using exact historical amounts maximizes privacy!</span>
      </div>
    </form>
  );
}
