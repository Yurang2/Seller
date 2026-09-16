# 기술 구조 설계 v1 (D-05 결정)

- 결정일: 2026-09-16. 사용자 확인 결과 기존 웹 골격은 없다. 이 문서가 골격의 기준이다.
- 대상: 구현자(Astra 6). `PLAN.md` 11장의 전제를 구체화한 것.

## 1. 스택 결정

| 층 | 선택 | 이유 |
|---|---|---|
| 실행 환경 | **Cloudflare Workers** 하나 (API + 정적 프론트 서빙) | 사용자의 Cloudflare 계정, 서버 관리 없음, 크론 내장 |
| 데이터베이스 | **D1** (SQLite) | 단일 사용자·수천 건 규모에 충분, 마이그레이션 도구 내장 |
| 파일 | **R2** 버킷 2개: `seller-attachments`(증빙), `seller-backups`(백업) | 캡처·영수증·백업 ZIP |
| 스케줄 | **Cron Triggers** (`scheduled` 핸들러) | Job 실행 |
| 인증 | **Cloudflare Access** (이메일 OTP 또는 Google) + Worker에서 Access JWT 검증 | 로그인 화면을 만들지 않고도 혼자만 접근 |
| API 프레임워크 | **Hono** | Workers 친화, 가볍고 타입 좋음 |
| ORM·마이그레이션 | **Drizzle ORM** (`drizzle-orm/d1`) + `drizzle-kit generate` → `migrations/*.sql` → `wrangler d1 migrations apply` | 스키마를 TypeScript로 관리하고 SQL 마이그레이션 파일을 남김 |
| 검증·타입 공유 | **Zod** 스키마를 `src/domain`에 두고 API·UI가 공유 | 한 곳에서 필드 규칙 유지 |
| 프론트 | **React + TypeScript + Vite**, 라우팅 React Router, 서버 상태 TanStack Query, 스타일 Tailwind | 폼·표 위주 화면에 충분, 학습 자료 많음 |
| 빌드 | **@cloudflare/vite-plugin** (Worker + SPA를 하나의 Vite 설정으로 빌드·개발) | `wrangler dev`와 Vite HMR을 같이 씀 |
| 테스트 | **Vitest**. 도메인은 순수 Node 테스트, API는 `@cloudflare/vitest-pool-workers` | 계산 규칙·상태 전이를 반드시 테스트 |
| 소수 계산 | 금액은 정수(최소 단위), 비율은 bp(1% = 100), 환율은 문자열 소수 + `big.js` | 부동소수 오차 방지 |
| 패키지 관리 | pnpm | |

선택하지 않은 것과 이유: Pages Functions(Workers 정적 자산이 후속 표준), Supabase/외부 DB(계정·비용 분산), Next.js(SSR 불필요), 로그인 직접 구현(Access가 대체).

## 2. 저장소 구조

```
/
  package.json            pnpm 스크립트
  wrangler.jsonc          Worker·D1·R2·크론·정적 자산 설정
  vite.config.ts          @cloudflare/vite-plugin + React
  drizzle.config.ts       out: ./migrations, dialect: sqlite (d1)
  tsconfig.json
  .dev.vars.example       로컬 비밀 예시(실제 .dev.vars는 커밋 금지)
  migrations/             0001_core.sql … (drizzle-kit이 생성, 손으로 수정 가능)
  src/
    domain/               순수 TS. Cloudflare 의존 없음. 단위 테스트 대상
      types/              엔티티 타입, Zod 스키마 (DATA_MODEL.md 대응)
      claim.ts            Claim 상태 전파(min), 신선도, 확인 조건(I-01)
      money.ts            Money·환율 환산(big.js)
      costing.ts          원가 계산 엔진 computeCosting()
      transitions.ts      상태 전이 규칙(Product/Order/PO/Shipment/Task)
      derivedTasks.ts     파생 작업 규칙(rule_key)
      nextAction.ts       nextAction(entity)
      costLineTypes.ts    비용 항목 사전 초기값
    db/
      schema.ts           drizzle 스키마
      repo/               엔티티별 쿼리(활동 로그·소프트 삭제 포함)
      seed/               SEED_RESEARCH.md → 초기 데이터 스크립트
    api/
      index.ts            Worker 진입점: fetch(Hono) + scheduled(Job 디스패치)
      auth.ts             Access JWT 검증 미들웨어
      routes/             /api/v1/*
      services/           도메인 함수 호출·트랜잭션·활동 로그 (R-12의 "하나의 함수")
      jobs/               Job 레지스트리·실행기·JobRun 기록
      importers/          파일 가져오기(엑셀·CSV) 매핑
      exporters/          내보내기 ZIP, 복원
      crypto.ts           개인정보 암호화(AES-GCM, WebCrypto)
    web/
      main.tsx, routes/, pages/, components/, api/(fetch 클라이언트), state/
  tests/
    domain/               costing·claim·transitions·derivedTasks 테스트
    api/                  라우트·가져오기 멱등성·내보내기 왕복 테스트
  docs/                   기획 문서(이 저장소)
  templates/              조사 시트 템플릿
```

