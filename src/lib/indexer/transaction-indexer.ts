import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { poolRegistry } from '../pools/registry';

/**
 * Historical amount data with pool attribution
 */
export interface HistoricalAmount {
  amount: number; // in lamports
  amountSol: number; // in SOL for display
  poolId: string;
  frequency: number; // How many times this amount appears
}

/**
 * Indexed data result
 */
export interface IndexedData {
  amounts: HistoricalAmount[];
  totalTransactions: number;
  lastUpdated: Date;
  poolBreakdown: Map<string, number>; // poolId -> count
}

/**
 * Available amount for user selection
 */
export interface AvailableAmount {
  lamports: number;
  sol: number;
  frequency: number;
  isHistorical: boolean; // true = from actual transactions, false = common amount
}

/**
 * Exact split result
 */
export interface ExactSplitResult {
  valid: boolean;
  chunks: AvailableAmount[];
  totalLamports: number;
  totalSol: number;
  error?: string;
  suggestion?: string; // Suggested amount if invalid
}

// Minimum amount per chunk (accounts for 0.02 SOL min deposit + fees)
export const MIN_CHUNK_LAMPORTS = 0.035 * LAMPORTS_PER_SOL; // 0.035 SOL minimum per chunk

// Common "round" amounts that are privacy-friendly (in lamports)
export const COMMON_AMOUNTS_LAMPORTS = [
  0.02 * LAMPORTS_PER_SOL,  // 0.02 SOL
  0.03 * LAMPORTS_PER_SOL,  // 0.03 SOL
  0.05 * LAMPORTS_PER_SOL,  // 0.05 SOL
  0.1 * LAMPORTS_PER_SOL,   // 0.1 SOL
  0.2 * LAMPORTS_PER_SOL,   // 0.2 SOL
  0.25 * LAMPORTS_PER_SOL,  // 0.25 SOL
  0.5 * LAMPORTS_PER_SOL,   // 0.5 SOL
  1 * LAMPORTS_PER_SOL,     // 1 SOL
  2 * LAMPORTS_PER_SOL,     // 2 SOL
  5 * LAMPORTS_PER_SOL,     // 5 SOL
  10 * LAMPORTS_PER_SOL,    // 10 SOL
];

/**
 * Transaction Indexer
 * Aggregates historical transaction amounts from all registered pools
 */
export class TransactionIndexer {
  private cache: Map<string, { data: number[]; timestamp: number }> = new Map();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes cache
  
  /**
   * Index all registered pools and aggregate historical amounts
   */
  async indexAllPools(
    connection: Connection,
    limit: number = 100
  ): Promise<IndexedData> {
    const allAmounts: HistoricalAmount[] = [];
    const poolBreakdown = new Map<string, number>();
    let totalTransactions = 0;
    
    const pools = poolRegistry.getAll();
    
    for (const pool of pools) {
      const cacheKey = `${pool.id}-${limit}`;
      const cached = this.cache.get(cacheKey);
      
      let amounts: number[];
      
      // Check cache
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        amounts = cached.data;
      } else {
        try {
          amounts = await pool.getHistoricalAmounts(connection, limit);
          this.cache.set(cacheKey, { data: amounts, timestamp: Date.now() });
        } catch (error) {
          console.error(`Error indexing pool ${pool.id}:`, error);
          amounts = [];
        }
      }
      
      // Track pool breakdown
      poolBreakdown.set(pool.id, amounts.length);
      totalTransactions += amounts.length;
      
      // Count frequency of each amount
      const frequencyMap = new Map<number, number>();
      for (const amount of amounts) {
        frequencyMap.set(amount, (frequencyMap.get(amount) || 0) + 1);
      }
      
      // Add to all amounts with frequency
      for (const [amount, frequency] of frequencyMap) {
        allAmounts.push({
          amount,
          amountSol: amount / LAMPORTS_PER_SOL,
          poolId: pool.id,
          frequency,
        });
      }
    }
    
