# BillSplit

[![CI](https://github.com/BhavyaPatel19/billsplit/actions/workflows/ci.yml/badge.svg)](https://github.com/BhavyaPatel19/billsplit/actions/workflows/ci.yml)

Split bills with friends and roommates: photograph a receipt, let the app read the items, tap who had what (down to "one bite" of the fries), and settle up.

> Status: Sprint 0 — scaffold. The live URL, receipt OCR, and splitting features land step by step; see the roadmap below.

## Why another bill splitter

Existing apps make you type every line and spread tax and tip evenly. BillSplit:

- reads the receipt photo and turns it into editable line items with confidence scores;
- lets each item be split equally, by exact amount, by percentage, or by shares, with tax, tip, discounts and fees allocated **proportionally** to what each person actually had;
- lets friends without an account claim their items from a link, and merges those placeholder people into real accounts when they join;
- keeps every receipt searchable, simplifies debts to the fewest transfers, and adds roommate features (recurring rent and utilities, room-weighted rent, away-day proration, move-out report).

## Stack

TypeScript monorepo (pnpm + Turborepo): Next.js 16 web app, Hono API with Drizzle ORM on Postgres, BullMQ worker, Better Auth, Claude vision for receipt extraction. Deployed with Docker Compose on AWS (Terraform, GitHub Actions, OIDC).

## Repository layout

```
apps/api         Hono API (OpenAPI at /docs)
apps/web         Next.js app
docker/          Dockerfiles, local Compose stack, production Compose + Caddyfile
infra/terraform  AWS infrastructure (bootstrap + main module)
packages/split-engine  Exact-cents money math: splits, allocation, ledger, debt simplification
packages/contracts   Zod schemas shared by web, api and worker
packages/db      Drizzle schema, SQL migrations, migrator
packages/config  Shared tsconfig presets
```

## Local development

Requires Node 24, pnpm 12 (`corepack enable`) and Docker.

```bash
pnpm install
pnpm --filter @billsplit/contracts build
pnpm docker:up      # postgres, valkey, S3-compatible storage (RustFS), mailpit
pnpm dev            # api on :4000 (docs at /docs), web on :3000
pnpm check          # lint + typecheck + tests
pnpm docker:app     # build and run the production images locally
```

Consoles: S3 at http://localhost:9001, mail at http://localhost:8025.

Database tests start Postgres with Testcontainers. On Colima, point it at the socket first:
`export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_RYUK_DISABLED=true`.

## Deployment

AWS, fully in Terraform: one ARM EC2 host running the Compose stack behind Caddy (automatic HTTPS), S3 for receipts and backups, ECR, SSM Parameter Store for secrets, CloudWatch alarms and a budget. GitHub Actions deploys over an OIDC role through SSM Run Command, so there are no AWS keys in GitHub and no SSH port on the host. About $20/month. Step by step: [infra/README.md](infra/README.md).

## Roadmap

1. **Sprint 0** scaffold, Docker, CI, Terraform, live URL
2. **Sprint 1** accounts, groups, invites, placeholder people
3. **Sprint 2** split engine, expenses, balances, settle up
4. **Sprint 3** receipt upload, OCR, tap-to-claim
5. **Sprint 4** claim links for guests, merge, notifications
6. **Sprint 5** household mode for roommates
7. **Sprint 6** search, insights, multi-currency, security hardening

## License

MIT
