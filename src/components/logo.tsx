export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect width="32" height="32" rx="7" fill="#2a78d6" />
      <path d="M8 22V16M13.3 22V11M18.7 22V14M24 22V9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
