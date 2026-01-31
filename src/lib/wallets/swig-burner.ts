import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  LAMPORTS_PER_SOL,
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

// Fee payer public key (used when sponsoring fees)
const FEE_PAYER_PUBKEY = new PublicKey('hciZb5onspShN7vhvGDANtavRp4ww3xMzfVECXo2BR4');

/**
 * Swig burner wallet info
 */
export interface SwigBurnerWallet {
  type: 'swig';
  evmPrivateKey: string;
  evmAddress: string;
  swigId: Uint8Array;
  swigAddress: PublicKey;
  walletAddress: PublicKey;
  swig: any;
}

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
  
  const message = `arc_ag_burner_wallet_${index}_${account.address}`;
  const signature = await account.signMessage({ message });
  const burnerKey = keccak256(toBytes(signature));
  return burnerKey;
}

/**
 * Get basic Swig info from ETH private key (without fetching from chain)
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
 * Ensure Swig wallet exists, create if not
 */
export async function ensureSwigWalletExists(
  connection: Connection,
  evmPrivateKey: string,
  sponsorFees: boolean,
  onStatus?: (msg: string) => void
): Promise<{ swigAddress: PublicKey; walletAddress: PublicKey; swig: any }> {
  const { swigId, evmAccount, formattedKey } = getSwigBasicInfo(evmPrivateKey);
  const swigAddress = await findSwigPda(swigId);
  
  try {
    // Try to fetch existing swig
    const swig = await fetchSwig(connection, swigAddress);
    const walletAddress = await getSwigSystemAddress(swig);
    return { swigAddress, walletAddress, swig };
  } catch (error: any) {
    // Swig doesn't exist, create it
    onStatus?.('Creating Swig wallet...');
    
    const authorityInfo = createSecp256k1AuthorityInfo(evmAccount.publicKey);
    const rootActions = Actions.set().all().get();
    
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const createSwigInstruction = await getCreateSwigInstruction({
      authorityInfo,
      id: swigId,
      payer: sponsorFees ? FEE_PAYER_PUBKEY : evmAccount.address as unknown as PublicKey,
      actions: rootActions,
    });
    
    const transaction = new Transaction();
    transaction.add(createSwigInstruction);
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sponsorFees ? FEE_PAYER_PUBKEY : evmAccount.address as unknown as PublicKey;
    
    if (sponsorFees) {
      // Sign with fee payer via API
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
    }
    
    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Fetch the created swig
    const swig = await fetchSwig(connection, swigAddress);
    const walletAddress = await getSwigSystemAddress(swig);
    
    return { swigAddress, walletAddress, swig };
  }
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
 * Deposit to Privacy Cash pool using Swig wallet
 */
export async function depositToPoolWithSwig(
  connection: Connection,
  swig: any,
  walletAddress: PublicKey,
  amountLamports: number,
  evmPrivateKey: string,
  tempIndex: number,
  updateStatus?: (msg: string) => void
): Promise<string> {
  throw new Error('depositToPoolWithSwig not implemented - Swig mode is disabled');
}

/**
 * Withdraw from Privacy Cash pool using Swig wallet
 */
export async function withdrawFromPool(
  connection: Connection,
  amountLamports: number,
  recipient: PublicKey,
  evmPrivateKey: string,
  tempIndex: number,
  updateStatus?: (msg: string) => void
): Promise<string> {
  throw new Error('withdrawFromPool not implemented - Swig mode is disabled');
}

/**
 * Create multiple Swig burner wallets
 */
export async function createSwigBurners(
  connection: Connection,
  mainPrivateKey: string,
  count: number,
  sponsorFees: boolean,
  onStatus?: (msg: string) => void
): Promise<SwigBurnerWallet[]> {
  const burners: SwigBurnerWallet[] = [];
  
  for (let i = 1; i <= count; i++) {
    onStatus?.(`Creating Swig burner ${i}/${count}...`);
    
    const burnerKey = await deriveBurnerPrivateKey(mainPrivateKey, i);
    const { evmAccount } = getSwigBasicInfo(burnerKey);
    
    const { swigAddress, walletAddress, swig } = await ensureSwigWalletExists(
      connection,
      burnerKey,
      sponsorFees,
      onStatus
    );
    
    burners.push({
      type: 'swig',
      evmPrivateKey: burnerKey,
      evmAddress: evmAccount.address,
      swigId: createDeterministicSwigId(evmAccount.address),
      swigAddress,
      walletAddress,
      swig,
    });
  }
  
  return burners;
}

/**
 * Transfer from Swig wallet to an address
 */
export async function transferFromSwig(
  connection: Connection,
  swig: any,
  walletAddress: PublicKey,
  recipient: PublicKey,
  amountLamports: number,
  evmPrivateKey: string,
  sponsorFees: boolean
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
      payer: sponsorFees ? FEE_PAYER_PUBKEY : walletAddress,
    }
  );
  
  const transaction = new Transaction();
  transaction.add(...signInstructions);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sponsorFees ? FEE_PAYER_PUBKEY : walletAddress;
  
  if (sponsorFees) {
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
  } else {
    // User pays - not implemented for frontend-only
    throw new Error('User-paid transactions require wallet connection');
  }
}
