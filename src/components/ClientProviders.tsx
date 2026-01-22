'use client';

import { FC, ReactNode } from 'react';
import WalletProvider from '@/contexts/WalletProvider';

interface ClientProvidersProps {
  children: ReactNode;
}

export const ClientProviders: FC<ClientProvidersProps> = ({ children }) => {
  return (
    <WalletProvider>
      {children}
    </WalletProvider>
  );
};

export default ClientProviders;
