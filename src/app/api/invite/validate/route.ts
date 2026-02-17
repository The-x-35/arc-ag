import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

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
    const { data: inviteCode, error: fetchError } = await supabase
      .from('invite_codes')
      .select('*')
      .eq('code', normalizedCode)
      .single();

    if (fetchError || !inviteCode) {
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
    const { data: existingWalletCode } = await supabase
      .from('invite_codes')
      .select('code')
      .eq('wallet_address', walletAddress)
      .eq('is_used', true)
      .single();

    if (existingWalletCode) {
      return NextResponse.json(
        { success: false, error: 'This wallet already has an invite code' },
        { status: 400 }
      );
    }

    // Claim the code: update with wallet address and mark as used
    // Use a transaction-like approach by checking is_used again in the update
    const { data: updatedCode, error: updateError } = await supabase
      .from('invite_codes')
      .update({
        wallet_address: walletAddress,
        is_used: true,
        used_at: new Date().toISOString()
      })
      .eq('code', normalizedCode)
      .eq('is_used', false) // Only update if still unused (atomic check)
      .select()
      .single();

    if (updateError || !updatedCode) {
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
