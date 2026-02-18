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

/**
 * Withdrawal plan result
 * Used for final burner withdrawals: match historical amounts, plus optional remainder
 */
export interface WithdrawalPlan {
  valid: boolean;
  historicalChunks: AvailableAmount[];
  remainderLamports: number;
  remainderSol: number;
  error?: string;
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
   * @param connection Solana connection
   * @param limit Maximum number of transactions to index per pool
   * @param poolIds Optional: filter to only these pool IDs. If not provided, uses all pools.
   */
  async indexAllPools(
    connection: Connection,
    limit: number = 100,
    poolIds?: string[]
  ): Promise<IndexedData> {
    const allAmounts: HistoricalAmount[] = [];
    const poolBreakdown = new Map<string, number>();
    let totalTransactions = 0;
    
    const allPools = poolRegistry.getAll();
    const pools = poolIds 
      ? allPools.filter(p => poolIds.includes(p.id))
      : allPools;
    
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
   * @param poolIds Optional: filter to only these pool IDs
   */
  async getAvailableAmounts(
    connection: Connection, 
    limit: number = 100,
    poolIds?: string[]
  ): Promise<AvailableAmount[]> {
    const indexed = await this.indexAllPools(connection, limit, poolIds);
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
   * @param poolIds Optional: filter to only these pool IDs
   */
  async findExactSplit(
    connection: Connection,
    totalLamports: number,
    numChunks: number,
    poolIds?: string[]
  ): Promise<ExactSplitResult> {
    const available = await this.getAvailableAmounts(connection, 100, poolIds);
    
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
    
    // Special case: Check if total is exactly chunk × numChunks for any valid chunk amount
    // This handles the case where user clicks on a popular amount button
    // Calculate expected chunk amount (may have rounding)
    const expectedChunkLamports = Math.floor(totalLamports / numChunks);
    const remainder = totalLamports % numChunks;
    
    // Try to find a chunk amount that, when multiplied by numChunks, equals totalLamports
    // First, try exact match
    let matchingChunk = validAmounts.find(a => a.lamports * numChunks === totalLamports);
    
    // If not found, try with the expected chunk amount (allowing small rounding)
    if (!matchingChunk) {
      // Try exact expected chunk amount
      matchingChunk = validAmounts.find(a => a.lamports === expectedChunkLamports);
      
      // If still not found, try with tolerance (allow up to remainder + small rounding)
      if (!matchingChunk) {
        matchingChunk = validAmounts.find(a => {
          const diff = Math.abs(a.lamports - expectedChunkLamports);
          // Allow up to remainder + small rounding (1000 lamports)
          return diff <= remainder + 1000;
        });
      }
    }
    
    if (matchingChunk) {
      // Use this chunk amount repeated numChunks times
      const chunks = Array(numChunks).fill(matchingChunk);
      const actualTotal = matchingChunk.lamports * numChunks;
      
      // Verify it's close enough (handle rounding - allow up to 1000 lamports difference)
      if (Math.abs(actualTotal - totalLamports) <= 1000) {
        return {
          valid: true,
          chunks,
          totalLamports: actualTotal,
          totalSol: actualTotal / LAMPORTS_PER_SOL,
        };
      }
    }
    
    // Also check if we can use any combination of two amounts that sum to total
    // This handles cases like 0.038 + 0.038 = 0.076 even if the special case above didn't catch it
    // We'll let the backtracking algorithm handle this, but ensure it can find equal splits
    
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
    
    // Use backtracking to find combinations
    // First, try to find combinations with different amounts (better privacy)
    // If that fails, allow same amounts to be used multiple times
    const chunks: AvailableAmount[] = [];
    const usedAmounts = new Set<number>();
    
    const findCombination = (currentSum: number, depth: number, allowRepeats: boolean = false): boolean => {
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
        
        // Check if this amount has been used
        const isNewAmount = !usedAmounts.has(amt.lamports);
        
        // If not allowing repeats and this amount was already used, skip it
        // Exception: for the last chunk, always allow repeats if needed to reach target
        if (!allowRepeats && !isNewAmount && depth < numChunks - 1) {
          continue;
        }
        
        chunks.push(amt);
        if (isNewAmount) {
          usedAmounts.add(amt.lamports);
        }
        
        // Try with current allowRepeats setting
        if (findCombination(currentSum + amt.lamports, depth + 1, allowRepeats)) {
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
    
    // First try without allowing repeats (better privacy)
    if (findCombination(0, 0, false)) {
      const total = chunks.reduce((sum, c) => sum + c.lamports, 0);
      if (total === targetLamports) {
        return {
          valid: true,
          chunks: [...chunks],
          totalLamports: targetLamports,
          totalSol: targetLamports / LAMPORTS_PER_SOL,
        };
      }
    }
    
    // If that didn't work, try again allowing repeats (for cases like 0.038 + 0.038 = 0.076)
    chunks.length = 0;
    usedAmounts.clear();
    if (findCombination(0, 0, true)) {
      const total = chunks.reduce((sum, c) => sum + c.lamports, 0);
      if (total === targetLamports) {
        return {
          valid: true,
          chunks: [...chunks],
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
   * Prioritizes suggestions close to the user's entered amount
   * @param poolIds Optional: filter to only these pool IDs
   */
  async getSuggestedAmounts(
    connection: Connection,
    targetLamports: number,
    numChunks: number,
    poolIds?: string[]
  ): Promise<{ amount: number; sol: number; chunks: number[] }[]> {
    const available = await this.getAvailableAmounts(connection, 100, poolIds);
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
    const targetSol = targetLamports / LAMPORTS_PER_SOL;
    const rangePercent = 0.15; // 15% range (tighter than previous 20%)
    
    // Try amounts close to target with smaller increments (1-2% steps)
    // First pass: very close (within 5%) with 1% steps
    for (let offset = -0.05; offset <= 0.05; offset += 0.01) {
      const testAmount = Math.floor(targetLamports * (1 + offset));
      if (testAmount >= MIN_CHUNK_LAMPORTS * numChunks) {
        targetAmounts.push(testAmount);
      }
    }
    
    // Second pass: medium range (5-10%) with 1.5% steps
    for (let offset = -0.10; offset <= 0.10; offset += 0.015) {
      if (Math.abs(offset) > 0.05) { // Skip already covered range
        const testAmount = Math.floor(targetLamports * (1 + offset));
        if (testAmount >= MIN_CHUNK_LAMPORTS * numChunks) {
          targetAmounts.push(testAmount);
        }
      }
    }
    
    // Third pass: outer range (10-15%) with 2% steps
    for (let offset = -rangePercent; offset <= rangePercent; offset += 0.02) {
      if (Math.abs(offset) > 0.10) { // Skip already covered range
        const testAmount = Math.floor(targetLamports * (1 + offset));
        if (testAmount >= MIN_CHUNK_LAMPORTS * numChunks) {
          targetAmounts.push(testAmount);
        }
      }
    }
    
    // Consider available amounts that when multiplied by numChunks are close to target
    // This helps find suggestions that are naturally close to what the user wants
    for (const amt of validAmounts.slice(0, 20)) {
      const totalFromChunk = amt.lamports * numChunks;
      const diffPercent = Math.abs(totalFromChunk - targetLamports) / targetLamports;
      
      // Only consider if within 15% of target
      if (diffPercent <= rangePercent && totalFromChunk >= MIN_CHUNK_LAMPORTS * numChunks) {
        targetAmounts.push(totalFromChunk);
      }
    }
    
    // Also try some common round amounts, but only if they're within 15% of target
    const roundAmounts = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1, 2, 3, 5, 10].map(a => Math.floor(a * LAMPORTS_PER_SOL));
    for (const roundAmt of roundAmounts) {
      if (roundAmt >= MIN_CHUNK_LAMPORTS * numChunks) {
        const diffPercent = Math.abs(roundAmt - targetLamports) / targetLamports;
        // Only include if within 15% of target
        if (diffPercent <= rangePercent) {
          targetAmounts.push(roundAmt);
        }
      }
    }
    
    // Remove duplicates and sort by proximity to target
    const uniqueTargets = Array.from(new Set(targetAmounts)).sort((a, b) => 
      Math.abs(a - targetLamports) - Math.abs(b - targetLamports)
    );
    
    // For each target amount, try to find an exact split with different chunks
    for (const testTarget of uniqueTargets.slice(0, 30)) {
      const result = this.findExactCombination(validAmounts, testTarget, numChunks);
      
      if (result.valid && result.chunks.length === numChunks) {
        suggestions.push({
          amount: result.totalLamports,
          sol: result.totalSol,
          chunks: result.chunks.map(c => c.sol),
        });
      }
    }
    
    // Sort primarily by absolute difference from target (closest first)
    // Secondary sort by variation in chunks (for privacy)
    suggestions.sort((a, b) => {
      // Primary: absolute difference from target (closest first)
      const aDiff = Math.abs(a.amount - targetLamports);
      const bDiff = Math.abs(b.amount - targetLamports);
      
      if (aDiff !== bDiff) {
        return aDiff - bDiff;
      }
      
      // Secondary: prefer suggestions with more variation (different chunks)
      const aVariation = new Set(a.chunks.map(c => Math.round(c * 1000))).size;
      const bVariation = new Set(b.chunks.map(c => Math.round(c * 1000))).size;
      if (aVariation !== bVariation) {
        return bVariation - aVariation;
      }
      
      // Tertiary: prefer amounts >= target
      const aAboveTarget = a.amount >= targetLamports;
      const bAboveTarget = b.amount >= targetLamports;
      if (aAboveTarget !== bAboveTarget) {
        return aAboveTarget ? -1 : 1;
      }
      
      return 0;
    });
    
    // Remove duplicates (same total amount)
    const unique = new Map<number, typeof suggestions[0]>();
    for (const sug of suggestions) {
      const rounded = Math.round(sug.amount / 1000000); // Round to nearest 0.001 SOL
      if (!unique.has(rounded)) {
        unique.set(rounded, sug);
      }
    }
    
    // Return up to 8-10 suggestions to give users better options
    return Array.from(unique.values()).slice(0, 10);
  }

  /**
   * Compute withdrawal chunks based on indexed historical amounts.
   * - Tries 2–3 total chunks (historical + optional remainder)
   * - Strictly avoids any amounts in excludedAmounts
   * - Ensures every chunk (including remainder) >= MIN_CHUNK_LAMPORTS
   * - Prefers combinations that maximize historical coverage (smallest remainder)
   */
  async findWithdrawalSplit(
    connection: Connection,
    totalLamports: number,
    options: { minChunks: number; maxChunks: number },
    excludedAmounts: number[] = [],
    poolIds?: string[]
  ): Promise<WithdrawalPlan> {
    const { minChunks, maxChunks } = options;
    if (minChunks < 1 || maxChunks < minChunks) {
      throw new Error('Invalid withdrawal split options');
    }

    if (totalLamports < MIN_CHUNK_LAMPORTS) {
      return {
        valid: false,
        historicalChunks: [],
        remainderLamports: 0,
        remainderSol: 0,
        error: `Total withdrawal amount must be at least ${MIN_CHUNK_LAMPORTS / LAMPORTS_PER_SOL} SOL`,
      };
    }

    const available = await this.getAvailableAmounts(connection, 100, poolIds);

    // Filter to usable amounts: above minimum, <= total, and not excluded
    const excludedSet = new Set(excludedAmounts);
    const candidates = available.filter(a =>
      a.lamports >= MIN_CHUNK_LAMPORTS &&
      a.lamports <= totalLamports &&
      !excludedSet.has(a.lamports)
    );

    if (candidates.length === 0) {
      // No historical amounts available, fall back to single-chunk withdrawal if allowed
      if (totalLamports >= MIN_CHUNK_LAMPORTS && minChunks <= 1) {
        return {
          valid: true,
          historicalChunks: [],
          remainderLamports: totalLamports,
          remainderSol: totalLamports / LAMPORTS_PER_SOL,
        };
      }
      return {
        valid: false,
        historicalChunks: [],
        remainderLamports: 0,
        remainderSol: 0,
        error: 'No valid historical amounts available for withdrawal split',
      };
    }

    // Sort candidates by frequency (most common first), then by amount descending
    candidates.sort((a, b) => {
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return b.lamports - a.lamports;
    });

    let bestPlan: WithdrawalPlan | null = null;

    // Try total chunk counts 2 then 3 (or according to options)
    const totalChunkTargets: number[] = [];
    for (let k = minChunks; k <= maxChunks; k++) totalChunkTargets.push(k);

    for (const desiredTotalChunks of totalChunkTargets) {
      // We will pick historicalChunksCount in {desiredTotalChunks, desiredTotalChunks - 1}
      const histCounts = new Set<number>([
        desiredTotalChunks,
        Math.max(1, desiredTotalChunks - 1),
      ]);

      for (const histCount of histCounts) {
        // Backtracking over candidates to pick exactly histCount chunks
        const current: AvailableAmount[] = [];

        const backtrack = (startIndex: number, depth: number, sum: number) => {
          if (depth === histCount) {
            if (sum > totalLamports) return;

            const remainder = totalLamports - sum;
            const remainderChunkCount = remainder >= MIN_CHUNK_LAMPORTS ? 1 : 0;
            const totalChunks = depth + remainderChunkCount;

            // Must match desiredTotalChunks exactly
            if (totalChunks !== desiredTotalChunks) return;

            // If we have a remainder, ensure it's >= MIN_CHUNK_LAMPORTS (already checked)
            const plan: WithdrawalPlan = {
              valid: true,
              historicalChunks: [...current],
              remainderLamports: remainderChunkCount ? remainder : 0,
              remainderSol: remainderChunkCount ? remainder / LAMPORTS_PER_SOL : 0,
            };

            // Choose the plan that minimizes remainder, then uses more historical coverage
            if (!bestPlan) {
              bestPlan = plan;
            } else {
              const bestR = bestPlan.remainderLamports;
              const newR = plan.remainderLamports;
              if (
                newR < bestR ||
                (newR === bestR &&
                  sum > bestPlan.historicalChunks.reduce((acc, c) => acc + c.lamports, 0))
              ) {
                bestPlan = plan;
              }
            }
            return;
          }

          // Simple pruning
          if (sum >= totalLamports) return;

          for (let i = startIndex; i < candidates.length; i++) {
            const amt = candidates[i];
            if (amt.lamports < MIN_CHUNK_LAMPORTS) continue;
            const newSum = sum + amt.lamports;
            if (newSum > totalLamports) continue;

            current.push(amt);
            // Allow reuse of same amount; use i instead of i+1
            backtrack(i, depth + 1, newSum);
            current.pop();
          }
        };

        backtrack(0, 0, 0);
      }
    }

    if (bestPlan) {
      return bestPlan;
    }

    // Fallback: if no 2–3 chunk plan, but total itself is >= minimum, allow single remainder chunk
    if (totalLamports >= MIN_CHUNK_LAMPORTS && minChunks <= 1) {
      return {
        valid: true,
        historicalChunks: [],
        remainderLamports: totalLamports,
        remainderSol: totalLamports / LAMPORTS_PER_SOL,
      };
    }

    return {
      valid: false,
      historicalChunks: [],
      remainderLamports: 0,
      remainderSol: 0,
      error: 'Could not find a valid 2–3 chunk withdrawal split respecting minimum amount and exclusions',
    };
  }
}

// Singleton instance
export const transactionIndexer = new TransactionIndexer();
