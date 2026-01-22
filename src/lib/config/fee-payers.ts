import { Network } from './networks';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export interface FeePayerConfig {
  solanaPrivateKey: string;
  solanaKeypair: Keypair;
}

const feePayers: Record<Network, FeePayerConfig | null> = {
  mainnet: null,
  testnet: null,
};

function isValidSolanaPrivateKey(key: string): boolean {
  if (!key || key.length === 0) return false;
  try {
    bs58.decode(key);
    return true;
  } catch {
    return false;
  }
}

function initializeFeePayers() {
  // Mainnet
  const solanaMainnetKey = process.env.SOLANA_MAINNET_FEE_PAYER_PRIVATE_KEY?.trim();

  if (solanaMainnetKey && isValidSolanaPrivateKey(solanaMainnetKey)) {
    try {
      feePayers.mainnet = {
        solanaPrivateKey: solanaMainnetKey,
        solanaKeypair: Keypair.fromSecretKey(bs58.decode(solanaMainnetKey)),
      };
    } catch (error) {
      console.warn('Failed to initialize mainnet fee payers:', error);
    }
  }

  // Testnet
  const solanaTestnetKey = process.env.SOLANA_TESTNET_FEE_PAYER_PRIVATE_KEY?.trim();

  if (solanaTestnetKey && isValidSolanaPrivateKey(solanaTestnetKey)) {
    try {
      feePayers.testnet = {
        solanaPrivateKey: solanaTestnetKey,
        solanaKeypair: Keypair.fromSecretKey(bs58.decode(solanaTestnetKey)),
      };
    } catch (error) {
      console.warn('Failed to initialize testnet fee payers:', error);
    }
  }
}

// Initialize on module load
initializeFeePayers();

export function getFeePayer(network: Network): FeePayerConfig {
  // Re-initialize in case env vars were set after module load
  if (!feePayers[network]) {
    initializeFeePayers();
  }
  
  const feePayer = feePayers[network];
  if (!feePayer) {
    throw new Error(
      `Fee payer not configured for ${network}. ` +
      `Please set SOLANA_${network.toUpperCase()}_FEE_PAYER_PRIVATE_KEY environment variable.`
    );
  }
  return feePayer;
}

export function hasFeePayer(network: Network): boolean {
  return feePayers[network] !== null;
}
