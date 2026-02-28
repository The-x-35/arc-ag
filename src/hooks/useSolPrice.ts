'use client';

import { useState, useEffect } from 'react';

const SOL_ID = 'SOL'; // Jupiter API accepts "SOL" as token identifier
const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Fallback mint address
const JUPITER_PRICE_API = 'https://lite-api.jup.ag/price/v3';

export function useSolPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Try with "SOL" first, fallback to mint address if needed
        let response = await fetch(`${JUPITER_PRICE_API}?ids=${encodeURIComponent(SOL_ID)}`);
        let data = await response.json();
        
        // If "SOL" doesn't work, try with mint address
        if (!response.ok || (!data?.[SOL_ID] && !data?.data?.[SOL_ID])) {
          response = await fetch(`${JUPITER_PRICE_API}?ids=${encodeURIComponent(SOL_MINT)}`);
          data = await response.json();
        }
        
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to fetch price');
        }
        
        // Support both data shapes: direct keyed, or nested "data"
        const node = data?.[SOL_ID] || data?.[SOL_MINT] || data?.data?.[SOL_ID] || data?.data?.[SOL_MINT];
        const usdPrice = node?.usdPrice ?? node?.price;
        
        if (usdPrice == null) {
          throw new Error('Price not available');
        }
        
        setPrice(parseFloat(usdPrice));
      } catch (err: any) {
        console.error('Failed to fetch SOL price:', err);
        setError(err.message || 'Failed to fetch price');
      } finally {
        setLoading(false);
      }
    };

    // Fetch immediately
    fetchPrice();

    // Update every 30 seconds
    const interval = setInterval(fetchPrice, 30000);

    return () => clearInterval(interval);
  }, []);

  return { price, loading, error };
}

export function formatSolWithUsd(sol: number, price: number | null): string {
  return formatAmountUsdFirst(sol, price, 6);
}

// Always show USD first, SOL in parentheses
export function formatAmountUsdFirst(sol: number | string, price: number | null, decimals: number = 6): string {
  // Handle encrypted amounts (strings that look like base64) or invalid values
  if (typeof sol === 'string') {
    // Check if it looks like an encrypted base64 string (long, base64 chars)
    if (sol.length > 20 && /^[A-Za-z0-9+/=]+$/.test(sol)) {
      return 'Encrypted';
    }
    const solNum = parseFloat(sol);
    if (isNaN(solNum) || !isFinite(solNum)) {
      return 'N/A';
    }
    sol = solNum;
  }
  
  const solNum = sol as number;
  if (price === null) {
    return `${solNum.toFixed(decimals)} SOL`;
  }
  const usd = solNum * price;
  return `$${usd.toFixed(2)} (${solNum.toFixed(decimals)} SOL)`;
}

// Backwards-compat alias (keep old name if used elsewhere)
export function formatSolAmount(sol: number | string, price: number | null, decimals: number = 6): string {
  return formatAmountUsdFirst(sol, price, decimals);
}
