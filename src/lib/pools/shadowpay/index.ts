/**
 * ShadowPay Pool Adapter
 * Implements the PrivacyPool interface for ShadowPay escrow system
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { PrivacyPool, DepositParams, WithdrawParams, PoolOperationResult } from '../types';
import { shadowPayApiClient } from './api-client';
import { getShadowPayProgramId, getHistoricalDepositAmounts } from './onchain';

// ShadowPay escrow program ID (will use actual program ID when available)
const SHADOWPAY_PROGRAM_ID = getShadowPayProgramId();

/**
 * ShadowPay Pool Adapter
 * Implements the PrivacyPool interface for ShadowPay protocol
 */
export const shadowPayPool: PrivacyPool = {
  id: 'shadowpay',
  name: 'ShadowPay',
  description: 'Privacy pool using RADR escrow system for SOL on Solana',
  programId: SHADOWPAY_PROGRAM_ID,
  
  supportedTokens: ['SOL'],
  minAmount: 0.001 * LAMPORTS_PER_SOL, // 0.001 SOL minimum (adjust based on actual limits)
  maxAmount: 100 * LAMPORTS_PER_SOL, // 100 SOL maximum (adjust based on actual limits)
  
  /**
   * Get historical deposit amounts from ShadowPay
   * Queries on-chain data to find past deposit transactions
   */
  async getHistoricalAmounts(connection: Connection, limit: number = 100): Promise<number[]> {
    try {
      const amounts = await getHistoricalDepositAmounts(connection, limit);
      return amounts;
    } catch (error) {
      console.error('[ShadowPay] Error getting historical amounts:', error);
      return [];
    }
  },
  
  /**
   * Deposit to ShadowPay escrow pool
   */
  async deposit(params: DepositParams): Promise<PoolOperationResult> {
    const { connection, amount, publicKey } = params;
    
    // Check if API is configured
    if (!shadowPayApiClient.isConfigured()) {
      return {
        signature: '',
        success: false,
        error: 'ShadowPay API key not configured. Set SHADOWPAY_API_KEY environment variable.',
      };
    }
    
    try {
      // Call ShadowPay API to deposit
      const result = await shadowPayApiClient.deposit(publicKey, amount);
      
      if (result.success && result.signature) {
        return {
          signature: result.signature,
          success: true,
        };
      } else {
        return {
          signature: result.transaction || '',
          success: false,
          error: result.error || result.message || 'Deposit failed',
        };
      }
    } catch (error: any) {
      console.error('[ShadowPay] Deposit error:', error);
      return {
        signature: '',
        success: false,
        error: error.message || 'Deposit failed',
      };
    }
  },
  
  /**
   * Withdraw from ShadowPay escrow pool
   */
  async withdraw(params: WithdrawParams): Promise<PoolOperationResult> {
    const { connection, amount, publicKey, recipient } = params;
    
    // Check if API is configured
    if (!shadowPayApiClient.isConfigured()) {
      return {
        signature: '',
        success: false,
        error: 'ShadowPay API key not configured. Set SHADOWPAY_API_KEY environment variable.',
      };
    }
    
    try {
      // Call ShadowPay API to withdraw
      const result = await shadowPayApiClient.withdraw(publicKey, recipient, amount);
      
      if (result.success && result.signature) {
        return {
          signature: result.signature,
          success: true,
        };
      } else {
        return {
          signature: result.transaction || '',
          success: false,
          error: result.error || result.message || 'Withdraw failed',
        };
      }
    } catch (error: any) {
      console.error('[ShadowPay] Withdraw error:', error);
      return {
        signature: '',
        success: false,
        error: error.message || 'Withdraw failed',
      };
    }
  },
  
  /**
   * Get private balance from ShadowPay escrow
   */
  async getPrivateBalance(
    publicKey: PublicKey,
    connection: Connection,
    storage: Storage
  ): Promise<number> {
    // Check if API is configured
    if (!shadowPayApiClient.isConfigured()) {
      console.warn('[ShadowPay] API not configured, cannot get balance');
      return 0;
    }
    
    try {
      const balanceResponse = await shadowPayApiClient.getBalance(publicKey);
      return balanceResponse.balance || 0;
    } catch (error) {
      console.error('[ShadowPay] Error getting balance:', error);
      return 0;
    }
  },
  
  /**
   * Check if ShadowPay is available
   */
  async isAvailable(connection: Connection): Promise<boolean> {
    try {
      // Check if program exists on-chain
      const programInfo = await connection.getAccountInfo(SHADOWPAY_PROGRAM_ID);
      
      // Also check if API is configured (for operations)
      const apiConfigured = shadowPayApiClient.isConfigured();
      
      // Pool is available if program exists (even if API not configured, can still query)
      return programInfo !== null;
    } catch (error) {
      console.error('[ShadowPay] Error checking availability:', error);
      return false;
    }
  },
};

export default shadowPayPool;
