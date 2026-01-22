import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivacyPool, DepositParams, WithdrawParams, PoolOperationResult } from '../types';

// Privacy Cash program ID
const PRIVACY_CASH_PROGRAM_ID = new PublicKey('9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD');

/**
 * Get Privacy Cash tree token account (where deposits go)
 */
function getTreeTokenAccount(): PublicKey {
  const [treeTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('tree_token')],
    PRIVACY_CASH_PROGRAM_ID
  );
  return treeTokenAccount;
}

/**
 * Privacy Cash Pool Adapter
 * Implements the PrivacyPool interface for Privacy Cash protocol
 */
export const privacyCashPool: PrivacyPool = {
  id: 'privacy-cash',
  name: 'Privacy Cash',
  description: 'Zero-knowledge privacy pool for SOL on Solana using Light Protocol',
  programId: PRIVACY_CASH_PROGRAM_ID,
  
  supportedTokens: ['SOL', 'USDC'],
  minAmount: 0.001 * LAMPORTS_PER_SOL, // 0.001 SOL minimum
  maxAmount: 100 * LAMPORTS_PER_SOL, // 100 SOL maximum
  
  /**
   * Get historical deposit amounts from Privacy Cash
   */
  async getHistoricalAmounts(connection: Connection, limit: number = 100): Promise<number[]> {
    const treeTokenAccount = getTreeTokenAccount();
    const treeTokenAddress = treeTokenAccount.toBase58();
    const amounts: number[] = [];
    
    try {
      // Get signatures for transactions involving the tree token account
      const signatures = await connection.getSignaturesForAddress(
        treeTokenAccount,
        { limit }
      );
      
      console.log(`[Privacy Cash] Found ${signatures.length} transaction signatures`);
      
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
          
          // Check top-level instructions
          const instructions = tx.transaction.message.instructions;
          for (const ix of instructions) {
            if ('program' in ix && ix.program === 'system') {
              const parsed = ix as any;
              if (parsed.parsed?.type === 'transfer') {
                const info = parsed.parsed.info;
                if (info.destination === treeTokenAddress) {
                  const amount = parseInt(info.lamports);
                  if (amount > 0) {
                    amounts.push(amount);
                  }
                }
              }
            }
          }
          
          // Check INNER instructions (CPI calls from Privacy Cash program)
          // This is where the actual deposits happen!
          if (tx.meta.innerInstructions && tx.meta.innerInstructions.length > 0) {
            for (const inner of tx.meta.innerInstructions) {
              for (const ix of inner.instructions) {
                if ('program' in ix && ix.program === 'system') {
                  const parsed = ix as any;
                  if (parsed.parsed?.type === 'transfer') {
                    const info = parsed.parsed.info;
                    if (info.destination === treeTokenAddress) {
                      const amount = parseInt(info.lamports);
                      if (amount > 0) {
                        amounts.push(amount);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      console.log(`[Privacy Cash] Found ${amounts.length} deposit amounts`);
    } catch (error) {
      console.error('Error querying Privacy Cash deposits:', error);
    }
    
    // Return all amounts (including duplicates for frequency counting)
    return amounts;
  },
  
  /**
   * Deposit to Privacy Cash pool
   */
  async deposit(params: DepositParams): Promise<PoolOperationResult> {
    const { connection, amount, publicKey, transactionSigner, storage, encryptionService } = params;
    
    try {
      // Dynamic imports for browser compatibility
      const { deposit } = await import('privacycash/utils');
      // @ts-ignore - hasher.rs has no type declarations
      const { WasmFactory } = await import('@lightprotocol/hasher.rs');
      
      const lightWasm = await WasmFactory.getInstance();
      
      const result = await deposit({
        lightWasm,
        amount_in_lamports: amount,
        connection,
        encryptionService,
        publicKey,
        transactionSigner,
        keyBasePath: '/circuit2/transaction2',
        storage,
      });
      
      return {
        signature: result.tx,
        success: true,
      };
    } catch (error: any) {
      console.error('Privacy Cash deposit error:', error);
      return {
        signature: '',
        success: false,
        error: error.message || 'Deposit failed',
      };
    }
  },
  
  /**
   * Withdraw from Privacy Cash pool
   */
  async withdraw(params: WithdrawParams): Promise<PoolOperationResult> {
    const { connection, amount, publicKey, recipient, storage, encryptionService } = params;
    
    try {
      // Dynamic imports for browser compatibility
      const { withdraw } = await import('privacycash/utils');
      // @ts-ignore - hasher.rs has no type declarations
      const { WasmFactory } = await import('@lightprotocol/hasher.rs');
      
      const lightWasm = await WasmFactory.getInstance();
      
      const result = await withdraw({
        lightWasm,
        amount_in_lamports: amount,
        connection,
        encryptionService,
        publicKey,
        recipient,
        keyBasePath: '/circuit2/transaction2',
        storage,
      });
      
      return {
        signature: result.tx,
        success: true,
      };
    } catch (error: any) {
      console.error('Privacy Cash withdraw error:', error);
      return {
        signature: '',
        success: false,
        error: error.message || 'Withdraw failed',
      };
    }
  },
  
  /**
   * Get private balance from Privacy Cash
   */
  async getPrivateBalance(publicKey: PublicKey, connection: Connection, storage: Storage): Promise<number> {
    try {
      const { getUtxos, getBalanceFromUtxos } = await import('privacycash/utils');
      // @ts-ignore
      const { EncryptionService } = await import('privacycash/utils');
      
      const encryptionService = new EncryptionService();
      // Note: This requires the keypair to derive encryption key - simplified version
      const utxos = await getUtxos({
        publicKey,
        connection,
        encryptionService,
        storage,
      });
      
      const balance = getBalanceFromUtxos(utxos);
      // getBalanceFromUtxos returns { lamports: number }, extract the number
      return typeof balance === 'number' ? balance : (balance as any).lamports || 0;
    } catch (error) {
      console.error('Error getting Privacy Cash balance:', error);
      return 0;
    }
  },
  
  /**
   * Check if Privacy Cash is available
   */
  async isAvailable(connection: Connection): Promise<boolean> {
    try {
      const info = await connection.getAccountInfo(PRIVACY_CASH_PROGRAM_ID);
      return info !== null;
    } catch {
      return false;
    }
  },
};

export default privacyCashPool;
