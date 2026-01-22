'use client';

import { useState } from 'react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { poolRegistry } from '@/lib/pools/registry';
import { privacyCashPool } from '@/lib/pools/privacy-cash';
import { transactionIndexer, HistoricalAmount } from '@/lib/indexer/transaction-indexer';
import { splitOptimizer, SplitResult } from '@/lib/optimizer/split-optimizer';
import { getSolanaRpc } from '@/lib/config/networks';

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
}

interface SplitDecision {
  splits: SplitResult[];
  totalAmount: number;
  averageMatchQuality: number;
  poolsUsed: string[];
  explanation: string[];
}

export default function TestIndexerPage() {
  const [amount, setAmount] = useState('1');
  const [chunks, setChunks] = useState('3');
  const [loading, setLoading] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [splitDecision, setSplitDecision] = useState<SplitDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

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

      // Get top amounts by frequency
      const sortedByFreq = [...indexed.amounts].sort((a, b) => b.frequency - a.frequency);
      const topAmounts = sortedByFreq.slice(0, 20).map(a => ({
        amount: a.amount,
        frequency: a.frequency,
        sol: (a.amount / LAMPORTS_PER_SOL).toFixed(6)
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
      });

      // Step 2: Run optimizer
      addLog('Running split optimizer...');
      const optimization = await splitOptimizer.optimizeSplit(connection, amountLamports, numChunks);

      addLog(`Optimizer decided on ${optimization.splits.length} chunks`);
      addLog(`Average match quality: ${(optimization.averageMatchQuality * 100).toFixed(1)}%`);

      // Generate explanations
      const explanations: string[] = [];
      explanations.push(`Total amount: ${amountSol} SOL (${amountLamports.toLocaleString()} lamports)`);
      explanations.push(`Splitting into ${numChunks} chunks for privacy`);
      explanations.push('');

      optimization.splits.forEach((split, i) => {
        const splitSol = (split.amount / LAMPORTS_PER_SOL).toFixed(6);
        const idealAmount = amountLamports / numChunks;
        const deviation = ((split.amount - idealAmount) / idealAmount * 100).toFixed(1);
        
        let reason = '';
        if (split.matchedHistoricalAmount) {
          reason = `Matched historical amount of ${splitSol} SOL (seen ${topAmounts.find(a => a.amount === split.matchedHistoricalAmount)?.frequency || 'multiple'} times)`;
        } else if (split.matchQuality > 0.8) {
          reason = 'Close match to common transaction size';
        } else if (split.matchQuality > 0.5) {
          reason = 'Reasonable blend with historical patterns';
        } else {
          reason = 'Remainder chunk (lower privacy)';
        }

        explanations.push(`Chunk ${i + 1}: ${splitSol} SOL`);
        explanations.push(`  - Pool: ${split.poolId}`);
        explanations.push(`  - Match quality: ${(split.matchQuality * 100).toFixed(0)}%`);
        explanations.push(`  - Deviation from equal: ${deviation}%`);
        explanations.push(`  - Reason: ${reason}`);
        explanations.push('');

        addLog(`Chunk ${i + 1}: ${splitSol} SOL (${(split.matchQuality * 100).toFixed(0)}% match)`);
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
    <main style={{ minHeight: '100vh', padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <header style={{ marginBottom: '32px', paddingBottom: '16px', borderBottom: '1px solid #333' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
          Indexer Test Page
        </h1>
        <p style={{ color: '#888' }}>
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
          background: '#111', 
          border: '1px solid #333', 
          borderRadius: '12px', 
          padding: '24px' 
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
            Test Parameters
          </h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#fff' }}>
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
                background: '#000',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#fff' }}>
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
                background: '#000',
                border: '1px solid #333',
                borderRadius: '8px',
                color: '#fff',
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
              background: loading ? '#333' : '#3b82f6',
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
              background: '#200', 
              border: '1px solid #500',
              borderRadius: '8px',
              color: '#f88',
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
            background: '#0a0a0a', 
            border: '1px solid #222', 
            borderRadius: '12px', 
            padding: '16px',
            marginBottom: '16px',
            maxHeight: '200px',
            overflow: 'auto'
          }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#888' }}>
              Logs
            </h3>
            {logs.length === 0 ? (
              <div style={{ color: '#444', fontSize: '13px' }}>Click "Run Indexer" to start...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} style={{ 
                  fontSize: '12px', 
                  fontFamily: 'monospace', 
                  color: log.includes('ERROR') ? '#f88' : '#888',
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
              background: '#111', 
              border: '1px solid #333', 
              borderRadius: '12px', 
              padding: '24px',
              marginBottom: '16px'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
                Historical Transaction Data
              </h3>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Total Transactions</div>
                  <div style={{ fontSize: '24px', fontWeight: '600' }}>{indexResult.totalTransactions}</div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Unique Amounts</div>
                  <div style={{ fontSize: '24px', fontWeight: '600' }}>{indexResult.uniqueAmounts.length}</div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Pools Indexed</div>
                  <div style={{ fontSize: '24px', fontWeight: '600' }}>{Object.keys(indexResult.poolBreakdown).length}</div>
                </div>
              </div>

              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#888' }}>
                Top 20 Most Used Amounts
              </h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(4, 1fr)', 
                gap: '8px'
              }}>
                {indexResult.topAmounts.map((item, i) => (
                  <div key={i} style={{ 
                    background: '#0a0a0a', 
                    padding: '10px 12px', 
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}>
                    <div style={{ fontFamily: 'monospace', color: '#fff' }}>
                      {item.sol} SOL
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
            </div>
          )}

          {/* Split Decision */}
          {splitDecision && (
            <div style={{ 
              background: '#111', 
              border: '1px solid #333', 
              borderRadius: '12px', 
              padding: '24px'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
                Split Decision
              </h3>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, 1fr)', 
                gap: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Average Match Quality</div>
                  <div style={{ 
                    fontSize: '24px', 
                    fontWeight: '600',
                    color: splitDecision.averageMatchQuality > 0.7 ? '#22c55e' : 
                           splitDecision.averageMatchQuality > 0.4 ? '#f59e0b' : '#ef4444'
                  }}>
                    {(splitDecision.averageMatchQuality * 100).toFixed(0)}%
                  </div>
                </div>
                <div style={{ background: '#0a0a0a', padding: '16px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', color: '#888' }}>Pools Used</div>
                  <div style={{ fontSize: '24px', fontWeight: '600' }}>
                    {splitDecision.poolsUsed.join(', ')}
                  </div>
                </div>
              </div>

              {/* Chunks visualization */}
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#888' }}>
                Chunk Breakdown
              </h4>
              <div style={{ marginBottom: '20px' }}>
                {splitDecision.splits.map((split, i) => {
                  const percentage = (split.amount / splitDecision.totalAmount) * 100;
                  return (
                    <div key={i} style={{ marginBottom: '12px' }}>
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        marginBottom: '4px',
                        fontSize: '13px'
                      }}>
                        <span style={{ color: '#fff' }}>
                          Chunk {i + 1}: {(split.amount / LAMPORTS_PER_SOL).toFixed(6)} SOL
                        </span>
                        <span style={{ 
                          color: split.matchQuality > 0.7 ? '#22c55e' : 
                                 split.matchQuality > 0.4 ? '#f59e0b' : '#888'
                        }}>
                          {(split.matchQuality * 100).toFixed(0)}% match
                        </span>
                      </div>
                      <div style={{ 
                        height: '8px', 
                        background: '#222', 
                        borderRadius: '4px',
                        overflow: 'hidden'
                      }}>
                        <div style={{ 
                          width: `${percentage}%`, 
                          height: '100%',
                          background: split.matchQuality > 0.7 ? '#22c55e' : 
                                      split.matchQuality > 0.4 ? '#f59e0b' : '#666',
                          borderRadius: '4px'
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detailed explanation */}
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#888' }}>
                Detailed Explanation
              </h4>
              <div style={{ 
                background: '#0a0a0a', 
                padding: '16px', 
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '12px',
                whiteSpace: 'pre-wrap',
                color: '#ccc',
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
              background: '#111', 
              border: '1px solid #333', 
              borderRadius: '12px', 
              padding: '48px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>No Data Yet</h3>
              <p style={{ color: '#888' }}>
                Enter an amount and number of chunks, then click "Run Indexer"
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
