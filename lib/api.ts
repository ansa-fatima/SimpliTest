import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export const notFound = (error = 'Not found') => NextResponse.json({ error }, { status: 404 });

export const conflict = (error: string) => NextResponse.json({ error }, { status: 409 });

// Never forwards the raw error to the client — it can carry internal details
// (DB hostnames, stack traces, driver errors). Full detail still goes to the
// server log for debugging; the client only ever sees a generic message.
export function serverError(error: unknown) {
  console.error('[api]', error);
  // A missing column/table means the code is newer than the database. That
  // message carries no secrets and is the single most useful thing to show,
  // otherwise every affected screen just says "Something went wrong".
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2022' || error.code === 'P2021')
  ) {
    return NextResponse.json(
      {
        error:
          'The database schema is out of date for this version of the app. Run `prisma migrate deploy` (or `prisma db push`) against this database and try again.',
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
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
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
