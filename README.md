# NorthStar — Civic North Consulting

Internal operations platform for time tracking, expense management, and mileage logging. Built for Sophie Kather and April Luebbert at Civic North Consulting.

## Prerequisites

- Node.js 18+
- PostgreSQL (local or hosted)
- npm

## Setup

### 1. Clone / open the project

```
cd northstar
```

### 2. Configure backend

```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL connection string and JWT secret
npm install
```

### 3. Run database migrations and seed

```bash
npx prisma migrate dev --name init
node prisma/seed.js
```

### 4. Configure frontend

```bash
cd ../frontend
npm install
```

### 5. Start development servers

In one terminal (backend):
```bash
cd backend
npm run dev
```

In another terminal (frontend):
```bash
cd frontend
npm run dev
```

App runs at `http://localhost:5173`. API at `http://localhost:3001`.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `JWT_SECRET` | Secret key for JWT signing | — |
| `PORT` | Backend port | `3001` |
| `FRONTEND_URL` | Frontend origin for CORS | `http://localhost:5173` |

## Default Accounts

Both accounts use password `changeme123`. Update via Settings > Change Password.

| Name | Email |
|---|---|
| Sophie Kather | sophie@civicnorthconsulting.com |
| April Luebbert | april@civicnorthconsulting.com |

## What's Built

### Phase 1 (this release)
- JWT authentication (httpOnly cookies, 30-day sessions)
- App shell with responsive navigation
- Client management (add/edit/archive)
- Project management (add/edit/archive, budget tracking)
- Task type management
- Time entry logging (week view, team view, live timer)
- Expense logging (client and overhead, receipt upload)
- Mileage logging (auto-calculated amounts)
- Settings (weekly hour target, password change)

### Phase 2 (upcoming)
- Client report (PDF + CSV export)
- Accountant report (PDF + CSV)
- Retainer burn gauge
- Team utilization view
- Daily email reminders (Resend)
- Browser push notifications

### Phase 3 (planned)
- Google Calendar sync & draft inbox
- Mobile polish pass
