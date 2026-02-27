import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

export async function GET(
  request: NextRequest,
  { params }: { params: { walletAddress: string } }
) {
  try {
    const { walletAddress } = params;
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : undefined; // No limit by default
    const status = searchParams.get('status'); // Optional filter by status

    const values: any[] = [walletAddress];
    const conditions: string[] = ['wallet_address = $1'];

    if (status) {
      conditions.push(`status = $${values.length + 1}`);
      values.push(status);
    }

    let sql = `
      SELECT *
      FROM transaction_sessions
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
    `;

    if (limit !== undefined && limit > 0) {
      sql += ` LIMIT ${limit}`;
    }

    const data = await query(sql, values);

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
