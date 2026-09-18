# 데이터 모델 v1

`PLAN.md`의 규칙(R-nn)을 저장 구조로 옮긴 문서. 물리 스키마(테이블·컬럼 이름)는 구현자가 정해도 되지만, **여기 적힌 필드·관계·불변 규칙(I-nn)·상태 전이는 유지**해야 한다.

## 0. 규약

- 모든 엔티티: `id`(ULID), `created_at`, `updated_at`, `deleted_at`(소프트 삭제). 시각은 UTC.
- 타입 표기: `text`, `int`, `bool`, `date`, `datetime`, `enum(...)`, `json`, `ref(Entity)`, `money`, `claim<kind>`.
- `money` = `{ amount_minor: int, currency: 'KRW'|'CNY'|'TWD'|'USD'|... }`. KRW·TWD는 1단위, CNY·USD는 1/100 단위. 원화 환산값은 저장하지 않고 FxRate 참조로 계산한다(R-05). 예외: 실제 카드 청구액처럼 "원화로 실제 발생한 값"은 별도 `money(KRW)` 필드로 저장한다.
- `claim<kind>`는 아래 1.1 Claim 구조를 따른다. kind: `money`, `percent`, `number`, `bool`, `text`, `enum`, `range`(min/likely/max), `days`.

## 1. 공통 패턴

### 1.1 Claim (사실 값) — R-01, R-02, R-03, R-07

권장 물리 구조: 단일 `claims` 테이블. 소유 엔티티는 `(owner_type, owner_id, field_key)`로 조회한다. 신선도 조회(재확인 기한 경과)를 한 번의 쿼리로 하기 위해서다.

| 필드 | 타입 | 설명 |
|---|---|---|
| owner_type, owner_id | text, ref | 소유 엔티티 |
| field_key | text | 예: `checkout_price`, `intl_shipping`, `children_product` |
| kind | enum | money/percent/number/bool/text/enum/range/days |
| status | enum(`confirmed`,`estimated`,`unknown`) | 미확인이면 value는 null |
| value_json | json | kind별 값. money는 `{amount_minor, currency}`, range는 `{min, likely, max, currency?}` |
| source_type | enum(`url`,`screenshot`,`message`,`call`,`document`,`competitor_observation`,`self_estimate`,`api`) | R-09: competitor_observation은 게이트·가격 결정의 단독 근거 불가 |
| source_ref | text | URL, 문서명, 대화 상대 등 |
| attachment_ids | json[] | 증빙. 외부 사실(오퍼 가격·배송, 구간 비용, 요율표, 관세·부가세, 채널 수수료)에서 `confirmed`이려면 1개 이상(I-01). 같은 소유자에 올린 이미지·PDF만 인정하며 다른 기록의 파일이나 텍스트 파일은 거부한다. 내 정책값(가정 판매가·청구 배송비·광고비·고정비)은 대상이 아니다 |
| checked_at | datetime | 확인 시각 |
| recheck_by | date | 필수. 기본값: 가격 30일, 배송 30일, 환율 1일, 요건 180일, 기타 90일 |
| note | text | 조건(옵션·수량·행사 등) |
| basis_json | json | 이 값이 성립하는 조건: `{quantity, option, includes[], per}` |

파생 규칙: `is_stale = status != unknown AND recheck_by < today`. 미확인 자리표시 값은 "조사 전"이지 "오래된 근거"가 아니므로 신선도 대상이 아니다. 파생값의 상태 = 입력 중 최약(R-04).

### 1.2 Attachment
`owner_type, owner_id, purpose enum(evidence, screenshot, invoice, receipt, label, document, other), r2_key, filename, mime, size, sha256, captured_at, note`.

### 1.3 Link (양방향 연결)
`from_type, from_id, to_type, to_id, relation enum(related, evidence_for, decided_by, supersedes, derived_from, blocks), note`. 지식 노트·결정·엔티티를 자유롭게 잇는다.

### 1.4 ActivityLog — R-06, R-14
`entity_type, entity_id, action enum(create, update, transition, delete, restore, import, job), before_json, after_json, reason, actor text('user' | 'job:<key>' | 'import:<batch_id>'), at`. 모든 쓰기에 기록한다. 홈 "이어서 하기"는 `actor='user'`의 최근 항목을 엔티티별로 묶어 만든다.

