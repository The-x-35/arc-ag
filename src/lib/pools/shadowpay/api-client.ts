/**
 * ShadowPay API Client
 * HTTP client for interacting with ShadowPay escrow API
 */

import { PublicKey } from '@solana/web3.js';
import { getShadowPayApiUrl, getShadowPayHeaders, isShadowPayConfigured } from '@/lib/config/shadowpay';

export interface ShadowPayDepositRequest {
  wallet_address: string;
  amount: number; // lamports
  treasury_wallet?: string;
}

export interface ShadowPayWithdrawRequest {
  wallet_address: string;
  recipient: string;
  amount: number; // lamports
}

export interface ShadowPayBalanceResponse {
  balance: number; // lamports
  wallet: string;
}

export interface ShadowPayApiResponse {
  success: boolean;
  signature?: string;
  transaction?: string;
  error?: string;
  message?: string;
}

/**
 * ShadowPay API Client
 */
export class ShadowPayApiClient {
  private baseUrl: string;
  
  constructor() {
    this.baseUrl = getShadowPayApiUrl();
  }
  
  /**
   * Check if API is configured
   */
  isConfigured(): boolean {
    return isShadowPayConfigured();
  }
  
  /**
   * Make API request with error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('ShadowPay API key not configured. Set SHADOWPAY_API_KEY environment variable.');
    }
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      ...getShadowPayHeaders(),
      ...options.headers,
    };
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `ShadowPay API error: ${response.status} ${response.statusText}`;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      return data as T;
    } catch (error: any) {
      if (error.message) {
        throw error;
      }
      throw new Error(`ShadowPay API request failed: ${error.message || 'Unknown error'}`);
    }
  }
  
  /**
   * Deposit SOL to ShadowPay escrow
   */
  async deposit(
    walletAddress: PublicKey | string,
    amount: number,
    treasuryWallet?: PublicKey | string
  ): Promise<ShadowPayApiResponse> {
    const walletAddr = typeof walletAddress === 'string' 
      ? walletAddress 
      : walletAddress.toBase58();
    
    const treasuryAddr = treasuryWallet 
      ? (typeof treasuryWallet === 'string' ? treasuryWallet : treasuryWallet.toBase58())
      : undefined;
    
    const body: ShadowPayDepositRequest = {
      wallet_address: walletAddr,
      amount,
      ...(treasuryAddr && { treasury_wallet: treasuryAddr }),
    };
    
    return this.request<ShadowPayApiResponse>('/api/escrow/deposit', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  
  /**
   * Withdraw SOL from ShadowPay escrow
   */
  async withdraw(
    walletAddress: PublicKey | string,
    recipient: PublicKey | string,
    amount: number
  ): Promise<ShadowPayApiResponse> {
    const walletAddr = typeof walletAddress === 'string' 
      ? walletAddress 
      : walletAddress.toBase58();
    
    const recipientAddr = typeof recipient === 'string' 
      ? recipient 
      : recipient.toBase58();
    
    const body: ShadowPayWithdrawRequest = {
      wallet_address: walletAddr,
      recipient: recipientAddr,
      amount,
    };
    
    return this.request<ShadowPayApiResponse>('/api/escrow/withdraw', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  
  /**
   * Get SOL escrow balance for a wallet
   */
  async getBalance(walletAddress: PublicKey | string): Promise<ShadowPayBalanceResponse> {
    const walletAddr = typeof walletAddress === 'string' 
      ? walletAddress 
      : walletAddress.toBase58();
    
    return this.request<ShadowPayBalanceResponse>(`/api/escrow/balance/${walletAddr}`, {
      method: 'GET',
    });
  }
  
  /**
   * Get SPL token escrow balance for a wallet
   */
  async getTokenBalance(
    walletAddress: PublicKey | string,
    mint: PublicKey | string
  ): Promise<ShadowPayBalanceResponse> {
    const walletAddr = typeof walletAddress === 'string' 
      ? walletAddress 
      : walletAddress.toBase58();
    
    const mintAddr = typeof mint === 'string' ? mint : mint.toBase58();
    
    return this.request<ShadowPayBalanceResponse>(`/api/escrow/balance-token/${walletAddr}/${mintAddr}`, {
      method: 'GET',
    });
  }
}

// Singleton instance
export const shadowPayApiClient = new ShadowPayApiClient();
