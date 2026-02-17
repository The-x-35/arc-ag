import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const walletAddress = searchParams.get('walletAddress');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // Check if wallet has a used invite code
    const { data, error } = await supabase
      .from('invite_codes')
      .select('code, is_used')
      .eq('wallet_address', walletAddress)
      .eq('is_used', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking invite code:', error);
      return NextResponse.json(
        { error: 'Failed to check invite code', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      hasInviteCode: !!data && data.is_used
    });

  } catch (error: any) {
    console.error('Error in invite check endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
