import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

/**
 * Generate a random word for session
 */
function generateRandomWord(): string {
  const words = [
    'apple', 'banana', 'cherry', 'dragon', 'elephant', 'forest', 'galaxy', 'harmony',
    'island', 'jungle', 'knight', 'lighthouse', 'mountain', 'nebula', 'ocean', 'planet',
    'quantum', 'rainbow', 'sunset', 'thunder', 'universe', 'volcano', 'waterfall', 'xylophone',
    'yesterday', 'zenith', 'alpha', 'beta', 'gamma', 'delta'
  ];
  const randomIndex = Math.floor(Math.random() * words.length);
  return words[randomIndex];
}

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

    // Generate random word
    const sessionWord = generateRandomWord();

    // Create session in database
    const { data, error } = await supabase
      .from('transaction_sessions')
      .insert({
        wallet_address: walletAddress,
        session_word: sessionWord,
        current_step: 1,
        status: 'pending',
        transaction_params: transactionParams,
        burner_addresses: [],
        signatures: [],
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      return NextResponse.json(
        { error: 'Failed to create session', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: data.id,
      word: sessionWord,
    });
  } catch (error: any) {
    console.error('Error in create session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