    // Sort by frequency (most common first) then by amount
    allAmounts.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.amount - b.amount;
    });
    
    return {
      amounts: allAmounts,
      totalTransactions,
      lastUpdated: new Date(),
      poolBreakdown,
    };
  }
  
  /**
   * Get unique amounts from all pools (for matching)
   */
  async getUniqueAmounts(connection: Connection, limit: number = 100): Promise<number[]> {
    const indexed = await this.indexAllPools(connection, limit);
    const unique = new Set(indexed.amounts.map(a => a.amount));
    return Array.from(unique).sort((a, b) => a - b);
  }
  
  /**
   * Find the best matching amounts for a target total
   * Returns amounts that are close to the target split
   */
  async findMatchingAmounts(
    connection: Connection,
    targetAmount: number,
    numChunks: number
  ): Promise<{ amounts: number[]; poolAssignments: Map<number, string> }> {
    const indexed = await this.indexAllPools(connection, 100);
    const historicalAmounts = indexed.amounts;
    
    if (historicalAmounts.length === 0) {
      // Fallback to equal splits
      return this.generateFallbackSplit(targetAmount, numChunks);
    }
    
    const matchedAmounts: number[] = [];
    const poolAssignments = new Map<number, string>();
    const usedIndices = new Set<number>();
    let remainingAmount = targetAmount;
    
    for (let i = 0; i < numChunks - 1; i++) {
      const targetChunkAmount = remainingAmount / (numChunks - i);
      
      // Find best matching historical amount
      let bestMatch = { amount: targetChunkAmount, poolId: 'fallback', index: -1 };
      let bestDiff = Infinity;
      
      for (let j = 0; j < historicalAmounts.length; j++) {
        if (usedIndices.has(j)) continue;
        
        const { amount, poolId, frequency } = historicalAmounts[j];
        if (amount > remainingAmount) continue;
        
        // Prefer amounts with higher frequency (more common = better privacy)
        const diff = Math.abs(amount - targetChunkAmount) / (1 + Math.log(frequency + 1));
        
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = { amount, poolId, index: j };
        }
      }
      
      if (bestMatch.index !== -1) {
        usedIndices.add(bestMatch.index);
      }
      
      matchedAmounts.push(bestMatch.amount);
      poolAssignments.set(matchedAmounts.length - 1, bestMatch.poolId);
      remainingAmount -= bestMatch.amount;
    }
    
    // Last chunk gets remainder
    matchedAmounts.push(remainingAmount);
    poolAssignments.set(matchedAmounts.length - 1, 'remainder');
    
    return { amounts: matchedAmounts, poolAssignments };
  }
  
  /**
   * Generate fallback split when no historical data
   */
  private generateFallbackSplit(
    totalAmount: number, 
    numChunks: number
  ): { amounts: number[]; poolAssignments: Map<number, string> } {
    const amounts: number[] = [];
    const poolAssignments = new Map<number, string>();
    
    // Random-ish splits to add some variance
    const randomFactors = Array.from({ length: numChunks }, () => 0.8 + Math.random() * 0.4);
    const sum = randomFactors.reduce((a, b) => a + b, 0);
    const normalizedFactors = randomFactors.map(f => f / sum);
    
    let remaining = totalAmount;
    for (let i = 0; i < numChunks - 1; i++) {
      const amount = Math.floor(totalAmount * normalizedFactors[i]);
      amounts.push(amount);
      poolAssignments.set(i, 'fallback');
      remaining -= amount;
    }
    
    amounts.push(remaining);
    poolAssignments.set(numChunks - 1, 'fallback');
    
    return { amounts, poolAssignments };
  }
  
  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get available amounts for exact matching
   * Combines historical amounts with common "round" amounts
   * Returns amounts sorted by frequency (most common first)
   */
  async getAvailableAmounts(connection: Connection, limit: number = 100): Promise<AvailableAmount[]> {
    const indexed = await this.indexAllPools(connection, limit);
    const availableMap = new Map<number, AvailableAmount>();
    
    // Add historical amounts
    for (const hist of indexed.amounts) {
      // Round to nearest 0.001 SOL for matching
      const roundedLamports = Math.round(hist.amount / 1000000) * 1000000;
      if (roundedLamports >= MIN_CHUNK_LAMPORTS) {
        const existing = availableMap.get(roundedLamports);
        if (existing) {
          existing.frequency += hist.frequency;
        } else {
          availableMap.set(roundedLamports, {
            lamports: roundedLamports,
            sol: roundedLamports / LAMPORTS_PER_SOL,
            frequency: hist.frequency,
            isHistorical: true,
          });
        }
      }
    }
    
    // Add common amounts (if not already present from historical)
    for (const commonLamports of COMMON_AMOUNTS_LAMPORTS) {
      if (commonLamports >= MIN_CHUNK_LAMPORTS && !availableMap.has(commonLamports)) {
        availableMap.set(commonLamports, {
          lamports: commonLamports,
          sol: commonLamports / LAMPORTS_PER_SOL,
          frequency: 0, // No historical data, but still valid
          isHistorical: false,
        });
      }
    }
    
    // Sort by frequency (historical first, then common amounts by size)
    const amounts = Array.from(availableMap.values());
    amounts.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.lamports - b.lamports;
    });
    
    return amounts;
  }

  /**
   * Find EXACT split for a given total amount
   * Only uses exact amounts from available pool - no approximation!
   */
  async findExactSplit(
    connection: Connection,
    totalLamports: number,
    numChunks: number
  ): Promise<ExactSplitResult> {
    const available = await this.getAvailableAmounts(connection, 100);
    
    // Filter to amounts that fit
    const validAmounts = available.filter(a => 
      a.lamports >= MIN_CHUNK_LAMPORTS && a.lamports <= totalLamports
    );
    
    if (validAmounts.length === 0) {
      return {
        valid: false,
        chunks: [],
        totalLamports: 0,
        totalSol: 0,
        error: `No valid amounts available. Minimum per chunk is ${MIN_CHUNK_LAMPORTS / LAMPORTS_PER_SOL} SOL`,
      };
    }
    
    // Try to find exact combination using greedy approach with backtracking
    const result = this.findExactCombination(validAmounts, totalLamports, numChunks);
    
    if (result.valid) {
      return result;
    }
    
    // If exact match not found, suggest nearest valid amount
    const suggestedTotal = this.findNearestValidTotal(validAmounts, totalLamports, numChunks);
    
    return {
      valid: false,
      chunks: [],
      totalLamports: 0,
      totalSol: 0,
      error: `Cannot split ${totalLamports / LAMPORTS_PER_SOL} SOL into ${numChunks} exact historical amounts`,
      suggestion: `Try sending ${suggestedTotal / LAMPORTS_PER_SOL} SOL instead`,
    };
  }

  /**
   * Find exact combination of amounts that sum to target
   * ONLY returns valid if the sum EXACTLY equals targetLamports
   */
  private findExactCombination(
    available: AvailableAmount[],
    targetLamports: number,
    numChunks: number
  ): ExactSplitResult {
    // Sort by lamports for consistent selection
    const sorted = [...available].sort((a, b) => b.lamports - a.lamports);
    
    // Try to find N amounts that sum exactly to target
    // First, check if we can use equal amounts (most privacy-friendly)
    const equalAmount = targetLamports / numChunks;
    const equalChunk = available.find(a => a.lamports === equalAmount);
    if (equalChunk) {
      const chunks = Array(numChunks).fill(equalChunk);
      return {
        valid: true,
        chunks,
        totalLamports: targetLamports,
        totalSol: targetLamports / LAMPORTS_PER_SOL,
      };
    }
    
    // Try greedy approach to find exact match
    const chunks: AvailableAmount[] = [];
    let remaining = targetLamports;
    
    for (let i = 0; i < numChunks - 1 && remaining > 0; i++) {
      // Find best amount for this chunk that leaves enough for remaining chunks
      const minRemainingNeeded = MIN_CHUNK_LAMPORTS * (numChunks - i - 1);
      const maxForThisChunk = remaining - minRemainingNeeded;
      
      // Find largest amount that fits
      let bestMatch: AvailableAmount | null = null;
      for (const amt of sorted) {
        if (amt.lamports <= maxForThisChunk && amt.lamports >= MIN_CHUNK_LAMPORTS) {
          bestMatch = amt;
          break; // Take largest that fits
        }
      }
      
      if (!bestMatch) break;
      
      chunks.push(bestMatch);
      remaining -= bestMatch.lamports;
    }
    
    // Check if remaining amount matches an available amount EXACTLY
    if (chunks.length === numChunks - 1 && remaining >= MIN_CHUNK_LAMPORTS) {
      const lastChunk = available.find(a => a.lamports === remaining);
      if (lastChunk) {
        chunks.push(lastChunk);
        // Verify total matches exactly
        const total = chunks.reduce((sum, c) => sum + c.lamports, 0);
        if (total === targetLamports) {
          return {
            valid: true,
            chunks,
            totalLamports: targetLamports,
            totalSol: targetLamports / LAMPORTS_PER_SOL,
          };
        }
      }
    }
    
    // No exact match found
    return {
      valid: false,
      chunks: [],
      totalLamports: 0,
      totalSol: 0,
    };
  }

  /**
   * Find nearest valid total that can be split exactly
   */
  private findNearestValidTotal(
    available: AvailableAmount[],
    targetLamports: number,
    numChunks: number
  ): number {
    // Get all amounts that could be used for equal splits
    const validAmounts = available
      .filter(a => a.lamports >= MIN_CHUNK_LAMPORTS)
      .map(a => a.lamports);
    
    if (validAmounts.length === 0) {
      return MIN_CHUNK_LAMPORTS * numChunks;
    }
    
    // Find the closest total (using equal splits for simplicity)
    let bestTotal = MIN_CHUNK_LAMPORTS * numChunks;
    let bestDiff = Math.abs(targetLamports - bestTotal);
    
    for (const amt of validAmounts) {
      const total = amt * numChunks;
      const diff = Math.abs(targetLamports - total);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestTotal = total;
      }
    }
    
    return bestTotal;
  }

  /**
   * Get suggested amounts based on user's target
   * Returns list of valid totals they could send (equal splits only for simplicity)
   */
  async getSuggestedAmounts(
    connection: Connection,
    targetLamports: number,
    numChunks: number
  ): Promise<{ amount: number; sol: number; chunks: number[] }[]> {
    const available = await this.getAvailableAmounts(connection, 100);
    const suggestions: { amount: number; sol: number; chunks: number[] }[] = [];
    
    // Get amounts that could work for equal splits
    const validAmounts = available
      .filter(a => a.lamports >= MIN_CHUNK_LAMPORTS)
      .slice(0, 20); // Get more options
    
    // Generate suggestions using equal splits (most privacy-friendly)
    // Include amounts both smaller and larger than target
    for (const amt of validAmounts) {
      const total = amt.lamports * numChunks;
      // Include suggestions within a wider range (50% to 200% of target)
      if (total >= MIN_CHUNK_LAMPORTS * numChunks && total <= targetLamports * 2) {
        suggestions.push({
          amount: total,
          sol: total / LAMPORTS_PER_SOL,
          chunks: Array(numChunks).fill(amt.lamports / LAMPORTS_PER_SOL),
        });
      }
    }
    
    // Sort by closeness to target, prioritizing amounts >= target
    suggestions.sort((a, b) => {
      // Prefer amounts that are >= target (user probably wants to send at least that much)
      const aAboveTarget = a.amount >= targetLamports;
      const bAboveTarget = b.amount >= targetLamports;
      
      if (aAboveTarget && !bAboveTarget) return -1;
      if (!aAboveTarget && bAboveTarget) return 1;
      
      // Then sort by closeness to target
      return Math.abs(a.amount - targetLamports) - Math.abs(b.amount - targetLamports);
    });
    
    return suggestions.slice(0, 6);
  }
}

// Singleton instance
export const transactionIndexer = new TransactionIndexer();
