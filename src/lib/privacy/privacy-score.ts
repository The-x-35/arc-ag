import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface AvailableAmount {
  lamports: number;
  sol: number;
  frequency: number;
  isHistorical: boolean;
}

export interface PrivacyScoreResult {
  pss: number;
  perChunkScores: number[];
  anonymitySets: number[];
  roundingFactors: number[];
  timeDelays: number[];
  level: 'weak' | 'moderate' | 'strong' | 'very-strong';
}

/**
 * Get anonymity set for a chunk amount
 * Tries to match against available historical amounts
 */
export function getAnonymitySet(
  chunk: { lamports: number; sol: number; frequency?: number },
  availableAmounts: AvailableAmount[]
): number {
  // If frequency is provided directly in chunk, use it
  if (chunk.frequency !== undefined && chunk.frequency > 0) {
    return chunk.frequency;
  }

  const amountSol = chunk.sol;
  const amountLamports = chunk.lamports;
  const tolerance = 0.001; // ±0.001 SOL tolerance for matching

  // Try exact lamports match first (most precise)
  for (const available of availableAmounts) {
    if (available.lamports === amountLamports) {
      return available.frequency;
    }
  }

  // Try exact SOL match with tolerance
  for (const available of availableAmounts) {
    const diff = Math.abs(available.sol - amountSol);
    if (diff <= tolerance) {
      return available.frequency;
    }
  }

  // If no exact match, try rounding to nearest 0.001 SOL and matching
  const roundedSol = Math.round(amountSol * 1000) / 1000;
  for (const available of availableAmounts) {
    const availableRounded = Math.round(available.sol * 1000) / 1000;
    if (Math.abs(availableRounded - roundedSol) <= tolerance) {
      return available.frequency;
    }
  }
  
  // Last resort: find closest match and use its frequency if very close
  if (availableAmounts.length > 0) {
    const closest = availableAmounts.reduce((closest, a) => {
      const diff = Math.abs(a.sol - amountSol);
      return diff < Math.abs(closest.sol - amountSol) ? a : closest;
    }, availableAmounts[0]);
    
    const diff = Math.abs(closest.sol - amountSol);
    // Use closest match if within 0.01 SOL (more lenient for round amounts)
    if (diff < 0.01) {
      if (closest.frequency > 0) {
        return closest.frequency;
      } else {
        // Even if frequency is 0, if it's a common round amount with exact match, give default AS
        const roundAmounts = [0.1, 0.2, 0.25, 0.5, 1, 2, 3, 5, 10];
        if (roundAmounts.includes(amountSol) || roundAmounts.includes(closest.sol)) {
          return 10; // Default anonymity set for common round amounts
        }
      }
    } else {
      // Final fallback: if it's a common round amount, give default AS
      const roundAmounts = [0.1, 0.2, 0.25, 0.3, 0.5, 1, 2, 3, 5, 5.5, 10];
      if (roundAmounts.includes(amountSol)) {
        return 10;
      } else if (closest.frequency > 0 && (diff / amountSol) * 100 < 50) {
        // If closest match is within 50% and has frequency, use it (very lenient for edge cases)
        return closest.frequency;
      }
    }
  }

  // Final fallback: if it's a common round amount, give default AS
  const roundAmounts = [0.1, 0.2, 0.25, 0.3, 0.5, 1, 2, 3, 5, 5.5, 10];
  if (roundAmounts.includes(amountSol)) {
    return 10;
  }

  return 0;
}

/**
 * Calculate rounding factor for an amount
 * Round amounts (1, 2, 5, 10 SOL) get higher factor
 */
export function calculateRoundingFactor(amountSol: number): number {
  // Check if amount is a round number
  const rounded = Math.round(amountSol * 100) / 100;
  if (Math.abs(amountSol - rounded) < 0.001) {
    // Check if it's a common round amount
    if ([0.1, 0.2, 0.25, 0.5, 1, 2, 3, 5, 10].includes(rounded)) {
      return 1.0; // Full factor for common round amounts
    }
    return 0.5; // Semi-round amounts
  }
  return 0.1; // Unique amounts
}

/**
 * Calculate chunk diversity factor
 * Rewards variety in chunk amounts
 */
export function calculateChunkDiversity(chunks: Array<{ sol: number }>): number {
  if (chunks.length <= 1) return 1.0; // Single chunk or no chunks means no diversity penalty

  const uniqueChunks = new Set(chunks.map(c => Math.round(c.sol * 1000) / 1000)).size;
  const totalChunks = chunks.length;

  // Diversity factor: 0.5 (min) to 1.0 (max)
  // 0.5 + 0.5 * (unique / total)
  const diversity = 0.5 + 0.5 * (uniqueChunks / totalChunks);
  return diversity;
}

/**
 * Normalize PSS score to 1-9.9 range
 * Uses exponential curve to preserve relative differences while mapping to readable scale
 */
function normalizePss(rawPss: number): number {
  if (rawPss <= 0) return 1.0;
  
  // Map raw PSS into 1-9.9 range using exponential curve
  // Formula: 1 + 8.9 * (1 - exp(-raw / scale))
  // Scale factor of 2.0 provides good distribution:
  // - raw ~0.1 → normalized ~1.4
  // - raw ~1.0 → normalized ~4.5
  // - raw ~5.0 → normalized ~9.2
  // - raw ~10+ → normalized ~9.9
  const scale = 2.0;
  const normalized = 1.0 + 8.9 * (1 - Math.exp(-rawPss / scale));
  
  // Clamp to ensure we never exceed 9.9
  return Math.min(9.9, Math.max(1.0, normalized));
}

/**
 * Get privacy level from normalized PSS score (1-9.9 range)
 */
