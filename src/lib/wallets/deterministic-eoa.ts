import { Keypair } from '@solana/web3.js';
import { keccak256, toBytes, hexToBytes } from 'viem';
import bs58 from 'bs58';

/**
 * Generate a deterministic Solana keypair from a signed hash and index
 * Uses keccak256 to hash the signed word + index + label
 * 
 * @param signedHash - Hash of the signed random word (hex string)
 * @param index - Index for the burner (0 = first burner, 1-N = intermediate, -1 = final)
 * @returns Deterministic Solana Keypair
 */
export function deriveEOAFromSignedHash(signedHash: string, index: number): Keypair {
  // Create unique seed: signedHash + index + label
  const label = index === 0 ? 'first_burner' : index === -1 ? 'final_burner' : `burner_${index}`;
  const seedData = `${signedHash}_${index}_${label}`;
  
  // Hash the seed data
  const seedBytes = toBytes(seedData);
  const hash = keccak256(seedBytes);
  
  // Convert hash to 64-byte seed for Solana Keypair
  // Solana keypairs need 64 bytes: 32 bytes private key + 32 bytes public key seed
  // We'll use the hash and extend it if needed
  const hashBytes = hexToBytes(hash);
  
  // If hash is 32 bytes, we need to extend to 64 bytes
  // Use the hash twice with different modifications
  const seed = new Uint8Array(64);
  seed.set(hashBytes.slice(0, 32), 0);
  
  // For the second 32 bytes, hash again with a modifier
  const secondHash = keccak256(toBytes(`${seedData}_second`));
  const secondHashBytes = hexToBytes(secondHash);
  seed.set(secondHashBytes.slice(0, 32), 32);
  
  // Generate keypair from seed
  return Keypair.fromSeed(seed.slice(0, 32));
}

/**
 * Generate all burner wallets deterministically from a signed hash
 * 
 * @param signedHash - Hash of the signed random word
 * @param numChunks - Number of chunks (determines number of intermediate burners)
 * @returns Object with all burner keypairs: { firstBurner, intermediateBurners, finalBurner }
 */
export function generateAllBurners(
  signedHash: string,
  numChunks: number
): {
  firstBurner: Keypair;
  intermediateBurners: Keypair[];
  finalBurner: Keypair;
} {
  // First burner (index 0)
  const firstBurner = deriveEOAFromSignedHash(signedHash, 0);
  
  // Intermediate burners (index 1 to numChunks)
  const intermediateBurners: Keypair[] = [];
  for (let i = 1; i <= numChunks; i++) {
    intermediateBurners.push(deriveEOAFromSignedHash(signedHash, i));
  }
  
  // Final burner (index -1)
  const finalBurner = deriveEOAFromSignedHash(signedHash, -1);
  
  return {
    firstBurner,
    intermediateBurners,
    finalBurner,
  };
}

/**
 * Get burner keypair by index from signed hash
 * 
 * @param signedHash - Hash of the signed random word
 * @param index - Burner index (0 = first, 1-N = intermediate, -1 = final)
 * @returns Keypair for the specified burner
 */
export function getBurnerByIndex(signedHash: string, index: number): Keypair {
  return deriveEOAFromSignedHash(signedHash, index);
}
