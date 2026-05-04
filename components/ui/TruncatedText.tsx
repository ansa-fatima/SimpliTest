'use client';

import { useEffect, useRef, useState } from 'react';

interface TruncatedTextProps {
  text: string;
  className?: string;
}

export function TruncatedText({ text, className = '' }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      title={overflowing ? text : undefined}
      className={`block truncate ${className}`}
    >
      {text}
    </span>
  );
}
