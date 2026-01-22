import { Connection } from '@solana/web3.js';
import { PrivacyPool, PoolInfo } from './types';

/**
 * Pool Registry - Central registry for all privacy pools
 * Implements plug-and-play architecture where pools can be added/removed dynamically
 */
class PoolRegistry {
  private pools: Map<string, PrivacyPool> = new Map();
  
  /**
   * Register a new pool
   */
  register(pool: PrivacyPool): void {
    if (this.pools.has(pool.id)) {
      console.warn(`Pool ${pool.id} is already registered, replacing...`);
    }
    this.pools.set(pool.id, pool);
    console.log(`Pool registered: ${pool.name} (${pool.id})`);
  }
  
  /**
   * Unregister a pool
   */
  unregister(poolId: string): boolean {
    return this.pools.delete(poolId);
  }
  
  /**
   * Get a pool by ID
   */
  get(poolId: string): PrivacyPool | undefined {
    return this.pools.get(poolId);
  }
  
  /**
   * Get all registered pools
   */
  getAll(): PrivacyPool[] {
    return Array.from(this.pools.values());
  }
  
  /**
   * Get all pool IDs
   */
  getPoolIds(): string[] {
    return Array.from(this.pools.keys());
  }
  
  /**
   * Get pool info for UI display
   */
  async getPoolInfo(connection: Connection): Promise<PoolInfo[]> {
    const infos: PoolInfo[] = [];
    
    for (const pool of this.pools.values()) {
      let isAvailable = true;
      if (pool.isAvailable) {
        try {
          isAvailable = await pool.isAvailable(connection);
        } catch {
          isAvailable = false;
        }
      }
      
      infos.push({
        id: pool.id,
        name: pool.name,
        description: pool.description,
        supportedTokens: pool.supportedTokens,
        minAmount: pool.minAmount,
        maxAmount: pool.maxAmount,
        isAvailable,
      });
    }
    
    return infos;
  }
  
  /**
   * Aggregate historical amounts from all pools
   * Returns amounts grouped by pool and combined
   */
  async aggregateHistoricalAmounts(
    connection: Connection, 
    limit: number = 100
  ): Promise<{
    byPool: Map<string, number[]>;
    combined: number[];
  }> {
    const byPool = new Map<string, number[]>();
    const combined: number[] = [];
    
    for (const pool of this.pools.values()) {
      try {
        const amounts = await pool.getHistoricalAmounts(connection, limit);
        byPool.set(pool.id, amounts);
        combined.push(...amounts);
      } catch (error) {
        console.error(`Error getting historical amounts from ${pool.id}:`, error);
        byPool.set(pool.id, []);
      }
    }
    
    // Sort combined amounts
    combined.sort((a, b) => a - b);
    
    return { byPool, combined };
  }
  
  /**
   * Find pools that support a given amount
   */
  findPoolsForAmount(amount: number): PrivacyPool[] {
    return this.getAll().filter(
      pool => amount >= pool.minAmount && amount <= pool.maxAmount
    );
  }
  
  /**
   * Check if registry has any pools
   */
  isEmpty(): boolean {
    return this.pools.size === 0;
  }
  
  /**
   * Get pool count
   */
  count(): number {
    return this.pools.size;
  }
}

// Singleton instance
export const poolRegistry = new PoolRegistry();

// Re-export types
export type { PrivacyPool, PoolInfo } from './types';
