'use client';

import { useState, useCallback } from 'react';
import { Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { findSwigPda } from '@swig-wallet/classic';

// Get RPC URL - same as wallet provider
const getRpcUrl = () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(WalletAdapterNetwork.Mainnet);
import {
  getSwigBasicInfo,
  getSwigWalletInfo,
  ensureSwigWalletExists,
  deriveBurnerPrivateKey,
  depositToPoolWithSwig,
  withdrawFromPool,
} from '@/lib/wallets/swig-burner';
import {
  isValidPrivateKey,
  isValidSolanaAddress,
  sleepWithCountdown,
  formatTime,
} from '@/lib/swig/utils';

export interface SwigPrivateSendParams {
  privateKey: string;
  destination: string;
  amount: number;
  numChunks: number;
  delayMinutes: number;
  sponsorFees: boolean;
}

import { StepStatus } from '@/components/ProgressSteps';

export type SwigPrivateSendStep = StepStatus;

export interface BurnerWalletInfo {
  index: number;
  address: string;
  evmPrivateKey: string;
  type: 'swig';
}

export interface SwigPrivateSendResult {
  success: boolean;
  signatures: string[];
  sourceWallet: {
    address: string;
    evmPrivateKey: string;
  };
  burnerWallets: BurnerWalletInfo[];
  totalAmount: number;
  recipient: string;
}

const STEPS = [
  { id: 1, label: 'Validating inputs' },
  { id: 2, label: 'Setting up main wallet' },
  { id: 3, label: 'Depositing to pool' },
  { id: 4, label: 'Waiting for indexing' },
  { id: 5, label: 'Privacy delay' },
  { id: 6, label: 'Setting up burner wallets' },
  { id: 7, label: 'Withdrawing to burners' },
  { id: 8, label: 'Re-depositing from burners' },
  { id: 9, label: 'Final withdrawal to destination' },
];

export function useSwigPrivateSend() {
  const [steps, setSteps] = useState<SwigPrivateSendStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SwigPrivateSendResult | null>(null);
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletInfo[]>([]);

  const updateStep = useCallback((stepId: number, status: 'pending' | 'running' | 'completed' | 'error', message?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, message } : step
    ));
  }, []);

  const execute = useCallback(async (params: SwigPrivateSendParams) => {
    const { privateKey, destination, amount, numChunks, delayMinutes, sponsorFees } = params;
    
    // Initialize steps
    setSteps(STEPS.map(s => ({ ...s, status: 'pending' as const })));
    setLoading(true);
    setError(null);
    setResult(null);
    setBurnerWallets([]);

    const connection = new Connection(getRpcUrl(), 'confirmed');
    const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    const delayMs = delayMinutes * 60 * 1000; // Convert minutes to milliseconds
    const signatures: string[] = [];
    const generatedBurners: BurnerWalletInfo[] = [];

    try {
      // Step 1: Validation
      updateStep(1, 'running', 'Validating inputs...');
      
      if (!isValidPrivateKey(formattedKey)) {
        throw new Error('Invalid Ethereum private key');
      }
      if (!isValidSolanaAddress(destination)) {
        throw new Error('Invalid Solana recipient address');
      }
      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      
      updateStep(1, 'completed', 'Inputs validated');

      // Step 2: Setup main wallet
      updateStep(2, 'running', 'Setting up main Swig wallet...');
      
      const mainBasic = getSwigBasicInfo(formattedKey);
      
      await ensureSwigWalletExists(
        connection, formattedKey, sponsorFees,
        (msg) => updateStep(2, 'running', msg)
      );
      
      const mainWallet = await getSwigWalletInfo(connection, formattedKey);
      
      // Check balance
      const balance = await connection.getBalance(mainWallet.walletAddress);
      const requiredBalance = amountLamports + 1000000; // Add buffer
      if (balance < requiredBalance) {
        throw new Error(`Insufficient balance. Have: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Need: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
      
      updateStep(2, 'completed', 'Main wallet ready');

      // Step 3: Deposit main wallet to pool
      updateStep(3, 'running', 'Depositing to privacy pool...');
      
      const depositSig = await depositToPoolWithSwig(
        connection, mainWallet.swig, mainWallet.walletAddress,
        amountLamports, formattedKey, 0,
        (msg) => updateStep(3, 'running', msg)
      );
      signatures.push(depositSig);
      
      updateStep(3, 'completed', 'Deposit complete');

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

      // Step 6: Setup burner wallets
      updateStep(6, 'running', `Deriving ${numChunks} burner wallets...`);
      
      interface BurnerWalletInternal {
        key: string;
        swigAddress: PublicKey;
        walletAddress: PublicKey;
        swig: any;
      }
      const internalBurners: BurnerWalletInternal[] = [];
      
      for (let i = 1; i <= numChunks; i++) {
        const burnerKey = await deriveBurnerPrivateKey(formattedKey, i);
        await ensureSwigWalletExists(
          connection, burnerKey, sponsorFees,
          (msg) => updateStep(6, 'running', `Burner ${i}: ${msg}`)
        );
        
        const burnerWallet = await getSwigWalletInfo(connection, burnerKey);
        internalBurners.push({
          key: burnerKey,
          swigAddress: burnerWallet.swigAddress,
          walletAddress: burnerWallet.walletAddress,
          swig: burnerWallet.swig,
        });
        
        generatedBurners.push({
          index: i,
          address: burnerWallet.walletAddress.toBase58(),
          evmPrivateKey: burnerKey,
          type: 'swig',
        });
        
        // Update state so UI can display burners as they're created
        setBurnerWallets([...generatedBurners]);
      }
      
      updateStep(6, 'completed', `${numChunks} burner wallets ready`);

      // Step 7: Withdraw from pool to burner wallets
      updateStep(7, 'running', 'Withdrawing to burner wallets...');
      
      const chunkAmount = Math.floor(amountLamports / numChunks);
      const remainder = amountLamports % numChunks;
      
      for (let i = 0; i < numChunks; i++) {
        const burner = internalBurners[i];
        const amount = i === numChunks - 1 ? chunkAmount + remainder : chunkAmount;
        
        updateStep(7, 'running', `Withdrawing chunk ${i + 1}/${numChunks}...`);
        
        const withdrawSig = await withdrawFromPool(
          connection, amount, burner.walletAddress,
          formattedKey, 0,
          (msg) => updateStep(7, 'running', msg)
        );
        signatures.push(withdrawSig);
        
        // Wait between withdrawals
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      updateStep(7, 'completed', 'Withdrawn to all burners');

      // Step 8: Re-deposit from burners to pool
      updateStep(8, 'running', 'Re-depositing from burners...');
      
      for (let i = 0; i < numChunks; i++) {
        const burner = internalBurners[i];
        const amount = i === numChunks - 1 ? chunkAmount + remainder : chunkAmount;
        
        updateStep(8, 'running', `Re-depositing from burner ${i + 1}/${numChunks}...`);
        
        const depositSig = await depositToPoolWithSwig(
          connection, burner.swig, burner.walletAddress,
          amount, burner.key, i + 1,
          (msg) => updateStep(8, 'running', msg)
        );
        signatures.push(depositSig);
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      updateStep(8, 'completed', 'All burners re-deposited');

      // Step 9: Final withdrawal to destination
      updateStep(9, 'running', 'Final withdrawal to destination...');
      
      const recipientPubkey = new PublicKey(destination);
      
      // Withdraw all from each burner's temp account to destination
      for (let i = 0; i < numChunks; i++) {
        const burner = internalBurners[i];
        const amount = i === numChunks - 1 ? chunkAmount + remainder : chunkAmount;
        
        updateStep(9, 'running', `Final withdraw ${i + 1}/${numChunks}...`);
        
        const withdrawSig = await withdrawFromPool(
          connection, amount, recipientPubkey,
          burner.key, i + 1,
          (msg) => updateStep(9, 'running', msg)
        );
        signatures.push(withdrawSig);
        
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      updateStep(9, 'completed', 'Complete!');

      const finalResult: SwigPrivateSendResult = {
        success: true,
        signatures,
        sourceWallet: {
          address: mainWallet.walletAddress.toBase58(),
          evmPrivateKey: formattedKey,
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
  }, [updateStep]);

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
  };
}
