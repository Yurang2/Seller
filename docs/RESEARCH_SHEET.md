# 조사 시트 열 구조 (templates/research_template.xlsx)

엑셀 조사 파일을 프로그램의 데이터 모델과 같은 구조로 맞춘 것. 소싱·구매대행 업체가 쓰는 조사 시트(상품·공급처·견적·물류·원가)를 기본으로 하되, 모든 금액에 상태(확인/추정/미확인)를 붙였다. M0의 "가져오기"는 이 열 이름을 그대로 읽는다.

## 사용 규칙

- 파란 글씨는 입력, 검은 글씨는 수식. 노란 배경 헤더는 원가 계산의 필수 입력. 회색 행은 예시(가상 값).
- 모르는 금액은 비운다. 0은 "0원임을 확인"했을 때만 적는다. 비어 있으면 원가 계산이 "미확인 N개"를 표시한다.
- 금액은 원래 통화로 적고, 환산은 원가계산 탭의 환율 칸에서만 한다. 한 계산 행에서는 외화 1종(오퍼 통화)만 가정한다.
- 가격·배송 견적은 캡처 파일명이 있어야 확인이다. 경쟁사관찰 탭은 근거로 쓰지 않는다(R-09).
- ID 규칙: 상품 P-, 공급처 S-, 오퍼 O-, 시나리오 SC-, 계산 CALC-, 경쟁사 C-, 요건 프로필 R-, 결정 D-, 작업 T-.

## 탭과 열

### 상품

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 상품ID | P-001 형식. 다른 탭에서 이 ID로 참조 |  | `Product.id` |
| B | 상품명 | 내부 이름 |  | `Product.name` |
| C | 캐릭터 | 예: 핑구 |  | `Character.name` |
| D | 카테고리 |  | 봉제인형, 인형 키링, 아크릴, 문구, 기타 | `Product.category` |
| E | 옵션방식 | 지정/랜덤/세트 | 지정, 랜덤, 세트 | `Product.option_scheme` |
| F | 연령표시 | 제품·페이지의 대상 연령 표기(예: 14세 이상). 모르면 비움 |  | `Product.age_marking` |
| G | 상태 | 파이프라인 단계 | 발견, 조사, 원가확인, 가격결정, 등록준비, 판매중, 일시정지, 중단, 탈락, 보류 | `Product.status` |
| H | 요건프로필ID | 요건 탭의 프로필ID |  | `Product.profile_id` |
| I | 선택오퍼ID | 가격 결정에 쓴 오퍼 |  | `Product.chosen_offer_id` |
| J | 선택시나리오ID | 가격 결정에 쓴 배송 시나리오 |  | `Product.chosen_scenario_id` |
| K | 결정판매가(KRW) | 결정 탭에 이유가 있어야 함 |  | `Product.decided_price` |
| L | 결정청구배송비(KRW) | 고객에게 받는 배송비(수입 항목) |  | `Product.decided_customer_shipping_fee` |
| M | 경쟁사참고URL | 참고용. 근거 아님 |  | `Product.competitor_refs[].url` |
| N | 경쟁사가격(KRW) | 참고용. 근거 아님 |  | `Product.competitor_refs[].price` |
| O | 경쟁사관찰일 | YYYY-MM-DD |  | `Product.competitor_refs[].observed_at` |
| P | 메모 |  |  | `note` |

### 공급처

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 공급처ID | S-001 형식 |  | `Supplier.id` |
| B | 이름 |  |  | `Supplier.name` |
| C | 현지이름 | 중국어·현지 표기 |  | `Supplier.name_local` |
| D | 플랫폼 |  | 타오바오, 티몰, 1688, 루텐, 기타 | `Supplier.platform` |
| E | 판매자유형 | 旗舰店=브랜드공식, 授权店=인가 | 브랜드공식, 인가, 일반, 미상 | `Supplier.seller_type` |
| F | 매장URL |  |  | `Supplier.store_url` |
| G | 국가 |  |  | `Supplier.country` |
| H | 연락수단 | 왕왕/알리왕왕/메시지 등 |  | `Supplier.contact_channels` |
| I | 한국직배송 |  | 가능, 불가, 미확인 | `Supplier.ships_to_kr.value` |
| J | 한국직배송상태 |  | 확인, 추정, 미확인 | `Supplier.ships_to_kr.status` |
| K | 결제수단 | 카드/알리페이 등 |  | `Supplier.payment_methods` |
| L | 신뢰메모 | 평점·거래 이력·응답 속도 |  | `Supplier.trust_notes` |
| M | 마지막연락일 | YYYY-MM-DD |  | `Supplier.last_contact_at` |

