export type Network = 'mainnet' | 'testnet';

export interface NetworkConfig {
  solana: {
    rpc: string;
  };
}

const networks: Record<Network, NetworkConfig> = {
  mainnet: {
    solana: {
      rpc: process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC || 'https://mainnet.helius-rpc.com/?api-key=d9b6d595-1feb-4741-8958-484ad55afdab',
    },
  },
  testnet: {
    solana: {
      rpc: process.env.NEXT_PUBLIC_SOLANA_TESTNET_RPC || 'https://api.devnet.solana.com',
    },
  },
};

export function getNetworkConfig(network: Network): NetworkConfig {
  return networks[network];
}

export function getSolanaRpc(network: Network): string {
  return networks[network].solana.rpc;
}