### 1.5 Task (할 일·막힘)
| 필드 | 타입 |
|---|---|
| title, detail | text |
| entity_type, entity_id | 선택 |
| source | enum(`manual`,`derived`) |
| rule_key | text (derived일 때) |
| status | enum(`todo`,`doing`,`blocked`,`done`,`cancelled`) |
| priority | int 1(막힘 해소) 2(기한 초과) 3(단계 필수) 4(권장) |
| due_at, completed_at | datetime |
| blocked_kind | enum(`external`,`decision`,`internal`) |
| blocked_reason, unblock_condition | text (blocked면 필수) |
| recheck_at | date (blocked면 필수) |

I-12: 열린 derived Task는 `(rule_key, entity_type, entity_id)`로 유일. 조건 해소 시 자동 `done`.

### 1.6 Note / Decision / Sop (지식)
- **Note**: `type enum(concept, research, competitor_observation, meeting, journal), title, body_md, tags json[], pinned bool`.
- **Decision**: `code text(D-01…, 자동 채번 가능), title, context, decision, rationale, alternatives_json[{option, why_not}], consequences, status enum(proposed, accepted, superseded, rejected), decided_at, revisit_when text, revisit_at date, superseded_by ref(Decision)`. `decision`과 `rationale`은 필수(R-06).
- **Sop**(절차): `key, title, steps_json[{n, text, check}], inputs, outputs, failure_handling, automation_state enum(none, file, api), job_key`.

### 1.7 Setting
`key, value_json`. 필수 키: `business_model enum(undecided, purchase_agency, import_resale, hybrid, domestic_wholesale)`, `mode_override enum(auto, research, operations)`, `default_fx_source`, `pii_retention_days`, `recheck_defaults_json`, `target_margin_rate`, `monthly_fixed_costs money(KRW)`, `expected_monthly_units int`.

### 1.8 FxRate
`base_currency, quote_currency('KRW'), rate text(decimal), as_of_date, kind enum(reference, card_actual, manual), source, note`. Costing은 특정 FxRate를 참조해 얼린다.

### 1.9 CostLineType (비용 항목 사전) — I-11
`code(pk), name, direction enum(income, expense), stage enum(sale, purchase, transport, customs, channel, other), payer_default enum(me, customer, supplier, by_model), basis enum(per_item, per_order, per_parcel, per_kg, per_purchase, percent_of_price, per_month), is_system bool, active bool`. 초기값은 PLAN 8.1.

## 2. 도메인 엔티티

### 2.1 Character
`name_ko, name_en, rights_holder claim<text>, kr_licensee claim<text>, notes`.

### 2.2 ComplianceProfile (판매 요건 프로필, G-01)
`character_id ref, category enum(plush, plush_keyring, acrylic, stationery, other), model_scope enum(purchase_agency, import_resale, both), gate_result enum(pass, conditional, fail, unknown), gate_reason text, gate_set_by enum(derived, manual), reviewed_at, recheck_by`.

**RequirementItem**: `profile_id, key enum(children_product, kc, trademark_license, parallel_import, copyright_import, design_right, customs_ip_watch, platform_ip_report, listing_assets, customs, labeling, channel_policy, return_policy), question, answer claim<enum|text>, risk_level enum(low, medium, high), item_result enum(pass, conditional, fail, unknown), condition_text, evidence(Link/Attachment)`.

파생: `gate_result`는 항목 판정에서만 집계된다(어떤 항목이든 `fail`이면 `fail`, 미판정이 남으면 `unknown`, `conditional`이 있으면 `conditional`, 그 외 `pass`). 수동 판정 경로는 두지 않는다. 항목 판정의 근거 규칙(I-14): `competitor_observation`은 거부, 위험도 `high` 항목의 통과·조건부는 `confirmed` 답변 + 첨부 또는 `evidence_for` 링크 필요, `self_estimate` 답변으로는 `low`가 아닌 항목을 `pass`로 판정할 수 없다.

