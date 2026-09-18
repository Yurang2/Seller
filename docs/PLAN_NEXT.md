# 다음 단계 계획 · 2026-09-18 (Astra 6 위임용)

작성: Fable. 기준: 브랜치 `claude/hopeful-wright-olq2lc` HEAD `5072f10`(M0·M1·M2 + 검토 반영 + 종합 등급). 이 문서는 "무엇을 어떤 순서로 만들지"이며, 구현은 Astra 6가 한다.

사용자 요구 두 가지가 새로 들어왔다.
1. **터미널에서 서버를 띄우는 방식은 쓰지 않는다.** 더블클릭으로 켜지는 프로그램이어야 한다.
2. **에어테이블처럼 표로 쌓고 보는 방식**이 필요하다.

판단(사용자 확인 전 기본값): 1번은 **데스크톱 앱 포장(트랙 A)**으로 먼저 푼다. Cloudflare 배포(트랙 C)는 같은 코드로 나중에 켤 수 있게 호환을 유지한다. 2번은 별도 DB를 얹지 않고 **표 화면 + 사용자 정의 열(트랙 B)**로 푼다. 에어테이블을 저장소로 쓰는 것은 규칙(R-02·R-03·R-06)을 강제할 수 없어 채택하지 않는다(DECISIONS IMP-08).

순서: **A → B → C**. A가 끝나기 전에 B를 시작하지 않는다(사용자가 실행 방법 없이 표 화면만 받는 상황을 피한다).

---

## 트랙 A · 데스크톱 앱 포장 (Windows 우선)

### A-0 원칙
- 도메인·서비스·화면 코드는 그대로 둔다. 바뀌는 것은 "저장소 바인딩"뿐이다: D1 → 로컬 SQLite 파일, R2 → 로컬 폴더, Access 인증 → 데스크톱 모드에서 생략(로컬 프로세스만 접근).
- 같은 소스가 Workers 빌드(트랙 C)와 데스크톱 빌드 두 곳에서 돌아야 한다. 바인딩을 인터페이스로 두고 두 구현을 갖는다.
- 규칙 R-01~R-14는 그대로 적용된다. 특히 R-14: 앱 종료 시 자동 백업 ZIP.

### A-1 저장소 어댑터
- `src/platform/d1-shim.ts`: `better-sqlite3` 위에 D1 표면을 구현한다. 필요한 표면은 현재 코드가 쓰는 것뿐이다: `prepare(sql).bind(...args)`, `.first<T>()`, `.all<T>()`(`{ results }` 반환), `.run()`, `db.batch(statements)`(하나의 트랜잭션). `first()`는 없으면 `null`. 바인딩 값 중 `undefined`는 D1처럼 오류가 아니라 `null`로 다룬다(현재 코드가 undefined를 넘기는 곳이 있으면 고친다).
- `src/db/repo/claims.ts`의 drizzle 사용 4곳은 `drizzle-orm/d1` 대신 드라이버 팩토리(`src/platform/orm.ts`)를 통해 얻는다: Workers에서는 `drizzle-orm/d1`, 데스크톱에서는 `drizzle-orm/better-sqlite3`. 스키마(`src/db/schema.ts`)는 공용.
- `src/platform/blob-store.ts`: R2 표면 `put(key, body, {httpMetadata})`, `get(key)`(→ `{ body: ReadableStream, arrayBuffer() }` 또는 `null`), `delete(key)`를 파일 폴더로 구현한다. 사용처는 `src/api/index.ts:101`, `services/attachments.ts:53,77`, `exporters/archive.ts:104,338,354,377`뿐이다.
- 마이그레이션: `migrations/*.sql`을 순서대로 적용하는 러너(`src/platform/migrate.ts`)와 `_migrations` 테이블. Workers는 wrangler가 하므로 데스크톱 전용. `--> statement-breakpoint` 구분자를 그대로 쓴다.
- 인증: `src/api/auth.ts`에 `APP_ENV === "desktop"` 우회를 추가한다. 조건: 요청이 앱 자체 프로토콜/로컬 루프백에서만 온다.

### A-2 셸
- Electron(메인 프로세스 Node)에서 Hono `app.fetch`를 직접 호출한다. 포트를 열지 않는다: `protocol.handle("app", request => app.fetch(request, env))`로 `app://seller/…`에 정적 자산(`dist/client`)과 `/api/*`를 모두 처리한다. 창은 `app://seller/`를 연다.
- 데이터 위치: `%APPDATA%/Seller/seller.sqlite`, 첨부 `%APPDATA%/Seller/attachments/`, 백업 `Documents/Seller 백업/`. 설정 화면에 경로를 표시하고 "폴더 열기" 버튼을 둔다.
- 종료 시 자동 백업: 마지막 백업 후 변경이 있으면 ZIP을 `Documents/Seller 백업/YYYY-MM-DD_HHmm.zip`으로 저장(최근 30개 유지). 실패하면 종료를 막지 말고 다음 실행 때 홈에 경고를 띄운다.
- 빌드: `electron-builder` NSIS 설치 파일 + 포터블 exe. 코드 서명은 없음(설치 시 SmartScreen 경고가 뜬다는 안내를 README에 적는다).
- 자동 업데이트는 넣지 않는다(R-10: 동작하지 않는 기능 금지). "새 버전 확인"은 GitHub 릴리스 링크만.

