import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

export const dynamic = 'force-dynamic';

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
    const rows = await query<{ code: string; is_used: boolean }>(
      `
      SELECT code, is_used
      FROM invite_codes
      WHERE wallet_address = $1
        AND is_used = true
      LIMIT 1
      `,
      [walletAddress]
    );

    const data = rows[0];

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
