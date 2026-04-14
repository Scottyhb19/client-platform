import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.create({
    data: {
      id: "test-user",
      clerkId: "placeholder-user",
      email: "test@test.com",
      firstName: "Scott",
      lastName: "EP",
      role: "PRACTITIONER",
      practiceId: "default-practice",
    },
  });
  console.log("User:", user.id);

  const client = await prisma.client.create({
    data: {
      id: "test-client",
      practiceId: "default-practice",
      email: "isaac@test.com",
      firstName: "Isaac",
      lastName: "Fong",
    },
  });
  console.log("Client:", client.id);

  await prisma.exercise.createMany({
    data: [
      {
        id: "ex-squat",
        practiceId: "default-practice",
        name: "Barbell Back Squat",
        movementPattern: "SQUAT",
        defaultSets: 4,
        defaultReps: "6",
        defaultLoad: "80kg",
      },
      {
        id: "ex-rdl",
        practiceId: "default-practice",
        name: "Romanian Deadlift",
        movementPattern: "HINGE",
        defaultSets: 3,
        defaultReps: "10",
        defaultLoad: "60kg",
      },
      {
        id: "ex-scorpion",
        practiceId: "default-practice",
        name: "Adductor Scorpions",
        movementPattern: "CORE",
        defaultSets: 2,
        defaultReps: "10",
      },
      {
        id: "ex-copenhagen",
        practiceId: "default-practice",
        name: "Copenhagen Adductor",
        movementPattern: "ISOMETRIC",
        defaultSets: 3,
        defaultReps: "8",
      },
    ],
  });
  console.log("Exercises: 4 created");

  await prisma.program.create({
    data: {
      id: "test-program",
      clientId: "test-client",
      createdById: "test-user",
      name: "Gym Program",
      type: "HOME_GYM",
      status: "ACTIVE",
    },
  });
  console.log("Program: test-program");

  await prisma.programDayGroup.create({
    data: {
      id: "test-day-a",
      programId: "test-program",
      label: "Day A",
      sortOrder: 0,
    },
  });
  console.log("Day: Day A");

  await prisma.programExercise.createMany({
    data: [
      {
        id: "pe-1",
        dayGroupId: "test-day-a",
        exerciseId: "ex-scorpion",
        sortOrder: 0,
        sectionTitle: "Mobility",
        sets: 2,
        reps: "10",
        instructions: "Stay tight. Attack each rep!",
      },
      {
        id: "pe-2",
        dayGroupId: "test-day-a",
        exerciseId: "ex-squat",
        sortOrder: 1,
        sectionTitle: "Strength",
        sets: 4,
        reps: "6",
        load: "80kg",
        instructions: "Brace hard. Controlled descent.",
      },
      {
        id: "pe-3",
        dayGroupId: "test-day-a",
        exerciseId: "ex-rdl",
        sortOrder: 2,
        sectionTitle: "Strength",
        sets: 3,
        reps: "10",
        load: "60kg",
        instructions: "Hip hinge, soft knees.",
      },
      {
        id: "pe-4",
        dayGroupId: "test-day-a",
        exerciseId: "ex-copenhagen",
        sortOrder: 3,
        sectionTitle: "Strength",
        sets: 3,
        reps: "8",
        instructions: "Key for groin rehab.",
      },
    ],
  });
  console.log("Program exercises: 4");

  await prisma.clinicalNote.createMany({
    data: [
      {
        id: "note-flag-1",
        clientId: "test-client",
        authorId: "test-user",
        type: "INJURY_FLAG",
        content:
          "L groin adductor strain - Feb 2026. Cleared for progressive loading.",
        isInjuryFlag: true,
      },
      {
        id: "note-1",
        clientId: "test-client",
        authorId: "test-user",
        type: "PROGRESS_NOTE",
        content:
          "ADD:ABD 0.82 (target >0.85). Copenhagen progressing well.",
        isInjuryFlag: false,
      },
    ],
  });
  console.log("Clinical notes: 2");

  console.log("Test data seeded!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