### A-3 개발 절차
```
pnpm dev            # 기존 Workers 로컬(회귀 확인용)
pnpm desktop:dev    # Electron + Vite (HMR)
pnpm desktop:build  # 설치 파일 생성 → release/
pnpm test           # 기존 62개 + 어댑터 테스트
```
어댑터 테스트(`tests/platform/`): d1-shim이 `batch`를 트랜잭션으로 처리하는지(중간 실패 시 롤백), `first` null, `all.results`; blob-store put/get/delete 왕복; 마이그레이션 러너 멱등성. 그리고 **기존 API 테스트 전체를 데스크톱 어댑터로도 한 번 돌린다**(vitest 설정 하나 추가, 미니플레어 없이). 두 환경에서 같은 결과여야 한다.

### A-4 완료 기준
1. 설치 파일을 더블클릭해 설치하고 바탕화면 아이콘으로 실행하면 홈이 뜬다. 터미널 없음.
2. "초기 조사 기록 불러오기" → 재시작 후 데이터 유지.
3. 첨부 업로드·다운로드, 백업 ZIP 내보내기·복원이 로컬 파일로 동작한다.
4. 앱을 닫으면 백업 ZIP이 생기고, 그 ZIP을 새로 설치한 앱에 복원하면 같은 기록이 나온다(`pnpm backup:verify`와 같은 비교).
5. `pnpm test`에 어댑터 테스트가 포함돼 통과한다. Workers 빌드(`pnpm build`)도 여전히 통과한다.
6. IMPLEMENTATION_STATUS·LOCAL_GUIDE를 "설치해서 쓰는 법"으로 고친다.

---

## 트랙 B · 표 화면과 사용자 정의 열

### B-1 표 화면(그리드)
- 모든 기록 종류에 "카드 / 표" 전환. 표는 카탈로그 필드를 열로 쓰고, Claim은 "값 · 상태" 한 셀로 요약한다(예: `59.9 CNY · 추정`).
- 클라이언트 정렬·필터(열별 텍스트/선택값), 열 숨기기, 열 순서는 로컬 저장(브라우저 저장소 사용 가능: 편의 설정이므로).
- 셀 편집: 셀을 누르면 작은 편집창(값 + 이유). 이유 없는 저장은 없다(R-06). 관리 필드(`managed`)와 Claim은 표에서 직접 편집하지 않고 상세로 보낸다.
- 다중 선택 후 "이유 하나로 같은 값 일괄 변경"(예: 오퍼 5개 상태를 '탈락'으로) — 한 번의 이유가 각 기록의 활동 로그에 남는다.
- CSV 내보내기는 현재 필터·열 기준.

### B-2 사용자 정의 열
- 새 테이블 `custom_fields(id, record_type, key, label, kind enum(text,number,date,select,bool,url), options_json, sort_order, created_at, deleted_at)`와 `record_extras(record_type, record_id, key, value_json, updated_at)`.
- 규칙: 사용자 정의 열은 계산·판정·전이에 절대 쓰이지 않는다(메모 성격). 표·상세·내보내기·복원에 포함된다. 삭제는 소프트.
- 설정 화면에 "열 관리". 기록 종류별로 추가·이름 변경·숨김.

### B-3 완료 기준
- 오퍼 표에서 통화·실결제가 상태·공급처로 정렬·필터가 되고, 상태 일괄 변경이 이유와 함께 로그에 남는다.
- 사용자 정의 열 "구매 메모(텍스트)"를 오퍼에 추가하고 값을 넣은 뒤 백업·복원해도 남는다.
- 원가 계산 결과는 사용자 정의 열 값과 무관하다(테스트).

---

## 트랙 C · Cloudflare 배포 (보류 유지, 호환만 확보)

- 트랙 A 이후에도 `pnpm build && wrangler deploy`가 되도록 유지한다. `ARCHITECTURE.md` 12장 5번(도메인 전체 Access 로그인 강제)은 사용자가 Cloudflare 계정 설정을 마친 뒤 실제 배포로만 완료 처리한다.
- 데스크톱과 클라우드를 동시에 쓰는 경우의 동기화는 설계하지 않는다(단일 사용자·단일 저장소 원칙). 옮길 때는 백업 ZIP 복원으로 옮긴다.

---

## 트랙 D · 판매 중 상품 가격 감시 (M4 설계 메모, 지금 구현하지 않음)

- 대상은 판매 중 상품의 선택 오퍼뿐. 조사 단계 후보는 대상이 아니다.
- 실행 주체는 PC 보조 프로그램(트랙 A의 Electron 안에서 "감시" 메뉴로 붙일 수 있음). 타오바오·티몰은 로그인 벽·봇 차단·약관 때문에 서버에서 돌리지 않는다.
- 관찰값은 `estimated`·`source_type=api`로만 저장한다. 결정 원가 대비 5% 이상 벌어지면 막힘 작업을 만든다. `confirmed` 승격은 사람이 캡처를 올릴 때만(R-03).

---

## Astra 6에게 넘길 지시

```
저장소 Yurang2/Seller, 브랜치 claude/hopeful-wright-olq2lc (HEAD 5072f10 이후) 기준.
docs/PLAN_NEXT.md 를 읽고 트랙 A(데스크톱 앱 포장)부터 구현해.
- 도메인·서비스·화면 코드는 바꾸지 말고 저장소 바인딩만 어댑터로 분리해(A-1). Workers 빌드가 계속 통과해야 해.
- Electron은 포트를 열지 말고 protocol.handle 로 app.fetch 를 직접 호출해(A-2).
- 기존 API 테스트 16개를 데스크톱 어댑터로도 돌려서 같은 결과를 확인해(A-3).
- A-4 완료 기준 6개를 전부 채운 뒤에만 트랙 B로 넘어가.
- PLAN.md 3장 R-01~R-14는 그대로 적용. 문서와 다르게 해야 하면 docs/DECISIONS.md 에 제안→근거→대안으로 적고 물어봐.
- 사용자는 "사용자님"으로 부른다.
```
