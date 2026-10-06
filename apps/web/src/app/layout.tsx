import type { Metadata } from 'next';
import { serverConfig } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${serverConfig.appName} — scheduled meals, delivered to your checkpoint`,
    template: `%s · ${serverConfig.appName}`,
  },
  description:
    'Order meals and tiffins for a future date and have them delivered to a college gate, school gate, office reception or hostel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
