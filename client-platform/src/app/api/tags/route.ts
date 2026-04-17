import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice";

export async function GET() {
  const tags = await prisma.exerciseTag.findMany({
    where: { practiceId: PRACTICE_ID },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, sortOrder: true },
  });

  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Get next sortOrder
  const last = await prisma.exerciseTag.findFirst({
    where: { practiceId: PRACTICE_ID },
    orderBy: { sortOrder: "desc" },
  });

  const tag = await prisma.exerciseTag.create({
    data: {
      practiceId: PRACTICE_ID,
      name: name.trim(),
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true, name: true, sortOrder: true },
  });

  return NextResponse.json(tag, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.exerciseTag.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
