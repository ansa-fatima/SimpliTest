import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });

export const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

export const notFound = (error = 'Not found') =>
  NextResponse.json({ error }, { status: 404 });

export const conflict = (error: string) =>
  NextResponse.json({ error }, { status: 409 });

export function serverError(error: unknown) {
  console.error('[api]', error);
  const msg = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** Translate common Prisma error codes to HTTP responses. Returns null if unknown. */
export function prismaError(e: unknown): NextResponse | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return conflict('A record with this value already exists');
    if (e.code === 'P2003') return bad('Referenced record does not exist', 404);
    if (e.code === 'P2025') return notFound('Record not found');
  }
  return null;
}

export async function parseJson<T = unknown>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
