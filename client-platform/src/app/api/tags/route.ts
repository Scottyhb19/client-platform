import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice";

export async function GET() {
  const tags = await prisma.exerciseTag.findMany({
    where: { practiceId: PRACTICE_ID },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json(tags);
}
