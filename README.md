# Arc Aggregator (arc-ag)

A privacy pool aggregator with plug-and-play architecture for routing SOL through privacy pools on Solana.

## Features

- **Plug-and-Play Pool Architecture**: Easily add new privacy pools by implementing the `PrivacyPool` interface
- **Transaction Indexing**: Queries on-chain historical transactions to match amounts for optimal privacy
- **Split Optimization**: Intelligently splits amounts across pools based on historical patterns
- **Dual Burner Types**:
  - **Swig PDA**: Deterministic smart wallets derived from your ETH key
  - **EOA Keypairs**: Standard Solana keypairs for more flexibility
- **Fee Sponsorship Toggle**: Backend pays fees or user pays
- **Key Display**: Shows all generated private keys and addresses for testing/recovery

## Architecture

```
User Input → Index Pools → Optimize Split → Generate Burners → Route Through Pools → Destination

Source Wallet → Pool Deposit → Burner Wallets → Pool Deposit → Final Withdraw → Destination
```

## Project Structure

```
arc-ag/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # Main UI
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   └── api/transaction/sign/        # Fee payer signing endpoint
│   ├── lib/
│   │   ├── pools/
│   │   │   ├── types.ts                 # PrivacyPool interface
│   │   │   ├── registry.ts              # Pool registry (plug-and-play)
│   │   │   └── privacy-cash/            # Privacy Cash adapter
│   │   ├── indexer/
│   │   │   └── transaction-indexer.ts   # On-chain indexer
│   │   ├── optimizer/
│   │   │   └── split-optimizer.ts       # Amount splitting logic
│   │   ├── wallets/
│   │   │   ├── swig-burner.ts           # Swig PDA burner wallets
│   │   │   └── eoa-burner.ts            # EOA keypair burners
│   │   ├── config/
│   │   │   ├── networks.ts              # RPC config
│   │   │   └── fee-payers.ts            # Fee payer config
│   │   └── utils/
│   │       └── solana.ts                # Helper utilities
│   ├── components/
│   │   ├── SendForm.tsx                 # Main form
│   │   ├── ProgressSteps.tsx            # Step progress display
│   │   ├── KeyDisplay.tsx               # Private key display
│   │   └── PoolSelector.tsx             # Pool selection UI
│   ├── hooks/
│   │   └── usePrivateSend.ts            # Main orchestration hook
│   └── types/
│       └── index.ts                     # TypeScript types
├── public/
│   ├── circuit2/                        # ZK circuits (from Privacy Cash)
│   └── wasm/                            # WASM files (from Privacy Cash)
└── lib/                                 # Node polyfills for browser
```

## Adding a New Pool

1. Implement the `PrivacyPool` interface:

```typescript
import { PrivacyPool } from '@/lib/pools/types';

export const myNewPool: PrivacyPool = {
  id: 'my-pool',
  name: 'My Pool',
  description: 'My privacy pool',
  programId: new PublicKey('...'),
  
  supportedTokens: ['SOL'],
  minAmount: 0.001 * LAMPORTS_PER_SOL,
  maxAmount: 100 * LAMPORTS_PER_SOL,
  
  async getHistoricalAmounts(connection, limit) {
    // Query on-chain history
    return [];
  },
  
  async deposit(params) {
    // Deposit implementation
    return { signature: '...', success: true };
  },
  
  async withdraw(params) {
    // Withdraw implementation
    return { signature: '...', success: true };
  },
};
```

2. Register the pool:

```typescript
import { poolRegistry } from '@/lib/pools/registry';
import { myNewPool } from './my-pool';

poolRegistry.register(myNewPool);
```

## Environment Variables

```env
# Fee payer for sponsored transactions
SOLANA_MAINNET_FEE_PAYER_PRIVATE_KEY=your_base58_private_key

# Optional: Custom RPC
NEXT_PUBLIC_SOLANA_MAINNET_RPC=https://your-rpc-url
```

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The app runs on port 3001 by default (to avoid conflicts with other services).

## Flow

1. **User Input**: Enter ETH private key, destination address, amount
2. **Pool Indexing**: Query historical transactions from all registered pools
3. **Split Optimization**: Match user amount to historical amounts for better privacy
4. **Burner Creation**: Generate deterministic burner wallets (Swig or EOA)
5. **Deposit to Pool**: Source wallet deposits to privacy pool
6. **Route Through Burners**: Funds are withdrawn to burners, then re-deposited
7. **Final Withdraw**: Pool withdraws to final destination address

## Security Notes

- Private keys are displayed for testing purposes only
- All burner wallets are deterministically derived from your main ETH key
- Funds can be recovered using the displayed keys
- Fee sponsorship uses a backend wallet - ensure it has sufficient balance

## License

ISC
