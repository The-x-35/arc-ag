-- Create transaction_sessions table
CREATE TABLE IF NOT EXISTS transaction_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  session_word TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  transaction_params JSONB NOT NULL,
  burner_addresses JSONB DEFAULT '[]'::jsonb,
  chunk_amounts JSONB,
  signatures JSONB DEFAULT '[]'::jsonb,
  used_deposit_amounts JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on wallet_address for fast lookups
CREATE INDEX IF NOT EXISTS idx_transaction_sessions_wallet_address ON transaction_sessions(wallet_address);

-- Create index on status for filtering active sessions
CREATE INDEX IF NOT EXISTS idx_transaction_sessions_status ON transaction_sessions(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_transaction_sessions_updated_at
  BEFORE UPDATE ON transaction_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE transaction_sessions ENABLE ROW LEVEL SECURITY;

-- Create policy: Users can only access their own sessions
CREATE POLICY "Users can view their own sessions"
  ON transaction_sessions
  FOR SELECT
  USING (true); -- For now, allow all reads (can be restricted later with auth)

CREATE POLICY "Users can insert their own sessions"
  ON transaction_sessions
  FOR INSERT
  WITH CHECK (true); -- For now, allow all inserts

CREATE POLICY "Users can update their own sessions"
  ON transaction_sessions
  FOR UPDATE
  USING (true); -- For now, allow all updates

CREATE POLICY "Users can delete their own sessions"
  ON transaction_sessions
  FOR DELETE
  USING (true); -- For now, allow all deletes
