import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
