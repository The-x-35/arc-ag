import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

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

    // Create session in database (session_word will be set to session ID after creation)
    const { data, error } = await supabase
      .from('transaction_sessions')
      .insert({
        wallet_address: walletAddress,
        session_word: '', // Temporary, will update with session ID
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

    // Update session_word to be the session ID
    const { error: updateError } = await supabase
      .from('transaction_sessions')
      .update({ session_word: data.id })
      .eq('id', data.id);

    if (updateError) {
      console.error('Error updating session word:', updateError);
      // Continue anyway, session was created
    }

    return NextResponse.json({
      success: true,
      sessionId: data.id,
      word: data.id, // Session ID is the word
    });
  } catch (error: any) {
    console.error('Error in create session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
