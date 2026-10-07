/** The Deal Desk mark: a "D" made of two halves meeting. Same artwork as app/icon.svg. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="8" fill="#191813" />
      <rect x="7.5" y="7" width="5.5" height="18" rx="1.4" fill="#fbfaf6" />
      <path d="M15.5 7H17a9 9 0 0 1 0 18h-1.5z" fill="#e2832b" />
      <path d="M15.5 11.5H17a4.5 4.5 0 0 1 0 9h-1.5z" fill="#191813" />
    </svg>
  );
}