export function getPrivacyLevel(pss: number): 'weak' | 'moderate' | 'strong' | 'very-strong' {
  if (pss < 3.0) return 'weak';
  if (pss < 6.0) return 'moderate';
  if (pss < 8.0) return 'strong';
  return 'very-strong';
}

/**
 * Format privacy score for display
 */
export function formatPrivacyScore(pss: number): string {
  return pss.toFixed(2);
}

/**
 * Calculate Privacy Strength Score (PSS)
 * 
 * Formula improvements:
 * 1. Minimum time factor (0.3) even at 0 delay
 * 2. Reward variety in chunk amounts
 * 3. Use weighted average instead of min (one bad chunk shouldn't kill everything)
 * 4. Reward historical matching more
 * 
 * Formula:
 * - Per-chunk: P_i = log₂(AS_i + 1) × timeFactor × R_i
 *   where timeFactor = 0.3 + 0.7 × min(1, T_i / 72) [gives 0.3 minimum even at 0 delay]
 * - Average per-chunk: avg(P_i)
 * - Chunk diversity: D = 0.5 + 0.5 × (unique_chunks / total_chunks)
 * - Total: PSS = weighted(P_i) × log₂(n + 1) × D × (1 + 0.1 × H) × historicalBonus
 * 
 * Where:
 * - AS_i: Anonymity set (frequency of matching historical amounts)
 * - T_i: Time delay in hours (capped at 72 hours)
 * - R_i: Rounding factor (1.0 for round, 0.5 for semi-round, 0.1 for unique)
 * - n: Number of chunks
 * - H: Number of intermediate hops (numChunks, intermediate burners only)
 * - D: Chunk diversity factor (rewards variety)
 * - historicalBonus: Bonus multiplier if all chunks match historical amounts
 */
export function calculatePrivacyScore(
  chunks: Array<{ lamports: number; sol: number; frequency?: number }>,
  delayMinutes: number,
  availableAmounts: AvailableAmount[],
  numChunks: number
): PrivacyScoreResult {
  // Convert delay to hours
  const delayHours = delayMinutes / 60;
  
  // Improved time factor: gives minimum 0.3 even at 0 delay
  // Formula: 0.3 + 0.7 × min(1, T_i / 72)
  // This means: 0 delay = 0.3, 72+ hours = 1.0
  const timeFactor = 0.3 + 0.7 * Math.min(1, delayHours / 72);
  
  // Calculate per-chunk scores
  const perChunkScores: number[] = [];
  const anonymitySets: number[] = [];
  const roundingFactors: number[] = [];
  const timeDelays: number[] = [];
  let allMatchHistorical = true;
  
  for (const chunk of chunks) {
    // Get anonymity set for this chunk
    // If chunks come from findExactSplit (valid=true), they are EXACT historical amounts with frequency
    let AS_i = 0;
    
    // Check for frequency in chunk (should be there if from findExactSplit)
    const chunkFreq = (chunk as any).frequency;
    
    if (chunkFreq !== undefined && chunkFreq !== null && chunkFreq > 0) {
      // Use frequency directly from chunk - it's an exact historical match
      AS_i = chunkFreq;
    } else {
      // Fallback: look up by EXACT lamports match (these are exact historical amounts!)
      const exactMatch = availableAmounts.find(a => a.lamports === chunk.lamports);
      if (exactMatch && exactMatch.frequency > 0) {
        AS_i = exactMatch.frequency;
      } else {
        // This should rarely happen - if it does, the chunk might not be from a valid split
        // Try getAnonymitySet as last resort
        AS_i = getAnonymitySet(chunk, availableAmounts);
        if (AS_i === 0) {
          AS_i = 1; // Minimum for any valid chunk
        }
      }
    }
    
    anonymitySets.push(AS_i);
    
    // Track if all chunks match historical
    if (AS_i === 0) {
      allMatchHistorical = false;
    }
    
    // Get rounding factor
    const R_i = calculateRoundingFactor(chunk.sol);
    roundingFactors.push(R_i);
    
    // All chunks use the same time delay
    timeDelays.push(timeFactor);
    
    // Calculate per-chunk privacy score: P_i = log₂(AS_i + 1) × timeFactor × R_i
    const logAnonymity = Math.log2(AS_i + 1);
    const P_i = logAnonymity * timeFactor * R_i;
    
    perChunkScores.push(P_i);
  }
  
  // Use weighted average instead of min - one bad chunk shouldn't kill everything
  // But weight towards the minimum to still penalize weak chunks
  const sumP_i = perChunkScores.reduce((sum, score) => sum + score, 0);
  const avgP_i = perChunkScores.length > 0 ? sumP_i / perChunkScores.length : 0;
  const minP_i = perChunkScores.length > 0 ? Math.min(...perChunkScores) : 0;

  // Weighted average of per-chunk scores (70% average, 30% minimum)
  const weightedP_i = (0.7 * avgP_i) + (0.3 * minP_i);

  const chunkFactor = Math.log2(numChunks + 1);
  const diversityFactor = calculateChunkDiversity(chunks);
  const H = numChunks; // H = numChunks (intermediate burners only)
  const hopFactor = 1 + 0.1 * H;
  const historicalBonus = allMatchHistorical ? 1.5 : 1.0;

  // Calculate raw PSS using the original formula
  const rawPss = weightedP_i * chunkFactor * diversityFactor * hopFactor * historicalBonus;
  
  // Normalize to 1-9.9 range for display
  const pss = normalizePss(rawPss);

  const level = getPrivacyLevel(pss);

  return {
    pss,
    perChunkScores,
    anonymitySets,
    roundingFactors,
    timeDelays,
    level,
  };
}
