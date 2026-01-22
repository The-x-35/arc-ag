import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getSolanaRpc, Network } from '../config/networks';

/**
 * Create a Solana connection
 */
export function createConnection(network: Network = 'mainnet'): Connection {
  const rpc = getSolanaRpc(network);
  return new Connection(rpc, 'confirmed');
}

/**
 * Get connection for mainnet (default)
 */
export function getMainnetConnection(): Connection {
  return createConnection('mainnet');
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
 * SOL to lamports conversion
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Lamports to SOL conversion
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Format lamports as SOL string
 */
export function formatSol(lamports: number, decimals: number = 4): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(decimals);
}

/**
 * Get account balance
 */
export async function getBalance(
  connection: Connection,
  publicKey: PublicKey
): Promise<number> {
  return await connection.getBalance(publicKey);
}

/**
 * Wait for a short delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format time in human readable format
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
 * Shorten address for display
 */
export function shortenAddress(address: string, chars: number = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Get explorer URL for transaction
 */
export function getTxExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/**
 * Get explorer URL for account
 */
export function getAccountExplorerUrl(address: string): string {
  return `https://solscan.io/account/${address}`;
}
