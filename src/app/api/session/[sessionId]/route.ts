import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/postgres';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;

    const rows = await query(
      `SELECT * FROM transaction_sessions WHERE id = $1`,
      [sessionId]
    );

    const data = rows[0];

    if (!data) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session: data,
    });
  } catch (error: any) {
    console.error('Error in get session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const updates = body;

    // Build dynamic update query from provided fields
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const setClauses: string[] = [];
    const values: any[] = [];

    keys.forEach((key, idx) => {
      setClauses.push(`${key} = $${idx + 1}`);
      values.push(
        ['transaction_params', 'burner_addresses', 'chunk_amounts', 'signatures', 'used_deposit_amounts'].includes(
          key
        )
          ? JSON.stringify(updates[key])
          : updates[key]
      );
    });

    values.push(sessionId);

    const rows = await query(
      `UPDATE transaction_sessions SET ${setClauses.join(', ')} WHERE id = $${
        keys.length + 1
      } RETURNING *`,
      values
    );

    const data = rows[0];

    if (!data) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      session: data,
    });
  } catch (error: any) {
    console.error('Error in update session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;

    await query(`DELETE FROM transaction_sessions WHERE id = $1`, [sessionId]);

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error('Error in delete session endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
