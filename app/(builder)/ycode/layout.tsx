import YCodeLayoutClient from './YCodeLayoutClient';
import { resolveRin5Navigation } from '@/lib/rin5-navigation';

/**
 * YCode Editor Layout (Server Component)
 * 
 * Forces dynamic rendering for all /ycode/* routes.
 * This is required because:
 * 1. Editor routes require authentication (user-specific)
 * 2. Client components use useSearchParams which needs dynamic context
 */

// Force all /ycode routes to be dynamic - no static prerendering
// This prevents useSearchParams errors during build
export const dynamic = 'force-dynamic';

export default function YCodeLayout({ children }: { children: React.ReactNode }) {
  const rin5Navigation = resolveRin5Navigation(process.env);
  return <YCodeLayoutClient rin5Navigation={rin5Navigation}>{children}</YCodeLayoutClient>;
}
