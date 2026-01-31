import { 
  Connection, 
  Transaction, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  Keypair,
} from '@solana/web3.js';
import {
  findSwigPda,
  fetchSwig,
  getSignInstructions,
  getSwigSystemAddress,
  getSigningFnForSecp256k1PrivateKey,
  Actions,
  createSecp256k1AuthorityInfo,
  getCreateSwigInstruction,
} from '@swig-wallet/classic';
import { privateKeyToAccount } from 'viem/accounts';
import { hexToBytes, keccak256, toBytes } from 'viem';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';

// Fee payer public key (hardcoded)
export const FEE_PAYER_PUBKEY = new PublicKey('hciZb5onspShN7vhvGDANtavRp4ww3xMzfVECXo2BR4');

// Get RPC URL - same as wallet provider
export const getRpcUrl = () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Mainnet);

// RPC URL
export const RPC_URL = getRpcUrl();

/**
 * Check if an error is due to block length exceeded
 */
export function isBlockLengthExceededError(error: any): boolean {
  const errorMessage = error?.message || error?.toString() || '';
  const errorLower = errorMessage.toLowerCase();
  
  return (
    errorLower.includes('block length') ||
    errorLower.includes('transaction too large') ||
    errorLower.includes('transaction size') ||
    errorLower.includes('exceeded') ||
    errorLower.includes('max transaction size') ||
    errorLower.includes('transaction exceeds') ||
    error?.code === 0x1 || // Transaction too large error code
    error?.code === -32002 // RPC error for transaction too large
  );
}

/**
 * Retry a transaction operation with error handling for block length exceeded
 * If block length exceeded, will retry with smaller batches or skip
 */
export async function retryTransaction<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    onRetry?: (attempt: number, error: any) => void;
    onBlockLengthError?: (error: any) => Promise<T | null>; // Return null to skip
    skipOnBlockLength?: boolean; // If true, skip operation on block length error
  } = {}
): Promise<T | null> {
  const {
    maxRetries = 3,
    onRetry,
    onBlockLengthError,
    skipOnBlockLength = false,
  } = options;
  
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a block length exceeded error
      if (isBlockLengthExceededError(error)) {
        console.warn(`[retryTransaction] Block length exceeded on attempt ${attempt + 1}`);
        
        // If skip is enabled, return null to skip
        if (skipOnBlockLength) {
          console.warn('[retryTransaction] Skipping transaction due to block length exceeded');
          return null;
        }
        
        // If custom handler provided, use it
        if (onBlockLengthError) {
          const result = await onBlockLengthError(error);
          if (result !== null) {
            return result;
          }
          // If handler returns null, continue to skip
          console.warn('[retryTransaction] Handler returned null, skipping transaction');
          return null;
        }
        
        // Otherwise, skip this transaction
        console.warn('[retryTransaction] Skipping transaction due to block length exceeded');
        return null;
      }
      
      // For other errors, retry if not last attempt
      if (attempt < maxRetries - 1) {
        if (onRetry) {
          onRetry(attempt + 1, error);
        }
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }
    }
  }
  
  // If all retries failed and it's not a block length error, throw
  throw lastError;
}

/**
 * Create deterministic Swig ID from EVM address
 */
export function createDeterministicSwigId(evmAddress: string): Uint8Array {
  const cleanAddress = evmAddress.startsWith('0x') ? evmAddress.slice(2) : evmAddress;
  const encoder = new TextEncoder();
  const data = encoder.encode(cleanAddress);
  
  const hash = new Uint8Array(32);
  let hashIndex = 0;
  
  for (let i = 0; i < data.length; i++) {
    hash[hashIndex] ^= data[i];
    hashIndex = (hashIndex + 1) % 32;
  }
  
  for (let i = 0; i < data.length; i++) {
    hash[hashIndex] ^= data[i] ^ 0xFF;
    hashIndex = (hashIndex + 1) % 32;
  }
  
  return hash;
}

/**
 * Validate Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate private key format
 */
export function isValidPrivateKey(key: string): boolean {
  const cleanKey = key.startsWith('0x') ? key.slice(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(cleanKey);
}

/**
 * Format milliseconds as human-readable time
 */
export function formatTime(ms: number): string {
  if (ms < 1000) return 'instant';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}min` : `${hours}h`;
}

/**
 * Sleep with countdown callback
 */
export async function sleepWithCountdown(
  ms: number,
  onUpdate: (remaining: string) => void
): Promise<void> {
  const start = Date.now();
  const interval = 1000; // Update every second
  
  while (Date.now() - start < ms) {
    const remaining = ms - (Date.now() - start);
    onUpdate(formatTime(remaining));
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, remaining)));
  }
  
  onUpdate('0s');
}

/**
 * Generate random delays that sum to totalMs, distributed across numDelays
 */
export function generateRandomDelays(totalMs: number, numDelays: number): number[] {
  if (numDelays === 0) return [];
  if (numDelays === 1) return [totalMs];
  
  // Generate random weights
  const weights = Array.from({ length: numDelays }, () => Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  
  // Distribute totalMs proportionally
  const delays = weights.map(w => Math.floor((w / sum) * totalMs));
  
  // Ensure sum equals totalMs (adjust last delay)
  const currentSum = delays.reduce((a, b) => a + b, 0);
  delays[delays.length - 1] += totalMs - currentSum;
  
  return delays;
}

/**
 * Get browser localStorage
 */
export function getBrowserStorage(): Storage {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  throw new Error('localStorage not available');
}
