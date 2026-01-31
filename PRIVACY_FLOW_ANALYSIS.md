PRIVACY POOL TRANSACTION FLOW AND ATTACK ANALYSIS

TRANSACTION FLOW

The system executes 13 steps:

1. Validate inputs: Check wallet connection, destination address, amount
2. Generate first burner: Create EOA keypair (first burner wallet)
3. Send to first burner: User transfers total amount plus fee buffers to first burner
4. First burner deposits to pool: Deposits funds in chunks (2-10 chunks) using exact historical amounts, with random delays between deposits
5. Wait for indexing: System waits ~10 seconds for UTXOs to be indexed on-chain
6. Privacy delay: Optional randomized delay 0-4 hours distributed across stages
7. Generate intermediate burners: Create N EOA keypairs where N equals number of chunks
8. Generate final burner: Create final EOA keypair for consolidation
9. Withdraw to burners: Withdraw funds from pool to intermediate burners matching original chunk amounts, with random delays
10. Re-deposit from burners: Each intermediate burner re-deposits to pool. Intermediate burner signs and pays fees, but UTXOs are encrypted with final burner's encryption service, so final burner controls them
11. Wait for indexing: System waits ~10 seconds for re-deposit UTXOs to be indexed
12. Final burner withdraws: Final burner withdraws all accumulated funds. Attempts 2-3 chunk pattern matching historical withdrawals, falls back to single withdrawal if no pattern found
13. Final burner sends to destination: Simple Solana SystemProgram.transfer to destination address

CURRENT ARCHITECTURE

The system routes funds through Privacy Cash pools and burner wallets to break linkability between source and destination.

Key mechanisms:
- Historical amount matching: Uses exact amounts from previous pool transactions
- Multiple hops: Funds pass through first burner, pool, intermediate burners, pool again, final burner
- UTXO control transfer: Intermediate burners sign re-deposits but final burner controls the UTXOs
- Buffer management: Each burner reserves 1.5M lamports for rent plus 2M lamports for deposit overhead (total 3.5M lamports per burner)

Observed patterns:
- First burner leaves ~0.00217 SOL
- Intermediate burners leave ~0.00158 SOL each

HOW TO ATTACK

Step 1: Enumerate pool transactions

Query all Privacy Cash pool transactions. Example scale: 100,000 total transactions. Extract transaction signatures, amounts, timestamps, and involved accounts.

Step 2: Identify burner wallets

Filter for wallets matching burner patterns:
- Wallets with 2-3 transactions total
- Wallets that receive funds, deposit to pool, then become inactive
- Wallets with leftover balances around 0.0015-0.002 SOL
- Wallets created within short time windows
- Wallets that deposit and withdraw similar amounts

Expected: ~10,000 burner transactions out of 100,000 total (10%)

Step 3: Pair transactions

For each burner wallet:
- Find deposit transaction D with amount A at time T1
- Find withdrawal transaction W with amount approximately A at time T2
- If |T2 - T1| < MAX_DELAY_WINDOW, create pair (D, W, burner, A)

Source wallet correlation:
- Group burners that received funds from the same source wallet
- If multiple burners received from source S, they likely share the same destination
- Track where these burners send funds to identify destination
- Pattern: Source S → Burner B1, B2, B3 → Pool → Final Burner → Destination D

Step 4: Correlate amounts

Exact amount matching:
- Group all transactions by exact amount
- If N burners deposit amount X and N burners withdraw amount X, correlate them
- Probability: If amount X appears 100 times and 10 burners use it, correlation probability = 10/100 = 10%

Chunk sequence matching:
- If burner deposits [0.035, 0.035, 0.02] SOL, find withdrawals summing to 0.09 SOL
- Match individual chunks to withdrawal amounts

Re-deposit pattern:
- Look for N small deposits (~0.03 SOL each) followed by 1 large withdrawal (~N × 0.03 SOL)
- This indicates intermediate burners re-depositing, then final burner withdrawing

Step 5: Temporal correlation

Link transactions by timing:
- Cluster transactions within time windows
- Identify sequences matching expected flow: User → First Burner → Pool chunks → Intermediate Burners → Pool re-deposits → Final Burner → Destination
- Account for randomized delays 0-4 hours when correlating

Step 6: Build transaction graph

Construct graph with:
- Nodes: Wallets (user, burners, pool, destination)
- Edges: Transactions with amounts and timestamps
- Weights: Correlation confidence scores

Find paths from source to destination. Identify strongly connected components. Calculate path probabilities.

ATTACK PROBABILITY CALCULATIONS

Scenario: 100,000 pool transactions, 10,000 burner transactions (10%), user sends 2 chunks of 0.035 SOL each

Single amount correlation:
- If 0.035 SOL appears 500 times and 10 burners use it: P(match) = 10/500 = 2%

Chunk sequence correlation:
- If sequence [0.035, 0.035] appears 200 times and 5 burners use it: P(match) = 5/200 = 2.5%

Multi-hop correlation:
- P1 = 2% (first burner deposit chunks)
- P2 = 5% (intermediate burner withdrawals)
- P3 = 3% (intermediate burner re-deposits)
- P4 = 10% (final burner withdrawal)
- P5 = 100% (final burner to destination, if destination known)
- P(total) = 0.02 × 0.05 × 0.03 × 0.10 × 1.0 = 0.0003%

Note: Temporal correlation and graph analysis increase probability. Known source or destination addresses dramatically reduce anonymity.

ATTACK SUCCESS RATES

Best case for attacker: Known source address, unique amounts, short time window. Success: 10-30%

Average case: Unknown source, known destination, common amounts, normal delays. Success: 1-5%

Worst case for attacker: Unknown source and destination, very common amounts, long delays, high pool activity. Success: <0.1%
