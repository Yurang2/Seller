# 구현 상태 · 2026-09-16

기준: `Yurang2/Seller`, `claude/hopeful-wright-olq2lc`.
읽은 순서: README 구현자 안내 → PLAN → DATA_MODEL → ARCHITECTURE → SEED_RESEARCH → RESEARCH_SHEET.

## 골격 완료 기준

| 기준 | 상태 | 검증 |
|---|---|---|
| 1. `pnpm dev` 홈 / health 200 | 로컬 확인 | 홈 200, `/api/v1/health` 200, Vite + Workers + 로컬 D1 |
| 2. `0001_core.sql` 로컬·원격 적용 | 확인 | Drizzle 스키마에서 생성한 13개 테이블. 전용 원격 `seller-db` 생성 및 원격/로컬 apply 성공 |
| 3. UI Claim 생성·강등·재조회 | 확인 | 실제 브라우저에서 첨부 없는 확인 가격 입력 → 추정 강등 메시지 → 새로고침 후 같은 값 조회 |
| 4. ZIP → 빈 로컬 DB 복원 | 확인 | Workers API 테스트에서 독립 빈 D1/R2로 Claim·첨부 원본 복원 후 동등성 확인. 실제 개발 서버의 ZIP도 새 로컬 D1으로 restore.ts 미리보기 → 적용 완료 |
| 5. 배포 후 모든 경로 Access 차단 | 원격 대기 | API JWT 미들웨어 및 로컬 미인증/위조 토큰 거절 테스트 구현. 배포 및 도메인 전체 Access 로그인 검증은 미실시 |
| 6. costing.test.ts 회귀 테스트 | 확인 | 5,900원 고객 청구 배송비를 지출로 사용하면 거절, 미확인 전파, 증빙 강등 등 |

**골격 전체 완료 아님. M0·M1 미착수.** 원격 조건을 로컬 테스트로 대체해 통과 표시하지 않는다.
주문·채널·자동화 화면 및 가짜 동기화 상태는 없다. scheduled 핸들러는 현재 작업을 실행하지 않는다.

## 원격 검증 전 필요한 설정

현재 환경의 Cloudflare 토큰으로 인증 및 D1 목록·Access 앱 목록 조회는 가능했다.
Workers subdomain, Access 조직, R2 목록 API는 403(Authentication error)을 반환했다.
Access 앱 목록은 비어 있었다. 전용 DB `seller-db`를 생성하고 `0001_core.sql`을 원격 적용했다.
증빙 버킷 생성은 Authentication error(10000)로 실패했다. 버킷과 Worker는 생성하지 않았다.

- 사용하려는 계정의 Workers 배포, D1 생성·수정, R2 생성·수정, Access 앱·정책, 조직 설정에 필요한 권한/설정을 준비한다.
- Zero Trust 팀 도메인과 허용할 사용자 이메일을 확정한다.
- 원격 D1의 실제 `database_id`는 wrangler.jsonc에 반영했다. 나머지 원격 리소스와 `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` 설정이 필요하다.
- 도메인 전체의 Access 보호를 설정하고 배포 후 `/`, 정적 파일, 미등록 SPA 경로, `/api/v1/health`의 비로그인 차단을 확인한다.
- 비밀 값은 대화나 Git에 저장하지 않는다.

## 로컬 개발

```sh
pnpm install
# .dev.vars.example을 .dev.vars로 복사 (로컬 APP_ENV=development)
pnpm db:migrate:local
pnpm dev
pnpm test
pnpm build
```

이 Windows 환경에서는 workerd의 Documents 하위 영속 DB 접근이 실패했다.
선택적 `.env.local`의 `SELLER_LOCAL_STATE_DIR`를 앱 데이터 폴더로 지정하면 정상 동작한다.
Vite와 마이그레이션 스크립트는 같은 값을 사용한다. 기본값은 기존 `.wrangler/state` 동작이다.
로컬 개인 경로와 데이터는 Git에서 제외한다. 운영 배포의 D1/R2 위치에는 영향이 없다.

`@cloudflare/vitest-pool-workers`의 Vitest 4.1 호환성을 고정했다.
동봉된 테스트 workerd가 문서의 compatibility_date보다 오래돼 workerd 1.20260916.1로 고정했다.
패키지와 lockfile을 함께 보관한다.

## 다음 단계

1. DECISIONS.md의 IMP-01·IMP-02에 사용자 확인.
2. 골격의 원격 기준 완료, 또는 IMP-03의 검증 시점 변경에 사용자 확인.
3. M0 수용 기준 전체 구현·검증 후 M1.
4. M1은 research_template.xlsx 원가계산 CALC-EX1의 착지원가 14,607.86원 / 공헌이익 9,356.14원을 회귀 테스트로 비교한다.
