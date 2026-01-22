import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toBytes, hexToBytes } from 'viem';
import bs58 from 'bs58';

// Fee payer public key (used when sponsoring fees)
const FEE_PAYER_PUBKEY = new PublicKey('hciZb5onspShN7vhvGDANtavRp4ww3xMzfVECXo2BR4');

/**
 * EOA burner wallet info
 */
export interface EOABurnerWallet {
  type: 'eoa';
  keypair: Keypair;
  publicKey: PublicKey;
  privateKey: string; // base58 encoded
  address: string;
}

/**
 * Derive a deterministic Solana keypair from an ETH private key and index
 */
export async function deriveEOAKeypair(mainPrivateKey: string, index: number): Promise<Keypair> {
  const formattedKey = mainPrivateKey.startsWith('0x') ? mainPrivateKey : `0x${mainPrivateKey}`;
  const account = privateKeyToAccount(formattedKey as `0x${string}`);
  
  // Create deterministic seed by signing a unique message
  const message = `arc_ag_eoa_burner_${index}_${account.address}`;
  const signature = await account.signMessage({ message });
  
  // Hash the signature to get 32 bytes for Solana keypair seed
  const seed = keccak256(toBytes(signature));
  const seedBytes = hexToBytes(seed);
  
  return Keypair.fromSeed(seedBytes);
}

/**
 * Generate a random EOA keypair (non-deterministic)
 */
export function generateRandomEOAKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * Create multiple EOA burner wallets
 */
export async function createEOABurners(
  mainPrivateKey: string,
  count: number,
  onStatus?: (msg: string) => void
): Promise<EOABurnerWallet[]> {
  const burners: EOABurnerWallet[] = [];
  
  for (let i = 1; i <= count; i++) {
    onStatus?.(`Generating EOA burner ${i}/${count}...`);
    
    const keypair = await deriveEOAKeypair(mainPrivateKey, i);
    const privateKeyBase58 = bs58.encode(keypair.secretKey);
    
    burners.push({
      type: 'eoa',
      keypair,
      publicKey: keypair.publicKey,
      privateKey: privateKeyBase58,
      address: keypair.publicKey.toBase58(),
    });
  }
  
  return burners;
}

/**
 * Fund an EOA burner from source wallet
 */
export async function fundEOABurner(
  connection: Connection,
  sourceKeypair: Keypair,
  recipientPublicKey: PublicKey,
  amountLamports: number,
  sponsorFees: boolean
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: sourceKeypair.publicKey,
    toPubkey: recipientPublicKey,
    lamports: amountLamports,
  });
  
  const transaction = new Transaction();
  transaction.add(transferInstruction);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sponsorFees ? FEE_PAYER_PUBKEY : sourceKeypair.publicKey;
  
  if (sponsorFees) {
    // Partially sign with source keypair
    transaction.partialSign(sourceKeypair);
    
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
    // User pays fees
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sourceKeypair],
      { commitment: 'confirmed' }
    );
    
    return signature;
  }
}

/**
 * Transfer from EOA burner to recipient
 */
export async function transferFromEOA(
  connection: Connection,
  burnerKeypair: Keypair,
  recipient: PublicKey,
  amountLamports: number,
  sponsorFees: boolean
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: burnerKeypair.publicKey,
    toPubkey: recipient,
    lamports: amountLamports,
  });
  
  const transaction = new Transaction();
  transaction.add(transferInstruction);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sponsorFees ? FEE_PAYER_PUBKEY : burnerKeypair.publicKey;
  
  if (sponsorFees) {
    // Partially sign with burner keypair
    transaction.partialSign(burnerKeypair);
    
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
    // Burner pays fees
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [burnerKeypair],
      { commitment: 'confirmed' }
    );
    
    return signature;
  }
}

/**
 * Get balance of an EOA wallet
 */
export async function getEOABalance(
  connection: Connection,
  publicKey: PublicKey
): Promise<number> {
  return await connection.getBalance(publicKey);
}

/**
 * Format keypair info for display (testing purposes)
 */
export function formatEOAForDisplay(burner: EOABurnerWallet): {
  address: string;
  privateKey: string;
  explorerUrl: string;
} {
  return {
    address: burner.address,
    privateKey: burner.privateKey,
    explorerUrl: `https://solscan.io/account/${burner.address}`,
  };
}
