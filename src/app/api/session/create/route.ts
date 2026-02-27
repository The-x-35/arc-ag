import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, transactionParams } = body;

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'walletAddress is required' },
        { status: 400 }
      );
    }

    if (!transactionParams) {
      return NextResponse.json(
        { error: 'transactionParams is required' },
        { status: 400 }
      );
    }

    // Create session in database; session_word will be set to the generated id
    const rows = await query<{
      id: string;
    }>(
      `
      INSERT INTO transaction_sessions (
        wallet_address,
        session_word,
        current_step,
        status,
        transaction_params,
        burner_addresses,
        signatures
      )
      VALUES ($1, '', 1, 'pending', $2::jsonb, '[]'::jsonb, '[]'::jsonb)
      RETURNING id
      `,
      [walletAddress, JSON.stringify(transactionParams)]
    );

    const created = rows[0];

    // Update session_word to be the session ID (fire-and-forget; not critical for client)
    if (created?.id) {
      query(
        `
        UPDATE transaction_sessions
        SET session_word = $1
        WHERE id = $1
        `,
        [created.id]
      ).catch((err) => {
        console.error('Error updating session_word for transaction_sessions:', err);
      });
    }

    return NextResponse.json({
      success: true,
      sessionId: created.id,
      word: created.id, // Session ID is the word
    });
  } catch (error: any) {
    console.error('Error in create session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
