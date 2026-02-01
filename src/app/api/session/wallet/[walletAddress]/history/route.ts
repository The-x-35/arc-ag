import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { walletAddress: string } }
) {
  try {
    const { walletAddress } = params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const status = searchParams.get('status'); // Optional filter by status

    let query = supabase
      .from('transaction_sessions')
      .select('*')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching session history:', error);
      return NextResponse.json(
        { error: 'Failed to fetch session history', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sessions: data || [],
      count: data?.length || 0,
    });
  } catch (error: any) {
    console.error('Error in get session history endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