### 2.3 Product / ProductVariant
**Product**: `name, character_id, profile_id, category, option_scheme enum(designated, random, set), age_marking claim<text>, status enum(discovered, researching, costing, pricing, listing_ready, live, paused, discontinued, rejected, on_hold), status_reason, stage_entered_at, hold_recheck_at, chosen_offer_id, chosen_scenario_id, current_costing_id, decided_price money, decided_customer_shipping_fee money, pricing_decision_id ref(Decision), competitor_refs json[{url, price money, observed_at, note}], images json[]`.

**ProductVariant**: `product_id, name, option_kind enum(designated, random), random_pool_desc, sku_internal, weight_g claim<number>, dims_mm claim<text>`.

### 2.4 Supplier / SupplierMessage
**Supplier**: `name, name_local, platform enum(taobao, tmall, 1688, ruten, other), seller_type enum(brand_flagship, authorized, general, unknown), store_url, country, contact_channels json, ships_to_kr claim<bool>, payment_methods json[], trust_notes, last_contact_at`.

**SupplierMessage**: `supplier_id, at, direction enum(out, in), summary, attachment_ids`.

### 2.5 Offer (오퍼·견적, G-02)
| 필드 | 타입 |
|---|---|
| supplier_id, product_id, variant_id? | ref |
| url | text |
| option_desc | text |
| option_kind | enum(unknown, single, set, random, designated) |
| set_composition, random_rule | text (예: "4개 구매 시 중복 없음") |
| quantity_tier_min, quantity_tier_max, moq | int |
| currency | text |
| listed_price | claim<money> (표시가) |
| checkout_price | claim<money> (실결제가, 행사·쿠폰 반영) |
| includes_shipping_to | enum(unknown, none, cn_domestic, kr) |
| cn_domestic_shipping | claim<money> |
| intl_shipping_by_seller | claim<money> (직배송 시 판매자 청구액) |
| lead_time_days | claim<range> |
| authenticity_evidence | enum(unknown, official_license_mark, authorization_doc, seller_claim, none) + attachment |
| status | enum(candidate, verified, rejected, chosen) |
| rejection_reason | text |

I-09: `status=chosen`은 Decision 참조 필수. 같은 상품에 chosen은 하나.

### 2.6 ForwarderService / RateCard
**ForwarderService**: `name, url, warehouse_address text, currency, notes`.
**RateCard**: `forwarder_id, name, effective_from, weight_bands json[{max_g, price claim<money>}], volumetric_rule text, includes_kr_domestic claim<bool>, customs_handling_fee claim<money>, insurance claim<money|percent>, consolidation_fee claim<money>, repack_fee claim<money>, est_days claim<range>, attachment_ids`.

### 2.7 ShippingScenario / ShippingLeg
**ShippingScenario**: `product_id, offer_id?, name, route_type enum(direct, forwarder), parcel_items claim<number>, parcel_weight_g claim<number>, customs_mode enum(list_clearance, general, unknown), duty claim<money|percent>, vat claim<money|percent>, est_total_days claim<range>, warnings json[] (파생), is_default bool`.

**ShippingLeg**: `scenario_id, seq, from_node, to_node enum(seller, forwarder_cn, kr_customs, customer_kr), carrier_or_service, cost claim<money>, basis enum(per_parcel, per_kg, per_item, per_order), includes json[cost_code], rate_card_id?, est_days claim<range>`.

I-06: 어떤 leg의 `includes`에 있는 cost_code가 다른 leg의 비용 항목으로도 존재하면 `warnings`에 중복 경고를 저장한다(저장은 허용).

### 2.8 Costing (원가·손익 스냅샷) — R-08, R-11
`product_id, offer_id, scenario_id, channel_id?, qty_assumption int, items_per_order int, fx_rate_id, inputs_frozen json (사용한 모든 Claim의 status·value·source·checked_at), lines json[{code, per_unit_minor, status}], outputs json{landed_per_unit, channel_cost_per_unit, contribution_per_unit, margin_rate, breakeven_price, net_est_per_unit, tax_revenue_basis?}, overall_status enum(confirmed, estimated, unknown), unknown_keys json[], is_current bool, decision_id?, note`.

