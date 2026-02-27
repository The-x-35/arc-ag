import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

/**
 * Validate invite code format (6 characters, A-Z0-9, uppercase)
 */
function isValidCodeFormat(code: string): boolean {
  if (!code || code.length !== 6) {
    return false;
  }
  return /^[A-Z0-9]{6}$/.test(code);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, walletAddress } = body;

    // Validate input
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invite code is required' },
        { status: 400 }
      );
    }

    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase().trim();

    // Validate code format
    if (!isValidCodeFormat(normalizedCode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid code format. Code must be exactly 6 characters (A-Z, 0-9)' },
        { status: 400 }
      );
    }

    // Check if code exists and get current state
    const inviteRows = await query<any>(
      `SELECT * FROM invite_codes WHERE code = $1 LIMIT 1`,
      [normalizedCode]
    );

    const inviteCode = inviteRows[0];

    if (!inviteCode) {
      return NextResponse.json(
        { success: false, error: 'Code not found' },
        { status: 404 }
      );
    }

    // Check if code is already used
    if (inviteCode.is_used) {
      return NextResponse.json(
        { success: false, error: 'Code already used' },
        { status: 400 }
      );
    }

    // Check if wallet already has a code
    const existingWalletRows = await query<{ code: string }>(
      `
      SELECT code
      FROM invite_codes
      WHERE wallet_address = $1
        AND is_used = true
      LIMIT 1
      `,
      [walletAddress]
    );

    if (existingWalletRows[0]) {
      return NextResponse.json(
        { success: false, error: 'This wallet already has an invite code' },
        { status: 400 }
      );
    }

    // Claim the code: update with wallet address and mark as used,
    // only if it is still unused
    const updatedRows = await query(
      `
      UPDATE invite_codes
      SET wallet_address = $1,
          is_used = true,
          used_at = NOW()
      WHERE code = $2
        AND is_used = false
      RETURNING *
      `,
      [walletAddress, normalizedCode]
    );

    if (!updatedRows[0]) {
      // Code was claimed between our check and update
      return NextResponse.json(
        { success: false, error: 'Code was already claimed' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Invite code validated and claimed successfully'
    });

  } catch (error: any) {
    console.error('Error in invite code validation:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