### 오퍼

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 오퍼ID | O-001 형식 |  | `Offer.id` |
| B | 상품ID | 상품 탭 |  | `Offer.product_id` |
| C | 공급처ID | 공급처 탭 |  | `Offer.supplier_id` |
| D | 상품URL |  |  | `Offer.url` |
| E | 옵션설명 |  |  | `Offer.option_desc` |
| F | 옵션종류 |  | 단품, 세트, 랜덤, 지정 | `Offer.option_kind` |
| G | 세트구성 |  |  | `Offer.set_composition` |
| H | 랜덤규칙 | 예: 4개 구매 시 중복 없음 |  | `Offer.random_rule` |
| I | 수량구간최소 |  |  | `Offer.quantity_tier_min` |
| J | 수량구간최대 |  |  | `Offer.quantity_tier_max` |
| K | MOQ | 최소 주문 수량 |  | `Offer.moq` |
| L | 통화 |  | CNY, TWD, USD, JPY, KRW | `Offer.currency` |
| M | 표시가 | 페이지에 보이는 가격(원래 통화) |  | `Offer.listed_price.value` |
| N | 표시가상태 |  | 확인, 추정, 미확인 | `Offer.listed_price.status` |
| O | 실결제가 | 결제 화면 기준(행사·쿠폰 반영). 모르면 비움 |  | `Offer.checkout_price.value` |
| P | 실결제가상태 |  | 확인, 추정, 미확인 | `Offer.checkout_price.status` |
| Q | 배송포함범위 | 가격에 포함된 배송 | 없음, 중국내, 한국까지, 미확인 | `Offer.includes_shipping_to` |
| R | 중국내배송비 | 판매자→대행창고(원래 통화) |  | `Offer.cn_domestic_shipping.value` |
| S | 중국내배송비상태 |  | 확인, 추정, 미확인 | `Offer.cn_domestic_shipping.status` |
| T | 판매자국제배송비 | 직배송 시 판매자 청구액(원래 통화) |  | `Offer.intl_shipping_by_seller.value` |
| U | 판매자국제배송비상태 |  | 확인, 추정, 미확인 | `Offer.intl_shipping_by_seller.status` |
| V | 리드타임일 | 발송까지 걸리는 일수 |  | `Offer.lead_time_days.value` |
| W | 리드타임상태 |  | 확인, 추정, 미확인 | `Offer.lead_time_days.status` |
| X | 정품근거 |  | 공식라이선스표기, 授权서류확인, 판매자주장, 없음, 미확인 | `Offer.authenticity_evidence` |
| Y | 출처유형 |  | url, 캡처, 메시지, 통화, 문서, 경쟁사관찰, 자체추정 | `Claim.source_type` |
| Z | 출처링크 |  |  | `Claim.source_ref` |
| AA | 캡처파일명 | 캡처 없으면 "확인" 불가 |  | `Claim.attachment_ids` |
| AB | 확인일 | YYYY-MM-DD |  | `Claim.checked_at` |
| AC | 재확인기한 | 기본 확인일+30일 |  | `Claim.recheck_by` |
| AD | 오퍼상태 |  | 후보, 검증, 탈락, 선택 | `Offer.status` |
| AE | 탈락사유 |  |  | `Offer.rejection_reason` |
| AF | 메모 |  |  | `note` |