I-05: `unknown_keys`가 비어 있지 않으면 `outputs`는 null이고 `overall_status=unknown`. 저장 후 입력 Claim이 바뀌어도 스냅샷은 불변. 화면은 현재 Claim과 비교해 "현재 값과 다름" 표시.

### 2.9 Channel / Listing
**Channel**: `name, type enum(smartstore, coupang, cafe24, other), account_ref, commission_rate claim<percent>, payment_fee_rate claim<percent>, fee_applies_to_shipping claim<bool>, settlement_cycle claim<text>, policies json{shipping_fee_policy, return_policy_text, purchase_agency_notice, random_notice}, integration_state enum(none, file, api, error), connector_id?`.

**Listing**: `channel_id, product_id, variant_id?, external_id, url, listed_price money(KRW), customer_shipping_fee money(KRW), disclosures json{purchase_agency_notice, random_notice, origin_notice, return_notice}, assets_source enum(unknown, own_photo, licensed, seller_provided_with_permission), status enum(draft, live, paused, ended), last_verified_at date, costing_id (등록 시점 예상), notes`. `live` 조건: 채널 상품 번호 또는 URL, 등록 판매가, `assets_source != unknown`, 노출 확인일, 상품이 `listing_ready/live/paused`, 등록 판매가 = 결정 판매가.

### 2.10 Customer — R-13
`channel_id, external_customer_ref, name, phone, address json{postcode, addr1, addr2}, customs_code_enc text(암호화), customs_code_verified claim<bool>, pii_retention_until date, consent_note`.
I-10: 통관부호는 평문 저장 금지. 기본 내보내기는 이름·전화·주소·통관부호 마스킹.

### 2.11 Order / OrderLine
**Order**: `channel_id, external_order_id, ordered_at, customer_id, status enum(new, confirmed, awaiting_purchase, purchased, in_transit_cn, at_forwarder, international_transit, customs, domestic_transit, delivered, completed, cancelled, return_requested, returned, refunded, issue), status_override bool, status_reason, items_total money, customer_shipping_fee money, discounts money, channel_fee_expected money, expected_snapshot json (Listing.costing 복사), business_model_at_order enum, needs_customs_code bool, evidence json{agency_notice: bool, settlement: bool, purchase_receipt: bool, shipping_list: bool}, notes`.
I-07: `(channel_id, external_order_id)` 유일. 가져오기는 갱신(upsert).

**OrderLine**: `order_id, listing_id, variant_id, qty, unit_price money, po_line_id?, allocated_costs json{code: amount_minor}, line_status`.

### 2.12 PurchaseOrder / PurchaseOrderLine
**PurchaseOrder**: `supplier_id, supplier_order_no, ordered_at, paid_at, status enum(draft, ordered, paid, shipped, arrived, cancelled), currency, goods_amount money, shipping_amount money, fees money, card_fx_rate_id?, krw_charged money(KRW), destination enum(customer, forwarder), ship_to_snapshot json, attachment_ids`.
**PurchaseOrderLine**: `po_id, offer_id, order_line_id?, qty, unit_price money, is_stock bool`.

### 2.13 Shipment / ShipmentLeg / ShipmentLine / TrackingEvent
**Shipment**: `route_type, forwarder_id?, status enum(preparing, cn_domestic, at_forwarder, international, customs, kr_domestic, delivered, lost, returned), actual_weight_g, dims_mm, customs json{mode, duty money, vat money, cleared_at, holder enum(customer, business)}, allocation_rule enum(by_qty, by_weight, by_value), next_check_at, customer_count int(파생)`.
**ShipmentLeg**: `shipment_id, seq, from_node, to_node, carrier, tracking_no, cost money, status, started_at, ended_at`.
**ShipmentLine**: `shipment_id, order_line_id, qty`.
**TrackingEvent**: `shipment_id, leg_seq, at, status_code, description, raw json, source enum(manual, api), connector_key?, external_event_id`(중복 방지).

I-08: `business_model=purchase_agency`이고 `customer_count > 1`이면 경고 저장 + derived Task(blocked, decision) 생성.
비용 배분: 소포 비용은 `allocation_rule`로 OrderLine.allocated_costs에 기록되고 OrderPnL이 읽는다.

