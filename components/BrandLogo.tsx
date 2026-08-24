import { cn } from '@/lib/utils';

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

export default function BrandLogo({ compact = false, className }: BrandLogoProps) {
  return (
    <span
      aria-label="rin5"
      className={cn('inline-flex items-baseline font-bold tracking-tight text-current', className)}
    >
      {compact ? 'r5' : 'rin5'}<span className="text-[#87f700]">.</span>
    </span>
  );
}
