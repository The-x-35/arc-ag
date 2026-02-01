'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { isValidSolanaAddress, formatTime, sleepWithCountdown, generateRandomDelays, isBlockLengthExceededError, retryTransaction } from '@/lib/swig/utils';
import { poolRegistry } from '@/lib/pools/registry';
import { transactionIndexer } from '@/lib/indexer/transaction-indexer';
import { useSessionRecovery, SessionData } from './useSessionRecovery';
import { generateAllBurners, getBurnerByIndex } from '@/lib/wallets/deterministic-eoa';
import { keccak256, toBytes } from 'viem';

// Get RPC URL - same as wallet provider
const getRpcUrl = () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Mainnet);

// Privacy Cash fee constants
const WITHDRAW_FEE_RATE = 0.0035; // 0.35%
const WITHDRAW_RENT_FEE = 0.006 * LAMPORTS_PER_SOL; // 0.006 SOL
const MIN_DEPOSIT_AMOUNT = 0.02 * LAMPORTS_PER_SOL; // 0.02 SOL minimum for deposit
const TX_FEE_BUFFER = 0.003 * LAMPORTS_PER_SOL; // 0.003 SOL for transaction fees

// Calculate minimum withdrawal amount per chunk so burner can re-deposit
// Burner needs: MIN_DEPOSIT + TX_FEES after withdrawal fees
// Formula: X * (1 - FEE_RATE) - RENT_FEE >= MIN_DEPOSIT + TX_FEES
// X >= (MIN_DEPOSIT + TX_FEES + RENT_FEE) / (1 - FEE_RATE)
const MIN_BURNER_BALANCE = MIN_DEPOSIT_AMOUNT + TX_FEE_BUFFER;
const MIN_CHUNK_AMOUNT = Math.ceil((MIN_BURNER_BALANCE + WITHDRAW_RENT_FEE) / (1 - WITHDRAW_FEE_RATE));
// ~0.03 SOL minimum per chunk

export interface WalletPrivateSendParams {
  destination: string;
  amount: number;
  numChunks: number;
  delayMinutes: number;
  sponsorFees: boolean;
  exactChunks?: number[]; // Exact amounts in lamports for each chunk
  selectedPools?: string[]; // Optional: filter to only these pool IDs
}

import { StepStatus } from '@/components/ProgressSteps';

export type WalletPrivateSendStep = StepStatus;

export interface EOABurnerWalletInfo {
  index: number;
  address: string;
  privateKey: string; // Base58 encoded Solana private key
  type: 'eoa';
}

export interface WalletPrivateSendResult {
  success: boolean;
  signatures: string[];
  sourceWallet: {
    address: string;
  };
  burnerWallets: EOABurnerWalletInfo[];
  totalAmount: number;
  recipient: string;
}

const STEPS = [
  { id: 1, label: 'Validating inputs' },
  { id: 2, label: 'Generating first burner wallet' },
  { id: 3, label: 'Sending to first burner (sign required)' },
  { id: 4, label: 'First burner depositing to pool in chunks' },
  { id: 5, label: 'Waiting for indexing' },
  { id: 6, label: 'Privacy delay' },
  { id: 7, label: 'Generating burner keypairs' },
  { id: 8, label: 'Generating final burner wallet' },
  { id: 9, label: 'Withdrawing to burners' },
  { id: 10, label: 'Re-depositing from burners (UTXOs to final burner)' },
  { id: 11, label: 'Waiting for indexing' },
  { id: 12, label: 'Final burner withdrawing all funds' },
  { id: 13, label: 'Final burner sending to destination' },
];

/**
 * Get browser localStorage
 */
function getBrowserStorage(): Storage {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  throw new Error('localStorage not available');
}

