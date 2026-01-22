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
import { isValidSolanaAddress, formatTime, calculateDelayMs, sleepWithCountdown } from '@/lib/swig/utils';

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
  { id: 2, label: 'Generating burner keypairs' },
  { id: 3, label: 'Depositing to pool (sign required)' },
  { id: 4, label: 'Waiting for indexing' },
  { id: 5, label: 'Privacy delay' },
  { id: 6, label: 'Withdrawing to burners' },
  { id: 7, label: 'Re-depositing from burners' },
  { id: 8, label: 'Final withdrawal to destination' },
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
    const { destination, amount, numChunks, sponsorFees, exactChunks } = params;
    
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
    const delayMs = calculateDelayMs(numChunks);
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
      
      // Check balance
      const balance = await connection.getBalance(publicKey);
      const requiredBalance = amountLamports + 10000000; // Add buffer for fees
      if (balance < requiredBalance) {
        throw new Error(`Insufficient balance. Have: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Need: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
      
      updateStep(1, 'completed', 'Inputs validated');

      // Step 2: Generate burner keypairs
      updateStep(2, 'running', `Generating ${numChunks} burner keypairs...`);
      
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
      
      updateStep(2, 'completed', `${numChunks} burner keypairs generated`);

      // CRITICAL: Initialize SDK components ONCE and reuse throughout
      // The encryption service must be the SAME for deposit and withdraw!
      const { deposit, withdraw } = await import('privacycash/utils');
      // @ts-ignore
      const { WasmFactory } = await import('@lightprotocol/hasher.rs');
      const { PrivacyCash } = await import('privacycash');
      
      const lightWasm = await WasmFactory.getInstance();
      
      // Create ONE temp keypair for the connected wallet's encryption service
      // This MUST be reused for both deposit AND withdraw from the same wallet!
      const mainTempKeypair = Keypair.generate();
      const mainPrivacyCashClient = new PrivacyCash({
        RPC_url: getRpcUrl(),
        owner: mainTempKeypair,
        enableDebug: false,
      }) as any;
      
      // Override publicKey to use wallet's public key (same as pc/tx page does)
      mainPrivacyCashClient.publicKey = publicKey;
      
      // Wallet signer for main wallet operations
      const walletSigner = async (tx: VersionedTransaction) => {
        const signedTx = await signTransaction(tx);
        return signedTx;
      };

      // Step 3: Deposit to pool from connected wallet
      updateStep(3, 'running', 'Depositing to pool (please sign in your wallet)...');
      
      try {
        const depositResult = await deposit({
          lightWasm,
          amount_in_lamports: amountLamports,
          connection: connection,
          encryptionService: mainPrivacyCashClient.encryptionService, // SAME encryption service
          publicKey: publicKey,
          transactionSigner: walletSigner,
          keyBasePath: '/circuit2/transaction2',
          storage: getBrowserStorage(),
        });
        
        signatures.push(depositResult.tx);
        updateStep(3, 'completed', 'Deposit complete');
        
      } catch (err: any) {
        console.error('Deposit error:', err);
        throw new Error(`Deposit failed: ${err.message}`);
      }

      // Step 4: Wait for indexing
      updateStep(4, 'running', 'Waiting for UTXO indexing...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      updateStep(4, 'completed', 'Deposit indexed');

      // Step 5: Privacy delay
      if (delayMs > 0) {
        updateStep(5, 'running', `Privacy delay: ${formatTime(delayMs)}`);
        await sleepWithCountdown(delayMs, (remaining) => {
          updateStep(5, 'running', `Waiting ${remaining}...`);
        });
        updateStep(5, 'completed', 'Privacy delay complete');
      } else {
        updateStep(5, 'completed', 'No delay (fast mode)');
      }

      // Step 6: Withdraw from pool to burner keypairs
      // Use the SAME encryption service as deposit!
      updateStep(6, 'running', 'Withdrawing to burner wallets...');
      
      // Use exact chunks if provided, otherwise equal split
      let chunkAmounts: number[];
      if (exactChunks && exactChunks.length === numChunks) {
        chunkAmounts = exactChunks;
        console.log('[useWalletPrivateSend] Using exact chunks:', chunkAmounts.map(c => c / LAMPORTS_PER_SOL));
      } else {
        const chunkAmount = Math.floor(amountLamports / numChunks);
        const remainder = amountLamports % numChunks;
        chunkAmounts = Array.from({ length: numChunks }, (_, i) => 
          i === numChunks - 1 ? chunkAmount + remainder : chunkAmount
        );
        console.log('[useWalletPrivateSend] Using equal split:', chunkAmounts.map(c => c / LAMPORTS_PER_SOL));
      }
      
      try {
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const withdrawAmount = chunkAmounts[i];
          
          updateStep(6, 'running', `Withdrawing chunk ${i + 1}/${numChunks}...`);
          
          const withdrawResult = await withdraw({
            lightWasm,
            amount_in_lamports: withdrawAmount,
            connection: connection,
            encryptionService: mainPrivacyCashClient.encryptionService, // SAME encryption service!
            publicKey: publicKey,
            recipient: burnerKeypair.publicKey,
            keyBasePath: '/circuit2/transaction2',
            storage: getBrowserStorage(),
          });
          
          signatures.push(withdrawResult.tx);
          
          // Wait for transaction confirmation
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        updateStep(6, 'completed', 'Withdrawn to all burners');
        
      } catch (err: any) {
        throw new Error(`Withdrawal to burners failed: ${err.message}`);
      }

      // Step 7: Re-deposit from burners to pool
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
          
          updateStep(7, 'running', `Checking burner ${i + 1} balance...`);
          
          // Get ACTUAL balance of burner (after withdrawal fees)
          const burnerBalance = await burnerConnection.getBalance(burnerKeypair.publicKey);
          
          // Reserve some for transaction fees (~0.003 SOL for compute + priority)
          const reserveForFees = 3000000; // 0.003 SOL
          const depositAmount = burnerBalance - reserveForFees;
          
          if (depositAmount <= 0) {
            console.log(`Burner ${i + 1} has insufficient balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL`);
            continue; // Skip this burner
          }
          
          updateStep(7, 'running', `Re-depositing ${(depositAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL from burner ${i + 1}/${numChunks}...`);
          
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
        
        updateStep(7, 'completed', 'All burners re-deposited');
        
      } catch (err: any) {
        throw new Error(`Re-deposit from burners failed: ${err.message}`);
      }

      // Step 8: Final withdrawal to destination
      // Use each burner's encryption service to withdraw MAX available
      updateStep(8, 'running', 'Final withdrawal to destination...');
      
      // Import getUtxos to check private balance
      const { getUtxos } = await import('privacycash/utils');
      
      try {
        const recipientPubkey = new PublicKey(destination);
        
        for (let i = 0; i < numChunks; i++) {
          const burnerKeypair = burnerKeypairs[i];
          const burnerClient = burnerClients[i];
          
          updateStep(8, 'running', `Checking burner ${i + 1} private balance...`);
          
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
          
          updateStep(8, 'running', `Final withdraw ${(totalPrivateBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL from burner ${i + 1}/${numChunks}...`);
          
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
        }
        
        updateStep(8, 'completed', 'Complete!');
        
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
