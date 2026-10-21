interface LogoProps {
  /** Pixel dimensions (square). */
  size?: number;
  className?: string;
}

/**
 * Simplitest brand mark -- served from `public/Logo.png` so the real brand
 * asset is used everywhere. All call sites (Topbar, LoginPage, invite /
 * reset-password landing pages, onboarding) go through this one component so
 * swapping the file in `public/Logo.png` updates every logo surface at once.
 */
export function Logo({ size = 28, className = '' }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/Logo.png"
      alt="Simplitest"
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