### 2.14 Inquiry / ReturnCase
**Inquiry**: `order_id?, channel_id, type enum(shipping, defect, exchange, return, other), status enum(open, answered, closed), opened_at, due_at, messages json[], resolution`.
**ReturnCase**: `order_line_id, type enum(return, exchange, refund_only), reason_code enum(random_not_wanted, defect, wrong_item, delay, change_of_mind, other), reason_text, status enum(requested, approved, rejected, in_return, received, refunded, closed), return_shipping_payer enum(customer, me), overseas_return_required bool, refund_amount money, costs json[{code, money}], resale_possible bool, outcome, closed_at`.

### 2.15 Transaction / SettlementStatement / OrderPnL
**Transaction**(실제 현금 흐름): `at, direction enum(in, out), amount money, fx_rate_id?, krw_amount money(KRW), cost_code ref(CostLineType), counterparty, entity_type?, entity_id?, evidence_attachment_id?, memo, source enum(manual, import)`.
I-11: `direction`은 `CostLineType.direction`과 일치해야 한다.

**SettlementStatement**: `channel_id, period_start, period_end, gross money, fees money, net money, paid_at, attachment_id, lines json[{external_order_id, gross, fee, net}]`. 가져오기 시 Order와 매칭해 `evidence.settlement=true`.

**OrderPnL**(파생, 저장 가능): `order_id, computed_at, lines json{code: {expected_minor, actual_minor, status}}, totals json{income, cost, contribution, margin_rate}, tax_revenue_basis money?(구매대행 수수료), completeness json`.

### 2.16 ReadinessItem (사업 준비 체크리스트)
`key, title, category enum(decision, legal, tax, customs, channel, finance, logistics, policy, ops), status enum(not_started, in_progress, blocked, done, not_applicable), depends_on json[key], evidence(Link/Attachment), due_at, recheck_at, notes, blocks json[]('product:listing_ready' 등)`. 초기값 PLAN 2.3.

### 2.17 Connector / Job / JobRun / JobRunItem / ImportBatch
**Connector**: `key, name, state enum(none, file, api, error), config json(비밀 제외), secret_ref, last_success_at, last_error, notes`.
**Job**: `key, connector_id?, trigger enum(manual, cron, webhook), cron_expr, enabled, dry_run_default, last_run_id, next_run_at`.
**JobRun**: `job_id, started_at, ended_at, status enum(queued, running, succeeded, partial, failed), trigger_source, dry_run bool, summary json{total, ok, skipped, failed}, error`.
**JobRunItem**: `run_id, external_key, status enum(ok, skipped, failed), message, retryable bool, retried_in_run_id?`.
**ImportBatch**: `kind enum(orders, settlement, tracking, excel_research), filename, mapping json, rows_total, rows_ok, rows_failed, results json[], applied bool`.

## 3. 상태 전이 요약

| 엔티티 | 전이 | 조건(뒤로 갈 때) |
|---|---|---|
| Product | discovered→researching | 캐릭터·카테고리·프로필 연결 |
| | researching→costing | 첨부 있는 오퍼 ≥1, 시나리오 ≥1, 프로필 ≠ fail |
| | costing→pricing | 현재 스냅샷 존재, unknown_keys 비어 있음 |
| | pricing→listing_ready | Decision(가격) 저장, 프로필 pass/conditional, ReadinessItem 중 `blocks`에 해당 항목 done |
| | listing_ready→live | 이 상품의 Listing status=live ≥1. live→paused 허용, paused→live는 live Listing 필요. 앞으로 갈 때는 새로 들어가는 단계의 조건만 검사 |
| | 어디서든→on_hold/discontinued/rejected | 이유 필수, on_hold는 재검토일 필수 |
| | 앞 단계로 | 이유만 있으면 허용 |
| Order | 파생 기본, override 시 이유 | PLAN 7.2 |
| PurchaseOrder | draft→ordered→paid→shipped→arrived / cancelled | paid는 실결제액 필수 |
| Shipment | preparing→…→delivered / lost / returned | 각 leg 송장 입력 시 진행 |
| Task | todo↔doing→done, →blocked(사유·조건·재확인일), →cancelled(이유) | |
| JobRun | queued→running→succeeded/partial/failed | 동일 Job 동시 실행 금지 |

