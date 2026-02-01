import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { walletAddress: string } }
) {
  try {
    const { walletAddress } = params;

    // Get active session (pending or in_progress) for this wallet
    const { data, error } = await supabase
      .from('transaction_sessions')
      .select('*')
      .eq('wallet_address', walletAddress)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching session by wallet:', error);
      return NextResponse.json(
        { error: 'Failed to fetch session', details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({
        success: true,
        session: null,
      });
    }

    return NextResponse.json({
      success: true,
      session: data,
    });
  } catch (error: any) {
    console.error('Error in get session by wallet endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
