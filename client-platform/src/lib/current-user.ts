import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice";

// Temporary shim until Clerk auth → practitioner mapping is wired.
// Returns the first active user in the default practice so FK-constrained
// create operations don't fail in dev.
export async function currentPractitionerId(): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { practiceId: PRACTICE_ID, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    throw new Error(
      "No active practitioner found. Run `npm run db:seed` or create a user first."
    );
  }
  return user.id;
}
