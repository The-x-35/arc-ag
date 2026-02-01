'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import SendForm, { SplitPreview } from '@/components/SendForm';
import PoolSelector from '@/components/PoolSelector';
import { useWalletPrivateSend } from '@/hooks/useWalletPrivateSend';
import { useSessionRecovery } from '@/hooks/useSessionRecovery';
import { BurnerType } from '@/types';
import { poolRegistry } from '@/lib/pools/registry';
import { privacyCashPool } from '@/lib/pools/privacy-cash';
import { shadowPayPool } from '@/lib/pools/shadowpay';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSolanaRpc } from '@/lib/config/networks';
import { transactionIndexer, AvailableAmount, ExactSplitResult } from '@/lib/indexer/transaction-indexer';

// Ensure pools are registered
if (poolRegistry.isEmpty()) {
  poolRegistry.register(privacyCashPool);
  poolRegistry.register(shadowPayPool);
}

// Flow step definitions for EOA mode
const EOA_FLOW_STEPS = [
  { id: 1, label: 'Validate Inputs', description: 'Check wallet and addresses' },
  { id: 2, label: 'Generate First Burner', description: 'Create first intermediate wallet' },
  { id: 3, label: 'Send to First Burner', description: 'Sign to send funds to first burner' },
  { id: 4, label: 'First Burner Deposits', description: 'Deposit to pool in chunks with delays' },
  { id: 5, label: 'Wait for Indexing', description: 'Wait for UTXO to be indexed' },
  { id: 6, label: 'Privacy Delay', description: 'Remaining privacy delay' },
  { id: 7, label: 'Generate Burner Keypairs', description: 'Create additional burner wallets' },
  { id: 8, label: 'Generate Final Burner', description: 'Create final burner wallet for consolidation' },
  { id: 9, label: 'Withdraw to Burners', description: 'Withdraw with random delays' },
  { id: 10, label: 'Re-deposit from Burners', description: 'Burners deposit back to pool (UTXOs to final burner)' },
  { id: 11, label: 'Wait for Indexing', description: 'Wait for re-deposit UTXOs to be indexed' },
  { id: 12, label: 'Final Burner Withdraws', description: 'Final burner withdraws all funds from pool' },
  { id: 13, label: 'Final Transfer', description: 'Final burner sends to destination' },
];