### 배송시나리오

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 시나리오ID | SC-001 형식 |  | `ShippingScenario.id` |
| B | 상품ID |  |  | `ShippingScenario.product_id` |
| C | 오퍼ID |  |  | `ShippingScenario.offer_id` |
| D | 이름 |  |  | `ShippingScenario.name` |
| E | 경로 |  | 직배송, 배송대행 | `ShippingScenario.route_type` |
| F | 소포당개수 | 한 상자에 몇 개 |  | `ShippingScenario.parcel_items.value` |
| G | 소포당개수상태 |  | 확인, 추정, 미확인 | `ShippingScenario.parcel_items.status` |
| H | 소포무게g |  |  | `ShippingScenario.parcel_weight_g.value` |
| I | 소포무게상태 |  | 확인, 추정, 미확인 | `ShippingScenario.parcel_weight_g.status` |
| J | 구간1 출발→도착 | 비우면 이 구간 없음 | 판매자→한국고객, 판매자→대행창고, 대행창고→한국통관, 한국통관→고객 | `ShippingLeg[1].from_to` |
| K | 구간1 서비스 | 운송사·대행업체·요율표 |  | `ShippingLeg[1].carrier_or_service` |
| L | 구간1 비용 | 소포당. 0이면 0을 적고 상태 확인. 모르면 비움 |  | `ShippingLeg[1].cost.value` |
| M | 구간1 통화 |  | CNY, KRW, USD, TWD, JPY | `ShippingLeg[1].cost.currency` |
| N | 구간1 상태 |  | 확인, 추정, 미확인 | `ShippingLeg[1].cost.status` |
| O | 구간1 포함항목 | 이 견적에 포함된 것(예: 국내택배) |  | `ShippingLeg[1].includes` |
| P | 구간2 출발→도착 | 비우면 이 구간 없음 | 판매자→한국고객, 판매자→대행창고, 대행창고→한국통관, 한국통관→고객 | `ShippingLeg[2].from_to` |
| Q | 구간2 서비스 | 운송사·대행업체·요율표 |  | `ShippingLeg[2].carrier_or_service` |
| R | 구간2 비용 | 소포당. 0이면 0을 적고 상태 확인. 모르면 비움 |  | `ShippingLeg[2].cost.value` |
| S | 구간2 통화 |  | CNY, KRW, USD, TWD, JPY | `ShippingLeg[2].cost.currency` |
| T | 구간2 상태 |  | 확인, 추정, 미확인 | `ShippingLeg[2].cost.status` |
| U | 구간2 포함항목 | 이 견적에 포함된 것(예: 국내택배) |  | `ShippingLeg[2].includes` |
| V | 구간3 출발→도착 | 비우면 이 구간 없음 | 판매자→한국고객, 판매자→대행창고, 대행창고→한국통관, 한국통관→고객 | `ShippingLeg[3].from_to` |
| W | 구간3 서비스 | 운송사·대행업체·요율표 |  | `ShippingLeg[3].carrier_or_service` |
| X | 구간3 비용 | 소포당. 0이면 0을 적고 상태 확인. 모르면 비움 |  | `ShippingLeg[3].cost.value` |
| Y | 구간3 통화 |  | CNY, KRW, USD, TWD, JPY | `ShippingLeg[3].cost.currency` |
| Z | 구간3 상태 |  | 확인, 추정, 미확인 | `ShippingLeg[3].cost.status` |
| AA | 구간3 포함항목 | 이 견적에 포함된 것(예: 국내택배) |  | `ShippingLeg[3].includes` |
| AB | 통관방식 |  | 목록통관, 일반통관, 미확인 | `ShippingScenario.customs_mode` |
| AC | 관세(KRW 소포당) | 없으면 0을 적고 상태 확인 |  | `ShippingScenario.duty.value` |
| AD | 관세상태 |  | 확인, 추정, 미확인 | `ShippingScenario.duty.status` |
| AE | 부가세(KRW 소포당) |  |  | `ShippingScenario.vat.value` |
| AF | 부가세상태 |  | 확인, 추정, 미확인 | `ShippingScenario.vat.status` |
| AG | 예상총일수 |  |  | `ShippingScenario.est_total_days` |
| AH | 확인일 |  |  | `Claim.checked_at` |
| AI | 출처/캡처 |  |  | `Claim.source_ref` |
| AJ | 메모 | 중복 경고 등 |  | `note` |

