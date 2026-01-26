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
   * Prefers different chunk amounts for better privacy
   * Uses backtracking to find valid combinations
   */
  private findExactCombination(
    available: AvailableAmount[],
    targetLamports: number,
    numChunks: number
  ): ExactSplitResult {
    // Sort by frequency (most common first) then by amount (larger first)
    const sorted = [...available].sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return b.lamports - a.lamports;
    });
    
    // Filter to amounts that could fit
    const validAmounts = sorted.filter(a => 
      a.lamports >= MIN_CHUNK_LAMPORTS && a.lamports <= targetLamports
    );
    
    if (validAmounts.length === 0) {
      return {
        valid: false,
        chunks: [],
        totalLamports: 0,
        totalSol: 0,
      };
    }
    
    // Use backtracking to find combinations with different amounts
    const chunks: AvailableAmount[] = [];
    const usedAmounts = new Set<number>();
    
    const findCombination = (currentSum: number, depth: number): boolean => {
      if (depth === numChunks) {
        return currentSum === targetLamports;
      }
      
      // Prune if we've exceeded target
      if (currentSum > targetLamports) {
        return false;
      }
      
      // Calculate min/max for remaining chunks
      const remainingChunks = numChunks - depth;
      const minForRemaining = MIN_CHUNK_LAMPORTS * remainingChunks;
      const maxForThisChunk = targetLamports - currentSum - minForRemaining + MIN_CHUNK_LAMPORTS;
      
      // Try each valid amount
      for (const amt of validAmounts) {
        if (amt.lamports < MIN_CHUNK_LAMPORTS || amt.lamports > maxForThisChunk) {
          continue;
        }
        
        // Prefer different amounts (better privacy)
        const isNewAmount = !usedAmounts.has(amt.lamports);
        
        // For early chunks, prefer new amounts; for later chunks, allow repeats if needed
        if (depth < numChunks - 2 && !isNewAmount) {
          continue; // Early chunks should be different
        }
        
        chunks.push(amt);
        if (isNewAmount) {
          usedAmounts.add(amt.lamports);
        }
        
        if (findCombination(currentSum + amt.lamports, depth + 1)) {
          return true;
        }
        
        // Backtrack
        chunks.pop();
        if (isNewAmount) {
          usedAmounts.delete(amt.lamports);
        }
      }
      
      return false;
    };
    
    if (findCombination(0, 0)) {
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
   * Returns list of valid totals with DIFFERENT chunk amounts for better privacy
   * Each suggestion is verified to have a valid exact split
   */
  async getSuggestedAmounts(
    connection: Connection,
    targetLamports: number,
    numChunks: number
  ): Promise<{ amount: number; sol: number; chunks: number[] }[]> {
    const available = await this.getAvailableAmounts(connection, 100);
    const suggestions: { amount: number; sol: number; chunks: number[] }[] = [];
    
    // Get valid amounts (only use amounts that actually exist in historical data)
    const validAmounts = available
      .filter(a => a.lamports >= MIN_CHUNK_LAMPORTS)
      .slice(0, 30);
    
    if (validAmounts.length === 0) {
      return [];
    }
    
    // Generate potential target amounts around the user's target
    const targetAmounts: number[] = [];
    
    // Try amounts close to target (within 20% above/below)
    for (let offset = -0.2; offset <= 0.2; offset += 0.05) {
      const testAmount = Math.floor(targetLamports * (1 + offset));
      if (testAmount >= MIN_CHUNK_LAMPORTS * numChunks) {
        targetAmounts.push(testAmount);
      }
    }
    
    // Also try some common round amounts
    const roundAmounts = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5].map(a => Math.floor(a * LAMPORTS_PER_SOL));
    for (const roundAmt of roundAmounts) {
      if (roundAmt >= MIN_CHUNK_LAMPORTS * numChunks && roundAmt <= targetLamports * 2) {
        targetAmounts.push(roundAmt);
      }
    }
    
    // Remove duplicates and sort
    const uniqueTargets = Array.from(new Set(targetAmounts)).sort((a, b) => 
      Math.abs(a - targetLamports) - Math.abs(b - targetLamports)
    );
    
    // For each target amount, try to find an exact split with different chunks
    for (const testTarget of uniqueTargets.slice(0, 20)) {
      const result = this.findExactCombination(validAmounts, testTarget, numChunks);
      
      if (result.valid && result.chunks.length === numChunks) {
        // Check if chunks are different (better privacy)
        const uniqueChunks = new Set(result.chunks.map(c => c.lamports));
        const hasVariation = uniqueChunks.size > 1;
        
        // Prefer suggestions with variation, but include equal splits too
        suggestions.push({
          amount: result.totalLamports,
          sol: result.totalSol,
          chunks: result.chunks.map(c => c.sol),
        });
      }
    }
    
    // Sort by closeness to target, prioritizing amounts >= target and more variation
    suggestions.sort((a, b) => {
      const aAboveTarget = a.amount >= targetLamports;
      const bAboveTarget = b.amount >= targetLamports;
      
      if (aAboveTarget && !bAboveTarget) return -1;
      if (!aAboveTarget && bAboveTarget) return 1;
      
      // Prefer suggestions with more variation (different chunks)
      const aVariation = new Set(a.chunks.map(c => Math.round(c * 1000))).size;
      const bVariation = new Set(b.chunks.map(c => Math.round(c * 1000))).size;
      if (aVariation !== bVariation) return bVariation - aVariation;
      
      // Then sort by closeness to target
      return Math.abs(a.amount - targetLamports) - Math.abs(b.amount - targetLamports);
    });
    
    // Remove duplicates (same total amount)
    const unique = new Map<number, typeof suggestions[0]>();
    for (const sug of suggestions) {
      const rounded = Math.round(sug.amount / 1000000); // Round to nearest 0.001 SOL
      if (!unique.has(rounded)) {
        unique.set(rounded, sug);
      }
    }
    
    return Array.from(unique.values()).slice(0, 6);
  }
}

// Singleton instance
export const transactionIndexer = new TransactionIndexer();
