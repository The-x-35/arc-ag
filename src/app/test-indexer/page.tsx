'use client';

import { useState } from 'react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { poolRegistry } from '@/lib/pools/registry';
import { privacyCashPool } from '@/lib/pools/privacy-cash';
import { transactionIndexer, HistoricalAmount } from '@/lib/indexer/transaction-indexer';
import { splitOptimizer, SplitResult } from '@/lib/optimizer/split-optimizer';
import { getSolanaRpc } from '@/lib/config/networks';
import { useSolPrice, formatSolAmount } from '@/hooks/useSolPrice';

// Ensure pool is registered
if (poolRegistry.isEmpty()) {
  poolRegistry.register(privacyCashPool);
}

interface IndexResult {
  historicalAmounts: HistoricalAmount[];
  totalTransactions: number;
  poolBreakdown: Record<string, number>;
  uniqueAmounts: number[];
  topAmounts: { amount: number; frequency: number; sol: string }[];
  depositAmounts: HistoricalAmount[];
  withdrawalAmounts: HistoricalAmount[];
  depositBreakdown: Record<string, number>;
  withdrawalBreakdown: Record<string, number>;
}

interface SplitDecision {
  splits: SplitResult[];
  totalAmount: number;
  averageMatchQuality: number;
  poolsUsed: string[];
  explanation: string[];
}

interface SplitPreview {
  loading: boolean;
  result: {
    valid: boolean;
    chunks: Array<{ sol: number }>;
    totalSol: number;
    error?: string;
  } | null;
  suggestions: Array<{ amount: number; sol: number; chunks: number[] }>;
}