export function useWalletPrivateSend() {
  const { publicKey, signTransaction, signMessage, connected } = useWallet();
  const { connection } = useConnection();
  const { createSession, updateSession, recoverSession, deleteSession } = useSessionRecovery();
  
  const [steps, setSteps] = useState<WalletPrivateSendStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletPrivateSendResult | null>(null);
  const [burnerWallets, setBurnerWallets] = useState<EOABurnerWalletInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const updateStep = useCallback((stepId: number, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, message } : step
    ));
    
    // Persist step update to session
    if (currentSessionId) {
      updateSession(currentSessionId, {
        current_step: stepId,
        status: status === 'running' ? 'in_progress' : status === 'completed' ? 'in_progress' : status === 'error' ? 'failed' : 'pending',
      }).catch(err => console.error('Failed to update session step:', err));
    }
  }, [currentSessionId, updateSession]);
  
  /**
   * Helper to persist session state
   */
  const persistSessionState = useCallback(async (
    burners: EOABurnerWalletInfo[],
    sigs: string[],
    chunkAmts?: number[],
    usedDeposits?: Set<number>
  ) => {
    if (!currentSessionId) return;
    
    try {
      await updateSession(currentSessionId, {
        burner_addresses: burners.map(b => ({
          index: b.index,
          address: b.address,
          type: b.type,
        })),
        signatures: sigs,
        chunk_amounts: chunkAmts,
        used_deposit_amounts: usedDeposits ? Array.from(usedDeposits) : undefined,
      });
    } catch (err) {
      console.error('Failed to persist session state:', err);
    }
  }, [currentSessionId, updateSession]);
  
  /**
   * Sign a message with the wallet (for session word)
   */
  const signMessageWithWallet = useCallback(async (message: string): Promise<string> => {
    if (!signMessage) {
      // Fallback: create a transaction to sign if signMessage is not available
      if (!signTransaction || !publicKey || !connection) {
        throw new Error('Wallet does not support message signing');
      }
      
      // Create a minimal transaction that encodes the message
      const { SystemProgram, Transaction } = await import('@solana/web3.js');
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: publicKey, // Self-transfer with 0 amount
          lamports: 0,
        })
      );
      
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      // Add message as memo (if available) or use transaction signature
      const signed = await signTransaction(transaction);
      const signature = Buffer.from(signed.serialize()).toString('hex');
      return keccak256(toBytes(`${message}_${signature}`));
    }
    
    // Use signMessage if available
    const messageBytes = new TextEncoder().encode(message);
    const signature = await signMessage(messageBytes);
    // Convert signature to hex string for hashing
    const sigHex = Buffer.from(signature).toString('hex');
    return keccak256(toBytes(`${message}_${sigHex}`));
  }, [signMessage, signTransaction, publicKey, connection]);

  /**
   * Execute transaction with session recovery support
   */
  const execute = useCallback(async (params: WalletPrivateSendParams, recoveredSession?: SessionData) => {
    const { destination, amount, numChunks, delayMinutes, sponsorFees, exactChunks } = params;
    
    if (!connected || !publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    if (!connection) {
      throw new Error('Connection not available');
    }

    // Initialize steps
    setSteps(STEPS.map(s => ({ ...s, status: 'pending' as const })));
    setLoading(true);
    setError(null);
    setResult(null);
    setBurnerWallets([]);
    
    // Session management
    let sessionId: string | null = null;
    let sessionWord: string | null = null;
    let signedHash: string | null = null;
    
    try {
      // If recovering from session, use existing session data
      if (recoveredSession) {
        sessionId = recoveredSession.id;
        sessionWord = recoveredSession.session_word;
        setCurrentSessionId(sessionId);
        setRecoveryMode(true);
        
        // Restore state from session
        if (recoveredSession.burner_addresses && recoveredSession.burner_addresses.length > 0) {
          const restoredBurners: EOABurnerWalletInfo[] = recoveredSession.burner_addresses.map(b => ({
            index: b.index,
            address: b.address,
            privateKey: '', // Will be regenerated deterministically
            type: b.type,
          }));
          setBurnerWallets(restoredBurners);
        }
        
        // Restore step progress
        const currentStep = recoveredSession.current_step;
        setSteps(STEPS.map(s => ({
          ...s,
          status: s.id < currentStep ? 'completed' as const : s.id === currentStep ? 'running' as const : 'pending' as const,
        })));
        
        // Request user to sign word again for deterministic generation
        updateStep(currentStep, 'running', 'Please sign the session word to continue...');
        signedHash = await signMessageWithWallet(sessionWord);
      } else {
        // Create new session
        updateStep(1, 'running', 'Creating session...');
        const session = await createSession(publicKey.toBase58(), params);
        sessionId = session.sessionId;
        sessionWord = session.word;
        setCurrentSessionId(sessionId);
        
        // Request user to sign the word
        updateStep(1, 'running', 'Please sign the session word to generate deterministic wallets...');
        signedHash = await signMessageWithWallet(sessionWord);
        
        // Update session with signed hash (store hash, not word)
        await updateSession(sessionId, {
          status: 'in_progress',
        });
      }
    } catch (err: any) {
      console.error('Session setup error:', err);
      throw new Error(`Session setup failed: ${err.message}`);
    }

    // If exact chunks provided, use their total, otherwise use amount
    const amountLamports = exactChunks && exactChunks.length === numChunks 
      ? exactChunks.reduce((sum, c) => sum + c, 0)
      : Math.floor(amount * LAMPORTS_PER_SOL);
    const delayMs = delayMinutes * 60 * 1000;
    
    // Constants for rent-exempt balance and deposit overhead
    const RENT_EXEMPT_MIN = 1500000; // 0.0015 SOL for rent + safety
    const DEPOSIT_OVERHEAD = 2000000; // 0.002 SOL for deposit overhead // Convert minutes to milliseconds
    const signatures: string[] = [];
    const generatedBurners: EOABurnerWalletInfo[] = [];
    const burnerKeypairs: Keypair[] = [];
    const usedDepositAmounts = new Set<number>(); // Track all deposit amounts for withdrawal planning

    // Helper: estimate the exact fee (in lamports) for a simple SystemProgram.transfer
    // This uses Solana's fee calculation instead of hardcoded guesses
    const estimateSimpleTransferFee = async (conn: Connection, payer: PublicKey): Promise<number> => {
      const { SystemProgram, Transaction } = await import('@solana/web3.js');
      const { blockhash } = await conn.getLatestBlockhash('finalized');

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: payer, // self-transfer for fee estimation
          lamports: 1,     // minimal amount, fee is independent of this
        })
      );

      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;

      const fee = await conn.getFeeForMessage(tx.compileMessage());
      // getFeeForMessage returns { value: number | null }
      if (fee && typeof fee.value === 'number' && fee.value > 0) {
        return fee.value;
      }

      // Fallback to known base fee if RPC doesn't return a value
      return 5000; // 0.000005 SOL base fee
    };

    try {
      // Step 1: Validation
      updateStep(1, 'running', 'Validating inputs...');
      
      if (!isValidSolanaAddress(destination)) {
        throw new Error('Invalid Solana recipient address');
      }
      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      
      // Validate exact chunks if provided
      if (exactChunks && exactChunks.length > 0) {
        if (exactChunks.length !== numChunks) {
          throw new Error(`Expected ${numChunks} chunks, got ${exactChunks.length}`);
        }
        // Check each chunk is above minimum
        for (let i = 0; i < exactChunks.length; i++) {
          if (exactChunks[i] < MIN_CHUNK_AMOUNT) {
            throw new Error(
              `Chunk ${i + 1} (${(exactChunks[i] / LAMPORTS_PER_SOL).toFixed(3)} SOL) is below minimum ${(MIN_CHUNK_AMOUNT / LAMPORTS_PER_SOL).toFixed(3)} SOL`
            );
          }
        }
      } else {
        // STRICT minimum check - each burner needs enough to re-deposit after fees
        const amountPerChunk = amountLamports / numChunks;
        const minAmountPerChunk = MIN_CHUNK_AMOUNT;
        const minTotalAmount = (minAmountPerChunk * numChunks) / LAMPORTS_PER_SOL;
        
        if (amountPerChunk < minAmountPerChunk) {
          throw new Error(
            `Amount too small for ${numChunks} chunks. Each chunk needs at least ${(minAmountPerChunk / LAMPORTS_PER_SOL).toFixed(3)} SOL. ` +
            `Minimum total: ${minTotalAmount.toFixed(3)} SOL for ${numChunks} chunks, or reduce chunks to ${Math.floor(amountLamports / minAmountPerChunk)}.`
          );
        }
      }
      
      // Check balance (including fee buffer for chunk deposits)
      const feeBufferPerChunk = 0.003 * LAMPORTS_PER_SOL; // 0.003 SOL per chunk deposit
      const totalFeeBuffer = numChunks * feeBufferPerChunk;
      const totalAmountWithFees = amountLamports + totalFeeBuffer;
      const balance = await connection.getBalance(publicKey);
      const requiredBalance = totalAmountWithFees + 10000000; // Add buffer for transaction fees
      if (balance < requiredBalance) {
        throw new Error(
          `Insufficient balance. Have: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
          `Need: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL ` +
          `(Amount: ${(amountLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL + Fees: ${(totalFeeBuffer / LAMPORTS_PER_SOL).toFixed(4)} SOL)`
        );
      }
      
      updateStep(1, 'completed', 'Inputs validated');

      // Step 2: Generate first burner wallet (deterministically)
      updateStep(2, 'running', 'Generating first burner wallet...');
      
      let firstBurnerKeypair: Keypair;
      if (recoveredSession && signedHash) {
        // Recover from session: regenerate deterministically
        firstBurnerKeypair = getBurnerByIndex(signedHash, 0);
      } else {
        // New session: generate deterministically from signed hash
        if (!signedHash) {
          throw new Error('Signed hash not available');
        }
        firstBurnerKeypair = getBurnerByIndex(signedHash, 0);
      }
      
      const firstBurnerInfo: EOABurnerWalletInfo = {
        index: 0,
        address: firstBurnerKeypair.publicKey.toBase58(),
        privateKey: bs58.encode(firstBurnerKeypair.secretKey),
        type: 'eoa',
      };
      generatedBurners.push(firstBurnerInfo);
      setBurnerWallets([...generatedBurners]);
      
      // Persist first burner
      await persistSessionState(generatedBurners, signatures);
      
      updateStep(2, 'completed', 'First burner wallet generated');

      // Step 3: User sends total amount to first burner
      updateStep(3, 'running', 'Preparing transfer to first burner (please sign)...');
      
      // Use the fee buffer already calculated above
      try {
        const { SystemProgram, Transaction } = await import('@solana/web3.js');
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: firstBurnerKeypair.publicKey,
            lamports: totalAmountWithFees,
          })
        );
        
        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;
        
        // User signs
        const signedTransaction = await signTransaction(transaction);
        
        // Send transaction
        const txSignature = await connection.sendRawTransaction(signedTransaction.serialize());
        signatures.push(txSignature);
        
        // Wait for confirmation
        await connection.confirmTransaction(txSignature, 'confirmed');
        
        updateStep(3, 'completed', `Sent ${(totalAmountWithFees / LAMPORTS_PER_SOL).toFixed(4)} SOL to first burner`);
        
      } catch (err: any) {
        console.error('Transfer to first burner error:', err);
        throw new Error(`Transfer to first burner failed: ${err.message}`);
      }

      // Get selected pool (default to privacy-cash if none selected or if privacy-cash is selected)
      const selectedPoolIds = params.selectedPools && params.selectedPools.length > 0 
        ? params.selectedPools 
        : ['privacy-cash']; // Default to privacy-cash
      
      // Use first selected pool (or privacy-cash as fallback)
      const poolId = selectedPoolIds[0] || 'privacy-cash';
      const pool = poolRegistry.get(poolId);
      
      if (!pool) {
        throw new Error(`Pool ${poolId} not found. Available pools: ${poolRegistry.getPoolIds().join(', ')}`);
      }
      
      // For now, Privacy Cash is the only pool with full SDK support
      // ShadowPay uses API, so we'll need different handling
      if (poolId !== 'privacy-cash') {
        throw new Error(`Pool ${poolId} is not yet supported for wallet transactions. Please use privacy-cash.`);
      }
      
      // CRITICAL: Initialize SDK components (Privacy Cash specific)
      const { deposit, withdraw } = await import('privacycash/utils');
      // @ts-ignore
      const { WasmFactory } = await import('@lightprotocol/hasher.rs');
      const { PrivacyCash } = await import('privacycash');
      
      const lightWasm = await WasmFactory.getInstance();

      // Step 4: First burner deposits to pool in chunks with random delays
      updateStep(4, 'running', 'First burner depositing to pool in chunks...');
      
      // Allocate 30% of total delay for chunk deposits
      const depositDelayPortion = Math.floor(delayMs * 0.3);
      const depositDelays = generateRandomDelays(depositDelayPortion, numChunks - 1);
      
      // Create PrivacyCash client for first burner (with its own encryption service)
      const firstBurnerClient = new PrivacyCash({
        RPC_url: getRpcUrl(),
        owner: firstBurnerKeypair,
        enableDebug: false,
      }) as any;
      
      // Use exact chunks if provided, otherwise equal split
      let chunkAmounts: number[];
      if (exactChunks && exactChunks.length === numChunks) {
        chunkAmounts = exactChunks;
        console.log('[useWalletPrivateSend] First burner using exact chunks:', chunkAmounts.map(c => c / LAMPORTS_PER_SOL));
      } else {
        const chunkAmount = Math.floor(amountLamports / numChunks);
        const remainder = amountLamports % numChunks;
        chunkAmounts = Array.from({ length: numChunks }, (_, i) => 
          i === numChunks - 1 ? chunkAmount + remainder : chunkAmount
        );
        console.log('[useWalletPrivateSend] First burner using equal split:', chunkAmounts.map(c => c / LAMPORTS_PER_SOL));
      }
      
      try {
        for (let i = 0; i < numChunks; i++) {
          let chunkAmount = chunkAmounts[i];
          
          updateStep(4, 'running', `Depositing chunk ${i + 1}/${numChunks}...`);
          
          const firstBurnerSigner = async (tx: VersionedTransaction) => {
            tx.sign([firstBurnerKeypair]);
            return tx;
          };
          
          // Leave 1.5M for rent-exempt balance + fees, reduce by 2M buffer for deposit overhead
          const balance = await connection.getBalance(firstBurnerKeypair.publicKey);
          const depositAmount = Math.max(0, Math.min(chunkAmount, balance - RENT_EXEMPT_MIN - DEPOSIT_OVERHEAD));
          
          if (depositAmount < MIN_DEPOSIT_AMOUNT) {
            console.warn(`[Deposit chunk ${i + 1}] Amount too small after buffer. Balance: ${balance}, Deposit: ${depositAmount}`);
            updateStep(4, 'running', `Chunk ${i + 1} skipped: insufficient balance after fee buffer`);
            continue;
          }
          
          // Use retry logic for block length exceeded errors
          const depositResult = await retryTransaction(
            async () => {
              try {
                return await deposit({
                  lightWasm,
                  amount_in_lamports: depositAmount,
                  connection: connection,
                  encryptionService: firstBurnerClient.encryptionService,
                  publicKey: firstBurnerKeypair.publicKey,
                  transactionSigner: firstBurnerSigner,
                  keyBasePath: '/circuit2/transaction2',
                  storage: getBrowserStorage(),
                });
              } catch (error: any) {
                // If insufficient funds error, reduce by more to ensure rent-exempt balance
                const errorText = error?.message || error?.toString() || '';
                if (errorText.includes('insufficient') || errorText.includes('response not ok') || errorText.includes('rent')) {
                  const currentBalance = await connection.getBalance(firstBurnerKeypair.publicKey);
                  const retryAmount = Math.max(0, currentBalance - RENT_EXEMPT_MIN - 3000000); // 1.5M rent + 3M overhead
                  if (retryAmount >= MIN_DEPOSIT_AMOUNT) {
                    console.log(`[Deposit chunk ${i + 1}] Retrying with reduced amount: ${retryAmount / LAMPORTS_PER_SOL} SOL`);
                    updateStep(4, 'running', `Retrying chunk ${i + 1} with reduced amount...`);
                    return await deposit({
                      lightWasm,
                      amount_in_lamports: retryAmount,
                      connection: connection,
                      encryptionService: firstBurnerClient.encryptionService,
                      publicKey: firstBurnerKeypair.publicKey,
                      transactionSigner: firstBurnerSigner,
                      keyBasePath: '/circuit2/transaction2',
                      storage: getBrowserStorage(),
                    });
                  }
                }
                throw error;
              }
            },
            {
              skipOnBlockLength: true, // Skip this chunk if block length exceeded
              onRetry: (attempt, error) => {
                console.warn(`[Deposit chunk ${i + 1}] Retry attempt ${attempt}:`, error.message);
                updateStep(4, 'running', `Retrying chunk ${i + 1} deposit (attempt ${attempt})...`);
              },
            }
          );
          
          if (depositResult) {
            signatures.push(depositResult.tx);
            // Track used deposit amounts for withdrawal planning
            usedDepositAmounts.add(depositAmount);
            // Persist after each deposit
            await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
          } else {
            console.warn(`[Deposit chunk ${i + 1}] Skipped due to block length exceeded`);
            updateStep(4, 'running', `Chunk ${i + 1} skipped (transaction too large)`);
          }
          
          // Wait for confirmation
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Random delay before next deposit (except for last chunk)
          if (i < numChunks - 1 && depositDelays[i] > 0) {
            updateStep(4, 'running', `Waiting ${formatTime(depositDelays[i])} before next deposit...`);
            await sleepWithCountdown(depositDelays[i], (remaining) => {
              updateStep(4, 'running', `Waiting ${remaining} before next deposit...`);
            });
          }
        }
        
        updateStep(4, 'completed', 'All chunks deposited to pool');
        
        // Persist after all deposits
        await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
        
      } catch (err: any) {
        console.error('First burner deposit error:', err);
        throw new Error(`First burner deposit failed: ${err.message}`);
      }

      // Step 5: Wait for indexing
      updateStep(5, 'running', 'Waiting for UTXO indexing...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      updateStep(5, 'completed', 'Deposit indexed');

      // Step 6: Privacy delay (remaining time after chunk deposits)
      const remainingDelay = delayMs - depositDelayPortion;
      if (remainingDelay > 0) {
        updateStep(6, 'running', `Privacy delay: ${formatTime(remainingDelay)}`);
        await sleepWithCountdown(remainingDelay, (remaining) => {
          updateStep(6, 'running', `Waiting ${remaining}...`);
        });
        updateStep(6, 'completed', 'Privacy delay complete');
      } else {
        updateStep(6, 'completed', 'No delay (fast mode)');
      }

      // Step 7: Generate additional burner keypairs (deterministically)
      updateStep(7, 'running', `Generating ${numChunks} burner keypairs...`);
      
      if (!signedHash) {
        throw new Error('Signed hash not available for deterministic generation');
      }
      
      for (let i = 0; i < numChunks; i++) {
        const keypair = getBurnerByIndex(signedHash, i + 1);
        burnerKeypairs.push(keypair);
        generatedBurners.push({
          index: i + 1,
          address: keypair.publicKey.toBase58(),
          privateKey: bs58.encode(keypair.secretKey),
          type: 'eoa',
        });
        
        // Update state so UI can display burners as they're created
        setBurnerWallets([...generatedBurners]);
      }
      
      // Persist intermediate burners
      await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
      
      updateStep(7, 'completed', `${numChunks} burner keypairs generated`);

      // Step 8: Generate final burner wallet (deterministically)
      updateStep(8, 'running', 'Generating final burner wallet...');
      
      if (!signedHash) {
        throw new Error('Signed hash not available for deterministic generation');
      }
      
      const finalBurnerKeypair = getBurnerByIndex(signedHash, -1);
      const finalBurnerClient = new PrivacyCash({
        RPC_url: getRpcUrl(),
        owner: finalBurnerKeypair,
        enableDebug: false,
      }) as any;
      
      // Add final burner to generated burners list
      generatedBurners.push({
        index: -1, // Special index for final burner (negative to distinguish from first burner)
        address: finalBurnerKeypair.publicKey.toBase58(),
        privateKey: bs58.encode(finalBurnerKeypair.secretKey),
        type: 'eoa',
      });
      setBurnerWallets([...generatedBurners]);
      
      // Persist final burner
      await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
      
      updateStep(8, 'completed', 'Final burner wallet generated');

      // Step 9: Withdraw from pool to burner keypairs with random delays
      // Use the first burner's encryption service to decrypt UTXOs
      updateStep(9, 'running', 'Withdrawing to burner wallets...');
      
      // Allocate 20% of total delay for withdrawals
      const withdrawDelayPortion = Math.floor(delayMs * 0.2);
      const withdrawDelays = generateRandomDelays(withdrawDelayPortion, numChunks - 1);
      
      // Use same chunk amounts as deposited
      try {
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const withdrawAmount = chunkAmounts[i];
          
          updateStep(9, 'running', `Withdrawing chunk ${i + 1}/${numChunks}...`);
          
          // Use retry logic for block length exceeded errors
          const withdrawResult = await retryTransaction(
            async () => {
              return await withdraw({
                lightWasm,
                amount_in_lamports: withdrawAmount,
                connection: connection,
                encryptionService: firstBurnerClient.encryptionService, // First burner's encryption service
                publicKey: firstBurnerKeypair.publicKey,
                recipient: burnerKeypair.publicKey,
                keyBasePath: '/circuit2/transaction2',
                storage: getBrowserStorage(),
              });
            },
            {
              skipOnBlockLength: true, // Skip this withdrawal if block length exceeded
              onRetry: (attempt, error) => {
                console.warn(`[Withdraw chunk ${i + 1}] Retry attempt ${attempt}:`, error.message);
                updateStep(9, 'running', `Retrying chunk ${i + 1} withdrawal (attempt ${attempt})...`);
              },
            }
          );
          
          if (withdrawResult) {
            signatures.push(withdrawResult.tx);
          } else {
            console.warn(`[Withdraw chunk ${i + 1}] Skipped due to block length exceeded`);
            updateStep(9, 'running', `Chunk ${i + 1} withdrawal skipped (transaction too large)`);
          }
          
          // Wait for transaction confirmation
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Random delay before next withdrawal (except for last)
          if (i < numChunks - 1 && withdrawDelays[i] > 0) {
            updateStep(9, 'running', `Waiting ${formatTime(withdrawDelays[i])} before next withdrawal...`);
            await sleepWithCountdown(withdrawDelays[i], (remaining) => {
              updateStep(9, 'running', `Waiting ${remaining} before next withdrawal...`);
            });
          }
        }
        
        updateStep(9, 'completed', 'Withdrawn to all burners');
        
      } catch (err: any) {
        throw new Error(`Withdrawal to burners failed: ${err.message}`);
      }

      // Step 10: Re-deposit from burners to pool
      // UTXOs will belong to final burner (using final burner's encryption service and publicKey)
      // But burner wallets sign the transactions (pay fees)
      updateStep(10, 'running', 'Re-depositing from burners (UTXOs to final burner)...');
      
      // Create a FRESH connection for burner operations to avoid stale ALT issues
      const burnerConnection = new Connection(getRpcUrl(), 'confirmed');
      
      // Wait a bit for withdrawals to fully settle before checking balances
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      try {
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          
          updateStep(10, 'running', `Checking burner ${i + 1} balance...`);
          
          // Get ACTUAL balance of burner (after withdrawal fees)
          // Wait a bit and retry if balance is 0 (might be timing issue)
          let burnerBalance = await burnerConnection.getBalance(burnerKeypair.publicKey);
          let retries = 0;
          while (burnerBalance === 0 && retries < 3) {
            console.log(`Burner ${i + 1} (${burnerKeypair.publicKey.toBase58().slice(0, 8)}...) balance is 0, waiting and retrying... (attempt ${retries + 1})`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            burnerBalance = await burnerConnection.getBalance(burnerKeypair.publicKey);
            retries++;
          }
          
          console.log(`Burner ${i + 1} (${burnerKeypair.publicKey.toBase58()}) balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL`);
          
          // Leave 1.5M for rent-exempt balance + fees, reduce by 2M buffer for deposit overhead
          const depositAmount = Math.max(0, burnerBalance - RENT_EXEMPT_MIN - DEPOSIT_OVERHEAD);
          
          if (depositAmount < MIN_DEPOSIT_AMOUNT) {
            console.warn(`Burner ${i + 1} has insufficient balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL (need at least ${(MIN_DEPOSIT_AMOUNT / LAMPORTS_PER_SOL).toFixed(6)} SOL after buffer)`);
            updateStep(10, 'running', `Burner ${i + 1} skipped: insufficient balance (${(burnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
            continue; // Skip this burner
          }
          
          console.log(`Burner ${i + 1} depositing ${(depositAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL, leaving ${((burnerBalance - depositAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL for fees`);
          
          updateStep(10, 'running', `Re-depositing ${(depositAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL from burner ${i + 1}/${numChunks} (UTXOs to final burner)...`);
          
          // Burner signs the transaction (pays for fees)
          const burnerSigner = async (tx: VersionedTransaction) => {
            tx.sign([burnerKeypair]);
            return tx;
          };
          
          // Use retry logic for block length exceeded errors
          // CRITICAL FIX: Pass burnerKeypair.publicKey for balance check (has the funds)
          // But encryptionService is from final burner, so UTXOs still belong to final burner
          const depositResult = await retryTransaction(
            async () => {
              try {
                return await deposit({
                  lightWasm,
                  amount_in_lamports: depositAmount,
                  connection: burnerConnection, // Use fresh connection for ALT fetch
                  encryptionService: finalBurnerClient.encryptionService, // Final burner's encryption service (UTXOs belong to final burner)
                  publicKey: burnerKeypair.publicKey, // Burner's public key (for balance check - has the funds!)
                  transactionSigner: burnerSigner, // Burner signs (pays fees)
                  keyBasePath: '/circuit2/transaction2',
                  storage: getBrowserStorage(),
                });
              } catch (error: any) {
                // If insufficient funds error, reduce by more to ensure rent-exempt balance
                const errorText = error?.message || error?.toString() || '';
                if (errorText.includes('insufficient') || errorText.includes('response not ok') || errorText.includes('rent')) {
                  const currentBalance = await burnerConnection.getBalance(burnerKeypair.publicKey);
                  const retryAmount = Math.max(0, currentBalance - RENT_EXEMPT_MIN - 3000000); // 1.5M rent + 3M overhead
                  if (retryAmount >= MIN_DEPOSIT_AMOUNT) {
                    console.log(`[Re-deposit burner ${i + 1}] Retrying with reduced amount: ${retryAmount / LAMPORTS_PER_SOL} SOL`);
                    updateStep(10, 'running', `Retrying burner ${i + 1} with reduced amount...`);
                    return await deposit({
                      lightWasm,
                      amount_in_lamports: retryAmount,
                      connection: burnerConnection,
                      encryptionService: finalBurnerClient.encryptionService,
                      publicKey: burnerKeypair.publicKey,
                      transactionSigner: burnerSigner,
                      keyBasePath: '/circuit2/transaction2',
                      storage: getBrowserStorage(),
                    });
                  }
                }
                throw error;
              }
            },
            {
              skipOnBlockLength: true, // Skip this re-deposit if block length exceeded
              onRetry: (attempt, error) => {
                console.warn(`[Re-deposit burner ${i + 1}] Retry attempt ${attempt}:`, error.message);
                updateStep(10, 'running', `Retrying burner ${i + 1} re-deposit (attempt ${attempt})...`);
              },
            }
          );
          
          if (depositResult) {
            signatures.push(depositResult.tx);
            // Track used deposit amounts (for re-deposits) for withdrawal planning
            usedDepositAmounts.add(depositAmount);
            // Persist after each re-deposit
            await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
          } else {
            console.warn(`[Re-deposit burner ${i + 1}] Skipped due to block length exceeded`);
            updateStep(10, 'running', `Burner ${i + 1} re-deposit skipped (transaction too large)`);
          }
          
          // Wait for indexing
          await new Promise(resolve => setTimeout(resolve, 8000));
        }
        
        updateStep(10, 'completed', 'All burners re-deposited (UTXOs belong to final burner)');
        
      } catch (err: any) {
        throw new Error(`Re-deposit from burners failed: ${err.message}`);
      }

      // Step 11: Wait for indexing after re-deposits
      updateStep(11, 'running', 'Waiting for UTXO indexing...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      updateStep(11, 'completed', 'Re-deposits indexed');

      // Step 12: Final burner withdraws funds from pool using indexed withdrawal chunks
      updateStep(12, 'running', 'Final burner withdrawing funds from pool with historical patterns...');
      
      // Import getUtxos to check private balance
      const { getUtxos } = await import('privacycash/utils');
      
      try {
        updateStep(12, 'running', 'Checking final burner private balance...');
        
        // Get all UTXOs owned by final burner
        const utxos = await getUtxos({
          publicKey: finalBurnerKeypair.publicKey,
          connection: burnerConnection,
          encryptionService: finalBurnerClient.encryptionService,
          storage: getBrowserStorage(),
        });
        
        // Calculate total private balance
        const totalPrivateBalance = utxos.reduce((sum: number, utxo: any) => {
          return sum + parseInt(utxo.amount.toString());
        }, 0);
        
        if (totalPrivateBalance <= 0) {
          throw new Error('Final burner has no private balance');
        }
        
        // Plan withdrawal chunks: 2–3 total chunks, avoid deposit amounts used in this flow
        console.log('[useWalletPrivateSend] Final burner totalPrivateBalance (lamports):', totalPrivateBalance);
        console.log('[useWalletPrivateSend] Used deposit amounts (lamports):', Array.from(usedDepositAmounts));
        const withdrawPlan = await transactionIndexer.findWithdrawalSplit(
          burnerConnection,
          totalPrivateBalance,
          { minChunks: 2, maxChunks: 3 },
          Array.from(usedDepositAmounts),
          selectedPoolIds
        );
        console.log('[useWalletPrivateSend] Withdraw plan:', {
          valid: withdrawPlan.valid,
          historicalChunks: withdrawPlan.historicalChunks.map(c => ({
            lamports: c.lamports,
            sol: c.sol,
            freq: c.frequency,
            isHistorical: c.isHistorical,
          })),
          remainderLamports: withdrawPlan.remainderLamports,
          remainderSol: withdrawPlan.remainderLamports
            ? withdrawPlan.remainderLamports / LAMPORTS_PER_SOL
            : 0,
        });

        let plannedChunks: number[] = [];

        if (withdrawPlan.valid) {
          plannedChunks = [
            ...withdrawPlan.historicalChunks.map(c => c.lamports),
          ];
          if (withdrawPlan.remainderLamports && withdrawPlan.remainderLamports >= MIN_CHUNK_AMOUNT) {
            plannedChunks.push(withdrawPlan.remainderLamports);
          }
        } else {
          // Fallback: withdraw everything in one go instead of failing
          console.warn(
            '[useWalletPrivateSend] Withdrawal split planning failed, falling back to single-chunk withdrawal of full balance'
          );
          plannedChunks = [totalPrivateBalance];
        }
        
        if (plannedChunks.length < 1) {
          throw new Error('Withdrawal plan produced no chunks');
        }
        
        // Execute each withdrawal chunk with retry logic
        for (let i = 0; i < plannedChunks.length; i++) {
          const amount = plannedChunks[i];
          updateStep(
            12,
            'running',
            `Withdrawing chunk ${i + 1}/${plannedChunks.length}: ${(amount / LAMPORTS_PER_SOL).toFixed(4)} SOL to final burner...`
          );
          
          const withdrawResult = await retryTransaction(
            async () => {
              return await withdraw({
                lightWasm,
                amount_in_lamports: amount,
                connection: burnerConnection,
                encryptionService: finalBurnerClient.encryptionService,
                publicKey: finalBurnerKeypair.publicKey,
                recipient: finalBurnerKeypair.publicKey, // Withdraw to final burner's own account
                keyBasePath: '/circuit2/transaction2',
                storage: getBrowserStorage(),
              });
            },
            {
              skipOnBlockLength: true,
              onRetry: (attempt, error) => {
                console.warn(
                  `[Final burner withdraw chunk ${i + 1}] Retry attempt ${attempt}:`,
                  error.message
                );
                updateStep(
                  12,
                  'running',
                  `Retrying final burner withdrawal chunk ${i + 1} (attempt ${attempt})...`
                );
              },
            }
          );
          
          if (withdrawResult) {
            signatures.push(withdrawResult.tx);
            // Persist after each final withdrawal
            await persistSessionState(generatedBurners, signatures, chunkAmounts, usedDepositAmounts);
          } else {
            console.warn(
              `[Final burner withdraw chunk ${i + 1}] Skipped due to transaction too large`
            );
            updateStep(
              12,
              'running',
              `Chunk ${i + 1} withdrawal skipped (transaction too large)`
            );
          }
          
          // Wait between chunks
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        updateStep(12, 'completed', 'Final burner withdrawals complete');
        
      } catch (err: any) {
        throw new Error(`Final burner withdrawal failed: ${err.message}`);
      }

      // Step 13: Final burner sends to destination via simple Solana transfer
      updateStep(13, 'running', 'Final burner sending to destination...');
      
      try {
        const recipientPubkey = new PublicKey(destination);
        
        // Get final burner's balance (after withdrawal)
        const finalBurnerBalance = await burnerConnection.getBalance(finalBurnerKeypair.publicKey);
        
        if (finalBurnerBalance <= 0) {
          throw new Error('Final burner has no balance to send');
        }
        
        // Calculate the exact fee needed for the final simple transfer
        const feeForFinalTransfer = await estimateSimpleTransferFee(burnerConnection, finalBurnerKeypair.publicKey);
        
        // Calculate maximum transferable amount (leave only the exact fee)
        const transferAmount = Math.max(0, finalBurnerBalance - feeForFinalTransfer);
        
        if (transferAmount <= 0) {
          throw new Error(
            `Insufficient balance for transfer. Have ${(finalBurnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
            `need at least ${(feeForFinalTransfer / LAMPORTS_PER_SOL).toFixed(6)} SOL for fees`
          );
        }
        
        console.log(`Final burner balance: ${(finalBurnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        console.log(
          `Transferring ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
          `leaving ${((finalBurnerBalance - transferAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL for fees`
        );
        
        updateStep(
          13,
          'running',
          `Sending ${(transferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL to destination ` +
          `(leaving ${((finalBurnerBalance - transferAmount) / LAMPORTS_PER_SOL).toFixed(6)} SOL for fees)...`
        );
        
        // Simple Solana transfer (not Privacy Cash)
        const { SystemProgram, Transaction } = await import('@solana/web3.js');
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: finalBurnerKeypair.publicKey,
            toPubkey: recipientPubkey,
            lamports: transferAmount,
          })
        );
        
        // Get recent blockhash
        const { blockhash } = await burnerConnection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = finalBurnerKeypair.publicKey;
        transaction.sign(finalBurnerKeypair);
        
        // For simple SystemProgram.transfer, fee is always 5000 lamports (0.000005 SOL)
        // No need to simulate - the fee is deterministic for simple transfers
        
        const txSignature = await burnerConnection.sendRawTransaction(transaction.serialize());
        signatures.push(txSignature);
        
        // Wait for confirmation
        await burnerConnection.confirmTransaction(txSignature, 'confirmed');
        
        updateStep(13, 'completed', `Sent ${(transferAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL to destination`);
        
      } catch (err: any) {
        throw new Error(`Final transfer to destination failed: ${err.message}`);
      }

      const finalResult: WalletPrivateSendResult = {
        success: true,
        signatures,
        sourceWallet: {
          address: publicKey.toBase58(),
        },
        burnerWallets: generatedBurners,
        totalAmount: amount,
        recipient: destination,
      };
      
      // Mark session as completed and clean up
      if (sessionId) {
        await updateSession(sessionId, {
          status: 'completed',
          current_step: 13,
        });
        await deleteSession(sessionId);
        setCurrentSessionId(null);
      }
      
      setResult(finalResult);
      setLoading(false);
      setRecoveryMode(false);
      
      return finalResult;

    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error occurred';
      setError(errorMessage);
      
      // Mark current step as error
      setSteps(prev => prev.map(step => 
        step.status === 'running' ? { ...step, status: 'error', message: errorMessage } : step
      ));
      
      // Mark session as failed (but don't delete - allow recovery)
      if (sessionId) {
        await updateSession(sessionId, {
          status: 'failed',
        }).catch(e => console.error('Failed to update session on error:', e));
      }
      
      setLoading(false);
      setRecoveryMode(false);
      throw err;
    }
  }, [connected, publicKey, signTransaction, connection, updateStep, createSession, updateSession, deleteSession, signMessageWithWallet, persistSessionState]);
  
  /**
   * Recover and continue from a saved session
   * Can be called with a session directly or will fetch active session
   */
  const recoverAndContinue = useCallback(async (sessionData?: SessionData) => {
    if (!connected || !publicKey) {
      throw new Error('Wallet not connected');
    }
    
    try {
      let session: SessionData;
      
      if (sessionData) {
        // Use provided session data
        session = sessionData;
      } else {
        // Fetch active session
        const fetchedSession = await recoverSession(publicKey.toBase58());
        if (!fetchedSession) {
          throw new Error('No active session found');
        }
        session = fetchedSession;
      }
      
      // Restore params from session
      const params: WalletPrivateSendParams = {
        destination: session.transaction_params.destination,
        amount: session.transaction_params.amount,
        numChunks: session.transaction_params.numChunks,
        delayMinutes: session.transaction_params.delayMinutes,
        sponsorFees: false, // Default to false
        exactChunks: session.transaction_params.exactChunks,
        selectedPools: session.transaction_params.selectedPools,
      };
      
      // Continue execution from saved step
      await execute(params, session);
      
      // Return params so UI can restore form state
      return params;
    } catch (err: any) {
      console.error('Recovery failed:', err);
      throw err;
    }
  }, [connected, publicKey, recoverSession, execute]);
  
  /**
   * Check for active session on mount
   */
  useEffect(() => {
    if (connected && publicKey && !loading) {
      recoverSession(publicKey.toBase58())
        .then(session => {
          if (session && (session.status === 'pending' || session.status === 'in_progress')) {
            // Session exists but don't auto-recover - let user decide
            console.log('Active session found:', session.id);
          }
        })
        .catch(err => {
          console.error('Error checking for session:', err);
        });
    }
  }, [connected, publicKey, loading, recoverSession]);

  const reset = useCallback(async () => {
    // Clean up session if exists
    if (currentSessionId) {
      try {
        await deleteSession(currentSessionId);
      } catch (err) {
        console.error('Failed to delete session on reset:', err);
      }
      setCurrentSessionId(null);
    }
    
    setSteps([]);
    setLoading(false);
    setError(null);
    setResult(null);
    setBurnerWallets([]);
    setRecoveryMode(false);
  }, [currentSessionId, deleteSession]);

  return {
    execute,
    recoverAndContinue,
    reset,
    steps,
    loading,
    error,
    result,
    burnerWallets,
    isWalletConnected: connected,
    walletAddress: publicKey?.toBase58(),
    hasActiveSession: currentSessionId !== null,
    recoveryMode,
  };
}
