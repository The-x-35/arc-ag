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
import { calculatePrivacyScore, formatPrivacyScore, PrivacyScoreResult } from '@/lib/privacy/privacy-score';

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
    privacyScore?: PrivacyScoreResult;
  }>({
    loading: false,
    result: null,
    availableAmounts: [],
    suggestions: [],
    privacyScore: undefined,
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
  
  // Invite code state
  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodeValidated, setInviteCodeValidated] = useState(false);
  const [validatingInviteCode, setValidatingInviteCode] = useState(false);
  const [inviteCodeError, setInviteCodeError] = useState<string | null>(null);

  // Initialize connection
  useEffect(() => {
    connectionRef.current = new Connection(getSolanaRpc('mainnet'), 'confirmed');
  }, []);

  // Check if wallet already has a validated invite code
  useEffect(() => {
    async function checkWalletInviteCode() {
      if (!publicKey) {
        setInviteCodeValidated(false);
        return;
      }

      const walletAddress = publicKey.toBase58();

      // First check localStorage for quick check
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('vpm_invite_validated');
        const storedWallet = localStorage.getItem('vpm_invite_wallet');
        if (stored === 'true' && storedWallet === walletAddress) {
          setInviteCodeValidated(true);
          return;
        }
      }

      // Verify with database
      try {
        const response = await fetch(`/api/invite/check?walletAddress=${encodeURIComponent(walletAddress)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.hasInviteCode) {
            setInviteCodeValidated(true);
            // Store in localStorage
            if (typeof window !== 'undefined') {
              localStorage.setItem('vpm_invite_validated', 'true');
              localStorage.setItem('vpm_invite_wallet', walletAddress);
            }
          }
        }
      } catch (error) {
        console.error('Error checking wallet invite code:', error);
      }
    }

    if (connected && publicKey) {
      checkWalletInviteCode();
    } else {
      setInviteCodeValidated(false);
    }
  }, [connected, publicKey]);

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
  const computeSplitPreview = useCallback(async (amountSol: number, numChunks: number, skipSuggestionCheck = false) => {
    if (!amountSol || amountSol <= 0) {
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: null,
        suggestions: [],
      }));
      return;
    }
    
    // Check minimum amount first
    const minAmount = 0.035 * numChunks;
    if (amountSol < minAmount) {
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: {
          valid: false,
          chunks: [],
          totalLamports: 0,
          totalSol: 0,
          error: `Amount is below minimum. Minimum is ${formatSolAmount(minAmount, solPrice, 3)} (${numChunks} parts × 0.035 SOL per part)`,
        },
        suggestions: [],
      }));
      return;
    }
    
    // Store previous suggestions before we start loading
    let previousSuggestions: { amount: number; sol: number; chunks: number[] }[] = [];
    setSplitPreview(prev => {
      if (prev.suggestions && prev.suggestions.length > 0) {
        previousSuggestions = prev.suggestions;
      }
      return { ...prev, loading: true };
    });
    
    try {
      const connection = connectionRef.current || new Connection(getSolanaRpc('mainnet'), 'confirmed');
      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
      
      const poolsToUse = selectedPools.length > 0 ? selectedPools : undefined;
      
      // Check if this amount matches a previous suggestion (within tolerance)
      // This prevents recalculating when user enters a suggested amount
      let splitResult: any = null;
      let useSuggestionChunks = false;
      
      if (!skipSuggestionCheck && previousSuggestions.length > 0) {
        const tolerance = 0.0001; // 0.0001 SOL tolerance
        const matchingSuggestion = previousSuggestions.find(s => 
          Math.abs(s.sol - amountSol) < tolerance && s.chunks && s.chunks.length === numChunks
        );
        
        if (matchingSuggestion) {
          useSuggestionChunks = true;
          // Use the suggestion's chunks directly - this is a valid split!
          const chunks = matchingSuggestion.chunks.map(sol => {
            const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
            return {
              lamports,
              sol,
              frequency: 0, // Will be looked up later
            };
          });
          
          // Calculate total
          const totalLamports = chunks.reduce((sum, c) => sum + c.lamports, 0);
          const totalSol = totalLamports / LAMPORTS_PER_SOL;
          
          splitResult = {
            valid: true,
            chunks,
            totalLamports,
            totalSol,
          };
        }
      }
      
      // Only call findExactSplit if we didn't find a matching suggestion
      if (!useSuggestionChunks) {
        splitResult = await transactionIndexer.findExactSplit(connection, amountLamports, numChunks, poolsToUse);
      }
      
      // Get suggestions ONLY if split not valid and we didn't use suggestion chunks
      let suggestions: { amount: number; sol: number; chunks: number[] }[] = [];
      if (useSuggestionChunks) {
        // Preserve existing suggestions when using suggestion chunks
        suggestions = previousSuggestions;
      } else if (!splitResult.valid) {
        try {
          suggestions = await transactionIndexer.getSuggestedAmounts(connection, amountLamports, numChunks, poolsToUse);
          console.log('Generated suggestions:', suggestions.length, 'for', amountLamports / LAMPORTS_PER_SOL, 'SOL');
          if (suggestions.length === 0) {
            console.warn('No suggestions generated for amount:', amountLamports / LAMPORTS_PER_SOL, 'SOL');
          }
        } catch (suggestionError) {
          console.error('Error getting suggestions:', suggestionError);
          // Continue with empty suggestions - they'll be shown if available
        }
      }

      // If we still have an invalid split but found a suggestion that exactly matches this amount,
      // treat that suggestion as a valid split instead of showing an error.
      if (!splitResult.valid && suggestions.length > 0) {
        const tolerance = 0.000001; // 0.000001 SOL tolerance
        const matchingSuggestion = suggestions.find(s =>
          Math.abs(s.sol - amountSol) < tolerance &&
          s.chunks &&
          s.chunks.length === numChunks
        );

        if (matchingSuggestion) {
          const chunksFromSuggestion = matchingSuggestion.chunks.map(sol => {
            const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
            return {
              lamports,
              sol,
              frequency: 0, // Will be looked up for privacy score below
            };
          });

          const totalLamports = chunksFromSuggestion.reduce((sum, c) => sum + c.lamports, 0);
          const totalSol = totalLamports / LAMPORTS_PER_SOL;

          splitResult = {
            valid: true,
            chunks: chunksFromSuggestion,
            totalLamports,
            totalSol,
          };
        }
      }
      
      // Get available amounts for privacy score calculation
      const availableAmounts = await transactionIndexer.getAvailableAmounts(connection, 100, poolsToUse);
      const availableAmountsForScore = availableAmounts.map(a => ({
        lamports: a.lamports,
        sol: a.sol,
        frequency: a.frequency,
        isHistorical: a.isHistorical,
      }));
      
      // Calculate privacy score
      let privacyScore: PrivacyScoreResult | undefined;
      try {
        // Calculate score for valid splits
        if (splitResult.valid && splitResult.chunks.length > 0) {
          // Ensure chunks have correct format
          // splitResult.chunks are AvailableAmount objects with frequency!
          // Since findExactSplit returned valid=true, ALL chunks are exact historical matches
          const chunksForScore = splitResult.chunks.map((c: any) => {
            // Handle both AvailableAmount and plain object formats
            const lamports = c.lamports || Math.floor((c.sol || 0) * LAMPORTS_PER_SOL);
            const sol = c.sol || (lamports / LAMPORTS_PER_SOL);
            
            // Get frequency - these are EXACT historical amounts, so frequency MUST exist
            let frequency = c.frequency;
            
            // If frequency is missing from chunk object, look it up by EXACT lamports match
            // (not lenient - these are exact historical amounts!)
            if (frequency === undefined || frequency === null || frequency === 0) {
              const exactMatch = availableAmounts.find(a => a.lamports === lamports);
              if (exactMatch) {
                frequency = exactMatch.frequency;
      } else {
                // This should never happen - if findExactSplit returned valid, chunks should be in availableAmounts
                console.error('[Privacy Score] ERROR: Chunk', sol, 'SOL not found in availableAmounts! This should not happen for valid splits.');
                frequency = 1; // Fallback to minimum
              }
            }
            
            return { lamports, sol, frequency: frequency || 1 }; // Minimum 1 for valid historical amounts
          });
          
          privacyScore = calculatePrivacyScore(
            chunksForScore,
            delayMinutes,
            availableAmountsForScore,
            numChunks
          );
        } else if (suggestions.length > 0) {
          // For invalid splits, use the first suggestion's chunks if available
          // This gives a more accurate privacy score based on what would actually work
          const firstSuggestion = suggestions[0];
          if (firstSuggestion.chunks && firstSuggestion.chunks.length > 0) {
            const suggestionChunks = firstSuggestion.chunks.map(sol => ({
              lamports: Math.floor(sol * LAMPORTS_PER_SOL),
              sol: sol,
            }));
            
            privacyScore = calculatePrivacyScore(
              suggestionChunks,
              delayMinutes,
              availableAmountsForScore,
              numChunks
            );
          } else {
            // Fallback to equal chunks if suggestion doesn't have chunk breakdown
            const chunkAmountLamports = Math.floor(amountLamports / numChunks);
            const remainder = amountLamports % numChunks;
            const equalChunks = Array.from({ length: numChunks }, (_, i) => {
              const lamports = i === numChunks - 1 
                ? chunkAmountLamports + remainder 
                : chunkAmountLamports;
              return {
                lamports,
                sol: lamports / LAMPORTS_PER_SOL,
              };
            });
            
            privacyScore = calculatePrivacyScore(
              equalChunks,
              delayMinutes,
              availableAmountsForScore,
              numChunks
            );
          }
        }
      } catch (scoreError) {
        console.error('Error calculating privacy score:', scoreError);
      }
      
      setSplitPreview(prev => ({
        ...prev,
        loading: false,
        result: splitResult,
        suggestions,
        privacyScore,
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
  }, [selectedPools, solPrice, delayMinutes]);
  
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
  
  // Helper function to format chunk breakdown (e.g., "1 SOL (3×) 2 SOL")
  const formatChunkBreakdown = useCallback((chunks: number[]): string => {
    // Group chunks by amount and count occurrences
    const grouped = new Map<number, number>();
    for (const chunk of chunks) {
      const rounded = Math.round(chunk * 1000) / 1000; // Round to 0.001 SOL for grouping
      grouped.set(rounded, (grouped.get(rounded) || 0) + 1);
    }
    
    // Sort by amount (ascending) for consistent display
    const sorted = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
    
    // Format as "amount SOL (count×) amount SOL (count×)" etc.
    return sorted.map(([amount, count]) => {
      const formatted = `${amount.toFixed(3)} SOL`;
      return count > 1 ? `${formatted} (${count}×)` : formatted;
    }).join(' ');
  }, []);
  
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
  
  // Validate invite code format
  const isValidCodeFormat = useCallback((code: string): boolean => {
    if (!code || code.length !== 6) {
      return false;
    }
    return /^[A-Z0-9]{6}$/.test(code.toUpperCase());
  }, []);

  // Handle invite code validation
  const handleInviteCodeSubmit = useCallback(async () => {
    if (!publicKey) {
      setInviteCodeError('Please connect your wallet first');
      return;
    }

    const normalizedCode = inviteCode.toUpperCase().trim();
    
    if (!isValidCodeFormat(normalizedCode)) {
      setInviteCodeError('Invalid code format. Code must be exactly 6 characters (A-Z, 0-9)');
      return;
    }

    setValidatingInviteCode(true);
    setInviteCodeError(null);

    try {
      const response = await fetch('/api/invite/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: normalizedCode,
          walletAddress: publicKey.toBase58(),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setInviteCodeValidated(true);
        setInviteCodeError(null);
        // Store in localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('vpm_invite_validated', 'true');
          localStorage.setItem('vpm_invite_wallet', publicKey.toBase58());
        }
      } else {
        setInviteCodeError(data.error || 'Failed to validate invite code');
      }
    } catch (error: any) {
      console.error('Error validating invite code:', error);
      setInviteCodeError('Failed to validate invite code. Please try again.');
    } finally {
      setValidatingInviteCode(false);
    }
  }, [inviteCode, publicKey, isValidCodeFormat]);
  
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
      {/* Wallet Connect Screen - Show if not connected and not validated */}
      {!connected && !inviteCodeValidated && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          gap: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <img src="/image.png" alt="VPM Logo" style={{ height: '48px', width: 'auto' }} />
            <h1 style={{ fontSize: '64px', fontWeight: '700', color: '#000', letterSpacing: '-0.02em', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>VPM</h1>
          </div>
          <p style={{ color: '#666', fontSize: '16px', textAlign: 'center', marginBottom: '16px' }}>
            Connect your Solana wallet to continue
          </p>
          <WalletMultiButton style={{
            background: '#000',
            borderRadius: '8px',
            height: '48px',
            fontSize: '16px',
            fontWeight: '600'
          }} />
        </div>
      )}

      {/* Invite Code Input Screen - Show if connected but not validated */}
      {connected && !inviteCodeValidated && publicKey && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          gap: '24px',
          maxWidth: '400px',
          margin: '0 auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <img src="/image.png" alt="VPM Logo" style={{ height: '48px', width: 'auto' }} />
            <h1 style={{ fontSize: '64px', fontWeight: '700', color: '#000', letterSpacing: '-0.02em', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>VPM</h1>
          </div>
          <div style={{
            background: '#f5f5f5',
            border: '1px solid #ddd',
            borderRadius: '12px',
            padding: '32px',
            width: '100%'
          }}>
            <h2 style={{ fontSize: '40px', fontWeight: '700', color: '#000', marginBottom: '8px', textAlign: 'center', letterSpacing: '-0.02em', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>
              Enter Invite Code
            </h2>
            <p style={{ color: '#666', fontSize: '14px', textAlign: 'center', marginBottom: '24px' }}>
              Please enter your 6-character invite code to access VPM
            </p>
            
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                  setInviteCode(value);
                  setInviteCodeError(null);
                }}
                placeholder="ABCD12"
                disabled={validatingInviteCode}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: '#fff',
                  border: `1px solid ${inviteCodeError ? '#ef4444' : '#ddd'}`,
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '18px',
                  textAlign: 'center',
                  letterSpacing: '4px',
                  fontFamily: 'monospace',
                  fontWeight: '600',
                  textTransform: 'uppercase'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && inviteCode.length === 6) {
                    handleInviteCodeSubmit();
                  }
                }}
              />
              {inviteCodeError && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: '#fef2f2',
                  border: '1px solid #ef4444',
                  borderRadius: '6px',
                  color: '#ef4444',
                  fontSize: '13px',
                  textAlign: 'center'
                }}>
                  {inviteCodeError}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleInviteCodeSubmit}
              disabled={validatingInviteCode || inviteCode.length !== 6}
              style={{
                width: '100%',
                padding: '14px',
                background: inviteCode.length === 6 && !validatingInviteCode ? '#000' : '#ccc',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '600',
                cursor: inviteCode.length === 6 && !validatingInviteCode ? 'pointer' : 'not-allowed',
                opacity: inviteCode.length === 6 && !validatingInviteCode ? 1 : 0.6
              }}
            >
              {validatingInviteCode ? 'Validating...' : 'Submit'}
            </button>

            <div style={{
              marginTop: '16px',
              padding: '12px',
              background: '#fff',
              borderRadius: '8px',
              border: '1px solid #ddd',
              fontSize: '12px',
              color: '#666',
              textAlign: 'center'
            }}>
              <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#999', marginBottom: '4px' }}>
                Connected: {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Form - Show only if validated */}
      {inviteCodeValidated && (
        <>
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
          <h1 style={{ fontSize: '40px', fontWeight: '700', color: '#000', letterSpacing: '-0.02em', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>VPM</h1>
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
            Min {formatSolAmount(0.035 * chunks, solPrice, 2)}
            {maxSolAmount && (
              <> • Max {formatSolAmount(maxSolAmount, solPrice, 2)}</>
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
                background: '#E3F9F3',
                borderRadius: '8px',
                border: '1px solid #00CC65'
              }}>
          <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#00CC65', fontSize: '16px' }}>✓</span>
                  <span style={{ color: '#00CC65', fontSize: '13px', fontWeight: '700', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>
                    Valid split found!
                  </span>
          </div>
                {/* Show grouped split in boxes, similar to previous chunk pills */}
                <div
                  style={{
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '6px',
                    marginTop: '8px',
                  }}
                >
                  {(() => {
                    const chunksSol = splitPreview.result.chunks.map((c) => c.sol);
                    const grouped = new Map<number, number>();
                    for (const chunk of chunksSol) {
                      const rounded = Math.round(chunk * 1000) / 1000; // 0.001 SOL grouping
                      grouped.set(rounded, (grouped.get(rounded) || 0) + 1);
                    }
                    const sorted = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
                    return sorted.map(([amount, count], idx) => (
                      <div
                        key={idx}
                      style={{ 
                        padding: '6px 10px',
                          background: '#E3F9F3',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                          color: '#00A478',
                          border: '1px solid #00CC65',
                        }}
                      >
                        {amount.toFixed(3)} SOL{count > 1 ? ` (${count}×)` : ''}
        </div>
                    ));
                  })()}
                </div>
                <div
                  style={{
                  fontSize: '11px', 
                    color: '#666',
                    marginTop: '8px',
                  }}
                >
                  Total: {formatSolAmount(splitPreview.result.totalSol, solPrice, 3)} • Split:{' '}
                  {formatChunkBreakdown(splitPreview.result.chunks.map((c) => c.sol))} • Each part
                  matches historical transactions
                </div>
              </div>
            ) : splitPreview?.result?.error ? (
        <div style={{ 
              padding: '12px',
                background: '#FFC5C6',
              borderRadius: '8px',
                border: '1px solid #FF2232'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#FF2232', fontSize: '16px' }}>
                    ✗
                  </span>
                  <span style={{ color: '#FF2232', fontSize: '13px', fontWeight: '700', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif' }}>
                    {(() => {
                      const errorText = splitPreview.result.error || '';
                      
                      // First, clean up any nested error messages or malformed text
                      // Remove patterns like "(Cannot split 000.00)" or "(Cannot split X SOL)"
                      let cleanError = errorText.replace(/\(Cannot split [^)]+\)/g, '').trim();
                      
                      // Remove any duplicate "Cannot split" patterns that might have been created
                      cleanError = cleanError.replace(/Cannot split[^C]*?Cannot split/g, 'Cannot split').trim();
                      
                      // Remove any "000.00" or similar zero patterns that might be artifacts
                      cleanError = cleanError.replace(/\b0{2,}\.0+\b/g, '').trim();
                      cleanError = cleanError.replace(/\s+/g, ' ').trim(); // Normalize whitespace
                      
                      // Find the first valid "Cannot split X SOL" pattern
                      const match = cleanError.match(/Cannot split ([\d.]+) SOL/);
                      if (match && solPrice && match[1]) {
                        const solAmount = parseFloat(match[1]);
                        if (!isNaN(solAmount) && isFinite(solAmount) && solAmount > 0) {
                          const usdAmount = solAmount * solPrice;
                          
                          // Check if USD amount is already in the error (avoid double formatting)
                          if (!cleanError.includes(`$${usdAmount.toFixed(2)}`)) {
                            // Replace the first occurrence of "Cannot split X SOL" with formatted version
                            return cleanError.replace(
                              /(Cannot split )([\d.]+)( SOL)/,
                              (match, prefix, solStr, suffix) => {
                                // Use the parsed amount to ensure correct formatting
                                return `${prefix}${solAmount.toFixed(6)}${suffix} ($${usdAmount.toFixed(2)})`;
                              }
                            );
                          }
                        }
                      }
                      return cleanError;
                    })()}
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
                            opacity: loading ? 0.6 : 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: '4px'
                          }}
                        >
                          <div style={{ fontWeight: '600' }}>
                            {formatSolAmount(suggestion.sol, solPrice, 3)}
                          </div>
                          {suggestion.chunks && suggestion.chunks.length > 0 && (
                            <div style={{ 
                              fontSize: '10px', 
                              color: '#666',
                              fontFamily: 'monospace'
                            }}>
                              {formatChunkBreakdown(suggestion.chunks)}
                            </div>
                          )}
                        </button>
                ))}
              </div>
                  </div>
                )}
              </div>
            ) : null}
            </div>
          )}

        {/* Privacy Score Display */}
        {splitPreview?.privacyScore && (
                  <div style={{
            marginBottom: '20px',
            padding: '12px',
            background: '#fafafa',
                    borderRadius: '8px',
            border: '1px solid #ddd',
            textAlign: 'left',
            color: '#000',
            fontSize: '13px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700' }}>
                Privacy Strength Score
              </span>
                    <span style={{ 
                fontSize: '16px',
                fontWeight: '800',
                color: (() => {
                  switch (splitPreview.privacyScore.level) {
                    case 'weak': return '#FF2232';
                    case 'moderate': return '#FF8C00';
                    case 'strong': return '#00CC65';
                    case 'very-strong': return '#00A478';
                    default: return '#666';
                  }
                })()
              }}>
                {formatPrivacyScore(splitPreview.privacyScore.pss)}
                    </span>
                      </div>
                      <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px'
            }}>
              <span style={{
                padding: '4px 8px',
                borderRadius: '4px',
                        fontSize: '11px',
                fontWeight: '600',
                color: '#fff',
                background: (() => {
                  switch (splitPreview.privacyScore.level) {
                    case 'weak': return '#FF2232';
                    case 'moderate': return '#FF8C00';
                    case 'strong': return '#00CC65';
                    case 'very-strong': return '#00A478';
                    default: return '#666';
                  }
                })()
              }}>
                {splitPreview.privacyScore.level.charAt(0).toUpperCase() + splitPreview.privacyScore.level.slice(1)}
              </span>
              <span style={{ color: '#666', fontSize: '12px' }}>
                {(() => {
                  switch (splitPreview.privacyScore.level) {
                    case 'weak': return 'Weak privacy. Transaction may be traceable. Consider using historical amounts for better privacy.';
                    case 'moderate': return 'Moderate privacy. Resists basic analysis. Increasing delay or chunks may help.';
                    case 'strong': return 'Strong privacy. Defeats most automated analysis. Good choice.';
                    case 'very-strong': return 'Very strong privacy. Highly resistant to sophisticated graph analysis.';
                    default: return 'Privacy level unknown.';
                  }
                })()}
              </span>
                      </div>
            <div style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
              Privacy Level: {chunks} parts, {delayMinutes === 0 ? '<1 min' : `${delayMinutes} min`}
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
            background: '#FFC5C6',
            border: '1px solid #FF2232',
              borderRadius: '8px', 
            color: '#FF2232',
            fontSize: '13px',
            fontWeight: '700',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif'
          }}>
            {error}
          </div>
        )}
        
        {/* Success Display */}
        {result && (
          <div style={{
            marginBottom: '20px',
              padding: '12px',
            background: '#E3F9F3',
            border: '1px solid #00CC65',
            borderRadius: '8px',
            color: '#00A478',
            fontSize: '13px',
            fontWeight: '700',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif'
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
                fontWeight: '700',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif',
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
            fontWeight: '700',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Text", "Segoe UI", Roboto, sans-serif',
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
        </>
      )}
    </main>
  );
}
