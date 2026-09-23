import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prep Genius — Interview prep kits',
  description: 'Turn a job description into a personalised interview preparation kit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
