import { Connection } from '@solana/web3.js';
import { transactionIndexer } from '../indexer/transaction-indexer';
import { poolRegistry } from '../pools/registry';

/**
 * Result of split optimization
 */
export interface SplitResult {
  poolId: string;
  amount: number;
  matchedHistoricalAmount?: number;
  matchQuality: number; // 0-1, how well it matches historical
  chunkIndex: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  splits: SplitResult[];
  totalAmount: number;
  averageMatchQuality: number;
  poolsUsed: string[];
}

/**
 * Split Optimizer
 * Determines optimal way to split funds across pools based on historical patterns
 */
export class SplitOptimizer {
  
  /**
   * Optimize split of an amount across pools
   * Goal: Match historical transaction amounts for maximum privacy
   */
  async optimizeSplit(
    connection: Connection,
    totalAmount: number,
    numChunks: number
  ): Promise<OptimizationResult> {
    // Get matching amounts from indexer
    const { amounts, poolAssignments } = await transactionIndexer.findMatchingAmounts(
      connection,
      totalAmount,
      numChunks
    );
    
    const splits: SplitResult[] = [];
    const poolsUsed = new Set<string>();
    let totalMatchQuality = 0;
    
    for (let i = 0; i < amounts.length; i++) {
      const amount = amounts[i];
      const poolId = poolAssignments.get(i) || 'privacy-cash'; // Default to privacy-cash
      
      // Calculate match quality (how close to ideal split)
      const idealAmount = totalAmount / numChunks;
      const deviation = Math.abs(amount - idealAmount) / idealAmount;
      const matchQuality = Math.max(0, 1 - deviation);
      
      splits.push({
        poolId: poolId === 'fallback' || poolId === 'remainder' ? 'privacy-cash' : poolId,
        amount,
        matchedHistoricalAmount: poolId !== 'fallback' && poolId !== 'remainder' ? amount : undefined,
        matchQuality,
        chunkIndex: i,
      });
      
      poolsUsed.add(poolId === 'fallback' || poolId === 'remainder' ? 'privacy-cash' : poolId);
      totalMatchQuality += matchQuality;
    }
    
    return {
      splits,
      totalAmount,
      averageMatchQuality: totalMatchQuality / splits.length,
      poolsUsed: Array.from(poolsUsed),
    };
  }
  
  /**
   * Optimize split across multiple pools
   * Distributes amounts to pools based on their historical patterns
   */
  async optimizeMultiPoolSplit(
    connection: Connection,
    totalAmount: number,
    numChunks: number,
    preferredPools?: string[]
  ): Promise<OptimizationResult> {
    const pools = preferredPools 
      ? preferredPools.map(id => poolRegistry.get(id)).filter(Boolean)
      : poolRegistry.getAll();
    
    if (pools.length === 0) {
      // No pools available, use single pool fallback
      return this.optimizeSplit(connection, totalAmount, numChunks);
    }
    
    // Get historical data from all pools
    const poolHistoricals = new Map<string, number[]>();
    for (const pool of pools) {
      if (!pool) continue;
      try {
        const amounts = await pool.getHistoricalAmounts(connection, 100);
        poolHistoricals.set(pool.id, amounts);
      } catch {
        poolHistoricals.set(pool.id, []);
      }
    }
    
    // Assign chunks to pools based on best matches
    const splits: SplitResult[] = [];
    const poolsUsed = new Set<string>();
    let remainingAmount = totalAmount;
    let totalMatchQuality = 0;
    
    for (let i = 0; i < numChunks; i++) {
      const targetAmount = remainingAmount / (numChunks - i);
      
      let bestMatch = {
        poolId: pools[0]?.id || 'privacy-cash',
        amount: targetAmount,
        matchQuality: 0.5,
        historicalAmount: undefined as number | undefined,
      };
      
      // Find best matching pool and amount
      for (const [poolId, historicals] of poolHistoricals) {
        for (const histAmount of historicals) {
          if (histAmount > remainingAmount) continue;
          
          const diff = Math.abs(histAmount - targetAmount);
          const quality = Math.max(0, 1 - (diff / targetAmount));
          
          if (quality > bestMatch.matchQuality) {
            bestMatch = {
              poolId,
              amount: histAmount,
              matchQuality: quality,
              historicalAmount: histAmount,
            };
          }
        }
      }
      
      // For last chunk, use remainder
      const finalAmount = i === numChunks - 1 ? remainingAmount : bestMatch.amount;
      
      splits.push({
        poolId: bestMatch.poolId,
        amount: finalAmount,
        matchedHistoricalAmount: bestMatch.historicalAmount,
        matchQuality: bestMatch.matchQuality,
        chunkIndex: i,
      });
      
      poolsUsed.add(bestMatch.poolId);
      totalMatchQuality += bestMatch.matchQuality;
      remainingAmount -= finalAmount;
    }
    
    return {
      splits,
      totalAmount,
      averageMatchQuality: totalMatchQuality / splits.length,
      poolsUsed: Array.from(poolsUsed),
    };
  }
  
  /**
   * Simple equal split (fallback)
   */
  simpleEqualSplit(
    totalAmount: number, 
    numChunks: number, 
    poolId: string = 'privacy-cash'
  ): OptimizationResult {
    const baseAmount = Math.floor(totalAmount / numChunks);
    const remainder = totalAmount - (baseAmount * numChunks);
    
    const splits: SplitResult[] = [];
    
    for (let i = 0; i < numChunks; i++) {
      // Add remainder to last chunk
      const amount = i === numChunks - 1 ? baseAmount + remainder : baseAmount;
      
      splits.push({
        poolId,
        amount,
        matchQuality: 0.5, // Average quality for equal splits
        chunkIndex: i,
      });
    }
    
    return {
      splits,
      totalAmount,
      averageMatchQuality: 0.5,
      poolsUsed: [poolId],
    };
  }
}

// Singleton instance
export const splitOptimizer = new SplitOptimizer();