경계 규칙: `src/domain`은 `src/db`·`src/api`·`src/web`를 import하지 않는다. `src/web`은 `src/domain/types`만 import한다(계산은 서버에서).

## 3. wrangler.jsonc (초안)

```jsonc
{
  "name": "seller",
  "main": "src/api/index.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "seller-db", "database_id": "<wrangler d1 create 결과>", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [
    { "binding": "ATTACHMENTS", "bucket_name": "seller-attachments" },
    { "binding": "BACKUPS", "bucket_name": "seller-backups" }
  ],
  "triggers": { "crons": ["*/30 * * * *", "0 18 * * *"] },
  "vars": {
    "APP_ENV": "production",
    "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com",
    "ACCESS_AUD": "<Access 애플리케이션 AUD 태그>"
  }
}
```

- 크론은 UTC다. `0 18 * * *` = 한국 03:00(백업). `*/30`은 Job 디스패처(활성 Job 중 실행 시각이 된 것만 실행).
- 비밀(`wrangler secret put`): `ENCRYPTION_KEY`(32바이트 base64), 채널 API 키(`SMARTSTORE_CLIENT_ID`, `SMARTSTORE_CLIENT_SECRET` 등, M4에서).
- 정적 자산 경로는 vite-plugin 기본값을 따른다.

## 4. 인증

- Cloudflare Zero Trust에서 Self-hosted 애플리케이션을 만들고 Worker 도메인 전체를 보호한다. 정책: 사용자 이메일 1개 허용.
- Worker는 모든 `/api/*` 요청에서 `Cf-Access-Jwt-Assertion` 헤더의 JWT를 `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`의 공개키로 검증하고(`jose`), `aud`가 `ACCESS_AUD`와 일치하는지 확인한다. 헤더만 믿지 않는다.
- 로컬 개발(`APP_ENV=development`)에서는 검증을 건너뛰고 `actor='user'`로 고정한다.

## 5. API 규약

- 경로 `/api/v1/<entities>`. JSON. ID는 ULID 문자열. 시각은 ISO 8601 UTC.
- 목록: `GET /api/v1/products?status=researching&limit=50&cursor=…`. 상세: `GET /api/v1/products/:id` (연결된 Claim·첨부·작업·활동 요약 포함).
- 생성·수정: `POST`, `PATCH`. 상태 전이는 별도: `POST /api/v1/products/:id/transition { to, reason }` → 조건 미충족 시 `409 { missing: [...] }`.
- Claim: `PUT /api/v1/claims { owner_type, owner_id, field_key, … }`(upsert). 첨부 없는 가격 Claim의 `confirmed` 요청은 `estimated`로 저장하고 응답에 `downgraded: true`.
- 첨부: `POST /api/v1/attachments` (multipart, Worker가 R2에 스트리밍), `GET /api/v1/attachments/:id`(R2에서 스트리밍, 인증 뒤). 직접 공개 URL을 만들지 않는다.
- 오류: `{ error: { code, message, details } }`. 검증 실패 `400`, 전이 불가 `409`, 없음 `404`.
- 모든 쓰기는 `services/`에서 트랜잭션 + ActivityLog. 라우트는 얇게.
- 원가: `POST /api/v1/costings/preview`(저장 없이 계산), `POST /api/v1/costings`(스냅샷 저장).
- 홈: `GET /api/v1/home` 한 번에 위젯 데이터를 모아 준다(이어서 하기, 준비, 막힘, 다음 행동, 파이프라인, 신선도, 자동화, 돈).

## 6. 도메인 핵심 함수 시그니처