### 원가계산

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 계산ID | CALC-001 형식 |  | `Costing.id` |
| B | 상품ID |  |  | `Costing.product_id` |
| C | 오퍼ID | 오퍼 탭에서 실결제가·통화를 가져옴 |  | `Costing.offer_id` |
| D | 시나리오ID | 배송시나리오 탭에서 구간·관세를 가져옴 |  | `Costing.scenario_id` |
| E | 채널 |  | 스마트스토어, 카페24, 쿠팡, 기타 | `Costing.channel_id` |
| F | 계산일 | YYYY-MM-DD |  | `Costing.created_at` |
| G | 환율(외화1→KRW) | 오퍼 통화 기준. 모르면 비움 |  | `Costing.fx_rate_id` |
| H | 환율날짜 |  |  | `FxRate.as_of_date` |
| I | 환율출처 | 은행 고시/카드 실제 |  | `FxRate.source` |
| J | 판매가(KRW) | 검토할 판매가 |  | `sale_price` |
| K | 청구배송비(KRW) | 고객에게 받을 배송비(주문당). 없으면 0 |  | `customer_shipping_fee` |
| L | 주문당개수 | 보통 1 |  | `items_per_order` |
| M | 채널판매수수료율 | 예: 5.5% → 0.055 |  | `channel_commission` |
| N | 결제수수료율 |  |  | `payment_processing_fee` |
| O | 수수료 배송비적용 | 청구 배송비에도 수수료가 붙는 채널이면 예 | 예, 아니오 | `Channel.fee_applies_to_shipping` |
| P | 해외결제수수료율 | 카드 해외결제·환가료 |  | `payment_fx_fee` |
| Q | 검수포장비(KRW 개당) |  |  | `inspection_packaging` |
| R | 반품예비율 | 판매가 대비 |  | `returns_reserve` |
| S | 광고비(KRW 월) |  |  | `ads` |
| T | 고정비(KRW 월) |  |  | `fixed_costs` |
| U | 예상월판매개수 |  |  | `expected_monthly_units` |
| V | 메모 |  |  | `note` |
| W | 실결제가(외화) | 오퍼 탭 조회 |  | `lookup Offer.checkout_price` |
| X | 실결제가상태 |  |  | `lookup` |
| Y | 오퍼통화 |  |  | `lookup Offer.currency` |
| Z | 소포당개수 | 시나리오 탭 조회 |  | `lookup` |
| AA | 소포당개수상태 |  |  | `lookup` |
| AB | 구간1 |  |  | `lookup` |
| AC | 구간1비용 |  |  | `lookup` |
| AD | 구간1통화 |  |  | `lookup` |
| AE | 구간1상태 |  |  | `lookup` |
| AF | 구간2 |  |  | `lookup` |
| AG | 구간2비용 |  |  | `lookup` |
| AH | 구간2통화 |  |  | `lookup` |
| AI | 구간2상태 |  |  | `lookup` |
| AJ | 구간3 |  |  | `lookup` |
| AK | 구간3비용 |  |  | `lookup` |
| AL | 구간3통화 |  |  | `lookup` |
| AM | 구간3상태 |  |  | `lookup` |
| AN | 관세(KRW) |  |  | `lookup` |
| AO | 관세상태 |  |  | `lookup` |
| AP | 부가세(KRW) |  |  | `lookup` |
| AQ | 부가세상태 |  |  | `lookup` |
| AR | 미확인개수 | 하나라도 있으면 아래 결과는 "미확인" |  | `Costing.unknown_keys.length` |
| AS | 추정개수 |  |  | `derived` |
| AT | 결과상태 | 확인 / 추정 포함 / 미확인 N개 |  | `Costing.overall_status` |
| AU | 개당매입원가(KRW) | 실결제가×환율×(1+해외결제수수료율) |  | `outputs.purchase_per_unit` |
| AV | 개당운송원가(KRW) | (구간 비용 합+관세+부가세)/소포당개수 |  | `outputs.transport_per_unit` |
| AW | 개당착지원가(KRW) | 매입+운송+검수포장 |  | `outputs.landed_per_unit` |
| AX | 개당수입(KRW) | 판매가+청구배송비/주문당개수 |  | `outputs.income_per_unit` |
| AY | 개당채널비용(KRW) | (판매가[+청구배송비])×(판매수수료율+결제수수료율) |  | `outputs.channel_cost_per_unit` |
| AZ | 개당공헌이익(KRW) | 수입−착지−채널−판매가×반품예비율 |  | `outputs.contribution_per_unit` |
| BA | 마진율 | 공헌이익/수입 |  | `outputs.margin_rate` |
| BB | 개당순이익추정(KRW) | 공헌이익−(광고비+고정비)/예상월판매개수 |  | `outputs.net_est_per_unit` |
| BC | 손익분기판매가(KRW) | 공헌이익 0이 되는 판매가 |  | `outputs.breakeven_price` |

