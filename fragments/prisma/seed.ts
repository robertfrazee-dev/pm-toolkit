import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_AREAS = [
  { name: "Health", description: "Body, mind, appointments, fitness", color: "#22c55e" },
  { name: "Work", description: "Job and career", color: "#3b82f6" },
  { name: "Side Projects", description: "Things I'm building for fun or profit", color: "#a855f7" },
  { name: "Home", description: "House, errands, pets, chores", color: "#f59e0b" },
  { name: "Money", description: "Bills, rent, budget", color: "#14b8a6" },
  { name: "People", description: "Family, friends, relationships", color: "#ec4899" },
];

async function main() {
  for (const area of DEFAULT_AREAS) {
    await prisma.area.upsert({ where: { name: area.name }, update: {}, create: area });
  }
  await prisma.settings.upsert({ where: { id: "singleton" }, update: {}, create: {} });
  console.log(`Seeded ${DEFAULT_AREAS.length} areas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