```ts
// src/domain/claim.ts
type ClaimStatus = 'confirmed' | 'estimated' | 'unknown'
function weakest(...s: ClaimStatus[]): ClaimStatus
function isStale(c: Claim, today: string): boolean

// src/domain/costing.ts
function computeCosting(input: CostingInput): CostingResult
// CostingInput: offer·scenario·channel·qty·fx 의 Claim 값들
// CostingResult: { overallStatus, unknownKeys: string[], lines, outputs | null }
// 규칙: unknownKeys.length > 0 이면 outputs = null (R-02)

// src/domain/transitions.ts
function canTransition(entity, to, ctx): { ok: true } | { ok: false, missing: string[] }

// src/domain/derivedTasks.ts
function deriveTasks(snapshot: DomainSnapshot): DerivedTask[]   // rule_key 기준 멱등

// src/api/services/orders.ts  (R-12: 수동·파일·API가 같은 함수)
function upsertOrder(input: ExternalOrder, source: 'manual'|'import'|'api', actor: string): Promise<Order>
function addTrackingEvent(shipmentId, event, source): Promise<void>
```

## 7. M0 핵심 스키마 (migrations/0001_core.sql)

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('evidence','screenshot','invoice','receipt','label','document','other')),
  r2_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, captured_at TEXT, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);

CREATE TABLE claims (
  id TEXT PRIMARY KEY, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, field_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('money','percent','number','bool','text','enum','range','days')),
  status TEXT NOT NULL CHECK (status IN ('confirmed','estimated','unknown')),
  value_json TEXT,
  source_type TEXT CHECK (source_type IN ('url','screenshot','message','call','document','competitor_observation','self_estimate','api')),
  source_ref TEXT, checked_at TEXT, recheck_by TEXT NOT NULL, note TEXT, basis_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE (owner_type, owner_id, field_key)
);
CREATE INDEX idx_claims_recheck ON claims(recheck_by) WHERE deleted_at IS NULL;

CREATE TABLE claim_attachments (
  claim_id TEXT NOT NULL REFERENCES claims(id), attachment_id TEXT NOT NULL REFERENCES attachments(id),
  PRIMARY KEY (claim_id, attachment_id)
);

CREATE TABLE links (
  id TEXT PRIMARY KEY, from_type TEXT NOT NULL, from_id TEXT NOT NULL, to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('related','evidence_for','decided_by','supersedes','derived_from','blocks')),
  note TEXT, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_links_from ON links(from_type, from_id);
CREATE INDEX idx_links_to ON links(to_type, to_id);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','transition','delete','restore','import','job')),
  before_json TEXT, after_json TEXT, reason TEXT, actor TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, at);
