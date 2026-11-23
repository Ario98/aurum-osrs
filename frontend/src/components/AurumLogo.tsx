import { useId } from 'react';

export const BRAND_NAME = 'Aurum';
export const BRAND_SUBTITLE = 'OSRS GE Terminal';
export const BRAND_SIGNATURE = 'Forged by Ario';
export const BRAND_REPO_URL = 'https://github.com/Ario98/aurum-osrs';

interface MarkProps {
  className?: string;
}

/**
 * Minimalist modern geometric "A" mark — an open precision gold chevron with a single
 * floating diamond inside an obsidian rounded tile. Crisp from 16px favicon to hero size.
 */
export function AurumMark({ className = 'h-10 w-10' }: MarkProps) {
  const uid = useId().replace(/:/g, '');
  const goldId = `auGold-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={goldId} x1="18" y1="16" x2="46" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        fill="#0b0b10"
        stroke="#f59e0b"
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <path
        d="M18 47.5 L32 16.5 L46 47.5"
        stroke={`url(#${goldId})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="28.75"
        y="40.25"
        width="6.5"
        height="6.5"
        rx="1.2"
        transform="rotate(45 32 43.5)"
        fill="#fde68a"
      />
    </svg>
  );
}

interface WordmarkProps {
  showSubtitle?: boolean;
  size?: 'sm' | 'md';
}

export function AurumWordmark({ showSubtitle = false, size = 'sm' }: WordmarkProps) {
  return (
    <span className="inline-flex items-baseline gap-1.5 select-none">
      <span
        className={`font-extrabold tracking-[0.14em] uppercase bg-gradient-to-b from-amber-100 via-amber-300 to-amber-500 bg-clip-text text-transparent ${
          size === 'md' ? 'text-base' : 'text-[13px]'
        }`}
      >
        {BRAND_NAME}
      </span>
      {showSubtitle && (
        <span className="text-[11px] font-medium tracking-normal text-zinc-500">{BRAND_SUBTITLE}</span>
      )}
    </span>
  );
}
