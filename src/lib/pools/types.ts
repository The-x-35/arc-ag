import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

/**
 * Parameters for depositing to a privacy pool
 */
export interface DepositParams {
  connection: Connection;
  amount: number; // lamports
  publicKey: PublicKey;
  transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  storage: Storage;
  encryptionService?: any;
}

/**
 * Parameters for withdrawing from a privacy pool
 */
export interface WithdrawParams {
  connection: Connection;
  amount: number; // lamports
  publicKey: PublicKey;
  recipient: PublicKey;
  storage: Storage;
  encryptionService?: any;
}

/**
 * Result of a pool operation (deposit/withdraw)
 */
export interface PoolOperationResult {
  signature: string;
  success: boolean;
  error?: string;
}

/**
 * Core interface for privacy pools
 * Any new pool must implement this interface to be plugged into the system
 */
export interface PrivacyPool {
  // Identity
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly programId: PublicKey;
  
  // Configuration
  readonly supportedTokens: string[];
  readonly minAmount: number; // lamports
  readonly maxAmount: number; // lamports
  
  /**
   * Get historical deposit/transaction amounts from the pool
   * Used for matching new transactions to blend in with historical activity
   */
  getHistoricalAmounts(connection: Connection, limit: number): Promise<number[]>;
  
  /**
   * Deposit funds into the privacy pool
   */
  deposit(params: DepositParams): Promise<PoolOperationResult>;
  
  /**
   * Withdraw funds from the privacy pool to a recipient
   */
  withdraw(params: WithdrawParams): Promise<PoolOperationResult>;
  
  /**
   * Get the current private balance for a wallet (if supported)
   */
  getPrivateBalance?(publicKey: PublicKey, connection: Connection, storage: Storage): Promise<number>;
  
  /**
   * Check if the pool is available/healthy
   */
  isAvailable?(connection: Connection): Promise<boolean>;
}

/**
 * Pool metadata for UI display
 */
export interface PoolInfo {
  id: string;
  name: string;
  description: string;
  supportedTokens: string[];
  minAmount: number;
  maxAmount: number;
  isAvailable: boolean;
}
