# 페이블 인계: PC·모바일 공동 사용을 위한 재계획

작성일: 2026-09-19. 저장소 `Yurang2/Seller`, 브랜치 `claude/hopeful-wright-olq2lc`, 기준 커밋 `4d0428286874c08b90a7d06dff9fd9f897392af9`.

## 사용자 요구와 현재 중단 지점

- 최초 지시: PLAN_NEXT 트랙 A부터 구현, 도메인·서비스·화면 유지, Workers 빌드 유지, A-4 완료 기준 6개 충족 후에만 B, 완료 후 같은 브랜치 커밋·푸시.
- 추가 요구: “핸드폰에서도 셀러 활동을 하고 싶다.” 로컬 PC 저장소만으로 충분한지 사용자가 재검토 중이며, 페이블에게 모바일부터 계획을 다시 잡도록 요청할 예정.
- 데스크톱 작업을 멈춘 상태. 트랙 C 우선 전환은 제안일 뿐 승인·배포하지 않았다. B도 시작하지 않았다.
- 사용자님의 후속 지시에 따라 이 문서와 현재 구현을 **같은 브랜치에 미완료 작업으로 커밋·푸시하여 인계**한다. 기준 커밋 이후의 최신 변경을 함께 읽어야 한다. 설치 파일은 로컬 `D:\Git\Seller\release`에 있으며 Git 추적 대상이 아니다.
- PLAN 3장 R-01~R-14는 유지한다. 사용자는 “사용자님”으로 부른다.

## 이미 있던 제품 기능 — 이번에 새로 만든 것이 아님

기준 커밋에 React 화면, Hono API, Cloudflare Workers·D1·R2 구조와 M0·M1·M2 기능이 존재한다. 초기 조사 가져오기, 상품·공급처·오퍼·배송 시나리오·요건 기록, Claim 증빙·신선도, 원가 계산·불변 스냅샷, 이유 있는 가격 결정·단계 전이, 등록 상품·판매 중 상태, 노트·작업·사업 준비, XLSX 가져오기, ZIP 내보내기·복원이 있다.

모바일을 위해 업무 규칙과 데이터 모델을 처음부터 다시 만들 이유는 아직 없다. 기존 앱의 화면과 실제 휴대폰 작업 흐름을 평가하고, 공유 저장소·인증·배포 계획을 먼저 확정하는 편이 합리적이다. 기존 문서의 과거 모바일 확인 기록을 이번 실제 기기 검증으로 취급하지 않는다.

## 이번에 추가한 것

| 영역 | 파일 | 내용 / 재계획 활용도 |
|---|---|---|
| SQLite 어댑터 | `src/platform/d1-shim.ts`, `migrate.ts`, `orm.ts` | D1 호출 표면, 원자적 batch, undefined→null, better-sqlite3 Drizzle, 마이그레이션 이력·멱등성. 모바일 웹 배포의 필수 요소는 아님. 향후 데스크톱 옵션·Node 테스트에 재사용 가능 |
| 파일 첨부 | `src/platform/storage.ts`, `blob-store.ts`, `desktop-env.ts` | 작은 BlobStore 계약과 로컬 파일 구현, 경로 이탈 방지. 웹에서는 기존 R2 사용 가능 |
| 데스크톱 요청 경계 | `src/platform/desktop-app.ts`, `electron/main.ts` | `protocol.handle` → fetch, 정적 파일·SPA·API, 포트 없는 구조, 요청 출처 검사, 창 격리, 단일 인스턴스, 폴더 열기. 웹 우선이면 보류 |
| 데스크톱 표시 | `electron/preload.ts` | 기존 React 파일을 수정하지 않고 설정 경로·폴더 버튼·실패 경고를 DOM에 추가. 웹/PWA 기능으로 그대로 채택할 대상은 아님 |
| 종료 백업 | `src/platform/backup.ts` | 변경 시 ZIP 저장, 같은 분 내 백업은 원자적 갱신, 최근 30개 유지, 실패 상태 저장·재시도. 웹은 브라우저 종료에 의존하지 않는 별도 백업 설계 필요 |
| 복원 비교 | `src/platform/verify-archive.ts`, `scripts/verify-desktop-backup.ts` | 전체 기록·원본 활동 이력·첨부 바이트 비교. 로컬 테스트 기반이며 검증 방법은 웹 배포에도 유용 |
| 공용 API 재실행 | `vitest.desktop.config.ts`, `tests/platform/api-bindings.ts` | 기존 `tests/api` 파일과 assertion을 바꾸지 않고 Miniflare 없이 데스크톱 저장소에서 동일 16개 테스트 실행 |
| 추가 검증 | `tests/platform/*.test.ts` | batch 롤백, null/results, 마이그레이션, 첨부 왕복·경로 차단, 인증, 프로토콜, 재시작 데이터 유지, 백업 복원·보관·실패 재시도 |
| Windows 패키지 | `electron-builder.yml`, `vite.desktop.config.ts`, `scripts/build-desktop.mjs`, `package.json` | NSIS 설치형·포터블 생성. 모바일 웹에는 필요 없음 |

공용 앱 변경은 `src/api/env.ts` 바인딩 타입 축소, `src/api/auth.ts`의 desktop+앱/루프백 조건, `src/db/repo/claims.ts`의 Drizzle import 교체다. `src/domain`, `src/api/services`, `src/web`의 기존 파일은 변경하지 않았다. 데스크톱 인증 우회를 원격 운영 모드에 적용해서는 안 된다.

