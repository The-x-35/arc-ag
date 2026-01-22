import { NextRequest, NextResponse } from 'next/server';
import { Transaction, Connection, sendAndConfirmTransaction } from '@solana/web3.js';
import { getFeePayer } from '@/lib/config/fee-payers';
import { getSolanaRpc, Network } from '@/lib/config/networks';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      transactionBase64,
      network = 'mainnet',
    } = body;

    console.log('\n=== TRANSACTION SIGN REQUEST ===');
    console.log('network:', network);
    console.log('has transactionBase64:', !!transactionBase64);

    if (!transactionBase64) {
      console.error('Missing transactionBase64');
      return NextResponse.json(
        { success: false, error: 'Transaction is required' },
        { status: 400 }
      );
    }

    // Get fee payer for the network
    const feePayer = getFeePayer(network as Network);
    if (!feePayer) {
      return NextResponse.json(
        { success: false, error: `Fee payer not configured for ${network}` },
        { status: 500 }
      );
    }

    // Get Solana connection
    const rpcUrl = getSolanaRpc(network as Network);
    const connection = new Connection(rpcUrl, 'confirmed');

    console.log('Deserializing transaction...');
    const transaction = Transaction.from(Buffer.from(transactionBase64, 'base64'));

    // Get fresh blockhash
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // Update blockhash and fee payer
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = feePayer.solanaKeypair.publicKey;

    // Sign and send transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [feePayer.solanaKeypair],
      { commitment: 'confirmed' }
    );

    console.log('Transaction confirmed:', signature);

    return NextResponse.json({
      success: true,
      data: {
        signature,
        explorerUrl: `https://solscan.io/tx/${signature}`,
      },
    });
  } catch (error: any) {
    console.error('Error signing transaction:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to sign transaction',
      },
      { status: 500 }
    );
  }
}
