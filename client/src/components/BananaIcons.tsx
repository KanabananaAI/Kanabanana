interface IconProps {
  className?: string
  size?: number
}

/** Small banana fruit — header logo, favicon-style */
export function BananaLogo({ className = '', size = 24 }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      {/* Banana body */}
      <path d="M20 8c-2 0-4 2-4 5 0 6 4 18 10 28 6 10 14 18 20 18 4 0 6-3 6-7 0-3-1-6-3-6-8 0-16-8-22-20C23 16 22 8 20 8z" fill="#FFD600" stroke="#C8A000" strokeWidth="2"/>
      {/* Banana tip */}
      <path d="M46 49c2 2 5 4 7 3s2-4 0-6" fill="none" stroke="#C8A000" strokeWidth="2" strokeLinecap="round"/>
      {/* Banana stem */}
      <path d="M20 8c0-3 1-5 3-6s4 0 4 2" fill="none" stroke="#5D8A2D" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Highlight */}
      <path d="M24 16c3 8 8 18 14 24" fill="none" stroke="#FFF176" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    </svg>
  )
}

/** Banana with clipboard — Backlog */
export function BananaBacklog({ className = '', size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="5" y="2" width="6" height="3" rx="1" fill="currentColor" opacity="0.3"/>
      <line x1="6" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
      <line x1="6" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
      <line x1="6" y1="14" x2="9" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
      <path d="M14 7c-0.5-1.5-0.5-3 0.5-3.5s2 0.5 2 1.5c0 2-1 5-2.5 8s-3 4.5-4 4.5-0.5-1 0.5-2.5" fill="#FFD600" stroke="#C8A000" strokeWidth="0.8"/>
    </svg>
  )
}

/** Banana with arrow — To Do */
export function BananaTodo({ className = '', size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5c-0.5-1.5-0.5-3 0.5-3.5s2 0.5 2 1.5c0 2-1 5-2.5 8s-3 4.5-4 4.5-0.5-1 0.5-2.5" fill="#FFD600" stroke="#C8A000" strokeWidth="0.8"/>
      <path d="M3 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M8 7l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

/** Banana spinning/working — In Progress */
export function BananaProgress({ className = '', size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M10 5c-0.5-1.5-0.5-3 0.5-3.5s2 0.5 2 1.5c0 2-1 5-2.5 8s-3 4.5-4 4.5-0.5-1 0.5-2.5" fill="#FFD600" stroke="#C8A000" strokeWidth="0.8"/>
      {/* Circular motion lines */}
      <path d="M15 6a6 6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      <path d="M15 6l1.5-1-0.5 2" fill="currentColor"/>
      <path d="M3 8a6 6 0 0 1 0 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.4"/>
    </svg>
  )
}

/** Banana with magnifying glass — Review */
export function BananaReview({ className = '', size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M6 5c-0.5-1.5-0.5-3 0.5-3.5s2 0.5 2 1.5c0 2-1 5-2.5 8s-3 4.5-4 4.5-0.5-1 0.5-2.5" fill="#FFD600" stroke="#C8A000" strokeWidth="0.8"/>
      <circle cx="13" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="16" y1="12" x2="18.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

/** Banana with checkmark — Done */
export function BananaDone({ className = '', size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M10 5c-0.5-1.5-0.5-3 0.5-3.5s2 0.5 2 1.5c0 2-1 5-2.5 8s-3 4.5-4 4.5-0.5-1 0.5-2.5" fill="#FFD600" stroke="#C8A000" strokeWidth="0.8"/>
      <path d="M3 10l3 3 6-7" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

/** Mascot image for empty states */
export function BananaMascot({ className = '', size = 160 }: IconProps) {
  return (
    <img
      src="/mascot.png"
      alt="KanaBanana mascot"
      width={size}
      height={size}
      className={`opacity-60 rounded-full ${className}`}
      style={{ objectFit: 'cover' }}
    />
  )
}

/** Map column IDs to their banana icon */
export const columnIcons: Record<string, (props: IconProps) => JSX.Element> = {
  backlog: BananaBacklog,
  todo: BananaTodo,
  scheduled: BananaTodo,
  'in-progress': BananaProgress,
  review: BananaReview,
  inspect: BananaReview,
  done: BananaDone,
}
