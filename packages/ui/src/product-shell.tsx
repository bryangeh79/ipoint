import type { ReactNode } from 'react';

export interface ProductShellProps {
  appName: string;
  children?: ReactNode;
}

export function ProductShell({ appName, children }: ProductShellProps) {
  return (
    <main>
      <h1>{appName}</h1>
      {children}
    </main>
  );
}
