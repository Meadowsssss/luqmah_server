require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../src/lib/prisma");
const { USER_ROLES, ORDER_STATUSES } = require("../src/constants/enums");

async function main() {
  await prisma.orderItemCustomization.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItemCustomization.deleteMany();
  await prisma.menuItemIngredient.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.restaurant.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("Password123!", 10);

  const vendorUser = await prisma.user.create({
    data: {
      name: "Maha Vendor",
      email: "vendor@luqmah.app",
      passwordHash,
      role: USER_ROLES.VENDOR,
      vendor: {
        create: {},
      },
    },
    include: {
      vendor: true,
    },
  });

  const customerUser = await prisma.user.create({
    data: {
      name: "Ahmad Customer",
      email: "customer@luqmah.app",
      passwordHash,
      role: USER_ROLES.CUSTOMER,
    },
  });

  const secondCustomer = await prisma.user.create({
    data: {
      name: "Sara Customer",
      email: "sara@luqmah.app",
      passwordHash,
      role: USER_ROLES.CUSTOMER,
    },
  });

  const restaurantOne = await prisma.restaurant.create({
    data: {
      vendorId: vendorUser.vendor.id,
      title: "Luqmah Kitchen",
      description: "Jordanian comfort food, wraps, and bowls.",
      address: "Amman, Abdali Boulevard",
      coverImage: "https://images.unsplash.com/photo-1544025162-d76694265947",
      menuCategories: {
        create: [
          {
            title: "Wraps",
            sortOrder: 1,
          },
          {
            title: "Bowls",
            sortOrder: 2,
          },
          {
            title: "Drinks",
            sortOrder: 3,
          },
        ],
      },
    },
    include: {
      menuCategories: true,
    },
  });

  const restaurantTwo = await prisma.restaurant.create({
    data: {
      vendorId: vendorUser.vendor.id,
      title: "Luqmah Express",
      description: "Quick bites and late night snacks.",
      address: "Amman, Sweifieh",
      coverImage: "https://images.unsplash.com/photo-1504674900247-0877df9cc836",
      menuCategories: {
        create: [
          {
            title: "Sandwiches",
            sortOrder: 1,
          },
          {
            title: "Sides",
            sortOrder: 2,
          },
        ],
      },
    },
    include: {
      menuCategories: true,
    },
  });

  const wrapsCategory = restaurantOne.menuCategories.find((category) => category.title === "Wraps");
  const bowlsCategory = restaurantOne.menuCategories.find((category) => category.title === "Bowls");
  const drinksCategory = restaurantOne.menuCategories.find((category) => category.title === "Drinks");
  const sandwichesCategory = restaurantTwo.menuCategories.find(
    (category) => category.title === "Sandwiches",
  );
  const sidesCategory = restaurantTwo.menuCategories.find((category) => category.title === "Sides");

  const chickenWrap = await prisma.menuItem.create({
    data: {
      restaurantId: restaurantOne.id,
      categoryId: wrapsCategory.id,
      title: "Chicken Shawarma Wrap",
      description: "Marinated chicken, pickles, garlic sauce.",
      price: new Prisma.Decimal("5.50"),
      ingredients: {
        create: [
          { name: "Chicken" },
          { name: "Pickles" },
          { name: "Garlic Sauce" },
        ],
      },
      customizations: {
        create: [
          {
            title: "Extra Garlic Sauce",
            priceDelta: new Prisma.Decimal("0.40"),
          },
          {
            title: "Add Fries Inside",
            priceDelta: new Prisma.Decimal("0.80"),
          },
        ],
      },
    },
    include: {
      customizations: true,
    },
  });

  const beefBowl = await prisma.menuItem.create({
    data: {
      restaurantId: restaurantOne.id,
      categoryId: bowlsCategory.id,
      title: "Beef Rice Bowl",
      description: "Spiced beef over vermicelli rice.",
      price: new Prisma.Decimal("7.25"),
      ingredients: {
        create: [{ name: "Beef" }, { name: "Rice" }, { name: "Tahini" }],
      },
      customizations: {
        create: [
          {
            title: "Extra Tahini",
            priceDelta: new Prisma.Decimal("0.30"),
          },
        ],
      },
    },
  });

  const mintLemonade = await prisma.menuItem.create({
    data: {
      restaurantId: restaurantOne.id,
      categoryId: drinksCategory.id,
      title: "Mint Lemonade",
      description: "Fresh lemon juice blended with mint.",
      price: new Prisma.Decimal("2.50"),
      ingredients: {
        create: [{ name: "Lemon" }, { name: "Mint" }, { name: "Sugar Syrup" }],
      },
    },
  });

  await prisma.menuItem.create({
    data: {
      restaurantId: restaurantTwo.id,
      categoryId: sandwichesCategory.id,
      title: "Crispy Chicken Sandwich",
      description: "Spicy mayo, lettuce, and crunchy chicken fillet.",
      price: new Prisma.Decimal("6.75"),
      ingredients: {
        create: [{ name: "Chicken Fillet" }, { name: "Lettuce" }, { name: "Spicy Mayo" }],
      },
      customizations: {
        create: [
          {
            title: "Cheese Slice",
            priceDelta: new Prisma.Decimal("0.50"),
          },
        ],
      },
    },
  });

  await prisma.menuItem.create({
    data: {
      restaurantId: restaurantTwo.id,
      categoryId: sidesCategory.id,
      title: "Loaded Fries",
      description: "Fries with cheese sauce and jalapenos.",
      price: new Prisma.Decimal("3.95"),
      ingredients: {
        create: [{ name: "Fries" }, { name: "Cheese Sauce" }, { name: "Jalapenos" }],
      },
      isAvailable: false,
    },
  });

  await prisma.order.create({
    data: {
      customerId: customerUser.id,
      restaurantId: restaurantOne.id,
      status: ORDER_STATUSES.IN_PROGRESS,
      notes: "Please call on arrival",
      totalAmount: new Prisma.Decimal("14.30"),
      orderItems: {
        create: [
          {
            menuItemId: chickenWrap.id,
            itemTitle: "Chicken Shawarma Wrap",
            unitPrice: new Prisma.Decimal("5.50"),
            quantity: 2,
            lineTotal: new Prisma.Decimal("11.80"),
            customizations: {
              create: [
                {
                  menuItemCustomizationId: chickenWrap.customizations[0].id,
                  title: "Extra Garlic Sauce",
                  priceDelta: new Prisma.Decimal("0.40"),
                },
              ],
            },
          },
          {
            menuItemId: mintLemonade.id,
            itemTitle: "Mint Lemonade",
            unitPrice: new Prisma.Decimal("2.50"),
            quantity: 1,
            lineTotal: new Prisma.Decimal("2.50"),
          },
        ],
      },
    },
  });

  await prisma.order.create({
    data: {
      customerId: secondCustomer.id,
      restaurantId: restaurantOne.id,
      status: ORDER_STATUSES.COMPLETED,
      totalAmount: new Prisma.Decimal("7.55"),
      orderItems: {
        create: [
          {
            menuItemId: chickenWrap.id,
            itemTitle: "Chicken Shawarma Wrap",
            unitPrice: new Prisma.Decimal("5.50"),
            quantity: 1,
            lineTotal: new Prisma.Decimal("5.90"),
            customizations: {
              create: [
                {
                  menuItemCustomizationId: chickenWrap.customizations[0].id,
                  title: "Extra Garlic Sauce",
                  priceDelta: new Prisma.Decimal("0.40"),
                },
              ],
            },
          },
          {
            itemTitle: "Service Water",
            unitPrice: new Prisma.Decimal("1.65"),
            quantity: 1,
            lineTotal: new Prisma.Decimal("1.65"),
          },
        ],
      },
    },
  });

  console.log("Seed complete");
  console.log("Vendor login: vendor@luqmah.app / Password123!");
  console.log("Customer login: customer@luqmah.app / Password123!");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
