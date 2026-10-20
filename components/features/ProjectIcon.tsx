import type { CSSProperties } from 'react';
import { projectGradient, projectIconPath } from '@/lib/projectIdentity';

// The workspace's tile: its chosen gradient + either the name's first letter or
// a picked icon. `size` is the tile edge in px.
export function ProjectIcon({
  project,
  size = 42,
  radius,
  fontSize,
  style,
}: {
  project: { id: string; name: string; color?: string | null; icon?: string | null };
  size?: number;
  radius?: number | string;
  fontSize?: number;
  style?: CSSProperties;
}) {
  const path = projectIconPath(project.icon);
  return (
    <div
      className="proj-icon"
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? 'var(--r)',
        background: projectGradient(project),
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: fontSize ?? Math.round(size * 0.38),
        flexShrink: 0,
        boxShadow: 'var(--shadow-xs)',
        ...style,
      }}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.46)}
          height={Math.round(size * 0.46)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d={path} />
        </svg>
      ) : (
        (project.name.trim().charAt(0) || '?').toUpperCase()
      )}
    </div>
  );
}