## 실제 실행한 검증과 한계

- `pnpm test` 실행 당시: 도메인 **49개**, Workers API **16개**, 데스크톱 **20개** 통과. 기존 문서의 도메인 46개와 현재 실행 수가 다르므로 실제 출력 수를 기재한다.
- 이후 백업·프로토콜 검증을 추가한 최종 `pnpm test:desktop`: **23개 통과 = 기존 API 16 + 플랫폼 7**.
- `pnpm build`: 타입 검사와 Workers·클라이언트 빌드 통과. 기존 workspace 모듈의 동적/정적 import 중복 경고는 남았다.
- `pnpm desktop:build`: 타입 검사·번들·NSIS·포터블 생성 성공. `release/Seller-Setup-0.1.0.exe`, `release/Seller-Portable-0.1.0.exe` 생성. 코드 서명 인증서 설정 없음.
- 테스트에서 seed 후 SQLite를 닫고 다시 열어 상품 4개 유지 확인. 첨부 1개 포함 ZIP을 독립 빈 SQLite·파일 저장소에 복원하고 기록·이력·바이트 비교 통과.
- 실제 Windows 앱 실행을 시도했으나 컴퓨터 사용 도구의 앱 접근 승인이 시간 초과됨. **더블클릭 설치·바탕화면 실행·실제 창에서의 업로드·다운로드·종료 백업은 미검증**이다. 파일 생성 성공으로 사용 가능 판정을 하지 않는다.
- 마지막 추가한 `desktop:backup:verify` CLI는 실제 사용자의 ZIP으로 실행하지 않았다. 푸시 전 최종 `pnpm typecheck`, `pnpm test`(도메인 49 + Workers API 16 + 데스크톱 23 = 총 88개), `pnpm build`를 다시 실행해 모두 통과했다.
- Cloudflare 원격 배포·Access 정책 적용·휴대폰 실기기 검증은 이번 작업에서 하지 않았다. 과거 권한 문제는 기존 IMPLEMENTATION_STATUS에 있으며 지금 재확인이 필요하다.

## A-4 완료 여부 — 완료 아님

1. 설치·바탕화면 홈: 설치 파일만 생성, 실제 UI 미검증.
2. 초기 자료→재시작 유지: 어댑터 자동 테스트 통과, 설치 앱 조작 미검증.
3. 첨부·ZIP 내보내기/복원: 어댑터/API 테스트 통과, 설치 앱 파일 선택·다운로드 미검증.
4. 닫기→ZIP→새 설치 복원: 백업 함수와 독립 저장소 비교 통과, 실제 창 종료·새 설치에서 미검증.
5. 테스트·Workers 빌드: 마지막 CLI 추가 후 푸시 전 통합 재실행까지 통과(총 88개).
6. 사용 문서: README·LOCAL_GUIDE·IMPLEMENTATION_STATUS의 설치형 사용 안내 갱신 미완료. 모바일 우선 전환 검토로 보류.

## 페이블이 다시 정하면 좋은 범위

1. PC·휴대폰이 같은 웹 API·D1·R2를 사용하는 구조를 기본으로 할지 확정. 단순 모바일 지원과 오프라인 사용·기기간 동기화는 별도 요구로 구분.
2. 모바일에서 우선 할 활동 정의: 상품 링크·메모 빠른 기록, 사진/캡처 증빙 업로드, 기존 기록 조회·수정, 할 일 확인 등. 실제 사용자 우선순위를 먼저 확인.
3. 트랙 순서 변경 및 수용 기준 작성. 제안: 인증된 웹 배포 → 모바일 핵심 작업 실기기 검증 → 표 화면. 별도 네이티브 모바일 앱이나 PWA 오프라인 기능은 자동으로 범위에 넣지 않음.
4. Cloudflare 권한·도메인·Access 정책, 홈/정적/미등록 경로/API 모두의 미로그인 차단 검증, 기존 데이터 이전 여부와 복원 검증.
5. 웹 백업은 PC 앱 종료 훅을 재사용하지 않고 서버 측 실행·보관·실패 표시·복원 검증으로 설계. D1/R2 일관성도 고려.
6. 이번 데스크톱 변경은 보존할지, 별도 브랜치로 격리할지, 웹 우선 코드에서 제외할지 결정. 단순히 휴대폰 지원을 위해 로컬 앱을 외부에 노출하거나 ZIP 수동 이동을 동기화로 취급하지 않음.

미승인 제안은 DECISIONS의 IMP-09(포트 없는 개발 모드와 HMR), IMP-10(모바일 요구로 웹 배포 우선)을 참고한다. `desktop:dev`는 아직 구현하지 않았다. `.pnpm-store/`는 설치 시 생긴 로컬 캐시이며 인계 코드·커밋 대상이 아니다.

## 읽을 자료

- `docs/PLAN.md` 3장: R-01~R-14, 기존 사업 목표.
- `docs/DATA_MODEL.md`: 데이터 관계·불변 규칙.
- `docs/ARCHITECTURE.md`: 기존 웹 구조와 인증 수용 기준.
- `docs/IMPLEMENTATION_STATUS.md`: 기존 M0·M1·M2 구현과 원격 보류 사유, 상단의 이번 A-4 실제 확인 결과.
- `docs/PLAN_NEXT.md`: 재계획 대상인 A→B→C 순서.
- `docs/DECISIONS.md`: 기존 채택 결정 및 미승인 순서 변경안.
