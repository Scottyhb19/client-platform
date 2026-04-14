// =============================================================================
// Database Seed Script
// =============================================================================
// Run with: npx tsx src/lib/seed.ts
// Seeds a practice with default section titles, exercise tags, and categories.

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DEFAULT_SECTION_TITLES,
  DEFAULT_EXERCISE_TAGS,
  DEFAULT_CLIENT_CATEGORIES,
} from "./constants";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // Create the default practice
  const practice = await prisma.practice.upsert({
    where: { id: "default-practice" },
    update: {},
    create: {
      id: "default-practice",
      name: "My EP Practice",
      timezone: "Australia/Sydney",
    },
  });

  console.log(`Practice: ${practice.name}`);

  // Seed section titles
  for (let i = 0; i < DEFAULT_SECTION_TITLES.length; i++) {
    await prisma.sectionTitle.upsert({
      where: {
        practiceId_name: {
          practiceId: practice.id,
          name: DEFAULT_SECTION_TITLES[i],
        },
      },
      update: { sortOrder: i },
      create: {
        practiceId: practice.id,
        name: DEFAULT_SECTION_TITLES[i],
        sortOrder: i,
      },
    });
  }
  console.log(`Section titles: ${DEFAULT_SECTION_TITLES.length} seeded`);

  // Seed exercise tags
  for (let i = 0; i < DEFAULT_EXERCISE_TAGS.length; i++) {
    await prisma.exerciseTag.upsert({
      where: {
        practiceId_name: {
          practiceId: practice.id,
          name: DEFAULT_EXERCISE_TAGS[i],
        },
      },
      update: { sortOrder: i },
      create: {
        practiceId: practice.id,
        name: DEFAULT_EXERCISE_TAGS[i],
        sortOrder: i,
      },
    });
  }
  console.log(`Exercise tags: ${DEFAULT_EXERCISE_TAGS.length} seeded`);

  // Seed client categories
  for (let i = 0; i < DEFAULT_CLIENT_CATEGORIES.length; i++) {
    await prisma.clientCategory.upsert({
      where: {
        practiceId_name: {
          practiceId: practice.id,
          name: DEFAULT_CLIENT_CATEGORIES[i],
        },
      },
      update: { sortOrder: i },
      create: {
        practiceId: practice.id,
        name: DEFAULT_CLIENT_CATEGORIES[i],
        sortOrder: i,
      },
    });
  }
  console.log(`Client categories: ${DEFAULT_CLIENT_CATEGORIES.length} seeded`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
