import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

export type Network = 'mainnet' | 'testnet';
export type BurnerType = 'swig' | 'eoa';

// Pool interface for plug-and-play architecture
export interface DepositParams {
  connection: Connection;
  amount: number; // lamports
  publicKey: PublicKey;
  transactionSigner: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  storage: Storage;
}

export interface WithdrawParams {
  connection: Connection;
  amount: number; // lamports
  publicKey: PublicKey;
  recipient: PublicKey;
  storage: Storage;
}

export interface PrivacyPool {
  id: string;
  name: string;
  description: string;
  
  // Indexing - get historical deposit amounts
  getHistoricalAmounts(connection: Connection, limit: number): Promise<number[]>;
  
  // Operations
  deposit(params: DepositParams): Promise<{ signature: string }>;
  withdraw(params: WithdrawParams): Promise<{ signature: string }>;
  
  // Config
  supportedTokens: string[];
  minAmount: number; // lamports
  maxAmount: number; // lamports
  programId: PublicKey;
}

// Burner wallet types
export interface BurnerWallet {
  type: BurnerType;
  publicKey: PublicKey;
  privateKey: string; // For display/recovery
  address: string;
  // For Swig
  swigId?: Uint8Array;
  evmPrivateKey?: string;
}

// Split optimization result
export interface SplitResult {
  poolId: string;
  amount: number; // lamports
  matchedHistoricalAmount?: number;
  matchQuality: number; // 0-1, how well it matches historical
}

// Transaction step status
export interface StepStatus {
  step: number;
  message: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  signature?: string;
}

// Private send result
export interface PrivateSendResult {
  success: boolean;
  signatures: string[];
  totalAmount: number;
  recipient: string;
  burnerWallets: BurnerWallet[];
  splitResults: SplitResult[];
}

// Config for send operation
export interface SendConfig {
  amount: number; // lamports
  destination: string;
  sourcePrivateKey: string; // ETH private key for source Swig
  burnerType: BurnerType;
  sponsorFees: boolean;
  privacyLevel: number; // 2-10 chunks
}