### 경쟁사관찰

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 관찰ID | C-001 형식 |  | `Note(competitor_observation)` |
| B | 경쟁사 |  |  | |
| C | URL |  |  | |
| D | 상품명 |  |  | |
| E | 판매가(KRW) |  |  | |
| F | 소비자가(KRW) | 표시 정가 |  | |
| G | 배송비규칙 |  |  | |
| H | 배송기간 |  |  | |
| I | 옵션·랜덤규칙 |  |  | |
| J | 표기(KC/원산지/수입자) |  |  | |
| K | 관찰일 |  |  | |
| L | 캡처파일명 |  |  | |
| M | 메모 | 이 탭의 내용은 근거가 아니라 참고(R-09) |  | |

### 요건

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 프로필ID | R-001 형식(캐릭터×카테고리) |  | `ComplianceProfile.id` |
| B | 캐릭터 |  |  | `ComplianceProfile.character_id` |
| C | 카테고리 |  | 봉제인형, 인형 키링, 아크릴, 문구, 기타 | `ComplianceProfile.category` |
| D | 항목키 |  | children_product, kc, trademark_license, parallel_import, copyright_import, design_right, customs_ip_watch, platform_ip_report, listing_assets, customs, labeling, channel_policy, return_policy | `RequirementItem.key` |
| E | 질문 |  |  | `RequirementItem.question` |
| F | 답변 |  |  | `RequirementItem.answer.value` |
| G | 상태 |  | 확인, 추정, 미확인 | `RequirementItem.answer.status` |
| H | 항목결과 |  | 통과, 조건부, 실패, 미확인 | `RequirementItem.item_result` |
| I | 조건 | 조건부일 때 지켜야 할 것 |  | `RequirementItem.condition_text` |
| J | 위험도 |  | 낮음, 중간, 높음 | `RequirementItem.risk_level` |
| K | 출처 |  |  | `Claim.source_ref` |
| L | 확인일 |  |  | `Claim.checked_at` |
| M | 재확인기한 | 기본 확인일+180일 |  | `Claim.recheck_by` |

### 결정

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 코드 | D-01 형식 |  | `Decision.code` |
| B | 제목 |  |  | `Decision.title` |
| C | 맥락 |  |  | `Decision.context` |
| D | 결정 |  |  | `Decision.decision` |
| E | 이유 | 필수 |  | `Decision.rationale` |
| F | 대안 |  |  | `Decision.alternatives_json` |
| G | 결과·영향 |  |  | `Decision.consequences` |
| H | 상태 |  | 제안, 채택, 대체, 기각 | `Decision.status` |
| I | 결정일 |  |  | `Decision.decided_at` |
| J | 재검토조건 |  |  | `Decision.revisit_when` |

### 작업

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 작업ID | T-001 형식 |  | `Task.id` |
| B | 제목 |  |  | `Task.title` |
| C | 관련ID | 상품/오퍼/프로필/결정 ID |  | `Task.entity_id` |
| D | 우선순위 | 1 막힘해소, 2 기한초과, 3 단계필수, 4 권장 | 1, 2, 3, 4 | `Task.priority` |
| E | 상태 |  | 할일, 진행, 막힘, 완료, 취소 | `Task.status` |
| F | 기한 |  |  | `Task.due_at` |
| G | 막힘사유 | 막힘이면 필수 |  | `Task.blocked_reason` |
| H | 해제조건 | 막힘이면 필수 |  | `Task.unblock_condition` |
| I | 재확인일 | 막힘이면 필수 |  | `Task.recheck_at` |
| J | 메모 |  |  | `Task.detail` |

