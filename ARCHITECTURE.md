# Architecture

This repo is the executable slice of the design in [DESIGN.md](./DESIGN.md): the
**Authorization Admin Service (PAP / IAM core)** built as a Hexagonal / Clean
NestJS + TypeORM monorepo. This document is the contract every feature module
follows. Read it before adding a module.

## 1. Monorepo layout

```
.
├── package.json                 # root scripts: build, typecheck, lint, format, test, test:e2e
├── pnpm-workspace.yaml          # workspaces: apps/*, packages/*
├── tsconfig.base.json           # strict TS; path aliases @kernel, @kernel/*, @app/*
├── .eslintrc.cjs                # typescript-eslint strict + dependency-rule no-restricted-imports
├── .prettierrc / .editorconfig / .nvmrc
├── packages/
│   └── kernel/                  # @kernel/core — framework-agnostic domain primitives
│       └── src/
│           ├── domain/          # Entity, AggregateRoot, ValueObject, UniqueEntityID, DomainEvent
│           ├── errors/          # DomainError + NotFound/Conflict/Validation/Forbidden, Guard
│           ├── pagination/      # CursorPage, PageQuery, Cursor
│           ├── time/            # Clock port + SystemClock
│           └── index.ts         # barrel — import everything from '@kernel/core'
└── apps/
    └── authz-admin/             # @app/authz-admin — the NestJS PAP service
        └── src/
            ├── main.ts          # bootstrap: helmet, ValidationPipe, filter, versioning, Swagger
            ├── app.module.ts    # composition root — register feature modules here
            ├── config/          # typed config (zod-validated) + global ConfigModule
            ├── health/          # terminus DB ping (version-neutral /health)
            ├── shared/
            │   ├── infrastructure/database/   # DataSource, DatabaseModule, TenantContext, RlsInterceptor
            │   └── presentation/              # GlobalExceptionFilter, RequestContext, LoggingInterceptor, TenantContextGuard
            │   └── shared.module.ts           # global: CLOCK, TenantContextGuard
            └── modules/
                └── tenant/      # THE REFERENCE MODULE — replicate this verbatim
                    ├── domain/
                    ├── application/
                    ├── infrastructure/
                    ├── presentation/
                    ├── __tests__/
                    └── tenant.module.ts
```

## 2. The dependency rule (non-negotiable)

```
        presentation ─┐
                      ├──> application ──> domain
     infrastructure ──┘
```

- **domain** imports NOTHING framework-specific. No `@nestjs/*`, no `typeorm`.
  Only `@kernel/core` and other domain files. This is enforced by an ESLint
  `no-restricted-imports` rule over `packages/kernel/**` and
  `apps/*/src/modules/**/domain/**`.
- **application** (use-cases) depends on domain + `@kernel/core`. It may use the
  `@Injectable()` decorator and `@Inject(TOKEN)` for DI, but depends only on
  **ports** (interfaces + DI tokens), never concrete adapters.
- **infrastructure** implements the ports (TypeORM repository, mappers, ORM
  entities). It is the only layer that imports `typeorm`.
- **presentation** (controllers, request/response DTOs) is THIN: translate ->
  call one use-case -> map result. No business logic.

## 3. The kernel (`@kernel/core`)

Import everything from the barrel: `import { AggregateRoot, NotFoundError } from '@kernel/core'`.

| Export | Use |
|---|---|
| `Entity<TProps>` | identity-based entity base |
| `AggregateRoot<TProps>` | + `addDomainEvent` / `pullDomainEvents` |
| `ValueObject<T>` | structural-equality immutable value |
| `UniqueEntityID` | UUID identity; `isValidUuid(s)` |
| `DomainEvent`, `IDomainEventDispatcher`, `DOMAIN_EVENT_DISPATCHER` | events + dispatch port/token |
| `DomainError` + `NotFoundError`/`ConflictError`/`ValidationError`/`ForbiddenError` | each has a stable string `code` and optional `reason` |
| `Guard`, `invariant` | invariant helpers (throw `ValidationError`) |
| `CursorPage<T>`, `PageQuery`, `Cursor`, `makeCursorPage` | cursor pagination |
| `Clock`, `SystemClock`, `CLOCK` | injectable time |

## 4. How to add a feature module (step by step)

Replicate `src/modules/tenant` exactly. For a module `Foo`:

