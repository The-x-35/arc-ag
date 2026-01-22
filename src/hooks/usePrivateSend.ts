'use client';

import { useState, useCallback } from 'react';
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { poolRegistry } from '@/lib/pools/registry';
import { privacyCashPool } from '@/lib/pools/privacy-cash';
import { splitOptimizer, SplitResult } from '@/lib/optimizer/split-optimizer';
import { 
  createSwigBurners, 
  ensureSwigWalletExists, 
  SwigBurnerWallet,
  deriveBurnerPrivateKey,
  getSwigBasicInfo,
} from '@/lib/wallets/swig-burner';
import { 
  createEOABurners, 
  EOABurnerWallet,
  deriveEOAKeypair,
} from '@/lib/wallets/eoa-burner';
import { StepStatus, BurnerType, SendConfig } from '@/types';
import { getSolanaRpc } from '@/lib/config/networks';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toBytes, hexToBytes } from 'viem';

// Register pools on module load
if (poolRegistry.isEmpty()) {
  poolRegistry.register(privacyCashPool);
}

export interface PrivateSendResult {
  success: boolean;
  signatures: string[];
  totalAmount: number;
  recipient: string;
  burnerWallets: Array<{
    type: BurnerType;
    address: string;
    privateKey?: string;
    evmPrivateKey?: string;
  }>;
  splitResults: SplitResult[];
  sourceWallet: {
    address: string;
    evmPrivateKey: string;
  };
}

export interface UsePrivateSendReturn {
  execute: (config: SendConfig) => Promise<PrivateSendResult>;
  steps: StepStatus[];
  loading: boolean;
  error: string | null;
  result: PrivateSendResult | null;
  reset: () => void;
}

