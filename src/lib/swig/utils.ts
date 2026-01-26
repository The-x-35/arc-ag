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
    hash[hashIndex] ^= data[data.length - 1 - i];
    hashIndex = (hashIndex + 1) % 32;
  }
  
  return hash;
}

/**
 * Derive burner ETH private key from main key by signing a unique message
 */
export async function deriveBurnerPrivateKey(mainPrivateKey: string, index: number): Promise<string> {
  const formattedKey = mainPrivateKey.startsWith('0x') ? mainPrivateKey : `0x${mainPrivateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  
  const message = `swig_burner_wallet_${index}_${account.address}`;
  const signature = await account.signMessage({ message });
  const burnerKey = keccak256(toBytes(signature));
  return burnerKey;
}

/**
 * Derive temp Solana keypair from ETH key (for Privacy Cash operations)
 */
export async function deriveTempKeypair(evmPrivateKey: string, index: number): Promise<Keypair> {
  const formattedKey = evmPrivateKey.startsWith('0x') ? evmPrivateKey : `0x${evmPrivateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  const message = `privacy_temp_${index}_${account.address}`;
  const signature = await account.signMessage({ message });
  const seed = keccak256(toBytes(signature));
  const seedBytes = hexToBytes(seed);
  return Keypair.fromSeed(seedBytes);
}

/**
 * Validate Ethereum private key
 */
export function isValidPrivateKey(key: string): boolean {
  const formatted = key.startsWith('0x') ? key : `0x${key}`;
  return /^0x[a-fA-F0-9]{64}$/.test(formatted);
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
 * Get Swig wallet basic info from ETH private key
 */
export function getSwigBasicInfo(evmPrivateKey: string): {
  swigId: Uint8Array;
  evmAccount: ReturnType<typeof privateKeyToAccount>;
  formattedKey: string;
} {
  const formattedKey = evmPrivateKey.startsWith('0x') ? evmPrivateKey : `0x${evmPrivateKey}`;
  const evmAccount = privateKeyToAccount(formattedKey as `0x${string}`);
  const swigId = createDeterministicSwigId(evmAccount.address);
  return { swigId, evmAccount, formattedKey };
}

/**
 * Get full Swig wallet info including addresses (requires swig to exist)
 */
export async function getSwigWalletInfo(
  connection: Connection,
  evmPrivateKey: string
): Promise<{
  swigAddress: PublicKey;
  walletAddress: PublicKey;
  swigId: Uint8Array;
  evmAccount: ReturnType<typeof privateKeyToAccount>;
  swig: any;
}> {
  const { swigId, evmAccount } = getSwigBasicInfo(evmPrivateKey);
  const swigAddress = await findSwigPda(swigId);
  const swig = await fetchSwig(connection, swigAddress);
  const walletAddress = await getSwigSystemAddress(swig);
  return { swigAddress, walletAddress, swigId, evmAccount, swig };
}

/**
 * Check if Swig wallet exists, create if not
 */
export async function ensureSwigWalletExists(
  connection: Connection,
  evmPrivateKey: string,
  swigId: Uint8Array,
  swigAddress: PublicKey,
  updateStatus: (msg: string) => void
): Promise<boolean> {
  try {
    await fetchSwig(connection, swigAddress);
    return true;
  } catch (error: any) {
    updateStatus('Creating Swig wallet...');
    
    const formattedKey = evmPrivateKey.startsWith('0x') ? evmPrivateKey : `0x${evmPrivateKey}`;
    const evmAccount = privateKeyToAccount(formattedKey as `0x${string}`);
    const authorityInfo = createSecp256k1AuthorityInfo(evmAccount.publicKey);
    const rootActions = Actions.set().all().get();
    
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const createSwigInstruction = await getCreateSwigInstruction({
      authorityInfo,
      id: swigId,
      payer: FEE_PAYER_PUBKEY,
      actions: rootActions,
    });
    
    const transaction = new Transaction();
    transaction.add(createSwigInstruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = FEE_PAYER_PUBKEY;
    
    const transactionBase64 = Buffer.from(transaction.serialize({ requireAllSignatures: false })).toString('base64');
    
    const signResponse = await fetch('/api/transaction/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionBase64, network: 'mainnet' }),
    });
    
    const signData = await signResponse.json();
    if (!signData.success) {
      throw new Error(signData.error || 'Failed to create wallet');
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  }
}

/**
 * Transfer from Swig to a specific address
 */
export async function transferFromSwigToAddress(
  connection: Connection,
  swig: any,
  walletAddress: PublicKey,
  recipient: PublicKey,
  amountLamports: number,
  evmPrivateKey: string
): Promise<string> {
  const formattedKey = evmPrivateKey.startsWith('0x') ? evmPrivateKey : `0x${evmPrivateKey}`;
  const evmAccount = privateKeyToAccount(formattedKey as `0x${string}`);
  
  const rootRole = swig.findRolesBySecp256k1SignerAddress(evmAccount.address)[0];
  if (!rootRole) {
    throw new Error('No role found for this authority');
  }
  
  const currentSlot = await connection.getSlot('finalized');
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: walletAddress,
    toPubkey: recipient,
    lamports: amountLamports,
  });
  
  const privateKeyBytes = hexToBytes(formattedKey as `0x${string}`);
  const signingFn = getSigningFnForSecp256k1PrivateKey(privateKeyBytes);
  
  const signInstructions = await getSignInstructions(
    swig,
    rootRole.id,
    [transferInstruction],
    false,
    {
      currentSlot: BigInt(currentSlot),
      signingFn,
      payer: FEE_PAYER_PUBKEY,
    }
  );
  
  const transaction = new Transaction();
  transaction.add(...signInstructions);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = FEE_PAYER_PUBKEY;
  
  const transactionBase64 = Buffer.from(transaction.serialize({ requireAllSignatures: false })).toString('base64');
  
  const signResponse = await fetch('/api/transaction/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionBase64, network: 'mainnet' }),
  });
  
  const signData = await signResponse.json();
  if (!signData.success) {
    throw new Error(signData.error || 'Failed to sign transaction');
  }
  
  return signData.data.signature;
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

/**
 * Deposit to Privacy Cash pool using Swig wallet
 */
export async function depositToPoolWithSwig(
  connection: Connection,
  swig: any,
  walletAddress: PublicKey,
  amountLamports: number,
  evmPrivateKey: string,
  tempIndex: number,
  updateStatus: (msg: string) => void
): Promise<string> {
  updateStatus(`Depositing ${amountLamports / LAMPORTS_PER_SOL} SOL to privacy pool...`);
  
  try {
    const { deposit } = await import('privacycash/utils');
    // @ts-ignore - hasher.rs has no type declarations
    const { WasmFactory } = await import('@lightprotocol/hasher.rs');
    const { PrivacyCash } = await import('privacycash');
    
    const lightWasm = await WasmFactory.getInstance();
    
    // Create a temp keypair for the deposit (Privacy Cash requires a keypair)
    const tempKeypair = await deriveTempKeypair(evmPrivateKey, tempIndex);
    
    // First, transfer from Swig to temp keypair
    updateStatus('Transferring to temporary address for pool deposit...');
    await transferFromSwigToAddress(
      connection, swig, walletAddress, tempKeypair.publicKey,
      amountLamports + 15000000, evmPrivateKey // Add extra for fees
    );
    
    // Wait for transfer to confirm
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Initialize PrivacyCash with temp keypair
    const privacyCashClient = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: tempKeypair,
      enableDebug: false,
    }) as any;
    
    // Transaction signer using temp keypair
    const transactionSigner = async (tx: VersionedTransaction) => {
      tx.sign([tempKeypair]);
      return tx;
    };
    
    // Deposit to pool
    const result = await deposit({
      lightWasm,
      amount_in_lamports: amountLamports,
      connection,
      encryptionService: privacyCashClient.encryptionService,
      publicKey: tempKeypair.publicKey,
      transactionSigner,
      keyBasePath: '/circuit2/transaction2',
      storage: getBrowserStorage(),
    });
    
    updateStatus('Waiting for deposit confirmation and UTXO indexing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return result.tx;
  } catch (error: any) {
    console.error('Privacy pool deposit error:', error);
    throw new Error(`Privacy pool deposit failed: ${error.message}`);
  }
}

