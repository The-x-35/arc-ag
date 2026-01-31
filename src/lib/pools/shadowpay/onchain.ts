/**
 * ShadowPay On-Chain Utilities
 * Query on-chain Solana data for ShadowPay escrow program transactions
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';

/**
 * ShadowPay escrow program ID
 * This needs to be identified from ShadowPay documentation or discovered on-chain
 * For now, using a placeholder - should be updated with actual program ID
 */
export const SHADOWPAY_ESCROW_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SHADOWPAY_PROGRAM_ID || 
  '11111111111111111111111111111111' // Placeholder - needs actual program ID
);

/**
 * Get ShadowPay escrow program ID from environment or default
 */
export function getShadowPayProgramId(): PublicKey {
  if (process.env.NEXT_PUBLIC_SHADOWPAY_PROGRAM_ID) {
    try {
      return new PublicKey(process.env.NEXT_PUBLIC_SHADOWPAY_PROGRAM_ID);
    } catch {
      console.warn('Invalid SHADOWPAY_PROGRAM_ID, using default');
    }
  }
  return SHADOWPAY_ESCROW_PROGRAM_ID;
}

/**
 * Find ShadowPay escrow accounts by querying program accounts
 * This is a helper to discover escrow accounts if program ID is known
 */
export async function findEscrowAccounts(
  connection: Connection,
  programId: PublicKey
): Promise<PublicKey[]> {
  try {
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          dataSize: 165, // Typical escrow account size (adjust based on actual structure)
        },
      ],
    });
    
    return accounts.map(acc => acc.pubkey);
  } catch (error) {
    console.error('Error finding escrow accounts:', error);
    return [];
  }
}

/**
 * Get historical deposit amounts from ShadowPay escrow program
 * Queries transactions involving the escrow program to extract deposit amounts
 */
export async function getHistoricalDepositAmounts(
  connection: Connection,
  limit: number = 100
): Promise<number[]> {
  const amounts: number[] = [];
  const programId = getShadowPayProgramId();
  
  try {
    // Check if program exists
    const programInfo = await connection.getAccountInfo(programId);
    if (!programInfo) {
      console.warn(`[ShadowPay] Program ${programId.toBase58()} not found on-chain`);
      return [];
    }
    
    // Get signatures for transactions involving the program
    const signatures = await connection.getSignaturesForAddress(
      programId,
      { limit }
    );
    
    console.log(`[ShadowPay] Found ${signatures.length} transaction signatures`);
    
    if (signatures.length === 0) {
      return [];
    }
    
    // Fetch transactions in batches
    const batchSize = 10;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      const txs = await connection.getParsedTransactions(
        batch.map(s => s.signature),
        { maxSupportedTransactionVersion: 0 }
      );
      
      for (const tx of txs) {
        if (!tx || !tx.transaction || !tx.meta) continue;
        
        // Extract amounts from transaction
        const txAmounts = extractDepositAmounts(tx, programId);
        amounts.push(...txAmounts);
      }
    }
    
    console.log(`[ShadowPay] Found ${amounts.length} deposit amounts`);
  } catch (error) {
    console.error('[ShadowPay] Error querying historical deposits:', error);
  }
  
  return amounts;
}

/**
 * Extract deposit amounts from a parsed transaction
 * Looks for SOL transfers to escrow accounts or program interactions
 */
function extractDepositAmounts(
  tx: ParsedTransactionWithMeta,
  programId: PublicKey
): number[] {
  const amounts: number[] = [];
  
  if (!tx.meta) return amounts;
  
  // Check pre/post balances for SOL transfers
  // If balance increases in an account, it might be a deposit
  const preBalances = tx.meta.preBalances || [];
  const postBalances = tx.meta.postBalances || [];
  
  // Look for accounts that received SOL (post > pre)
  for (let i = 0; i < Math.min(preBalances.length, postBalances.length); i++) {
    const preBalance = preBalances[i];
    const postBalance = postBalances[i];
    const diff = postBalance - preBalance;
    
    // If account received SOL and is related to our program
    if (diff > 0) {
      const accountKey = tx.transaction.message.accountKeys[i];
      
      // Check if this account is owned by the escrow program
      // or if the transaction involved the program
      if (accountKey && tx.meta.logMessages) {
        const hasProgramLog = tx.meta.logMessages.some(log => 
          log.includes(programId.toBase58())
        );
        
        if (hasProgramLog && diff > 5000) { // Minimum 0.000005 SOL to filter noise
          amounts.push(diff);
        }
      }
    }
  }
  
  // Also check inner instructions (CPI calls)
  if (tx.meta.innerInstructions && tx.meta.innerInstructions.length > 0) {
    for (const inner of tx.meta.innerInstructions) {
      for (const ix of inner.instructions) {
        if ('parsed' in ix && ix.parsed) {
          const parsed = ix.parsed as any;
          
          // Look for transfer instructions
          if (parsed.type === 'transfer' && parsed.info) {
            const info = parsed.info;
            const amount = parseInt(info.lamports || info.amount || '0');
            
            if (amount > 5000) { // Minimum threshold
              amounts.push(amount);
            }
          }
        }
      }
    }
  }
  
  // Check top-level instructions
  const instructions = tx.transaction.message.instructions;
  for (const ix of instructions) {
    if ('parsed' in ix && ix.parsed) {
      const parsed = ix.parsed as any;
      
      if (parsed.type === 'transfer' && parsed.info) {
        const info = parsed.info;
        const amount = parseInt(info.lamports || info.amount || '0');
        
        if (amount > 5000) {
          amounts.push(amount);
        }
      }
    }
  }
  
  return amounts;
}

/**
 * Alternative: Query by escrow account if we know the account address
 * This is more efficient if we have a known escrow account
 */
export async function getHistoricalAmountsFromAccount(
  connection: Connection,
  escrowAccount: PublicKey,
  limit: number = 100
): Promise<number[]> {
  const amounts: number[] = [];
  
  try {
    const signatures = await connection.getSignaturesForAddress(
      escrowAccount,
      { limit }
    );
    
    console.log(`[ShadowPay] Found ${signatures.length} signatures for escrow account`);
    
    const batchSize = 10;
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      const txs = await connection.getParsedTransactions(
        batch.map(s => s.signature),
        { maxSupportedTransactionVersion: 0 }
      );
      
      for (const tx of txs) {
        if (!tx || !tx.meta) continue;
        
        // Extract amounts from balance changes
        const preBalances = tx.meta.preBalances || [];
        const postBalances = tx.meta.postBalances || [];
        
        // Find the escrow account index
        const escrowAccountStr = escrowAccount.toBase58();
        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          key => {
            if (typeof key === 'string') {
              return key === escrowAccountStr;
            }
            if (key instanceof PublicKey) {
              return key.equals(escrowAccount);
            }
            return false;
          }
        );
        
        if (accountIndex >= 0 && accountIndex < preBalances.length) {
          const preBalance = preBalances[accountIndex];
          const postBalance = postBalances[accountIndex];
          const diff = postBalance - preBalance;
          
          if (diff > 5000) { // Deposit detected
            amounts.push(diff);
          }
        }
      }
    }
    
    console.log(`[ShadowPay] Found ${amounts.length} amounts from escrow account`);
  } catch (error) {
    console.error('[ShadowPay] Error querying escrow account:', error);
  }
  
  return amounts;
}