export default function TestIndexerPage() {
  const { price: solPrice } = useSolPrice();
  const [amount, setAmount] = useState('1');
  const [chunks, setChunks] = useState('3');
  const [loading, setLoading] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [splitDecision, setSplitDecision] = useState<SplitDecision | null>(null);
  const [splitPreview, setSplitPreview] = useState<SplitPreview>({
    loading: false,
    result: null,
    suggestions: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Helper function to format chunk breakdown (like /prod)
  const formatChunkBreakdown = (chunks: number[]): string => {
    const grouped = new Map<number, number>();
    for (const chunk of chunks) {
      const rounded = Math.round(chunk * 1000) / 1000; // Round to 0.001 SOL for grouping
      grouped.set(rounded, (grouped.get(rounded) || 0) + 1);
    }
    const sorted = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
    return sorted.map(([amount, count]) => {
      const formatted = `${amount.toFixed(3)} SOL`;
      return count > 1 ? `${formatted} (${count}×)` : formatted;
    }).join(' + ');
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const runIndexing = async () => {
    setLoading(true);
    setError(null);
    setIndexResult(null);
    setSplitDecision(null);
    setLogs([]);

    try {
      const amountSol = parseFloat(amount);
      const numChunks = parseInt(chunks);

      if (isNaN(amountSol) || amountSol <= 0) {
        throw new Error('Invalid amount');
      }
      if (isNaN(numChunks) || numChunks < 2 || numChunks > 10) {
        throw new Error('Chunks must be between 2 and 10');
      }

      const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      addLog(`Starting indexing for ${amountSol} SOL split into ${numChunks} chunks`);
      addLog(`Amount in lamports: ${amountLamports.toLocaleString()}`);

      // Connect to Solana
      const connection = new Connection(getSolanaRpc('mainnet'), 'confirmed');
      addLog('Connected to Solana mainnet');

      // Step 1: Index all pools
      addLog('Indexing pool transactions...');
      const indexed = await transactionIndexer.indexAllPools(connection, 100);
      
      addLog(`Found ${indexed.totalTransactions} total transactions`);
      
      // Process results
      const poolBreakdown: Record<string, number> = {};
      indexed.poolBreakdown.forEach((count, poolId) => {
        poolBreakdown[poolId] = count;
        addLog(`  Pool "${poolId}": ${count} transactions`);
      });
      
      const depositBreakdown: Record<string, number> = {};
      indexed.depositBreakdown.forEach((count, poolId) => {
        depositBreakdown[poolId] = count;
        addLog(`  Deposits to "${poolId}": ${count} transactions`);
      });
      
      const withdrawalBreakdown: Record<string, number> = {};
      indexed.withdrawalBreakdown.forEach((count, poolId) => {
        withdrawalBreakdown[poolId] = count;
        if (count > 0) {
          addLog(`  Withdrawals from "${poolId}": ${count} transactions`);
        }
      });

      // Get top amounts by frequency
      const sortedByFreq = [...indexed.amounts].sort((a, b) => b.frequency - a.frequency);
      const topAmounts = sortedByFreq.slice(0, 20).map(a => ({
        amount: a.amount,
        frequency: a.frequency,
        sol: formatSolAmount(a.amount / LAMPORTS_PER_SOL, solPrice, 6)
      }));

      addLog(`Top ${topAmounts.length} most frequent amounts found`);

      // Get unique amounts
      const uniqueAmounts = await transactionIndexer.getUniqueAmounts(connection, 100);
      addLog(`${uniqueAmounts.length} unique amounts in history`);

      setIndexResult({
        historicalAmounts: indexed.amounts,
        totalTransactions: indexed.totalTransactions,
        poolBreakdown,
        uniqueAmounts,
        topAmounts,
        depositAmounts: indexed.depositAmounts,
        withdrawalAmounts: indexed.withdrawalAmounts,
        depositBreakdown,
        withdrawalBreakdown,
      });

      // Step 2: Check if exact split is possible
      addLog('Checking for exact split match...');
      const splitResult = await transactionIndexer.findExactSplit(connection, amountLamports, numChunks);
      
      // Get suggestions if split is not valid
      let suggestions: Array<{ amount: number; sol: number; chunks: number[] }> = [];
      if (!splitResult.valid) {
        addLog('Exact split not found, getting recommendations...');
        try {
          suggestions = await transactionIndexer.getSuggestedAmounts(connection, amountLamports, numChunks);
          addLog(`Found ${suggestions.length} recommended amounts`);
        } catch (suggestionError) {
          console.error('Error getting suggestions:', suggestionError);
          addLog('Could not generate suggestions');
        }
      }
      
      // Update split preview (like /prod)
      setSplitPreview({
        loading: false,
        result: splitResult.valid ? {
          valid: true,
          chunks: splitResult.chunks.map(c => ({ sol: c.sol })),
          totalSol: splitResult.totalSol,
        } : {
          valid: false,
          chunks: [],
          totalSol: 0,
          error: splitResult.error,
        },
        suggestions,
      });

      // Step 3: Run optimizer (for backward compatibility with existing UI)
      addLog('Running split optimizer...');
      const optimization = await splitOptimizer.optimizeSplit(connection, amountLamports, numChunks);

      addLog(`Optimizer decided on ${optimization.splits.length} chunks`);
      addLog(`Average match quality: ${(optimization.averageMatchQuality * 100).toFixed(1)}%`);
      
      if (splitResult.valid) {
        addLog('✓ Exact split found!');
      } else {
        addLog(`✗ Exact split not found: ${splitResult.error || 'No matching historical amounts'}`);
      }

      // Generate explanations
      const explanations: string[] = [];
      explanations.push(`Total amount: ${formatSolAmount(amountSol, solPrice, 6)} (${amountLamports.toLocaleString()} lamports)`);
      explanations.push(`Splitting into ${numChunks} chunks for privacy`);
      explanations.push('');

      optimization.splits.forEach((split, i) => {
        const splitSol = split.amount / LAMPORTS_PER_SOL;
        const splitFormatted = formatSolAmount(splitSol, solPrice, 6);
        const idealAmount = amountLamports / numChunks;
        const deviation = ((split.amount - idealAmount) / idealAmount * 100).toFixed(1);
        
        let reason = '';
        if (split.matchedHistoricalAmount) {
          const matchedFreq = topAmounts.find(a => a.amount === split.matchedHistoricalAmount)?.frequency || 'multiple';
          reason = `Matched historical amount of ${splitFormatted} (seen ${matchedFreq} times)`;
        } else if (split.matchQuality > 0.8) {
          reason = 'Close match to common transaction size';
        } else if (split.matchQuality > 0.5) {
          reason = 'Reasonable blend with historical patterns';
        } else {
          reason = 'Remainder chunk (lower privacy)';
        }

        explanations.push(`Chunk ${i + 1}: ${splitFormatted}`);
        explanations.push(`  - Pool: ${split.poolId}`);
        explanations.push(`  - Match quality: ${(split.matchQuality * 100).toFixed(0)}%`);
        explanations.push(`  - Deviation from equal: ${deviation}%`);
        explanations.push(`  - Reason: ${reason}`);
        explanations.push('');

        addLog(`Chunk ${i + 1}: ${splitFormatted} (${(split.matchQuality * 100).toFixed(0)}% match)`);
      });

      setSplitDecision({
        splits: optimization.splits,
        totalAmount: optimization.totalAmount,
        averageMatchQuality: optimization.averageMatchQuality,
        poolsUsed: optimization.poolsUsed,
        explanation: explanations,
      });

      addLog('Done!');

    } catch (err: any) {
      setError(err.message || 'Indexing failed');
      addLog(`ERROR: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', padding: '24px', maxWidth: '1400px', margin: '0 auto', background: '#fff', color: '#000' }}>
      {/* Header */}
      <header style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid #ddd' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: '#000' }}>
          Indexer Test Page
        </h1>
        <p style={{ color: '#666' }}>
          Test the transaction indexer and see how amounts are split
        </p>
        <a href="/" style={{ color: '#3b82f6', fontSize: '14px' }}>← Back to main</a>
      </header>

      {/* Input Form */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '300px 1fr', 
        gap: '32px',
        alignItems: 'start'
      }}>
        {/* Left - Input */}
        <div style={{ 
          background: '#fff', 
          border: '1px solid #ddd', 
          borderRadius: '12px', 
          padding: '24px' 
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#000' }}>
            Test Parameters
          </h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#000' }}>
              Amount (SOL)
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                color: '#000',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#000' }}>
              Number of Chunks
            </label>
            <input
              type="number"
              min="2"
              max="10"
              value={chunks}
              onChange={(e) => setChunks(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                color: '#000',
                fontSize: '14px'
              }}
            />
            <span style={{ fontSize: '12px', color: '#666', marginTop: '4px', display: 'block' }}>
              Between 2 and 10
            </span>
          </div>

          <button
            onClick={runIndexing}
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? '#ccc' : '#000',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Indexing...' : 'Run Indexer'}
          </button>

          {error && (
            <div style={{ 
              marginTop: '16px', 
              padding: '12px', 
              background: '#FFC5C6', 
              border: '1px solid #FF2232',
              borderRadius: '8px',
              color: '#FF2232',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Right - Results */}
        <div>
          {/* Logs */}
          <div style={{ 
            background: '#f5f5f5', 
            border: '1px solid #ddd', 
            borderRadius: '12px', 
            padding: '16px',
            marginBottom: '16px',
            maxHeight: '200px',
            overflow: 'auto'
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#000' }}>
              Logs
            </h3>
            {logs.length === 0 ? (
              <div style={{ color: '#666', fontSize: '13px' }}>Click "Run Indexer" to start...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{ 
                  fontSize: '12px', 
                  fontFamily: 'monospace', 
                  color: log.includes('ERROR') ? '#FF2232' : '#666',
                  marginBottom: '4px'
                }}>
                  {log}
                </div>
              ))
            )}
          </div>

          {/* Historical Data */}
          {indexResult && (
            <div style={{ 
              background: '#fff', 
              border: '1px solid #ddd', 
              borderRadius: '12px', 
              padding: '24px',
              marginBottom: '16px'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#000' }}>
                Historical Transaction Data
              </h3>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>Total Transactions</div>
                  <div style={{ fontSize: '24px', fontWeight: '600', color: '#000' }}>{indexResult.totalTransactions}</div>
                </div>
                <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>Unique Amounts</div>
                  <div style={{ fontSize: '24px', fontWeight: '600', color: '#000' }}>{indexResult.uniqueAmounts.length}</div>
                </div>
                <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>Pools Indexed</div>
                  <div style={{ fontSize: '24px', fontWeight: '600', color: '#000' }}>{Object.keys(indexResult.poolBreakdown).length}</div>
                </div>
              </div>

              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#000' }}>
                Top 20 Most Used Amounts
              </h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(4, 1fr)', 
                gap: '8px'
              }}>
                {indexResult.topAmounts.map((item, i) => (
                  <div key={i} style={{ 
                    background: '#f5f5f5', 
                    padding: '10px 12px', 
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}>
                    <div style={{ fontFamily: 'monospace', color: '#000' }}>
                      {item.sol}
                    </div>
                    <div style={{ color: '#22c55e', marginTop: '2px' }}>
                      {item.frequency}x used
                    </div>
                  </div>
                ))}
              </div>

              {indexResult.topAmounts.length === 0 && (
                <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                  No historical transactions found. The pool may be new or empty.
                </div>
              )}

              {/* Deposit vs Withdrawal Breakdown */}
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginTop: '24px', marginBottom: '12px', color: '#000' }}>
                Deposit vs Withdrawal Breakdown
              </h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                marginBottom: '20px'
              }}>
                {/* Deposits (Inside Pool) */}
                <div style={{ 
                  background: '#f0fdf4', 
                  border: '1px solid #22c55e',
                  padding: '16px', 
                  borderRadius: '8px' 
                }}>
                  <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px', fontWeight: '600' }}>
                    Deposits (Inside Pool)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: '600', color: '#22c55e', marginBottom: '8px' }}>
                    {indexResult.depositAmounts.length > 0 ? indexResult.depositAmounts.reduce((sum, a) => sum + a.frequency, 0) : 0}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {Object.keys(indexResult.depositBreakdown).length > 0 
                      ? Object.entries(indexResult.depositBreakdown).map(([pool, count]) => (
                          <div key={pool} style={{ marginTop: '4px' }}>
                            {pool}: {count} transactions
                          </div>
                        ))
                      : 'No deposits tracked'}
                  </div>
                  {indexResult.depositAmounts.length > 0 && (
                    <div style={{ marginTop: '12px', fontSize: '11px', color: '#666' }}>
                      <div style={{ marginBottom: '4px', fontWeight: '600' }}>Top Deposit Amounts:</div>
                      {indexResult.depositAmounts.slice(0, 5).map((item, i) => (
                        <div key={i} style={{ marginTop: '2px', fontFamily: 'monospace', color: '#000' }}>
                          {formatSolAmount(item.amountSol, solPrice, 3)} ({item.frequency}x)
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Withdrawals (Outside Pool) */}
                <div style={{ 
                  background: '#fffbeb', 
                  border: '1px solid #f59e0b',
                  padding: '16px', 
                  borderRadius: '8px' 
                }}>
                  <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '8px', fontWeight: '600' }}>
                    Withdrawals (Outside Pool)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: '600', color: '#f59e0b', marginBottom: '8px' }}>
                    {indexResult.withdrawalAmounts.length > 0 ? indexResult.withdrawalAmounts.reduce((sum, a) => sum + a.frequency, 0) : 0}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {Object.keys(indexResult.withdrawalBreakdown).length > 0 
                      ? Object.entries(indexResult.withdrawalBreakdown).map(([pool, count]) => (
                          count > 0 && (
                            <div key={pool} style={{ marginTop: '4px' }}>
                              {pool}: {count} transactions
                            </div>
                          )
                        ))
                      : 'No withdrawals tracked'}
                  </div>
                  {indexResult.withdrawalAmounts.length > 0 && (
                    <div style={{ marginTop: '12px', fontSize: '11px', color: '#666' }}>
                      <div style={{ marginBottom: '4px', fontWeight: '600' }}>Top Withdrawal Amounts:</div>
                      {indexResult.withdrawalAmounts.slice(0, 5).map((item, i) => (
                        <div key={i} style={{ marginTop: '2px', fontFamily: 'monospace', color: '#000' }}>
                          {formatSolAmount(item.amountSol, solPrice, 3)} ({item.frequency}x)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Split Preview (like /prod) */}
          {splitPreview?.result && (
            <div style={{ marginBottom: '16px' }}>
              {splitPreview.loading ? (
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
              ) : splitPreview.result.valid ? (
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
                  {/* Show grouped split in boxes */}
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
                          {formatSolAmount(amount, solPrice, 3)}{count > 1 ? ` (${count}×)` : ''}
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
              ) : splitPreview.result.error ? (
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
                        const match = errorText.match(/Cannot split ([\d.]+) SOL/);
                        if (match && solPrice && match[1]) {
                          const solAmount = parseFloat(match[1]);
                          if (!isNaN(solAmount) && isFinite(solAmount) && solAmount > 0) {
                            const usdAmount = solAmount * solPrice;
                            return errorText.replace(
                              /(Cannot split )([\d.]+)( SOL)/,
                              `$1${solAmount.toFixed(6)}$3 ($${usdAmount.toFixed(2)})`
                            );
                          }
                        }
                        return errorText;
                      })()}
                    </span>
                  </div>
                  {splitPreview.suggestions && splitPreview.suggestions.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px' }}>
                        Suggested amounts (click to use):
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {splitPreview.suggestions.map((suggestion, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setAmount((suggestion.sol).toString());
                              addLog(`Selected recommendation: ${formatSolAmount(suggestion.sol, solPrice, 6)}`);
                            }}
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

          {/* Split Decision (Optimizer Results) */}
          {splitDecision && (
            <div style={{ 
              background: '#fff', 
              border: '1px solid #ddd', 
              borderRadius: '12px', 
              padding: '24px',
              marginTop: '16px'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#000' }}>
                Optimizer Analysis
              </h3>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>Average Match Quality</div>
                  <div style={{ 
                    fontSize: '24px', 
                    fontWeight: '600',
                    color: splitDecision.averageMatchQuality > 0.7 ? '#22c55e' : 
                           splitDecision.averageMatchQuality > 0.4 ? '#f59e0b' : '#ef4444'
                  }}>
                    {(splitDecision.averageMatchQuality * 100).toFixed(0)}%
                  </div>
                </div>
                <div style={{ background: '#f5f5f5', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#666' }}>Pools Used</div>
                  <div style={{ fontSize: '24px', fontWeight: '600', color: '#000' }}>
                    {splitDecision.poolsUsed.join(', ')}
                  </div>
                </div>
              </div>

              {/* Detailed explanation */}
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#000' }}>
                Detailed Explanation
              </h4>
              <div style={{ 
                background: '#f5f5f5', 
                padding: '16px', 
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                color: '#000',
                maxHeight: '300px',
                overflow: 'auto'
              }}>
                {splitDecision.explanation.join('\n')}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!indexResult && !loading && (
            <div style={{ 
              background: '#fff', 
              border: '1px solid #ddd', 
              borderRadius: '12px', 
              padding: '48px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <h3 style={{ fontSize: '18px', marginBottom: '8px', color: '#000' }}>No Data Yet</h3>
              <p style={{ color: '#666' }}>
                Enter an amount and number of chunks, then click "Run Indexer"
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