### 환율

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 날짜 | YYYY-MM-DD |  | `FxRate.as_of_date` |
| B | 통화 |  | CNY, TWD, USD, JPY | `FxRate.base_currency` |
| C | 원화환율 | 외화 1단위당 KRW |  | `FxRate.rate` |
| D | 종류 |  | 기준, 카드실제, 수동 | `FxRate.kind` |
| E | 출처 |  |  | `FxRate.source` |
| F | 메모 |  |  | `FxRate.note` |

### 비용항목

| 열 | 헤더 | 설명 | 허용 값 | 데이터 모델 대응 |
|---|---|---|---|---|
| A | 코드 |  |  | `CostLineType.code` |
| B | 이름 |  |  | `CostLineType.name` |
| C | 방향 |  | 수입, 지출 | `CostLineType.direction` |
| D | 단계 |  | 판매, 매입, 운송, 통관, 채널, 기타 | `CostLineType.stage` |
| E | 부담 |  | 나, 고객, 공급처, 모델에따라 | `CostLineType.payer_default` |
| F | 발생단위 |  | 개당, 주문당, 소포당, kg당, 발주당, 판매가의%, 월 | `CostLineType.basis` |
| G | 설명 |  |  | |

## 원가계산 탭의 수식 규칙

- `미확인개수` = 실결제가·환율·판매가·청구배송비·주문당개수·수수료율·검수포장비·반품예비율·소포당개수·사용 중인 구간 비용·관세·부가세 중 비어 있거나 상태가 "미확인"인 것의 수.
- `미확인개수 > 0`이면 모든 결과 칸은 숫자 대신 "미확인"이다(R-02). 조회한 값이 비어 있으면 0이 아니라 빈칸으로 취급한다.
- `추정개수 > 0`이면 결과상태는 "추정 포함".
- 개당매입원가 = 실결제가 × 환율(오퍼 통화가 KRW면 1) × (1 + 해외결제수수료율)
- 개당운송원가 = (구간1~3 비용의 원화 환산 합 + 관세 + 부가세) ÷ 소포당개수. 비어 있는 구간은 없는 것으로 본다.
- 개당착지원가 = 매입 + 운송 + 검수포장비
- 개당수입 = 판매가 + 청구배송비 ÷ 주문당개수
- 개당채널비용 = (판매가 + [청구배송비 ÷ 주문당개수, 수수료가 배송비에도 적용될 때]) × (판매수수료율 + 결제수수료율)
- 개당공헌이익 = 수입 − 착지 − 채널 − 판매가 × 반품예비율. 마진율 = 공헌이익 ÷ 수입.
- 개당순이익추정 = 공헌이익 − (광고비 + 고정비) ÷ 예상월판매개수
- 손익분기판매가 = (착지원가 + 배송비수수료기준 × 수수료율 합 − 청구배송비 ÷ 주문당개수) ÷ (1 − 판매수수료율 − 결제수수료율 − 반품예비율)

## 프로그램 가져오기 대응

- 상품·공급처·오퍼·배송시나리오·요건·결정·작업·환율·비용항목 탭은 각각 `Product`, `Supplier`, `Offer`, `ShippingScenario`+`ShippingLeg`, `ComplianceProfile`+`RequirementItem`, `Decision`, `Task`, `FxRate`, `CostLineType`로 들어간다.
- "값 + 상태" 열 쌍은 Claim 하나가 된다. 캡처파일명이 비어 있는 "확인"은 "추정"으로 내려간다(I-01).
- 원가계산 탭은 가져오지 않는다. 프로그램의 계산기가 같은 규칙으로 다시 계산한다(R-11).
- 경쟁사관찰 탭은 `Note(type=competitor_observation)`와 `Product.competitor_refs`로 들어간다.
- 예시 행(-EX1)은 가져오기에서 건너뛴다.
