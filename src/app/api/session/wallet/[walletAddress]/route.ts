import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

export async function GET(
  request: NextRequest,
  { params }: { params: { walletAddress: string } }
) {
  try {
    const { walletAddress } = params;

    // Get active session (pending or in_progress) for this wallet
    const rows = await query(
      `
      SELECT *
      FROM transaction_sessions
      WHERE wallet_address = $1
        AND status IN ('pending', 'in_progress')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [walletAddress]
    );

    const data = rows[0];

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