1. **domain/**
   - `foo.entity.ts` — `Foo extends AggregateRoot<FooProps>`; private constructor;
     static `create(...)` factory (applies invariants via `Guard`) and
     `fromSnapshot(...)` for rehydration; behavior methods raise domain events.
   - `value-objects/*.vo.ts` — wrap primitives; validate in factories.
   - `foo.events.ts` — `extends DomainEvent`, stable `eventName()`.
   - `foo.errors.ts` — extend the kernel error classes with module-specific codes.
   - `foo.repository.port.ts` — the `FooRepository` interface **and** the
     `FOO_REPOSITORY = Symbol('FOO_REPOSITORY')` DI token.
2. **application/**
   - `dto/foo.commands.ts` — plain command/query input shapes (no decorators).
   - `dto/foo.view.ts` — read-model view + `toFooView(aggregate)` mapper.
   - `use-cases/<verb>-foo.use-case.ts` — one `@Injectable()` class each with a
     single `execute(command)` method; `@Inject(FOO_REPOSITORY)` and
     `@Inject(CLOCK)`; depend on **ports only**.
3. **infrastructure/**
   - `foo.orm-entity.ts` — `@Entity({ name: 'foos' })`; pure data; carries
     `tenant_id` (see §5) for tenant-owned tables; `version:int` for ETag.
   - `foo.mapper.ts` — `toOrm` / `toDomain`.
   - `typeorm-foo.repository.ts` — `implements FooRepository`; resolve the
     `EntityManager` through `TenantContextService` so RLS applies (see §5).
4. **presentation/**
   - `dto/*.request.ts` — class-validator + `@ApiProperty` request DTOs.
   - `dto/foo.response.ts` — `@ApiProperty` response DTOs + `from(view)`.
   - `foo.controller.ts` — `@Controller({ path: 'foos', version: '1' })`,
     `@UseGuards(TenantContextGuard)`, thin handlers.
5. **`foo.module.ts`** — register controller + use-cases, and bind the port:
   `{ provide: FOO_REPOSITORY, useClass: TypeOrmFooRepository }`.
6. **__tests__/** — `<verb>-foo.use-case.spec.ts` (mock repo) and
   `foo.e2e-spec.ts` (supertest + in-memory repo override).
7. **Register** the module in `app.module.ts` (see §6).

> ORM entities are auto-discovered by glob (`modules/**/infrastructure/*.orm-entity.ts`)
> — there is no central entity registry to edit.

## 5. Tenant context & RLS pattern (DESIGN §6, §8.3)

Tenant isolation is enforced in **three layers**; this service owns the data layer.

1. **`TenantContextGuard`** (presentation) reads the tenant id and binds it into
   an `AsyncLocalStorage` store via `TenantContextService.enterWith({ tenantId })`.
   In production the tenant id is the verified JWT `tid` claim. **In this
   reference impl it is a validated `x-tenant-id` UUID header — a documented
   placeholder.** Swapping to real JWT means changing only `extractTenantId`.
2. **`RlsInterceptor`** (global) wraps each tenant-scoped request in a
   `QueryRunner` transaction and runs
   `SELECT set_config('app.current_tenant', <tenantId>, true)` (== `SET LOCAL`).
   It binds that runner into the tenant context, commits on success / rolls back
   on error, and releases the runner. When `DB_ENABLED=false` it is a pass-through.
3. **Postgres RLS** on each tenant-owned table:
   ```sql
   ALTER TABLE foos ENABLE ROW LEVEL SECURITY;
   CREATE POLICY foos_tenant_isolation ON foos
     USING (tenant_id = current_setting('app.current_tenant')::uuid);
   ```

**What repositories MUST do:** resolve the `EntityManager` through
`TenantContextService` (`store.queryRunner.manager`) so every statement runs
inside the RLS-scoped transaction. Falling back to `dataSource.manager` is only
for non-request contexts (jobs). See `typeorm-tenant.repository.ts`.

**What use-cases MUST do:** nothing tenant-specific — they are tenant-agnostic.
The tenant is ambient (context + RLS). Use-cases never read the tenant id to
filter; RLS does it. (The `tenants` table is special: a tenant row *is* the
boundary, so it has no `tenant_id` column.)

## 6. Module registration pattern

In `app.module.ts`, add the module to `imports` — one line, grouped under the
feature-modules comment:

```ts
imports: [
  ConfigModule,
  DatabaseModule,
  SharedModule,
  HealthModule,
  // --- Feature modules (replicate the Tenant module pattern) ---
  TenantModule,
  FooModule,   // <- add here
],
```

`AppModule` implements `NestModule` (for the `RequestContextMiddleware`). Feature
modules are plain `@Module({...})` classes named `<Feature>Module`.

## 7. Error handling (DESIGN §8.1)

- Domain code throws kernel `DomainError` subclasses, each with a **stable
  `code`** and optional `reason`. The domain never imports HTTP.
- `GlobalExceptionFilter` is the single translation point. It maps:

  | Error | HTTP | envelope `code` |
  |---|---|---|
  | `ValidationError` / Nest 400 | 400 | `validation_failed` |
  | Nest 401 | 401 | `unauthenticated` |
  | `ForbiddenError` / Nest 403 | 403 | `forbidden` |
  | `NotFoundError` / Nest 404 | 404 | `not_found` |
  | `ConflictError` / Nest 409 | 409 | `conflict` |
  | (rate limit) | 429 | `rate_limited` |
  | anything else | 500 | `internal_error` |

- Every 4xx/5xx body is the envelope:
  ```json
  { "error": { "code": "conflict", "message": "...", "reason": "...", "traceId": "trc_..." } }
  ```
  `traceId` comes from `RequestContextMiddleware` (honors inbound `x-trace-id`).
  `decisionId` is reserved for PDP responses (not used by the PAP CRUD endpoints).

## 8. Testing strategy

- **Unit (use-case) tests** — `*.spec.ts` next to the module under `__tests__/`.
  Construct the use-case directly with a hand-rolled mock repository (implements
  the port) and a fixed `Clock`. No NestJS, no DB. Fast and deterministic.
  Run with `pnpm test`.
- **E2E tests** — `*.e2e-spec.ts`. Boot the real `AppModule` via
  `Test.createTestingModule`, set `DB_ENABLED=false`, and
  `.overrideProvider(FOO_REPOSITORY).useClass(InMemoryFooRepository)` so the
  full HTTP -> guard -> pipe -> controller -> use-case -> filter stack runs
  without Postgres. Assert status codes AND the error envelope. Run with
  `pnpm test:e2e`.
- Integration against real Postgres (RLS verification) is left as a follow-up;
  the seams (`DATA_SOURCE`, `TenantContextService`) make it a drop-in.

## 9. Commands

```bash
corepack enable && pnpm install
pnpm build        # tsc project-references build of kernel + app
pnpm typecheck    # strict type check, no emit drift
pnpm lint         # typescript-eslint strict + dependency-rule enforcement
pnpm format       # prettier write
pnpm test         # jest unit tests (kernel + app)
pnpm test:e2e     # supertest e2e (no DB required)
```
