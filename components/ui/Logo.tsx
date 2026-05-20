interface LogoProps {
  /** Pixel dimensions (square). */
  size?: number;
  className?: string;
}

/**
 * Simplitest brand mark — a black/violet split diamond with a white check.
 * Rendered inline so it stays crisp at any size and respects currentColor where useful.
 *
 * The two halves use fixed brand colours (the black is slightly off-pure for warmth on white
 * backgrounds, the violet is the design's primary accent).
 */
export function Logo({ size = 28, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Simplitest"
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Left half — warm-black */}
      <path d="M12 1 L1 12 L12 23 Z" fill="#18181B" />
      {/* Right half — brand violet */}
      <path d="M12 1 L23 12 L12 23 Z" fill="#7C3AED" />
      {/* Check */}
      <path
        d="M7 12.5 L10.5 16 L17 9"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