/**
 * Withdraw from Privacy Cash pool to recipient
 */
export async function withdrawFromPool(
  connection: Connection,
  amountLamports: number,
  recipient: PublicKey,
  evmPrivateKey: string,
  tempIndex: number,
  updateStatus: (msg: string) => void
): Promise<string> {
  updateStatus(`Withdrawing ${amountLamports / LAMPORTS_PER_SOL} SOL from privacy pool...`);
  
  try {
    const { withdraw } = await import('privacycash/utils');
    // @ts-ignore - hasher.rs has no type declarations
    const { WasmFactory } = await import('@lightprotocol/hasher.rs');
    const { PrivacyCash } = await import('privacycash');
    
    const lightWasm = await WasmFactory.getInstance();
    
    // Derive same temp keypair used for deposit
    const tempKeypair = await deriveTempKeypair(evmPrivateKey, tempIndex);
    
    // Initialize PrivacyCash
    const privacyCashClient = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: tempKeypair,
      enableDebug: false,
    }) as any;
    
    // Transaction signer
    const transactionSigner = async (tx: VersionedTransaction) => {
      tx.sign([tempKeypair]);
      return tx;
    };
    
    // Withdraw from pool
    const result = await withdraw({
      lightWasm,
      amount_in_lamports: amountLamports,
      connection,
      encryptionService: privacyCashClient.encryptionService,
      publicKey: tempKeypair.publicKey,
      recipient,
      keyBasePath: '/circuit2/transaction2',
      storage: getBrowserStorage(),
    });
    
    return result.tx;
  } catch (error: any) {
    console.error('Privacy pool withdraw error:', error);
    throw new Error(`Privacy pool withdraw failed: ${error.message}`);
  }
}

