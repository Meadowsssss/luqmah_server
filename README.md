# Luqmah Backend v1

Node.js + Express + Prisma + PostgreSQL backend for the Luqmah Flutter food ordering app.

## Stack

- Node.js
- Express
- Prisma
- PostgreSQL
- JWT auth
- bcryptjs
- zod

## Features

- Customer, vendor, and admin roles
- Customer identity handled by Firebase Authentication plus backend customer sync
- Admin-managed vendor onboarding
- Vendor-scoped restaurants, menu items, and order access
- Customer-scoped order access
- Restaurant browsing and menu retrieval
- Order creation with item snapshots for historical accuracy
- Password change endpoint for authenticated users
- Prisma migration and seed data

## Project Structure

```text
server/
  prisma/
  src/
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env file and update database plus Firebase Admin credentials:

```bash
cp .env.example .env
```

3. Run the Prisma migration:

```bash
npm run db:migrate
```

4. Seed sample data:

```bash
npm run db:seed
```

5. Start the server:

```bash
npm run dev
```

Server default URL: `http://localhost:4000`

Required Firebase Admin env vars for customer sync:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## Admin Bootstrap

1. Copy the admin variables from `.env.example` into `.env`.
2. Run:

```bash
npm run admin:bootstrap
```

This creates or updates the backend admin account used by the hidden in-app admin portal.

## Auth Modes

- Customers authenticate with Firebase first, then exchange a Firebase ID token at `POST /auth/firebase/customer` for a Luqmah backend JWT.
- Vendors authenticate with backend credentials at `POST /auth/login`.
- Admins authenticate with backend credentials at `POST /admin/login`.
- Customer password reset, email verification, and password change stay in Firebase.
- Vendor/admin passwords stay in the backend.

## Seeded Accounts

- Vendor: `vendor@luqmah.app` / `Password123!`
- Customer: `customer@luqmah.app` / `Password123!`

Customer sign-up is handled by Firebase. Vendor accounts are provisioned manually by an admin.

## API Notes

- Use `Authorization: Bearer <token>` for protected routes.
- Orders snapshot `item_title`, `unit_price`, `quantity`, and `line_total`.
- Historical orders do not rely only on `menu_item_id`.
- Vendor order filters:
  - `status=new` returns `ACCEPTED`, `IN_PROGRESS`, and `READY`
  - `status=past` returns `COMPLETED` and `CANCELLED`

## Example Requests

### Sync Firebase Customer Session

```bash
curl -X POST http://localhost:4000/auth/firebase/customer \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "<firebase-id-token>"
  }'
```

### Vendor Login

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "vendor@luqmah.app",
    "password": "Password123!"
  }'
```

### Get Current User

```bash
curl http://localhost:4000/auth/me \
  -H "Authorization: Bearer <token>"
```

### Change Password

```bash
curl -X PATCH http://localhost:4000/users/me/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "Password123!",
    "newPassword": "Password456!"
  }'
```

### Browse Restaurants

```bash
curl http://localhost:4000/restaurants
```

### Get Restaurant Menu

```bash
curl http://localhost:4000/restaurants/<restaurantId>/menu
```

### Create Order

```bash
curl -X POST http://localhost:4000/orders \
  -H "Authorization: Bearer <customer-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "<restaurantId>",
    "notes": "No onions please",
    "items": [
      {
        "menuItemId": "<menuItemId>",
        "quantity": 2,
        "customizationIds": ["<customizationId>"]
      }
    ]
  }'
```

### Vendor Orders

```bash
curl "http://localhost:4000/vendor/orders?status=new" \
  -H "Authorization: Bearer <vendor-token>"
```

### Update Vendor Order Status

```bash
curl -X PATCH http://localhost:4000/vendor/orders/<orderId>/status \
  -H "Authorization: Bearer <vendor-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "READY"
  }'
```

### Create Vendor Menu Item

```bash
curl -X POST http://localhost:4000/vendor/menu-items \
  -H "Authorization: Bearer <vendor-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "<restaurantId>",
    "categoryId": "<categoryId>",
    "title": "Falafel Wrap",
    "description": "Crispy falafel, tahini, pickles",
    "price": 4.95,
    "ingredientNames": ["Falafel", "Tahini", "Pickles"],
    "customizations": [
      {
        "title": "Extra Tahini",
        "priceDelta": 0.30
      }
    ]
  }'
```

### Create Vendor Menu Category

```bash
curl -X POST http://localhost:4000/vendor/menu-categories \
  -H "Authorization: Bearer <vendor-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "<restaurantId>",
    "title": "Wraps"
  }'
```

## Endpoints

- `POST /auth/login`
- `POST /auth/firebase/customer`
- `GET /auth/me`
- `POST /admin/login`
- `GET /admin/me`
- `GET /admin/vendors`
- `POST /admin/vendors`
- `PATCH /users/me/password`
- `GET /restaurants`
- `GET /restaurants/:id`
- `GET /restaurants/:id/menu`
- `POST /orders`
- `GET /orders/me`
- `GET /orders/me/:id`
- `GET /vendor/restaurants/me`
- `GET /vendor/orders?status=new`
- `GET /vendor/orders?status=past`
- `GET /vendor/orders/:id`
- `PATCH /vendor/orders/:id/status`
- `POST /vendor/menu-categories`
- `GET /vendor/menu-items`
- `POST /vendor/menu-items`
- `PATCH /vendor/menu-items/:id`
- `PATCH /vendor/menu-items/:id/availability`
