// Types describing the Postgres rows for convenience in the app

export interface TransactionSession {
  id: string;
  wallet_address: string;
  session_word: string;
  current_step: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  transaction_params: {
    destination: string;
    amount: number;
    numChunks: number;
    delayMinutes: number;
    exactChunks?: number[];
    selectedPools?: string[];
  };
  burner_addresses: Array<{
    index: number;
    address: string;
    type: 'eoa';
  }>;
  chunk_amounts?: number[];
  signatures?: string[];
  used_deposit_amounts?: number[];
  created_at: string;
  updated_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  wallet_address: string | null;
  is_used: boolean;
  used_at: string | null;
  created_at: string;
}
