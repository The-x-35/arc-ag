import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { sessionId } = params;

    const { data, error } = await supabase
      .from('transaction_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 404 }
        );
      }
      console.error('Error fetching session:', error);
      return NextResponse.json(
        { error: 'Failed to fetch session', details: error.message },
        { status: 500 }
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

    const { data, error } = await supabase
      .from('transaction_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Error updating session:', error);
      return NextResponse.json(
        { error: 'Failed to update session', details: error.message },
        { status: 500 }
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

    const { error } = await supabase
      .from('transaction_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) {
      console.error('Error deleting session:', error);
      return NextResponse.json(
        { error: 'Failed to delete session', details: error.message },
        { status: 500 }
      );
    }

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
