'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSolanaRpc } from '@/lib/config/networks';
import { poolRegistry } from '@/lib/pools/registry';
import { privacyCashPool } from '@/lib/pools/privacy-cash';
import { shadowPayPool } from '@/lib/pools/shadowpay';
import { transactionIndexer } from '@/lib/indexer/transaction-indexer';
import { useWalletPrivateSend } from '@/hooks/useWalletPrivateSend';
import { useSessionRecovery, SessionData } from '@/hooks/useSessionRecovery';
import { useSolPrice, formatSolAmount } from '@/hooks/useSolPrice';
import PrivacySlider from '@/components/PrivacySlider';
import PrivacyProgressBar from '@/components/PrivacyProgressBar';
import PrivacySettingsModal from '@/components/PrivacySettingsModal';
import ProdMenu from '@/components/ProdMenu';

// Ensure pools are registered
if (poolRegistry.isEmpty()) {
  poolRegistry.register(privacyCashPool);
  poolRegistry.register(shadowPayPool);
}

export default function ProdPage() {
  // Form state
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  
  // Privacy slider state (0-100, maps to 2-10 chunks and 0-240 min)
  const [privacySliderValue, setPrivacySliderValue] = useState(25); // Default: ~4 chunks, ~60 min
  
  // Derived values from slider
  const chunks = Math.round(2 + (privacySliderValue / 100) * 8);
  const delayMinutes = Math.round((privacySliderValue / 100) * 240);
  
  // Settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBurnerWallets, setShowBurnerWallets] = useState(false);
  
  // Pool state
  const [pools, setPools] = useState<Array<{
    id: string;
    name: string;
    description: string;
    isAvailable: boolean;
  }>>([]);
  const [selectedPools, setSelectedPools] = useState<string[]>(['privacy-cash']);
  const [poolsLoading, setPoolsLoading] = useState(true);
  
  // Split preview state
  const [splitPreview, setSplitPreview] = useState<{
    loading: boolean;
    result: {
      valid: boolean;
      chunks: Array<{ lamports: number; sol: number; isHistorical?: boolean; frequency?: number }>;
      totalSol: number;
      error?: string;
    } | null;
    availableAmounts: Array<{ sol: number; frequency: number; isHistorical: boolean }>;
    suggestions: Array<{ amount: number; sol: number; chunks: number[] }>;
  }>({
    loading: false,
    result: null,
    availableAmounts: [],
    suggestions: [],
  });
  
  // Connection ref for indexing
  const connectionRef = useRef<Connection | null>(null);
  
  // Wallet state
  const { connected, publicKey } = useWallet();
  
  // Hooks
  const walletSend = useWalletPrivateSend();
  const { steps, loading, error, result, reset, burnerWallets, recoverAndContinue, hasActiveSession } = walletSend;
  const { getSessionHistory } = useSessionRecovery();
  const { price: solPrice } = useSolPrice();
  
  // Recovery state
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [recovering, setRecovering] = useState(false);
  
  // Initialize connection
  useEffect(() => {
    connectionRef.current = new Connection(getSolanaRpc('mainnet'), 'confirmed');
  }, []);
  
  // Check for active session on mount
  useEffect(() => {
    if (connected && hasActiveSession && !loading) {
      setShowRecoveryPrompt(true);
    }
  }, [connected, hasActiveSession, loading]);
  
  // Load pools and available amounts on mount
  useEffect(() => {
    async function loadData() {
      try {
        const connection = connectionRef.current || new Connection(getSolanaRpc('mainnet'), 'confirmed');
        const poolInfos = await poolRegistry.getPoolInfo(connection);
        setPools(poolInfos.map(p => ({
          ...p,
        })));
        
        // Load available amounts for recommendations
        const availableAmounts = await transactionIndexer.getAvailableAmounts(connection, 100);
        setSplitPreview(prev => ({
          ...prev,
          availableAmounts,
        }));
      } catch (err) {
        console.error('Failed to load pools:', err);
        setPools([{
          id: 'privacy-cash',
          name: 'Privacy Cash',
          description: 'Zero-knowledge privacy pool for SOL',
          isAvailable: true,
        }]);
      } finally {
        setPoolsLoading(false);
      }
    }
    
    loadData();
  }, []);
  
  // Compute split preview when amount or chunks changes
  const computeSplitPreview = useCallback(async (amountSol: number, numChunks: number) => {
    if (!amountSol || amountSol <= 0) {
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: null,
        suggestions: [],
      }));
      return;
    }
    
    setSplitPreview(prev => ({ ...prev, loading: true }));
    
    try {
      const connection = connectionRef.current || new Connection(getSolanaRpc('mainnet'), 'confirmed');
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      
      const poolsToUse = selectedPools.length > 0 ? selectedPools : undefined;
      const splitResult = await transactionIndexer.findExactSplit(connection, amountLamports, numChunks, poolsToUse);
      
      // Get suggestions ONLY if split not valid
      let suggestions: { amount: number; sol: number; chunks: number[] }[] = [];
      if (!splitResult.valid) {
        suggestions = await transactionIndexer.getSuggestedAmounts(connection, amountLamports, numChunks, poolsToUse);
      }
      
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: splitResult,
        suggestions,
      }));
    } catch (err) {
      console.error('Error computing split:', err);
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: {
          valid: false,
          chunks: [],
          totalLamports: 0,
          totalSol: 0,
          error: 'Failed to compute split',
        },
        suggestions: [],
      }));
    }
  }, [selectedPools]);
  
  // Debounced amount change handler
  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (amountNum > 0) {
      const timer = setTimeout(() => {
        computeSplitPreview(amountNum, chunks);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: null,
        suggestions: [],
      }));
    }
  }, [amount, chunks, computeSplitPreview]);
  
  // Handle selecting a suggested amount
  const handleSelectSuggestion = useCallback((sol: number) => {
    setAmount(sol.toString());
  }, []);
  
  // Handle recovery
  const handleRecover = useCallback(async () => {
    if (!publicKey) return;
    
    setRecovering(true);
    setShowRecoveryPrompt(false);
    try {
      const params = await recoverAndContinue();
      if (params) {
        setDestination(params.destination);
        setAmount(params.amount.toString());
        // Update slider to match session values
        const sliderValue = Math.round(((params.numChunks - 2) / 8) * 100);
        setPrivacySliderValue(sliderValue);
        if (params.selectedPools) {
          setSelectedPools(params.selectedPools);
        }
      }
    } catch (err: any) {
      console.error('Recovery failed:', err);
      setShowRecoveryPrompt(true);
    } finally {
      setRecovering(false);
    }
  }, [recoverAndContinue, publicKey]);
  
  // Handle session recovery from menu
  const handleRecoverSession = useCallback(async (session: SessionData) => {
    try {
      const params = session.transaction_params;
      setDestination(params.destination);
      setAmount(params.amount.toString());
      const sliderValue = Math.round(((params.numChunks - 2) / 8) * 100);
      setPrivacySliderValue(sliderValue);
      if (params.selectedPools) {
        setSelectedPools(params.selectedPools);
      }
      await recoverAndContinue(session);
    } catch (err: any) {
      console.error('Failed to recover session:', err);
      alert(`Failed to recover session: ${err.message}`);
    }
  }, [recoverAndContinue]);
  
  // Handle settings save
  const handleSettingsSave = useCallback((newChunks: number, newTimeMinutes: number) => {
    // Calculate slider value from chunks and time
    // For chunks: reverse the formula chunks = 2 + (value/100) * 8
    const chunksValue = ((newChunks - 2) / 8) * 100;
    // For time: reverse the formula time = (value/100) * 240
    const timeValue = (newTimeMinutes / 240) * 100;
    // Average the two values for slider position
    const avgValue = (chunksValue + timeValue) / 2;
    setPrivacySliderValue(Math.round(Math.max(0, Math.min(100, avgValue))));
  }, []);
  
  // Handle submit
  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    const minAmount = 0.035 * chunks;
    if (amountNum < minAmount) return;
    
    try {
      let exactChunks: number[] | undefined;
      let sendAmount = amountNum;
      
      if (splitPreview.result?.valid && splitPreview.result.chunks.length > 0) {
        exactChunks = splitPreview.result.chunks.map(c => c.lamports);
        sendAmount = splitPreview.result.totalSol;
      }
      
      await walletSend.execute({
        destination,
        amount: sendAmount,
        numChunks: chunks,
        delayMinutes,
        sponsorFees: false,
        exactChunks,
        selectedPools: selectedPools.length > 0 ? selectedPools : undefined,
      });
    } catch (err) {
      console.error('Send failed:', err);
    }
  };
  
  const amountNum = parseFloat(amount) || 0;
  const minAmount = 0.035 * chunks;
  const meetsMinimum = amountNum >= minAmount;
  const isFormValid = connected && destination && amount && meetsMinimum && !loading;
  
  return (
    <main style={{ 
      minHeight: '100vh', 
      padding: '24px', 
      maxWidth: '800px', 
      margin: '0 auto',
      background: '#000'
    }}>
      {/* Recovery Prompt */}
      {showRecoveryPrompt && connected && (
        <div style={{
          marginBottom: '24px',
          padding: '16px',
          background: '#1a1a2e',
          border: '1px solid #3b82f6',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#fff', fontWeight: '600', marginBottom: '4px' }}>
              Active Session Found
            </div>
            <div style={{ color: '#888', fontSize: '13px' }}>
              You have an active transaction session. Would you like to recover and continue?
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleRecover}
              disabled={recovering}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontWeight: '600',
                cursor: recovering ? 'not-allowed' : 'pointer',
                opacity: recovering ? 0.6 : 1,
                fontSize: '13px'
              }}
            >
              {recovering ? 'Recovering...' : 'Recover'}
            </button>
            <button
              onClick={() => setShowRecoveryPrompt(false)}
              disabled={recovering}
              style={{
                padding: '8px 16px',
                background: '#222',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#fff',
                cursor: recovering ? 'not-allowed' : 'pointer',
                fontSize: '13px'
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      
      {/* Header */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '32px',
        paddingBottom: '16px',
        borderBottom: '1px solid #333'
      }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>Private Send</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ProdMenu
            onShowBurners={() => setShowBurnerWallets(!showBurnerWallets)}
            onShowSettings={() => setShowSettingsModal(true)}
            onRecoverSession={handleRecoverSession}
          />
        </div>
      </header>
      
      {/* Main Form */}
      <div style={{
        background: '#111',
        border: '1px solid #333',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px'
      }}>
        {/* Wallet Connect */}
        <div style={{ marginBottom: '20px' }}>
          {connected && publicKey ? (
            <div style={{
              padding: '12px',
              background: '#000',
              borderRadius: '8px',
              border: '1px solid #333',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Connected</div>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#22c55e' }}>
                  {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                </div>
              </div>
              <WalletMultiButton style={{
                background: '#333',
                borderRadius: '6px',
                height: '32px',
                fontSize: '12px'
              }} />
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
                Connect your Solana wallet
              </span>
            </div>
          )}
        </div>
        
        {/* Destination */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Destination Address
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Solana wallet address"
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
        
        {/* Amount */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#fff', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Amount (SOL)
          </label>
          <input
            type="number"
            step="0.01"
            min="0.07"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
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
            Min {formatSolAmount(0.035 * chunks, solPrice, 2)} ({chunks} × {formatSolAmount(0.035, solPrice, 3)} per chunk)
          </div>
        </div>
        
        {/* Split Preview */}
        {amount && parseFloat(amount) > 0 && splitPreview && (
          <div style={{ marginBottom: '20px' }}>
            {splitPreview?.loading ? (
              <div style={{ 
                padding: '16px',
                background: '#0a0a0a',
                borderRadius: '8px',
                border: '1px solid #333',
                textAlign: 'center',
                color: '#888',
                fontSize: '13px'
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
                      {formatSolAmount(chunk.sol, solPrice, 6)}
                      {chunk.isHistorical && chunk.frequency && (
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
                  Total: {formatSolAmount(splitPreview.result.totalSol, solPrice, 6)} • Each chunk matches historical transactions
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
                    ⚠ Amount below recommended minimum ({formatSolAmount(minAmount, solPrice, 3)} for {chunks} chunks)
                    <br />
                    <span style={{ color: '#888', fontSize: '11px' }}>
                      Each chunk will be {formatSolAmount(amountNum / chunks, solPrice, 6)} (minimum recommended: {formatSolAmount(0.035, solPrice, 3)} per chunk)
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
                    ⚠ Custom amount: Will split equally into {chunks} chunks of {formatSolAmount(amountNum / chunks, solPrice, 6)} each
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
                          onClick={() => handleSelectSuggestion(suggestion.sol)}
                          disabled={loading}
                          style={{
                            padding: '8px 12px',
                            background: '#222',
                            border: '1px solid #444',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            color: '#fff',
                            fontSize: '12px',
                            opacity: loading ? 0.6 : 1
                          }}
                        >
                          <div style={{ fontWeight: '600' }}>{formatSolAmount(suggestion.sol, solPrice, 6)}</div>
                          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
                            {suggestion.chunks.map(c => formatSolAmount(c, solPrice, 6)).join(' + ')}
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
        
        {/* Recommended Amounts */}
        {splitPreview?.availableAmounts && splitPreview.availableAmounts.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#888', display: 'block', marginBottom: '8px', fontSize: '12px' }}>
              Recommended amounts (from historical transactions):
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {splitPreview.availableAmounts
                .filter(a => a.frequency > 0)
                .slice(0, 8)
                .map((amt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectSuggestion(amt.sol * chunks)}
                    disabled={loading}
                    style={{
                      padding: '6px 10px',
                      background: amt.isHistorical ? '#1a1a2e' : '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      color: '#fff',
                      fontSize: '11px',
                      opacity: loading ? 0.6 : 1
                    }}
                  >
                    {formatSolAmount(amt.sol, solPrice, 6)}
                    <span style={{ color: '#666', marginLeft: '4px' }}>
                      ({amt.frequency}×)
                    </span>
                  </button>
                ))}
            </div>
            <div style={{ fontSize: '10px', color: '#666', marginTop: '6px' }}>
              Click to set as chunk size (total = chunk × {chunks} chunks)
            </div>
          </div>
        )}
        
        {/* Privacy Slider */}
        <div style={{ marginBottom: '24px' }}>
          <PrivacySlider
            value={privacySliderValue}
            onChange={setPrivacySliderValue}
            onSettingsClick={() => setShowSettingsModal(true)}
            disabled={loading}
          />
        </div>
        
        {/* Progress Bar */}
        {steps.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <PrivacyProgressBar steps={steps} />
          </div>
        )}
        
        {/* Error Display */}
        {error && (
          <div style={{
            marginBottom: '20px',
            padding: '12px',
            background: '#1a0000',
            border: '1px solid #500',
            borderRadius: '8px',
            color: '#f55',
            fontSize: '13px'
          }}>
            {error}
          </div>
        )}
        
        {/* Success Display */}
        {result && (
          <div style={{
            marginBottom: '20px',
            padding: '12px',
            background: '#001a00',
            border: '1px solid #050',
            borderRadius: '8px',
            color: '#5f5',
            fontSize: '13px'
          }}>
            <div style={{ marginBottom: '8px' }}>
              ✓ Complete! Sent {formatSolAmount(result.totalAmount, solPrice, 6)} to {result.recipient.slice(0,8)}...{result.recipient.slice(-8)}
            </div>
            <button
              type="button"
              onClick={() => {
                reset();
                setDestination('');
                setAmount('');
                setPrivacySliderValue(25);
              }}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Send Another
            </button>
          </div>
        )}
        
        {/* Submit Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isFormValid}
          style={{
            width: '100%',
            padding: '14px',
            background: isFormValid ? '#3b82f6' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: isFormValid ? 'pointer' : 'not-allowed',
            opacity: isFormValid ? 1 : 0.6
          }}
        >
          {loading ? 'Processing...' : splitPreview?.result?.valid 
            ? `Send ${formatSolAmount(splitPreview.result.totalSol, solPrice, 6)} Privately` 
            : meetsMinimum 
              ? `Send ${formatSolAmount(amountNum, solPrice, 6)} (Custom Split)` 
              : 'Enter valid amount'}
        </button>
      </div>
      
      {/* Burner Wallets Section */}
      {showBurnerWallets && burnerWallets && burnerWallets.length > 0 && (
        <div style={{
          background: '#111',
          border: '1px solid #333',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#fff' }}>
              🔑 Burner Wallets
            </h3>
            <button
              type="button"
              onClick={() => setShowBurnerWallets(false)}
              style={{
                padding: '6px 12px',
                background: '#222',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Hide
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {burnerWallets.map((burner, i) => (
              <div key={i} style={{
                background: '#0a0a0a',
                border: '1px solid #222',
                borderRadius: '8px',
                padding: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{ fontWeight: '600', color: '#fff', fontSize: '13px' }}>
                    {burner.index === 0 ? 'First Burner' : burner.index === -1 ? 'Final Burner' : `Burner ${burner.index}`}
                  </span>
                  <span style={{
                    padding: '2px 8px',
                    background: '#1a1a2e',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#888'
                  }}>
                    EOA
                  </span>
                </div>
                
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>Address</div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    color: '#3b82f6',
                    wordBreak: 'break-all',
                    background: '#000',
                    padding: '6px',
                    borderRadius: '4px'
                  }}>
                    {burner.address}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '10px', color: '#666', marginBottom: '2px' }}>
                    Private Key (Base58)
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '9px',
                    color: '#f59e0b',
                    wordBreak: 'break-all',
                    background: '#0f0f00',
                    padding: '6px',
                    borderRadius: '4px',
                    border: '1px solid #332'
                  }}>
                    {burner.privateKey}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (burner.privateKey) navigator.clipboard.writeText(burner.privateKey);
                    }}
                    style={{
                      marginTop: '6px',
                      padding: '4px 8px',
                      background: '#222',
                      border: '1px solid #333',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#888',
                      cursor: 'pointer'
                    }}
                  >
                    Copy Key
                  </button>
                </div>
                
                <a
                  href={`https://solscan.io/account/${burner.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: '8px',
                    fontSize: '10px',
                    color: '#3b82f6'
                  }}
                >
                  View on Solscan →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Settings Modal */}
      <PrivacySettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        chunks={chunks}
        timeMinutes={delayMinutes}
        onSave={handleSettingsSave}
        selectedPools={selectedPools}
        onPoolsChange={setSelectedPools}
        availablePools={pools}
      />
    </main>
  );
}
