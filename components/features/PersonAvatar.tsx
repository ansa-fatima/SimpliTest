'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { initials } from '@/lib/utils';
import { avatarGradient } from './tc-helpers';

// Profile pictures: a log/run only stores the tester's NAME, so look the person
// up by name / username / email (one shared fetch, refreshed every 10 seconds).
export type AvatarMap = Map<string, string>;
let avatarCache: { at: number; p: Promise<AvatarMap> } | null = null;
function loadAvatars(): Promise<AvatarMap> {
  if (!avatarCache || Date.now() - avatarCache.at > 10_000) {
    avatarCache = {
      at: Date.now(),
      p: api
        .get<{ name: string | null; username: string; email: string; avatarUrl: string | null }[]>(
          '/api/users',
        )
        .then(users => {
          const m: AvatarMap = new Map();
          for (const u of users) {
            if (!u.avatarUrl) continue;
            for (const k of [u.name, u.username, u.email])
              if (k && k.trim()) m.set(k.trim().toLowerCase(), u.avatarUrl);
          }
          return m;
        })
        .catch(() => new Map<string, string>()),
    };
  }
  return avatarCache.p;
}
export function useUserAvatars(): AvatarMap {
  const [m, setM] = useState<AvatarMap>(new Map());
  useEffect(() => {
    let live = true;
    loadAvatars().then(x => live && setM(x));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

// Initials-in-a-gradient circle, or the person's profile picture when they have one.
export function PersonAvatar({ name, avatars }: { name: string; avatars: AvatarMap }) {
  const url = avatars.get(name.trim().toLowerCase());
  if (url) {
    return (
      <span className="avatar sm" style={{ background: 'transparent', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      </span>
    );
  }
  return (
    <span className="avatar sm" style={{ background: avatarGradient(name) }}>
      {initials(name)}
    </span>
  );
}