/**
 * Calculate delay between deposit and withdraw based on privacy level
 */
export function calculateDelayMs(numChunks: number): number {
  const MIN_CHUNKS = 2;
  const MAX_CHUNKS = 10;
  const MAX_DELAY_MS = 4 * 60 * 60 * 1000; // 4 hours
  
  if (numChunks <= MIN_CHUNKS) return 0;
  const totalDelay = ((numChunks - MIN_CHUNKS) / (MAX_CHUNKS - MIN_CHUNKS)) * MAX_DELAY_MS;
  return Math.floor(totalDelay / 2);
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
 * Sleep with countdown updates
 */
export async function sleepWithCountdown(
  ms: number,
  onUpdate: (remaining: string) => void
): Promise<void> {
  if (ms <= 0) return;
  
  const endTime = Date.now() + ms;
  
  while (Date.now() < endTime) {
    const remaining = endTime - Date.now();
    onUpdate(formatTime(remaining));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Generate random delays that sum to a target total
 * Used to distribute delays across multiple operations for privacy
 */
export function generateRandomDelays(totalMs: number, numDelays: number): number[] {
  if (numDelays === 0) return [];
  if (totalMs <= 0) return Array(numDelays).fill(0);
  
  // Generate random weights for each delay
  const weights: number[] = [];
  for (let i = 0; i < numDelays; i++) {
    weights.push(0.5 + Math.random()); // Random between 0.5 and 1.5
  }
  
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  // Distribute totalMs proportionally
  const delays = weights.map(w => Math.floor((w / totalWeight) * totalMs));
  
  // Adjust to ensure exact sum (due to rounding)
  const actualSum = delays.reduce((sum, d) => sum + d, 0);
  const diff = totalMs - actualSum;
  if (diff !== 0) {
    delays[0] += diff; // Add remainder to first delay
  }
  
  return delays;
}
