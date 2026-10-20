import type { CSSProperties, ReactNode } from 'react';

// SVG icons used by the Test Case module, with the exact paths from the
// SimpliEd mockup (SimpliEd_STS_v3.html). The mockup draws every icon as an
// inline stroke SVG with default line caps, so these deliberately set no
// stroke-linecap/linejoin — matching it avoids a subtle weight difference
// against Tabler's rounded webfont glyphs. Sizing and stroke width come from
// the surrounding `.tcv3` CSS rules (.btn svg, .icon-btn svg, …); the
// attributes here are only fallbacks for places without such a rule.

type IconName =
  | 'folder'
  | 'folder-plus'
  | 'portal'
  | 'chevron'
  | 'search'
  | 'plus'
  | 'download'
  | 'upload'
  | 'copy'
  | 'move'
  | 'trash'
  | 'check'
  | 'x'
  | 'left'
  | 'right'
  | 'pencil'
  | 'eye'
  | 'dots'
  | 'file'
  | 'upload-cloud'
  | 'sparkle'
  | 'grip';

const PATHS: Record<IconName, { vb: string; body: ReactNode; style?: CSSProperties }> = {
  folder: {
    vb: '0 0 24 24',
    body: <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
  },
  'folder-plus': {
    vb: '0 0 24 24',
    body: (
      <>
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        <path d="M12 11v6M9 14h6" />
      </>
    ),
  },
  portal: {
    vb: '0 0 24 24',
    body: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
      </>
    ),
  },
  chevron: { vb: '0 0 12 12', body: <path d="M4 2l5 4-5 4" /> },
  search: {
    vb: '0 0 24 24',
    body: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </>
    ),
  },
  plus: { vb: '0 0 24 24', body: <path d="M12 5v14M5 12h14" /> },
  download: {
    vb: '0 0 24 24',
    body: <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  },
  upload: {
    vb: '0 0 24 24',
    body: (
      <path
        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
        style={{ transform: 'scaleY(-1)', transformOrigin: 'center' }}
      />
    ),
  },
  copy: {
    vb: '0 0 24 24',
    body: (
      <>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </>
    ),
  },
  move: {
    vb: '0 0 24 24',
    body: <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />,
  },
  trash: {
    vb: '0 0 24 24',
    body: (
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    ),
  },
  check: { vb: '0 0 12 12', body: <path d="M2 6L5 9L10 3" /> },
  x: { vb: '0 0 12 12', body: <path d="M3 3l6 6M9 3l-6 6" /> },
  left: { vb: '0 0 24 24', body: <path d="M15 18l-6-6 6-6" /> },
  right: { vb: '0 0 24 24', body: <path d="M9 18l6-6-6-6" /> },
  pencil: {
    vb: '0 0 24 24',
    body: <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />,
  },
  eye: {
    vb: '0 0 24 24',
    body: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  dots: {
    vb: '0 0 24 24',
    body: (
      <>
        <circle cx="12" cy="5" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="12" cy="19" r="1.2" />
      </>
    ),
  },
  file: {
    vb: '0 0 24 24',
    body: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
      </>
    ),
  },
  'upload-cloud': {
    vb: '0 0 24 24',
    body: <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  },
  sparkle: {
    vb: '0 0 24 24',
    body: <path d="M12 2L14.5 9.5 22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />,
  },
  grip: {
    vb: '0 0 24 24',
    body: (
      <>
        <circle cx="9" cy="6" r="1.2" />
        <circle cx="15" cy="6" r="1.2" />
        <circle cx="9" cy="12" r="1.2" />
        <circle cx="15" cy="12" r="1.2" />
        <circle cx="9" cy="18" r="1.2" />
        <circle cx="15" cy="18" r="1.2" />
      </>
    ),
  },
};

export function Ico({
  name,
  size,
  strokeWidth = 2,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const def = PATHS[name];
  return (
    <svg
      viewBox={def.vb}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {def.body}
    </svg>
  );
}
