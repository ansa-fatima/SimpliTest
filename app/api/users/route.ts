import { prisma } from '@/lib/db';
import { ok, serverError } from '@/lib/api';

// GET /api/users  — minimal list used to power the Owner filter / assignment dropdown.
// For the richer Members-page payload (status, lastActiveAt, plan, counts) see /api/members.
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        avatarUrl: true,
        role: true,
      },
    });
    return ok(users);
  } catch (e) {
    return serverError(e);
  }
}
