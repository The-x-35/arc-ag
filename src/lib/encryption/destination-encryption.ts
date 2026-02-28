import { keccak256, toBytes, hexToBytes } from 'viem';

/**
 * Derive a 32-byte AES-256 key from signedHash
 * Uses keccak256 with a unique label to ensure different keys for different purposes
 */
function deriveEncryptionKey(signedHash: string, label: string = 'destination_encryption_key'): ArrayBuffer {
  const keyMaterial = keccak256(toBytes(`${signedHash}_${label}`));
  const keyBytes = hexToBytes(keyMaterial);
  // Create a new Uint8Array with a proper ArrayBuffer for AES-256
  const keyBuffer = new Uint8Array(32);
  keyBuffer.set(keyBytes.slice(0, 32));
  return keyBuffer.buffer;
}

/**
 * Encrypt destination address using AES-256-GCM
 * @param destination - Plain text destination address
 * @param signedHash - Hash of the signed session ID
 * @returns Base64-encoded encrypted data (IV + ciphertext + auth tag)
 */
export async function encryptDestination(
  destination: string,
  signedHash: string
): Promise<string> {
  const key = deriveEncryptionKey(signedHash, 'destination_encryption_key');
  
  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Import key for Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Encrypt
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(destination);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    cryptoKey,
    plaintext
  );
  
  // Combine IV + ciphertext (GCM auth tag is appended automatically)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  // Convert to base64 for storage
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt destination address using AES-256-GCM
 * @param encryptedDestination - Base64-encoded encrypted data
 * @param signedHash - Hash of the signed session ID
 * @returns Plain text destination address
 */
export async function decryptDestination(
  encryptedDestination: string,
  signedHash: string
): Promise<string> {
  try {
    const key = deriveEncryptionKey(signedHash, 'destination_encryption_key');
    
    // Decode from base64
    let combined: Uint8Array;
    try {
      combined = Uint8Array.from(atob(encryptedDestination), c => c.charCodeAt(0));
    } catch (err) {
      throw new Error(`Invalid base64 encrypted destination: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    if (combined.length < 12) {
      throw new Error('Encrypted destination too short (missing IV)');
    }
    
    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Import key for Web Crypto API
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      cryptoKey,
      ciphertext
    );
    
    // Convert to string
    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Decryption failed: ${err.message}`);
    }
    throw new Error(`Decryption failed: ${String(err)}`);
  }
}

/**
 * Encrypt amount using AES-256-GCM
 * @param amount - Plain text amount (number as string)
 * @param signedHash - Hash of the signed session ID
 * @returns Base64-encoded encrypted data
 */
export async function encryptAmount(
  amount: number,
  signedHash: string
): Promise<string> {
  const key = deriveEncryptionKey(signedHash, 'amount_encryption_key');
  const amountStr = amount.toString();
  
  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // Import key for Web Crypto API
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  // Encrypt
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(amountStr);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    cryptoKey,
    plaintext
  );
  
  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  // Convert to base64 for storage
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt amount using AES-256-GCM
 * @param encryptedAmount - Base64-encoded encrypted data
 * @param signedHash - Hash of the signed session ID
 * @returns Plain text amount (as number)
 */
export async function decryptAmount(
  encryptedAmount: string,
  signedHash: string
): Promise<number> {
  try {
    const key = deriveEncryptionKey(signedHash, 'amount_encryption_key');
    
    // Decode from base64
    let combined: Uint8Array;
    try {
      combined = Uint8Array.from(atob(encryptedAmount), c => c.charCodeAt(0));
    } catch (err) {
      throw new Error(`Invalid base64 encrypted amount: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    if (combined.length < 12) {
      throw new Error('Encrypted amount too short (missing IV)');
    }
    
    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Import key for Web Crypto API
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    // Decrypt
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      cryptoKey,
      ciphertext
    );
    
    // Convert to string then number
    const decoder = new TextDecoder();
    const amountStr = decoder.decode(plaintext);
    return parseFloat(amountStr);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Amount decryption failed: ${err.message}`);
    }
    throw new Error(`Amount decryption failed: ${String(err)}`);
  }
}

/**
 * Check if a string is a valid UUID format
 */
export function isUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
