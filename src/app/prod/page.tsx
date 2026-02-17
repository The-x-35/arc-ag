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
  const [amountUnit, setAmountUnit] = useState<'SOL' | 'USD'>('SOL');
  
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
  
  // Max transaction limit in USD (prod)
  const MAX_USD = 1000;
  const maxSolAmount = solPrice ? MAX_USD / solPrice : null;
  const maxUsdAmount = MAX_USD;
  
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
    const inputNum = parseFloat(amount);
    const amountSol = amountUnit === 'SOL'
      ? inputNum
      : solPrice
        ? inputNum / solPrice
        : 0;
    if (amountSol > 0) {
      const timer = setTimeout(() => {
        computeSplitPreview(amountSol, chunks);
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
  }, [amount, amountUnit, solPrice, chunks, computeSplitPreview]);
  
  // Handle selecting a suggested amount
  const handleSelectSuggestion = useCallback((sol: number) => {
    let clampedSol = sol;
    if (maxSolAmount && clampedSol > maxSolAmount) {
      clampedSol = maxSolAmount;
    }
    if (amountUnit === 'USD' && solPrice) {
      setAmount((clampedSol * solPrice).toString());
    } else {
      setAmount(clampedSol.toString());
    }
  }, [amountUnit, solPrice, maxSolAmount]);

  const handleAmountUnitChange = useCallback((unit: 'SOL' | 'USD') => {
    if (unit === amountUnit) return;
    if (unit === 'USD' && !solPrice) return;
    
    const current = parseFloat(amount);
    let next = current;
    if (!Number.isNaN(current) && solPrice) {
      if (amountUnit === 'SOL' && unit === 'USD') {
        next = current * solPrice;
      } else if (amountUnit === 'USD' && unit === 'SOL') {
        next = current / solPrice;
      }
    }
    setAmountUnit(unit);
    setAmount(Number.isNaN(next) ? '' : next.toString());
  }, [amount, amountUnit, solPrice]);
  
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
    const inputNum = parseFloat(amount);
    const amountSol = amountUnit === 'SOL'
      ? inputNum
      : solPrice
        ? inputNum / solPrice
        : 0;
    const minAmount = 0.035 * chunks;
    if (amountSol < minAmount) return;
    if (maxSolAmount && amountSol > maxSolAmount) return;
    
    try {
      let exactChunks: number[] | undefined;
      let sendAmount = amountSol;
      
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
  
  const inputNum = parseFloat(amount) || 0;
  const amountSolForUi = amountUnit === 'SOL'
    ? inputNum
    : solPrice
      ? inputNum / solPrice
      : 0;
  const minAmount = 0.035 * chunks;
  const meetsMinimum = amountSolForUi >= minAmount;
  const underMax = !maxSolAmount || amountSolForUi <= maxSolAmount;
  const isFormValid = connected && destination && amount && meetsMinimum && underMax && !loading;
  
  // Display-only equivalent for the other currency
  const equivalentText = (() => {
    if (!solPrice || !amount) return '';
    if (!isFinite(inputNum) || inputNum <= 0) return '';
    
    if (amountUnit === 'SOL') {
      const usd = amountSolForUi * solPrice;
      if (!isFinite(usd)) return '';
      return `($${usd.toFixed(2)})`;
    } else {
      const sol = inputNum / solPrice;
      if (!isFinite(sol)) return '';
      return `(${sol.toFixed(4)} SOL)`;
    }
  })();
  
  return (
    <main style={{ 
      minHeight: '100vh', 
      padding: '24px', 
      maxWidth: '800px', 
      margin: '0 auto',
      background: '#fff'
    }}>
      {/* Recovery Prompt */}
      {showRecoveryPrompt && connected && (
        <div style={{
          marginBottom: '24px',
          padding: '16px',
          background: '#f5f5f5',
          border: '1px solid #000',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#000', fontWeight: '600', marginBottom: '4px' }}>
              Active Session Found
            </div>
            <div style={{ color: '#666', fontSize: '13px' }}>
              You have an active transaction session. Would you like to recover and continue?
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleRecover}
              disabled={recovering}
              style={{
                padding: '8px 16px',
                background: '#000',
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
                background: '#e5e5e5',
                border: '1px solid #ccc',
                borderRadius: '6px',
                color: '#000',
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
        borderBottom: '1px solid #ddd'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/image.png" alt="VPM Logo" style={{ height: '32px', width: 'auto' }} />
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#000' }}>VPM</h1>
        </div>
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
        background: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px'
      }}>
        {/* Wallet Connect */}
        <div style={{ marginBottom: '20px' }}>
          {connected && publicKey ? (
            <div style={{
              padding: '12px',
              background: '#fff',
              borderRadius: '8px',
              border: '1px solid #ddd',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Connected</div>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#000' }}>
                  {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
                </div>
              </div>
              <WalletMultiButton style={{
                background: '#ddd',
                borderRadius: '6px',
                height: '32px',
                fontSize: '12px'
              }} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <WalletMultiButton style={{
                background: '#000',
                borderRadius: '8px',
                height: '44px',
                fontSize: '14px',
                fontWeight: '600'
              }} />
              <span style={{ fontSize: '12px', color: '#999' }}>
                Connect your Solana wallet
              </span>
            </div>
          )}
        </div>
        
        {/* Destination */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#000', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
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
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: '8px',
              color: '#000',
              fontSize: '14px'
            }}
          />
        </div>
        
        {/* Amount */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#000', display: 'block', marginBottom: '8px', fontSize: '14px' }}>
            Amount
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* SOL / USD switch on the left */}
            <div
              style={{
                display: 'flex',
                gap: '4px',
                background: '#fff',
                padding: '2px',
                borderRadius: '999px',
                border: '1px solid #ddd'
              }}
            >
              <button
                type="button"
                onClick={() => handleAmountUnitChange('SOL')}
                style={{
                  padding: '4px 8px',
                  borderRadius: '999px',
                  border: 'none',
                  fontSize: '11px',
                  cursor: 'pointer',
                  background: amountUnit === 'SOL' ? '#000' : 'transparent',
                  color: amountUnit === 'SOL' ? '#fff' : '#666',
                  minWidth: '36px'
                }}
              >
                SOL
              </button>
              <button
                type="button"
                onClick={() => handleAmountUnitChange('USD')}
                disabled={!solPrice}
                style={{
                  padding: '4px 8px',
                  borderRadius: '999px',
                  border: 'none',
                  fontSize: '11px',
                  cursor: !solPrice ? 'not-allowed' : 'pointer',
                  background: amountUnit === 'USD' ? '#000' : 'transparent',
                  color: !solPrice ? '#ccc' : amountUnit === 'USD' ? '#fff' : '#666',
                  minWidth: '36px',
                  opacity: !solPrice ? 0.5 : 1
                }}
              >
                $
              </button>
            </div>

            {/* Amount input on the right */}
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="number"
                step="0.01"
                min={amountUnit === 'SOL' ? 0.07 : solPrice ? (0.07 * solPrice).toFixed(2) : undefined}
                max={amountUnit === 'SOL' ? maxSolAmount ?? undefined : maxUsdAmount}
                value={amount}
                onChange={(e) => {
                  const next = e.target.value;
                  const num = parseFloat(next);
                  if (Number.isNaN(num)) {
                    setAmount(next);
                    return;
                  }
                  if (amountUnit === 'SOL') {
                    if (maxSolAmount && num > maxSolAmount) {
                      setAmount(maxSolAmount.toString());
                    } else {
                      setAmount(next);
                    }
                  } else {
                    if (num > maxUsdAmount) {
                      setAmount(maxUsdAmount.toString());
                    } else {
                      setAmount(next);
                    }
                  }
                }}
                placeholder={amountUnit === 'SOL' ? 'Enter amount in SOL' : 'Enter amount in USD'}
                disabled={loading || (amountUnit === 'USD' && !solPrice)}
                required
                style={{
                  width: '100%',
                  padding: '12px 80px 12px 16px',
                  background: '#fff',
                  border: `1px solid ${splitPreview?.result?.valid ? '#22c55e' : splitPreview?.result?.error ? '#ef4444' : '#ddd'}`,
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
              {equivalentText && (
                <span
                  style={{
                    position: 'absolute',
                    right: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    color: '#999',
                    pointerEvents: 'none',
                    fontFamily: 'monospace',
                    maxWidth: '70px',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {equivalentText}
                </span>
              )}
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#999', marginTop: '4px' }}>
            Min {formatSolAmount(0.035 * chunks, solPrice, 2)} ({chunks} × {formatSolAmount(0.035, solPrice, 3)} per chunk)
            {maxSolAmount && (
              <> • Max {formatSolAmount(maxSolAmount, solPrice, 2)} (USD ${MAX_USD.toFixed(0)})</>
            )}
          </div>
        </div>
        
        {/* Split Preview */}
        {amount && parseFloat(amount) > 0 && splitPreview && (
          <div style={{ marginBottom: '20px' }}>
            {splitPreview?.loading ? (
              <div style={{ 
                padding: '16px',
                background: '#fafafa',
                borderRadius: '8px',
                border: '1px solid #ddd',
                textAlign: 'center',
                color: '#666',
                fontSize: '13px'
              }}>
                Calculating optimal split...
              </div>
            ) : splitPreview?.result?.valid ? (
              <div style={{ 
                padding: '12px',
                background: '#f0fdf4',
                borderRadius: '8px',
                border: '1px solid #22c55e'
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
                        background: '#dcfce7',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: '#166534',
                        border: '1px solid #22c55e'
                      }}
                    >
                      {formatSolAmount(chunk.sol, solPrice, 6)}
                      {chunk.isHistorical && chunk.frequency && (
                        <span style={{ marginLeft: '4px', fontSize: '10px', color: '#666' }}>
                          ({chunk.frequency}×)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ 
                  fontSize: '11px', 
                  color: '#666',
                  marginTop: '8px'
                }}>
                  Total: {formatSolAmount(splitPreview.result.totalSol, solPrice, 6)} • Each chunk matches historical transactions
                </div>
              </div>
            ) : splitPreview?.result?.error ? (
              <div style={{ 
                padding: '12px',
                background: '#fef2f2',
                borderRadius: '8px',
                border: '1px solid #ef4444'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#ef4444', fontSize: '16px' }}>
                    ✗
                  </span>
                  <span style={{ color: '#ef4444', fontSize: '13px' }}>
                    This amount is not secure to send based on historical transactions.
                  </span>
                </div>
                {splitPreview?.suggestions && splitPreview.suggestions.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>
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
                            background: '#e5e5e5',
                            border: '1px solid #ccc',
                            borderRadius: '6px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            color: '#000',
                            fontSize: '12px',
                            opacity: loading ? 0.6 : 1
                          }}
                        >
                          <div style={{ fontWeight: '600' }}>
                            {formatSolAmount(suggestion.sol, solPrice, 6)}
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
            <label style={{ color: '#666', display: 'block', marginBottom: '8px', fontSize: '12px' }}>
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
                      background: amt.isHistorical ? '#e5e5e5' : '#f5f5f5',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      color: '#000',
                      fontSize: '11px',
                      opacity: loading ? 0.6 : 1
                    }}
                  >
                    {formatSolAmount(amt.sol, solPrice, 3)}
                    <span style={{ color: '#999', marginLeft: '4px' }}>
                      ({amt.frequency}×)
                    </span>
                  </button>
                ))}
            </div>
            <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>
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
                background: '#000',
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
            background: isFormValid ? '#000' : '#ccc',
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
              ? `Send ${formatSolAmount(amountSolForUi, solPrice, 6)} (Custom Split)` 
              : 'Enter valid amount'}
        </button>
      </div>
      
      {/* Burner Wallets Section */}
      {showBurnerWallets && burnerWallets && burnerWallets.length > 0 && (
        <div style={{
          background: '#f5f5f5',
          border: '1px solid #ddd',
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
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#000' }}>
              🔑 Burner Wallets
            </h3>
            <button
              type="button"
              onClick={() => setShowBurnerWallets(false)}
              style={{
                padding: '6px 12px',
                background: '#e5e5e5',
                border: '1px solid #ccc',
                borderRadius: '6px',
                color: '#000',
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
                background: '#fafafa',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '12px'
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span style={{ fontWeight: '600', color: '#000', fontSize: '13px' }}>
                    {burner.index === 0 ? 'First Burner' : burner.index === -1 ? 'Final Burner' : `Burner ${burner.index}`}
                  </span>
                  <span style={{
                    padding: '2px 8px',
                    background: '#e5e5e5',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#666'
                  }}>
                    EOA
                  </span>
                </div>
                
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>Address</div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    color: '#000',
                    wordBreak: 'break-all',
                    background: '#fff',
                    padding: '6px',
                    borderRadius: '4px'
                  }}>
                    {burner.address}
                  </div>
                </div>
                
                <div>
                  <div style={{ fontSize: '10px', color: '#999', marginBottom: '2px' }}>
                    Private Key (Base58)
                  </div>
                  <div style={{
                    fontFamily: 'monospace',
                    fontSize: '9px',
                    color: '#333',
                    wordBreak: 'break-all',
                    background: '#f0f0f0',
                    padding: '6px',
                    borderRadius: '4px',
                    border: '1px solid #ddd'
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
                      background: '#e5e5e5',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '10px',
                      color: '#666',
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
                    color: '#000'
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