CREATE INDEX idx_activity_actor ON activity_log(actor, at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT,
  entity_type TEXT, entity_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('manual','derived')), rule_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('todo','doing','blocked','done','cancelled')),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
  due_at TEXT, completed_at TEXT,
  blocked_kind TEXT CHECK (blocked_kind IN ('external','decision','internal')),
  blocked_reason TEXT, unblock_condition TEXT, recheck_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  CHECK (status <> 'blocked' OR (blocked_reason IS NOT NULL AND unblock_condition IS NOT NULL AND recheck_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_tasks_derived_open ON tasks(rule_key, entity_type, entity_id)
  WHERE source = 'derived' AND status NOT IN ('done','cancelled') AND deleted_at IS NULL;

CREATE TABLE notes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('concept','research','competitor_observation','meeting','journal')),
  title TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY, code TEXT UNIQUE, title TEXT NOT NULL, context TEXT,
  decision TEXT NOT NULL, rationale TEXT NOT NULL, alternatives_json TEXT NOT NULL DEFAULT '[]', consequences TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','superseded','rejected')),
  decided_at TEXT, revisit_when TEXT, revisit_at TEXT, superseded_by TEXT REFERENCES decisions(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE sops (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, steps_json TEXT NOT NULL DEFAULT '[]',
  inputs TEXT, outputs TEXT, failure_handling TEXT,
  automation_state TEXT NOT NULL DEFAULT 'none' CHECK (automation_state IN ('none','file','api')), job_key TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE fx_rates (
  id TEXT PRIMARY KEY, base_currency TEXT NOT NULL, quote_currency TEXT NOT NULL DEFAULT 'KRW',
  rate TEXT NOT NULL, as_of_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reference','card_actual','manual')), source TEXT NOT NULL, note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (base_currency, quote_currency, as_of_date, kind, source)
);

CREATE TABLE cost_line_types (
  code TEXT PRIMARY KEY, name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('income','expense')),
  stage TEXT NOT NULL CHECK (stage IN ('sale','purchase','transport','customs','channel','other')),
  payer_default TEXT NOT NULL CHECK (payer_default IN ('me','customer','supplier','by_model')),
  basis TEXT NOT NULL CHECK (basis IN ('per_item','per_order','per_parcel','per_kg','per_purchase','percent_of_price','per_month')),
  is_system INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('orders','settlement','tracking','excel_research')),
  filename TEXT NOT NULL, mapping_json TEXT NOT NULL, rows_total INTEGER NOT NULL DEFAULT 0,
  rows_ok INTEGER NOT NULL DEFAULT 0, rows_failed INTEGER NOT NULL DEFAULT 0, results_json TEXT NOT NULL DEFAULT '[]',
  applied INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
```

M1 이후 테이블(`characters`, `compliance_profiles`, `requirement_items`, `products`, `product_variants`, `suppliers`, `supplier_messages`, `offers`, `forwarder_services`, `rate_cards`, `shipping_scenarios`, `shipping_legs`, `costings`, `readiness_items`, 그리고 M3의 주문 계열, M4의 `connectors`/`jobs`/`job_runs`/`job_run_items`)는 `DATA_MODEL.md`의 필드를 같은 규약(ULID, created/updated/deleted_at, CHECK로 enum 고정)으로 만든다. I-01(확인 조건)·I-05(미확인 전파)·I-08(합포장 경고) 같은 규칙은 SQL이 아니라 `src/domain`과 `services/`에서 강제하고 테스트한다.

## 8. Job 실행기

- `scheduled(event)`: `event.cron`으로 분기. `*/30`이면 `jobs` 테이블에서 `enabled=1 AND next_run_at <= now`인 Job을 순회.
- 실행 전 `job_runs`에 `running` 행을 넣고, 같은 Job의 `running` 행이 있으면 건너뛴다(중복 실행 금지). 15분 넘은 `running`은 `failed`로 정리.
- 각 항목은 `job_run_items`에 결과. 실패·재시도 가능 항목은 재처리 큐. `POST /api/v1/jobs/:key/run?dry_run=1`로 수동 실행.
- M0에서는 Job 테이블 없이 수동 내보내기만. M4에서 `backup_export`(매일), `fx_refresh`, `pii_retention_cleanup`, 채널 주문 수집이 붙는다.

## 9. 백업·복원

- 내보내기: `GET /api/v1/export?pii=masked|full` → ZIP(`manifest.json`, `entities/*.json`, `entities/*.csv`, `attachments/manifest.json`). ZIP 생성은 `fflate`.
- 백업 Job: 같은 함수를 호출해 `BACKUPS` 버킷에 `backups/YYYY-MM-DD.zip` 저장, 30일 지난 것 삭제.
- 복원: `scripts/restore.ts`(로컬 Node)가 ZIP을 읽어 `/api/v1/import`로 upsert. dry-run 보고 후 적용.
- 2차 방어: `wrangler d1 export seller-db --output backup.sql`을 주 1회 수동 실행하는 SOP.

## 10. 개인정보 암호화

- `crypto.ts`: `ENCRYPTION_KEY`로 AES-GCM. 저장 형식 `v1:<iv b64>:<ciphertext b64>`. 통관부호·전화번호에 적용.
- 목록 API는 마스킹(`010-****-1234`, `P1234*******`). 전체 표시는 `GET /api/v1/customers/:id?reveal=1`이며 ActivityLog에 남긴다.

## 11. 개발·배포 절차

```bash
pnpm install
pnpm exec wrangler d1 create seller-db            # database_id를 wrangler.jsonc에 기입
pnpm exec wrangler r2 bucket create seller-attachments
pnpm exec wrangler r2 bucket create seller-backups
pnpm db:generate                                  # drizzle-kit generate → migrations/
pnpm db:migrate:local                             # wrangler d1 migrations apply seller-db --local
pnpm dev                                          # vite (cloudflare plugin) – 로컬 D1·R2 에뮬레이션
pnpm test
pnpm db:migrate:remote && pnpm deploy             # wrangler deploy
pnpm exec wrangler secret put ENCRYPTION_KEY
```

Cloudflare 대시보드: Zero Trust → Access → Applications → Self-hosted로 Worker 도메인 보호, AUD 태그를 `ACCESS_AUD`에 기입.

## 12. "골격 완료"의 정의 (M0 착수 조건)

1. `pnpm dev`로 홈 화면이 뜨고 `/api/v1/health`가 200을 준다.
2. `0001_core.sql`이 로컬·원격에 적용된다.
3. Claim 하나를 UI에서 만들고(첨부 없이 `confirmed` 시도 → `estimated`로 강등 표시) 다시 읽는다.
4. 내보내기 ZIP을 받아 빈 로컬 DB에 복원하면 같은 Claim이 나온다.
5. 배포 후 Access 로그인 없이는 아무 경로도 열리지 않는다.
6. `tests/domain/costing.test.ts`에 5,900원 사례(청구 배송비를 지출 항목으로 넣으면 검증 실패)와 미확인 전파 테스트가 있다.