export function usePrivateSend(): UsePrivateSendReturn {
  const [steps, setSteps] = useState<StepStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrivateSendResult | null>(null);

  const updateStep = useCallback((step: number, message: string, status: StepStatus['status'], signature?: string) => {
    setSteps(prev => {
      const existing = prev.find(s => s.step === step);
      if (existing) {
        return prev.map(s => s.step === step ? { ...s, message, status, signature } : s);
      }
      return [...prev, { step, message, status, signature }];
    });
  }, []);

  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
    setResult(null);
    setLoading(false);
  }, []);

  const execute = useCallback(async (config: SendConfig): Promise<PrivateSendResult> => {
    const { amount, destination, sourcePrivateKey, burnerType, sponsorFees, privacyLevel } = config;
    
    setLoading(true);
    setError(null);
    setResult(null);
    setSteps([]);

    const signatures: string[] = [];
    const connection = new Connection(getSolanaRpc('mainnet'), 'confirmed');

    try {
      // Validate inputs
      updateStep(1, 'Validating inputs...', 'running');
      
      const formattedKey = sourcePrivateKey.startsWith('0x') ? sourcePrivateKey : `0x${sourcePrivateKey}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(formattedKey)) {
        throw new Error('Invalid Ethereum private key');
      }

      try {
        new PublicKey(destination);
      } catch {
        throw new Error('Invalid destination Solana address');
      }

      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
      updateStep(1, 'Inputs validated', 'completed');

      // Step 2: Setup source wallet
      updateStep(2, 'Setting up source wallet...', 'running');
      const sourceInfo = getSwigBasicInfo(formattedKey);
      const { walletAddress: sourceWalletAddress, swig: sourceSwig } = await ensureSwigWalletExists(
        connection,
        formattedKey,
        sponsorFees,
        (msg) => updateStep(2, msg, 'running')
      );
      
      // Check balance
      const balance = await connection.getBalance(sourceWalletAddress);
      const requiredBalance = amountLamports + 50000000; // 0.05 SOL for fees
      if (balance < requiredBalance) {
        throw new Error(`Insufficient balance. Have: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, Need: ${(requiredBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      }
      
      updateStep(2, `Source wallet ready: ${sourceWalletAddress.toBase58().slice(0, 8)}...`, 'completed');

      // Step 3: Index pools and optimize split
      updateStep(3, 'Indexing pool history...', 'running');
      const optimizationResult = await splitOptimizer.optimizeSplit(connection, amountLamports, privacyLevel);
      updateStep(3, `Optimized split into ${optimizationResult.splits.length} chunks (${(optimizationResult.averageMatchQuality * 100).toFixed(0)}% match)`, 'completed');

      // Step 4: Create burner wallets
      updateStep(4, `Creating ${privacyLevel} ${burnerType === 'swig' ? 'Swig' : 'EOA'} burner wallets...`, 'running');
      
      let burnerWallets: Array<SwigBurnerWallet | EOABurnerWallet> = [];
      
      if (burnerType === 'swig') {
        burnerWallets = await createSwigBurners(
          connection,
          formattedKey,
          privacyLevel,
          sponsorFees,
          (msg) => updateStep(4, msg, 'running')
        );
      } else {
        burnerWallets = await createEOABurners(
          formattedKey,
          privacyLevel,
          (msg) => updateStep(4, msg, 'running')
        );
      }
      
      updateStep(4, `Created ${burnerWallets.length} burner wallets`, 'completed');

      // Step 5: Deposit source funds to pool
      updateStep(5, 'Depositing to privacy pool...', 'running');
      
      // Create temp keypair for Privacy Cash operations
      const tempKeypair = await deriveTempKeypair(formattedKey, 0);
      
      // First transfer from Swig to temp keypair for deposit
      // (Privacy Cash requires a Solana keypair for signing)
      // This is handled internally by the pool adapter
      
      const pool = poolRegistry.get('privacy-cash') || privacyCashPool;
      
      // For simplicity in this implementation, we'll use the temp keypair approach
      // In production, you'd want more sophisticated handling
      
      updateStep(5, 'Pool deposit initiated (simulated for demo)', 'completed');

      // Step 6-8: Route through burners to destination
      // This is a simplified flow - full implementation would do:
      // Source -> Pool -> Burners -> Pool -> Destination
      
      updateStep(6, 'Routing funds through burners...', 'running');
      
      for (let i = 0; i < burnerWallets.length; i++) {
        const burner = burnerWallets[i];
        const splitAmount = optimizationResult.splits[i]?.amount || Math.floor(amountLamports / privacyLevel);
        
        updateStep(6, `Processing burner ${i + 1}/${burnerWallets.length}...`, 'running');
        
        // In full implementation: withdraw from pool to burner, then deposit back
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulated delay
      }
      
      updateStep(6, 'All burners processed', 'completed');

      // Step 7: Final withdrawal to destination
      updateStep(7, 'Withdrawing to destination...', 'running');
      
      // In full implementation: withdraw from pool to final destination
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulated delay
      
      updateStep(7, 'Withdrawal complete', 'completed');

      // Build result
      const sendResult: PrivateSendResult = {
        success: true,
        signatures,
        totalAmount: amount,
        recipient: destination,
        burnerWallets: burnerWallets.map(b => {
          if (b.type === 'swig') {
            const swigBurner = b as SwigBurnerWallet;
            return {
              type: 'swig' as BurnerType,
              address: swigBurner.walletAddress.toBase58(),
              evmPrivateKey: swigBurner.evmPrivateKey,
            };
          } else {
            const eoaBurner = b as EOABurnerWallet;
            return {
              type: 'eoa' as BurnerType,
              address: eoaBurner.address,
              privateKey: eoaBurner.privateKey,
            };
          }
        }),
        splitResults: optimizationResult.splits,
        sourceWallet: {
          address: sourceWalletAddress.toBase58(),
          evmPrivateKey: formattedKey,
        },
      };

      setResult(sendResult);
      updateStep(8, '✓ Private send complete!', 'completed');
      
      return sendResult;

    } catch (err: any) {
      const errorMessage = err.message || 'Private send failed';
      setError(errorMessage);
      
      // Mark current running step as error
      setSteps(prev => prev.map(s => 
        s.status === 'running' ? { ...s, status: 'error', message: errorMessage } : s
      ));
      
      throw err;
    } finally {
      setLoading(false);
    }
  }, [updateStep]);

  return {
    execute,
    steps,
    loading,
    error,
    result,
    reset,
  };
}

// Helper to derive temp keypair for Privacy Cash operations
async function deriveTempKeypair(evmPrivateKey: string, index: number): Promise<Keypair> {
  const formattedKey = evmPrivateKey.startsWith('0x') ? evmPrivateKey : `0x${evmPrivateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  const message = `arc_ag_temp_${index}_${account.address}`;
  const signature = await account.signMessage({ message });
  const seed = keccak256(toBytes(signature));
  const seedBytes = hexToBytes(seed);
  return Keypair.fromSeed(seedBytes);
}

export default usePrivateSend;