export default function Home() {
  // Form state
  const [privateKey, setPrivateKey] = useState('');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [privacyLevel, setPrivacyLevel] = useState(2);
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [burnerType, setBurnerType] = useState<BurnerType>('eoa');
  const [sponsorFees, setSponsorFees] = useState(false);
  
  // Split preview state
  const [splitPreview, setSplitPreview] = useState<SplitPreview>({
    loading: false,
    result: null,
    availableAmounts: [],
    suggestions: [],
  });
  
  // Connection ref for indexing
  const connectionRef = useRef<Connection | null>(null);
  
  // Wallet state
  const { connected, publicKey } = useWallet();
  
  // Pool state
  const [pools, setPools] = useState<Array<{
    id: string;
    name: string;
    description: string;
    isAvailable: boolean;
    transactionCount?: number;
  }>>([]);
  const [selectedPools, setSelectedPools] = useState<string[]>(['privacy-cash']);
  const [poolsLoading, setPoolsLoading] = useState(true);

  // Hook for EOA mode
  const walletSend = useWalletPrivateSend();
  const { steps, loading, error, result, reset, burnerWallets, recoverAndContinue, hasActiveSession, recoveryMode } = walletSend;
  const flowSteps = EOA_FLOW_STEPS;
  
  // Recovery state
  const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
  const [recovering, setRecovering] = useState(false);
  
  // Session history state
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  // Session recovery hook
  const { getSessionHistory, recoverSession } = useSessionRecovery();

  // Initialize connection
  useEffect(() => {
    connectionRef.current = new Connection(getSolanaRpc('mainnet'), 'confirmed');
  }, []);

  // Check for active session on mount
  useEffect(() => {
    if (connected && hasActiveSession && !loading && !recoveryMode) {
      setShowRecoveryPrompt(true);
    }
  }, [connected, hasActiveSession, loading, recoveryMode]);
  
  // Load pools and available amounts on mount
  useEffect(() => {
    async function loadData() {
      try {
        const connection = connectionRef.current || new Connection(getSolanaRpc('mainnet'), 'confirmed');
        
        // Load pool info
        const poolInfos = await poolRegistry.getPoolInfo(connection);
        setPools(poolInfos.map(p => ({
          ...p,
          transactionCount: undefined,
        })));
        
        // Load available amounts for split preview
        const availableAmounts = await transactionIndexer.getAvailableAmounts(connection, 100);
        setSplitPreview(prev => ({
          ...prev,
          availableAmounts,
        }));
        
      } catch (err) {
        console.error('Failed to load data:', err);
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
  
  // Handle recovery
  const handleRecover = useCallback(async () => {
    if (!publicKey) return;
    
    setRecovering(true);
    setShowRecoveryPrompt(false);
    try {
      // Fetch the active session to restore form state
      const session = await recoverSession(publicKey.toBase58());
      
      if (session) {
        // Restore form state from session
        const params = session.transaction_params;
        setDestination(params.destination);
        setAmount(params.amount.toString());
        setPrivacyLevel(params.numChunks);
        setDelayMinutes(params.delayMinutes);
        if (params.selectedPools) {
          setSelectedPools(params.selectedPools);
        }
        
        // Continue the session with the fetched session data
        await recoverAndContinue(session);
      } else {
        throw new Error('No active session found');
      }
    } catch (err: any) {
      console.error('Recovery failed:', err);
      // Error is handled by the hook's error state
      setShowRecoveryPrompt(true); // Show prompt again on error
    } finally {
      setRecovering(false);
    }
  }, [recoverAndContinue, publicKey, recoverSession]);
  
  // Handle dismiss recovery
  const handleDismissRecovery = useCallback(() => {
    setShowRecoveryPrompt(false);
  }, []);
  
  // Load session history
  const loadSessionHistory = useCallback(async () => {
    if (!connected || !publicKey) return;
    
    setLoadingHistory(true);
    try {
      const sessions = await getSessionHistory(publicKey.toBase58(), { limit: 50 });
      setSessionHistory(sessions);
    } catch (err: any) {
      console.error('Failed to load session history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [connected, publicKey, getSessionHistory]);
  
  // Load history when showing history panel
  useEffect(() => {
    if (showSessionHistory && connected && publicKey) {
      loadSessionHistory();
    }
  }, [showSessionHistory, connected, publicKey, loadSessionHistory]);

  // Compute split preview when amount or privacy level changes
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
      
      // Use selected pools (or all if none selected)
      const poolsToUse = selectedPools.length > 0 ? selectedPools : undefined;
      
      // Find exact split
      const splitResult = await transactionIndexer.findExactSplit(connection, amountLamports, numChunks, poolsToUse);
      
      // Get suggestions ONLY if split not valid
      let suggestions: { amount: number; sol: number; chunks: number[] }[] = [];
      if (!splitResult.valid) {
        suggestions = await transactionIndexer.getSuggestedAmounts(connection, amountLamports, numChunks, poolsToUse);
      } else {
        // Clear suggestions when we have a valid split
        suggestions = [];
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
  }, []);

  // Debounced amount change handler
  useEffect(() => {
    const amountNum = parseFloat(amount);
    if (amountNum > 0) {
      const timer = setTimeout(() => {
        computeSplitPreview(amountNum, privacyLevel);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSplitPreview(prev => ({
        ...prev,
        result: null,
        suggestions: [],
      }));
    }
  }, [amount, privacyLevel, computeSplitPreview]);

  const handleAmountChange = (value: string) => {
    setAmount(value);
  };

  const handleSelectSuggestion = (sol: number) => {
    setAmount(sol.toString());
  };

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    const minAmount = 0.035 * privacyLevel; // MIN_CHUNK_LAMPORTS per chunk
    if (amountNum < minAmount) return;
    
    try {
      let chunks: number[] | undefined;
      let sendAmount = amountNum;
      
      // If we have a valid exact split, use it
      if (splitPreview.result?.valid && splitPreview.result.chunks.length > 0) {
        chunks = splitPreview.result.chunks.map(c => c.lamports);
        sendAmount = splitPreview.result.totalSol;
      }
      // Otherwise, use equal split (custom amount)
      // The hook will handle equal splitting if exactChunks is not provided
      
      await walletSend.execute({
        destination,
        amount: sendAmount,
        numChunks: privacyLevel,
        delayMinutes,
        sponsorFees,
        exactChunks: chunks, // Pass exact chunk amounts if available, undefined for equal split
        selectedPools: selectedPools.length > 0 ? selectedPools : undefined, // Pass selected pools
      });
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  const handleReset = () => {
    reset();
  };

  // Get step status from hook steps
  const getStepStatus = (stepId: number) => {
    const hookStep = steps.find(s => s.id === stepId);
    return hookStep?.status || 'pending';
  };

  const getStepMessage = (stepId: number) => {
    const hookStep = steps.find(s => s.id === stepId);
    return hookStep?.message;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'running': return '#3b82f6';
      case 'error': return '#ef4444';
      default: return '#444';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✓';
      case 'running': return '●';
      case 'error': return '✗';
      default: return '○';
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
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
              {recovering ? 'Recovering...' : 'Recover Session'}
            </button>
            <button
              onClick={handleDismissRecovery}
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
        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Arc Aggregator</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a 
            href="/test-indexer" 
            style={{ 
              padding: '4px 12px', 
              background: '#222', 
              borderRadius: '4px',
              fontSize: '12px',
              border: '1px solid #333',
              color: '#fff',
              textDecoration: 'none'
            }}
          >
            Test Indexer
          </a>
          {connected && (
            <button
              onClick={() => setShowSessionHistory(!showSessionHistory)}
              style={{
                padding: '4px 12px',
                background: showSessionHistory ? '#3b82f6' : '#222',
                borderRadius: '4px',
                fontSize: '12px',
                border: '1px solid #333',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              {showSessionHistory ? 'Hide' : 'View'} Sessions
            </button>
          )}
          <span style={{ 
            padding: '4px 12px', 
            background: '#1a1a1a', 
            borderRadius: '4px',
            fontSize: '12px',
            border: '1px solid #333'
          }}>Mainnet</span>
        </div>
      </header>
      
      {/* Session History Panel */}
      {showSessionHistory && connected && (
        <div style={{
          marginBottom: '24px',
          padding: '16px',
          background: '#111',
          border: '1px solid #333',
          borderRadius: '8px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>
              Session History
            </h3>
            <button
              onClick={loadSessionHistory}
              disabled={loadingHistory}
              style={{
                padding: '6px 12px',
                background: '#222',
                border: '1px solid #444',
                borderRadius: '6px',
                color: '#fff',
                cursor: loadingHistory ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                opacity: loadingHistory ? 0.6 : 1
              }}
            >
              {loadingHistory ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          
          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
              Loading sessions...
            </div>
          ) : sessionHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
              No sessions found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {sessionHistory.map((session) => {
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
                      padding: '12px',
                      background: '#0a0a0a',
                      border: `1px solid ${statusColors[session.status] || '#333'}`,
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ color: '#fff', fontWeight: '600', marginBottom: '4px' }}>
                          {date.toLocaleString()}
                        </div>
                        <div style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace' }}>
                          {session.id.slice(0, 8)}...{session.id.slice(-8)}
                        </div>
                      </div>
                      <span style={{
                        padding: '2px 8px',
                        background: statusColors[session.status] || '#666',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: '600',
                        textTransform: 'uppercase'
                      }}>
                        {session.status}
                      </span>
                    </div>
                    
                    <div style={{ color: '#888', marginTop: '8px' }}>
                      <div>Amount: {params.amount} SOL</div>
                      <div>Chunks: {params.numChunks}</div>
                      <div>Destination: {params.destination.slice(0, 8)}...{params.destination.slice(-8)}</div>
                      <div>Step: {session.current_step} / 13</div>
                      {session.signatures && session.signatures.length > 0 && (
                        <div>Signatures: {session.signatures.length}</div>
                      )}
                    </div>
                    
                    {(session.status === 'pending' || session.status === 'in_progress') && (
                      <button
                        onClick={async () => {
                          try {
                            // Restore form state from session
                            const params = session.transaction_params;
                            setDestination(params.destination);
                            setAmount(params.amount.toString());
                            setPrivacyLevel(params.numChunks);
                            setDelayMinutes(params.delayMinutes);
                            if (params.selectedPools) {
                              setSelectedPools(params.selectedPools);
                            }
                            
                            // Close history panel
                            setShowSessionHistory(false);
                            
                            // Continue the session
                            await recoverAndContinue(session);
                          } catch (err: any) {
                            console.error('Failed to continue session:', err);
                            alert(`Failed to continue session: ${err.message}`);
                          }
                        }}
                        style={{
                          marginTop: '8px',
                          padding: '6px 12px',
                          background: '#3b82f6',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#fff',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontWeight: '600'
                        }}
                      >
                        Continue Session
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Content - 3 columns */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr 1fr', 
        gap: '24px',
        alignItems: 'start'
      }}>
        {/* Left Column - Form */}
        <div>
          <div style={{ 
            background: '#111', 
            border: '1px solid #333', 
            borderRadius: '12px', 
            padding: '24px' 
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>
              Send SOL Privately
            </h2>
            <p style={{ color: '#999', fontSize: '14px', marginBottom: '24px' }}>
              Uses exact historical amounts for maximum privacy
            </p>

            <SendForm
              privateKey={privateKey}
              destination={destination}
              amount={amount}
              privacyLevel={privacyLevel}
              delayMinutes={delayMinutes}
              burnerType={burnerType}
              sponsorFees={sponsorFees}
              splitPreview={splitPreview}
              onPrivateKeyChange={setPrivateKey}
              onDestinationChange={setDestination}
              onAmountChange={handleAmountChange}
              onPrivacyLevelChange={setPrivacyLevel}
              onDelayChange={setDelayMinutes}
              onBurnerTypeChange={setBurnerType}
              onSponsorFeesChange={setSponsorFees}
              onSelectSuggestion={handleSelectSuggestion}
              onSubmit={handleSubmit}
              loading={loading}
              disabled={!connected || !destination || !amount || !splitPreview.result?.valid}
            />
          </div>

          {/* Pool Selector */}
          <div style={{ 
            background: '#111', 
            border: '1px solid #333', 
            borderRadius: '12px', 
            padding: '24px',
            marginTop: '16px'
          }}>
            <PoolSelector
              pools={pools}
              selectedPools={selectedPools}
              onSelectionChange={setSelectedPools}
              loading={poolsLoading}
            />
          </div>
        </div>

        {/* Middle Column - Flow Steps */}
        <div style={{ 
          background: '#111', 
          border: '1px solid #333', 
          borderRadius: '12px', 
          padding: '24px'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
            Transaction Flow
          </h3>
          <p style={{ color: '#888', fontSize: '12px', marginBottom: '16px' }}>
            Wallet → First Burner → Pool (chunks) → {privacyLevel} Burner EOAs → Pool (UTXOs to Final Burner) → Final Burner → Destination
          </p>

          {/* Split Preview Summary */}
          {splitPreview.result?.valid && (
            <div style={{ 
              marginBottom: '16px',
              padding: '12px',
              background: '#0a1a0a',
              borderRadius: '8px',
              border: '1px solid #1a3a1a'
            }}>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>
                Exact chunk amounts:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {splitPreview.result.chunks.map((chunk, i) => (
                  <span key={i} style={{ 
                    padding: '4px 8px',
                    background: '#1a2a1a',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#4ade80'
                  }}>
                    {chunk.sol} SOL
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Flow Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {flowSteps.map((step) => {
              const status = getStepStatus(step.id);
              const message = getStepMessage(step.id);
              
              return (
                <div key={step.id}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '8px 12px',
                    background: status === 'running' ? '#0a1020' : status === 'completed' ? '#0a1f0a' : '#0a0a0a',
                    borderRadius: '8px',
                    borderLeft: `3px solid ${getStatusColor(status)}`,
                  }}>
                    {/* Status indicator */}
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
                      fontSize: '12px',
                    }}>
                      {getStatusIcon(status)}
                    </span>
                    
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ 
                        color: status === 'pending' ? '#666' : '#fff', 
                        fontSize: '13px', 
                        fontWeight: status === 'running' ? '600' : '400',
                      }}>
                        {step.label}
                      </div>
                      <div style={{ 
                        color: '#666', 
                        fontSize: '11px',
                        marginTop: '2px'
                      }}>
                        {message || step.description}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error */}
          {error && (
            <div style={{ 
              marginTop: '16px',
              background: '#1a0000', 
              border: '1px solid #500', 
              borderRadius: '8px', 
              padding: '12px',
            }}>
              <div style={{ color: '#f55', fontWeight: '600', marginBottom: '4px' }}>Error</div>
              <p style={{ color: '#fff', fontSize: '13px' }}>{error}</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                {error.includes('Re-deposit') && (
                  <button 
                    onClick={async () => {
                      // Retry just the re-deposit step by re-running from step 10
                      // This is a workaround - ideally we'd have a resume function
                      const amountNum = parseFloat(amount);
                      const minAmount = 0.035 * privacyLevel;
                      if (amountNum < minAmount) return;
                      
                      try {
                        let chunks: number[] | undefined;
                        let sendAmount = amountNum;
                        if (splitPreview.result?.valid && splitPreview.result.chunks.length > 0) {
                          chunks = splitPreview.result.chunks.map(c => c.lamports);
                          sendAmount = splitPreview.result.totalSol;
                        }
                        
                        // Re-execute - the hook will skip completed steps if we had burner wallets
                        await walletSend.execute({
                          destination,
                          amount: sendAmount,
                          numChunks: privacyLevel,
                          delayMinutes,
                          sponsorFees,
                          exactChunks: chunks,
                          selectedPools: selectedPools.length > 0 ? selectedPools : undefined,
                        });
                      } catch (err) {
                        console.error('Retry failed:', err);
                      }
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#3b82f6',
                      border: '1px solid #555',
                      borderRadius: '6px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '600'
                    }}
                  >
                    Retry Re-deposit
                  </button>
                )}
                <button 
                  onClick={handleReset}
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
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* Success */}
          {result && (
            <div style={{ 
              marginTop: '16px',
              background: '#001a00', 
              border: '1px solid #050', 
              borderRadius: '8px', 
              padding: '12px',
            }}>
              <div style={{ color: '#5f5', fontWeight: '600', marginBottom: '8px' }}>✓ Complete!</div>
              <div style={{ fontSize: '13px', color: '#ccc' }}>
                Sent {result.totalAmount} SOL to {result.recipient.slice(0,8)}...{result.recipient.slice(-8)}
              </div>
              <button 
                onClick={handleReset}
                style={{
                  marginTop: '12px',
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
        </div>

        {/* Right Column - Burner Keys */}
        <div style={{ 
          background: '#111', 
          border: '1px solid #333', 
          borderRadius: '12px', 
          padding: '24px'
        }}>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
            🔑 Burner Wallets
          </h3>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>
            Intermediate wallets for fund routing. Save private keys to recover funds.
          </p>
          
          {burnerWallets && burnerWallets.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {burnerWallets.map((burner, i) => (
                <div key={i} style={{ 
                  background: '#0a0a0a',
                  border: '1px solid #222',
                  borderRadius: '8px',
                  padding: '12px',
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
                  
                  {/* Address */}
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
                  
                  {/* Private Key */}
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
          ) : (
            <div style={{ 
              textAlign: 'center', 
              padding: '32px 16px',
              color: '#666',
              fontSize: '13px'
            }}>
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>👛</div>
              Burner wallets will appear here once transaction starts
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
