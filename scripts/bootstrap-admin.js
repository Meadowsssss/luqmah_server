require("dotenv").config();

const bcrypt = require("bcryptjs");
const { prisma } = require("../src/lib/prisma");
const { USER_ROLES } = require("../src/constants/enums");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Luqmah Admin";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        name,
        passwordHash,
        role: USER_ROLES.ADMIN,
      },
    });
    console.log(`Updated admin account for ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: USER_ROLES.ADMIN,
    },
  });

  console.log(`Created admin account for ${email}`);
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
