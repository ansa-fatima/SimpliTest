interface LogoProps {
  size?: number;       // pixel dimensions (square)
  className?: string;
}

/**
 * SimpliTest brand mark.
 * The image lives at /public/logo.png — drop a square PNG/SVG there.
 */
export function Logo({ size = 28, className = '' }: LogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/Logo.png"
      alt="SimpliTest"
      width={size}
      height={size}
      className={`flex-shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
