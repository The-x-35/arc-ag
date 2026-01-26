'use client';

import { useState, useCallback } from 'react';
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
import { isValidSolanaAddress, formatTime, sleepWithCountdown, generateRandomDelays } from '@/lib/swig/utils';

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
  { id: 8, label: 'Withdrawing to burners' },
  { id: 9, label: 'Re-depositing from burners' },
  { id: 10, label: 'Final withdrawal to destination' },
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
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  
  const [steps, setSteps] = useState<WalletPrivateSendStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletPrivateSendResult | null>(null);
  const [burnerWallets, setBurnerWallets] = useState<EOABurnerWalletInfo[]>([]);

  const updateStep = useCallback((stepId: number, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, message } : step
    ));
  }, []);

  const execute = useCallback(async (params: WalletPrivateSendParams) => {
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

    // If exact chunks provided, use their total, otherwise use amount
    const amountLamports = exactChunks && exactChunks.length === numChunks 
      ? exactChunks.reduce((sum, c) => sum + c, 0)
      : Math.floor(amount * LAMPORTS_PER_SOL);
    const delayMs = delayMinutes * 60 * 1000; // Convert minutes to milliseconds
    const signatures: string[] = [];
    const generatedBurners: EOABurnerWalletInfo[] = [];
    const burnerKeypairs: Keypair[] = [];

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
        // Check minimum amount per chunk (each burner needs enough to re-deposit after fees)
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

      // Step 2: Generate first burner wallet
      updateStep(2, 'running', 'Generating first burner wallet...');
      
      const firstBurnerKeypair = Keypair.generate();
      const firstBurnerInfo: EOABurnerWalletInfo = {
        index: 0,
        address: firstBurnerKeypair.publicKey.toBase58(),
        privateKey: bs58.encode(firstBurnerKeypair.secretKey),
        type: 'eoa',
      };
      generatedBurners.push(firstBurnerInfo);
      setBurnerWallets([...generatedBurners]);
      
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

      // CRITICAL: Initialize SDK components
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
          const chunkAmount = chunkAmounts[i];
          
          updateStep(4, 'running', `Depositing chunk ${i + 1}/${numChunks}...`);
          
          const firstBurnerSigner = async (tx: VersionedTransaction) => {
            tx.sign([firstBurnerKeypair]);
            return tx;
          };
          
          const depositResult = await deposit({
            lightWasm,
            amount_in_lamports: chunkAmount,
            connection: connection,
            encryptionService: firstBurnerClient.encryptionService,
            publicKey: firstBurnerKeypair.publicKey,
            transactionSigner: firstBurnerSigner,
            keyBasePath: '/circuit2/transaction2',
            storage: getBrowserStorage(),
          });
          
          signatures.push(depositResult.tx);
          
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

      // Step 7: Generate additional burner keypairs
      updateStep(7, 'running', `Generating ${numChunks} burner keypairs...`);
      
      for (let i = 0; i < numChunks; i++) {
        const keypair = Keypair.generate();
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
      
      updateStep(7, 'completed', `${numChunks} burner keypairs generated`);

      // Step 8: Withdraw from pool to burner keypairs with random delays
      // Use the first burner's encryption service to decrypt UTXOs
      updateStep(8, 'running', 'Withdrawing to burner wallets...');
      
      // Allocate 20% of total delay for withdrawals
      const withdrawDelayPortion = Math.floor(delayMs * 0.2);
      const withdrawDelays = generateRandomDelays(withdrawDelayPortion, numChunks - 1);
      
      // Use same chunk amounts as deposited
      try {
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const withdrawAmount = chunkAmounts[i];
          
          updateStep(8, 'running', `Withdrawing chunk ${i + 1}/${numChunks}...`);
          
          const withdrawResult = await withdraw({
            lightWasm,
            amount_in_lamports: withdrawAmount,
            connection: connection,
            encryptionService: firstBurnerClient.encryptionService, // First burner's encryption service
            publicKey: firstBurnerKeypair.publicKey,
            recipient: burnerKeypair.publicKey,
            keyBasePath: '/circuit2/transaction2',
            storage: getBrowserStorage(),
          });
          
          signatures.push(withdrawResult.tx);
          
          // Wait for transaction confirmation
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Random delay before next withdrawal (except for last)
          if (i < numChunks - 1 && withdrawDelays[i] > 0) {
            updateStep(8, 'running', `Waiting ${formatTime(withdrawDelays[i])} before next withdrawal...`);
            await sleepWithCountdown(withdrawDelays[i], (remaining) => {
              updateStep(8, 'running', `Waiting ${remaining} before next withdrawal...`);
            });
          }
        }
        
        updateStep(8, 'completed', 'Withdrawn to all burners');
        
      } catch (err: any) {
        throw new Error(`Withdrawal to burners failed: ${err.message}`);
      }

      // Step 9: Re-deposit from burners to pool
      // Each burner has its OWN encryption service (different keypair)
      updateStep(7, 'running', 'Re-depositing from burners...');
      
      // Create a FRESH connection for burner operations to avoid stale ALT issues
      const burnerConnection = new Connection(getRpcUrl(), 'confirmed');
      
      // Create encryption services for each burner
      const burnerClients: any[] = [];
      for (const burnerKeypair of burnerKeypairs) {
        const burnerClient = new PrivacyCash({
          RPC_url: getRpcUrl(),
          owner: burnerKeypair, // Burner's own keypair
          enableDebug: false,
        }) as any;
        burnerClients.push(burnerClient);
      }
      
      try {
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const burnerClient = burnerClients[i];
          
          updateStep(9, 'running', `Checking burner ${i + 1} balance...`);
          
          // Get ACTUAL balance of burner (after withdrawal fees)
          const burnerBalance = await burnerConnection.getBalance(burnerKeypair.publicKey);
          
          // Reserve some for transaction fees (~0.003 SOL for compute + priority)
          const reserveForFees = 3000000; // 0.003 SOL
          const depositAmount = burnerBalance - reserveForFees;
          
          if (depositAmount <= 0) {
            console.log(`Burner ${i + 1} has insufficient balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL`);
            continue; // Skip this burner
          }
          
          updateStep(9, 'running', `Re-depositing ${(depositAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL from burner ${i + 1}/${numChunks}...`);
          
          const burnerSigner = async (tx: VersionedTransaction) => {
            tx.sign([burnerKeypair]);
            return tx;
          };
          
          const depositResult = await deposit({
            lightWasm,
            amount_in_lamports: depositAmount,
            connection: burnerConnection, // Use fresh connection for ALT fetch
            encryptionService: burnerClient.encryptionService, // Burner's encryption service
            publicKey: burnerKeypair.publicKey,
            transactionSigner: burnerSigner,
            keyBasePath: '/circuit2/transaction2',
            storage: getBrowserStorage(),
          });
          
          signatures.push(depositResult.tx);
          
          // Wait for indexing
          await new Promise(resolve => setTimeout(resolve, 8000));
        }
        
        updateStep(9, 'completed', 'All burners re-deposited');
        
      } catch (err: any) {
        throw new Error(`Re-deposit from burners failed: ${err.message}`);
      }

      // Step 10: Final withdrawal to destination with random delays
      // Use each burner's encryption service to withdraw MAX available
      updateStep(10, 'running', 'Final withdrawal to destination...');
      
      // Allocate 20% of total delay for final withdrawals
      const finalDelayPortion = Math.floor(delayMs * 0.2);
      const finalDelays = generateRandomDelays(finalDelayPortion, numChunks - 1);
      
      // Import getUtxos to check private balance
      const { getUtxos } = await import('privacycash/utils');
      
      try {
        const recipientPubkey = new PublicKey(destination);
        
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const burnerClient = burnerClients[i];
          
          updateStep(10, 'running', `Checking burner ${i + 1} private balance...`);
          
          // Get actual UTXOs/private balance for this burner
          const utxos = await getUtxos({
            publicKey: burnerKeypair.publicKey,
            connection: burnerConnection, // Use fresh connection
            encryptionService: burnerClient.encryptionService,
            storage: getBrowserStorage(),
          });
          
          // Calculate total private balance
          const totalPrivateBalance = utxos.reduce((sum: number, utxo: any) => {
            return sum + parseInt(utxo.amount.toString());
          }, 0);
          
          if (totalPrivateBalance <= 0) {
            console.log(`Burner ${i + 1} has no private balance`);
            continue;
          }
          
          updateStep(10, 'running', `Final withdraw ${(totalPrivateBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL from burner ${i + 1}/${numChunks}...`);
          
          const withdrawResult = await withdraw({
            lightWasm,
            amount_in_lamports: totalPrivateBalance, // Withdraw MAX available
            connection: burnerConnection, // Use fresh connection for ALT fetch
            encryptionService: burnerClient.encryptionService,
            publicKey: burnerKeypair.publicKey,
            recipient: recipientPubkey,
            keyBasePath: '/circuit2/transaction2',
            storage: getBrowserStorage(),
          });
          
          signatures.push(withdrawResult.tx);
          
          // Wait for confirmation
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Random delay before next withdrawal (except for last)
          if (i < numChunks - 1 && finalDelays[i] > 0) {
            updateStep(10, 'running', `Waiting ${formatTime(finalDelays[i])} before next withdrawal...`);
            await sleepWithCountdown(finalDelays[i], (remaining) => {
              updateStep(10, 'running', `Waiting ${remaining} before next withdrawal...`);
            });
          }
        }
        
        updateStep(10, 'completed', 'Complete!');
        
      } catch (err: any) {
        throw new Error(`Final withdrawal failed: ${err.message}`);
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
      
      setResult(finalResult);
      setLoading(false);
      
      return finalResult;

    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error occurred';
      setError(errorMessage);
      
      // Mark current step as error
      setSteps(prev => prev.map(step => 
        step.status === 'running' ? { ...step, status: 'error', message: errorMessage } : step
      ));
      
      setLoading(false);
      throw err;
    }
  }, [connected, publicKey, signTransaction, connection, updateStep]);

  const reset = useCallback(() => {
    setSteps([]);
    setLoading(false);
    setError(null);
    setResult(null);
    setBurnerWallets([]);
  }, []);

  return {
    execute,
    reset,
    steps,
    loading,
    error,
    result,
    burnerWallets,
    isWalletConnected: connected,
    walletAddress: publicKey?.toBase58(),
  };
}
