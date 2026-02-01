import { useCallback } from 'react';
import { TransactionSession } from '@/lib/db/supabase';
import { WalletPrivateSendParams } from './useWalletPrivateSend';

export interface SessionData extends TransactionSession {}

export function useSessionRecovery() {
  /**
   * Create a new session
   */
  const createSession = useCallback(async (
    walletAddress: string,
    params: WalletPrivateSendParams
  ): Promise<{ sessionId: string; word: string }> => {
    const response = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        transactionParams: {
          destination: params.destination,
          amount: params.amount,
          numChunks: params.numChunks,
          delayMinutes: params.delayMinutes,
          exactChunks: params.exactChunks,
          selectedPools: params.selectedPools,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create session');
    }

    const data = await response.json();
    return {
      sessionId: data.sessionId,
      word: data.word,
    };
  }, []);

  /**
   * Get session by ID
   */
  const getSession = useCallback(async (sessionId: string): Promise<SessionData> => {
    const response = await fetch(`/api/session/${sessionId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get session');
    }

    const data = await response.json();
    return data.session;
  }, []);

  /**
   * Update session state
   */
  const updateSession = useCallback(async (
    sessionId: string,
    updates: Partial<SessionData>
  ): Promise<void> => {
    const response = await fetch(`/api/session/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update session');
    }
  }, []);

  /**
   * Recover active session for a wallet
   */
  const recoverSession = useCallback(async (
    walletAddress: string
  ): Promise<SessionData | null> => {
    const response = await fetch(`/api/session/wallet/${walletAddress}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to recover session');
    }

    const data = await response.json();
    return data.session || null;
  }, []);

  /**
   * Delete session
   */
  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    const response = await fetch(`/api/session/${sessionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete session');
    }
  }, []);

  /**
   * Get all sessions for a wallet (history)
   */
  const getSessionHistory = useCallback(async (
    walletAddress: string,
    options?: { limit?: number; status?: 'pending' | 'in_progress' | 'completed' | 'failed' }
  ): Promise<SessionData[]> => {
    const params = new URLSearchParams();
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.status) {
      params.append('status', options.status);
    }

    const queryString = params.toString();
    const url = `/api/session/wallet/${walletAddress}/history${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get session history');
    }

    const data = await response.json();
    return data.sessions || [];
  }, []);

  return {
    createSession,
    getSession,
    updateSession,
    recoverSession,
    deleteSession,
    getSessionHistory,
  };
}