## 4. 파생 작업 규칙 (초기)

| rule_key | 조건 | 제목 | 우선순위 | 자동 완료 |
|---|---|---|---|---|
| `decide_business_model` | Setting.business_model=undecided | 사업 모델 결정(D-01) | 1(blocked, decision) | 결정 시 |
| `profile_gate_unknown` | Profile.gate_result=unknown이고 연결 상품 존재 | 요건 확인: {profile} | 1 | 결과 확정 시 |
| `product_needs_profile` | Product.status=discovered, profile 없음 | 요건 프로필 연결 | 3 | 연결 시 |
| `product_needs_offer` | researching, 오퍼 0 | 공급처 오퍼 입력 | 3 | 오퍼 ≥1 |
| `product_needs_scenario` | researching, 시나리오 0 | 배송 시나리오 만들기 | 3 | ≥1 |
| `costing_unknown` | 현재 스냅샷 unknown_keys 비어 있지 않음 | 미확인 확인: {keys} | 1 | 비면 |
| `claim_stale` | Claim.recheck_by 경과, 소유 엔티티 활성 | 재확인: {field} | 2 | 갱신 시 |
| `pricing_needs_decision` | pricing, decision 없음 | 가격 결정 기록 | 3 | 저장 시 |
| `order_customs_code` | needs_customs_code, 고객 통관부호 없음 | 통관부호 요청 | 2 | 입력 시 |
| `order_purchase_due` | awaiting_purchase 24h 초과 | 해외 발주 | 2 | purchased |
| `shipment_stale` | next_check_at 경과 또는 이벤트 없음 N일 | 배송 상태 확인 | 2 | 새 이벤트 |
| `shipment_multi_customer` | I-08 | 합포장 검토(구매대행) | 1 | 분리 시 |
| `inquiry_overdue` | open 24h | 문의 답변 | 2 | answered |
| `order_evidence_missing` | completed인데 evidence 미완 | 증빙 첨부 | 3 | 4/4 |
| `jobrun_failed_items` | retryable 실패 항목 존재 | 재처리 | 2 | 재처리 성공 |
| `readiness_recheck` | ReadinessItem blocked, recheck_at 경과 | 재확인: {item} | 2 | 상태 변경 |
| `product_needs_listing` | listing_ready/live인데 live Listing 없음 | 채널에 올리고 등록 상품 기록 | live면 1, 아니면 3 | live Listing 생성 |

`profile_gate_unknown`·`costing_unknown`·`decide_business_model`은 `blocked`로 생성되며 사유·해제 조건·재확인일을 갖는다(PLAN 5.4).

## 5. 내보내기·가져오기

- ZIP 구조: `manifest.json{schema_version, exported_at, pii_mode: masked|full, counts}`, `entities/<name>.json`(배열), `entities/<name>.csv`, `attachments/manifest.json`(r2_key, sha256, owner), 선택적으로 첨부 파일 본체.
- 가져오기: id 기준 upsert. 먼저 dry-run 보고서(추가/갱신/충돌 건수) 후 적용. 스키마 버전이 낮으면 마이그레이션 적용.
- 엑셀 조사 파일: `ImportBatch(kind=excel_research)`. 열 매핑을 저장하고 행별로 Product/Supplier/Offer/Claim을 만든다. 첨부 없는 가격은 `estimated`(I-01). 사용자가 행별 결과를 검토한 뒤 적용.

## 6. 개인정보 처리

- 저장 최소화: 이름·전화·주소·통관부호·채널 고객 참조만. 생년월일·이메일은 필요 시에만.
- 통관부호: 애플리케이션 계층 암호화(키는 Worker secrets). 화면은 마스킹 기본, 클릭 시 전체 표시 + ActivityLog.
- 보관: `pii_retention_until = 배송 완료 + Setting.pii_retention_days`. `pii_retention_cleanup` Job이 지나면 개인 필드를 비운다(주문·손익 데이터는 유지).
