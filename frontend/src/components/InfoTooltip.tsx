import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface Props {
  title?: string;
  text: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

/**
 * Plain-English hover + mobile-tap "?" tooltip for quant/OSRS terms.
 */
export function InfoTooltip({ title, text, align = 'center', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const posCls =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span
      ref={ref}
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={title ? `Info: ${title}` : 'More info'}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-500 transition hover:text-zinc-200 focus:outline-none"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`pointer-events-auto absolute bottom-full z-50 mb-2 w-64 rounded-xl border border-white/[0.14] bg-[#111117] p-3 text-left text-[11px] font-normal normal-case tracking-normal leading-relaxed text-zinc-300 shadow-2xl ${posCls}`}
        >
          {title && <span className="mb-1 block font-semibold text-zinc-100">{title}</span>}
          <span>{text}</span>
        </span>
      )}
    </span>
  );
}
