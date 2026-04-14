import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PRACTICE_ID = "default-practice";

// GET /api/clients — list all active clients
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const category = searchParams.get("category");

  const clients = await prisma.client.findMany({
    where: {
      practiceId: PRACTICE_ID,
      deletedAt: null,
      archivedAt: null,
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(category && { category: { name: category } }),
    },
    include: {
      category: { select: { id: true, name: true } },
      programs: {
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true, type: true, status: true },
        take: 1,
      },
      clinicalNotes: {
        where: { isInjuryFlag: true, deletedAt: null },
        select: { id: true, title: true },
        take: 3,
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json(clients);
}

// POST /api/clients — create new client
export async function POST(req: NextRequest) {
  const body = await req.json();

  const {
    firstName,
    lastName,
    email,
    dateOfBirth,
    phone,
    gender,
    address,
    medicalHistory,
    referralSource,
    referredBy,
    medications,
    injuries,
    contraindications,
    goals,
    categoryId,
  } = body;

  if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
    return NextResponse.json(
      { error: "First name, last name, and email are required" },
      { status: 400 }
    );
  }

  const client = await prisma.client.create({
    data: {
      practiceId: PRACTICE_ID,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      phone: phone || null,
      gender: gender || null,
      address: address || null,
      medicalHistory: medicalHistory || null,
      referralSource: referralSource || null,
      referredBy: referredBy || null,
      medications: medications || null,
      injuries: injuries || null,
      contraindications: contraindications || null,
      goals: goals || null,
      categoryId: categoryId || null,
    },
    include: { category: { select: { id: true, name: true } } },
  });

  return NextResponse.json(client, { status: 201 });
}
