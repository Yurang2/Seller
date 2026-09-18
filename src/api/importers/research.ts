import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { ulid } from "ulid";
import { sha256 } from "../services/attachments";
import {
  saveRecord,
  getRecord,
  listRecords,
  validateRecord,
  audit,
  fail,
  today,
  type Row,
} from "../services/records";
import { upsertClaim } from "../services/claims";
import { defaultRecheck, normalizeClaim } from "../../domain/claim";
import { initialize, reconcileTasks } from "../services/workspace";
import seedWorkbook from "../../domain/seedWorkbook.json";
import seedNotes from "../../domain/seedNotes.json";
export type Workbook = Record<string, Record<string, string>[]>;
const arr = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
export function parseWorkbook(bytes: Uint8Array): Workbook {
  if (bytes.length > 10 * 1024 * 1024)
    fail("조사 파일은 10MB 이하로 올려주세요.");
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > 40 * 1024 * 1024) fail("압축 해제 크기가 너무 큽니다.");
      return true;
    },
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    processEntities: true,
  });
  const xml = (path: string) => {
    if (!files[path]) fail(`엑셀 구성 파일 없음: ${path}`);
    const str = strFromU8(files[path]);
    if (/<!DOCTYPE|<!ENTITY/i.test(str))
      fail("외부 엔티티를 포함한 파일은 지원하지 않습니다.");
    return parser.parse(str);
  };
  const textValue = (v: any): string =>
    v == null
      ? ""
      : typeof v === "string"
        ? v
        : typeof v === "number"
          ? String(v)
          : v.t !== undefined
            ? textValue(v.t)
            : v["#text"] !== undefined
              ? textValue(v["#text"])
              : v.r
                ? arr(v.r).map(textValue).join("")
                : "";
  const shared = files["xl/sharedStrings.xml"]
    ? arr(xml("xl/sharedStrings.xml").sst.si).map(textValue)
    : [];
  const rels = arr(
    xml("xl/_rels/workbook.xml.rels").Relationships.Relationship,
  );
  const out: Workbook = {};
  for (const sh of arr(xml("xl/workbook.xml").workbook.sheets.sheet)) {
    const rel = rels.find((r) => r["@Id"] === sh["@r:id"]);
    if (!rel || rel["@TargetMode"] === "External")
      fail("시트 연결 형식이 올바르지 않습니다.");
    const target = rel["@Target"].startsWith("/")
      ? rel["@Target"].slice(1)
      : "xl/" + rel["@Target"];
    const rows: Record<string, string>[] = [];
    for (const r of arr(xml(target).worksheet.sheetData?.row)) {
      const row: Record<string, string> = {};
      for (const c of arr(r.c)) {
        const k = String(c["@r"]).replace(/\d/g, "");
        const v =
          c["@t"] === "s"
            ? shared[Number(c.v)]
            : c["@t"] === "inlineStr"
              ? textValue(c.is)
              : textValue(c.v);
        if (v !== "") row[k] = v;
      }
      if (Object.keys(row).length) rows.push(row);
    }
    out[sh["@name"]] = rows;
  }
  return out;
}
const status = (s?: string) =>
  s === "확인" ? "confirmed" : s === "추정" ? "estimated" : "unknown";
const map = (
  value: string | undefined,
  values: Record<string, string>,
  fallback = "unknown",
) => values[value ?? ""] ?? fallback;
const category = (s?: string) =>
  map(
    s,
    {
      봉제인형: "plush",
      "인형 키링": "plush_keyring",
      아크릴: "acrylic",
      문구: "stationery",
    },
    "other",
  );
const stamp = (s?: string) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s + "T00:00:00Z"
    : new Date().toISOString();
const num = (s?: string) => (s == null || s === "" ? null : Number(s));
const source = (s?: string) =>
  map(
    s,
    {
      url: "url",
      자체추정: "self_estimate",
      자체: "self_estimate",
      screenshot: "screenshot",
      message: "message",
      document: "document",
      competitor_observation: "competitor_observation",
    },
    "document",
  );
export async function stableId(key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("Seller research v1:" + key),
    ),
  );
  let x = 0n;
  for (const b of bytes.slice(0, 16)) x = (x << 8n) | BigInt(b);
  let out = "";
  const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (let i = 0; i < 26; i++) {
    out = chars[Number(x & 31n)] + out;
    x >>= 5n;
  }
  return out;
}
type Operation = {
  sheet: string;
  row: number;
  external_id: string;
  type: string;
  record: Row;
  claims?: Row[];
  message?: string;
};
export async function researchImport(
  db: D1Database,
  workbook: Workbook,
  filename: string,
  apply = false,
  expectedHash?: string,
  seed = false,
) {
  const headers: Record<string, string> = {
    상품: "상품ID",
    공급처: "공급처ID",
    오퍼: "오퍼ID",
    배송시나리오: "시나리오ID",
    요건: "프로필ID",
    결정: "코드",
    작업: "작업ID",
    환율: "날짜",
  };
  for (const [sheet, header] of Object.entries(headers))
    if (workbook[sheet] && workbook[sheet][0]?.A !== header)
      fail(
        `${sheet} 시트의 첫 열은 ${header}이어야 합니다. 템플릿 열 순서를 유지하세요.`,
      );
  if (!Object.keys(headers).some((s) => workbook[s]))
    fail("조사 템플릿 시트를 찾을 수 없습니다.");
  const hash = await sha256(new TextEncoder().encode(JSON.stringify(workbook)));
  if (apply && expectedHash !== hash)
    fail("동일 파일의 미리보기를 확인한 후 적용하세요.");
  const ops: Operation[] = [],
    results: Row[] = [];
  const ids: Record<string, string> = {};
  const id = async (key: string) =>
    ids[key] ?? (ids[key] = await stableId(key));
  const rows = (sheet: string) =>
    (workbook[sheet] ?? []).slice(1).map((r, i) => ({ r, row: i + 2 }));
  const add = (
    sheet: string,
    row: number,
    external_id: string,
    type: string,
    record: Row,
    claims: Row[] = [],
  ) => ops.push({ sheet, row, external_id, type, record, claims });
  const claim = (
    owner_type: string,
    owner_id: string,
    field_key: string,
    kind: string,
    value: unknown,
    s: string | undefined,
    ref?: string,
    checked?: string,
    note = "",
    currency = "CNY",
    sourceType?: string,
    recheck?: string,
  ): Row => {
    let st = status(s);
    if (value == null || value === "") st = "unknown";
    if (kind === "money" && value !== null)
      value = {
        amount_minor: Math.round(
          Number(value) * (currency === "CNY" || currency === "USD" ? 100 : 1),
        ),
        currency,
      };
    return {
      owner_type,
      owner_id,
      field_key,
      kind,
      status: st,
      value_json: st === "unknown" ? null : value,
      source_type: sourceType ?? "document",
      source_ref: ref ?? filename,
      checked_at: st === "unknown" ? null : stamp(checked),
      recheck_by:
        recheck ?? defaultRecheck(field_key, stamp(checked), owner_type),
      attachment_ids: [],
      note:
        note +
        (!checked
          ? " · 원본 확인일 미상. 가져온 날은 기록 검토일이며 원문 확인일이 아님."
          : ""),
      basis_json: {},
    };
  };
  const chars = new Set(
    rows("상품")
      .map((x) => x.r.C)
      .concat(rows("요건").map((x) => x.r.B))
      .filter(Boolean),
  );
  for (const name of chars)
    add("캐릭터", 0, name, "characters", {
      id: await id("char:" + name),
      name_ko: name,
      name_en: name === "핑구" ? "Pingu" : null,
    });
  const profiles = new Set<string>();
  for (const { r, row } of rows("요건"))
    if (!profiles.has(r.A)) {
      profiles.add(r.A);
      add("요건", row, r.A, "compliance_profiles", {
        id: await id(r.A),
        name: `${r.B} × ${r.C}`,
        character_id: await id("char:" + r.B),
        category: category(r.C),
        model_scope: "both",
      });
    }
  for (const { r, row } of rows("상품")) {
    if (r.A?.includes("-EX")) {
      results.push({
        sheet: "상품",
        row,
        status: "skipped",
        message: "가상 예시 행",
      });
      continue;
    }
    const ignored = (
      [
        ["G", "상태"],
        ["I", "선택오퍼ID"],
        ["J", "선택시나리오ID"],
        ["K", "결정판매가"],
        ["L", "결정청구배송비"],
      ] as const
    )
      .filter(([col]) => r[col] != null && String(r[col]).trim() !== "")
      .map(([, name]) => name);
    if (ignored.length)
      results.push({
        sheet: "상품",
        row,
        external_id: r.A,
        status: "notice",
        message: `${ignored.join("·")} 열은 가져오지 않았습니다. 단계 변경·오퍼 선택·가격 결정은 이유를 남겨야 하는 규칙이라 화면에서 처리합니다.`,
      });
    add(
      "상품",
      row,
      r.A,
      "products",
      {
        id: await id(r.A),
        name: r.B,
        character_id: await id("char:" + r.C),
        profile_id: r.H ? await id(r.H) : null,
        category: category(r.D),
        option_scheme: map(
          r.E,
          { 지정: "designated", 랜덤: "random", 세트: "set" },
          "designated",
        ),
        notes: r.P ?? "",
        competitor_refs: r.M
          ? [
              {
                url: r.M,
                price: r.N
                  ? { amount_minor: Number(r.N), currency: "KRW" }
                  : null,
                observed_at: r.O ?? null,
                note: r.P ?? "",
                source_type: "competitor_observation",
              },
            ]
          : [],
      },
      [
        claim(
          "products",
          await id(r.A),
          "age_marking",
          "text",
          r.F,
          "추정",
          filename,
          r.O,
        ),
      ],
    );
  }
  for (const { r, row } of rows("공급처")) {
    if (r.A?.includes("-EX")) {
      results.push({
        sheet: "공급처",
        row,
        status: "skipped",
        message: "가상 예시 행",
      });
      continue;
    }
    add(
      "공급처",
      row,
      r.A,
      "suppliers",
      {
        id: await id(r.A),
        name: r.B,
        name_local: r.C ?? null,
        platform: map(
          r.D,
          { 타오바오: "taobao", 티몰: "tmall", "1688": "1688", 루텐: "ruten" },
          "other",
        ),
        seller_type: map(r.E, {
          일반: "general",
          인가: "authorized",
          공식: "brand_flagship",
        }),
        store_url: r.F ?? null,
        country: r.G ?? null,
        trust_notes: r.L ?? "",
        contact_channels: r.H ? { note: r.H } : {},
        payment_methods: r.K ? r.K.split(";") : [],
        last_contact_at: r.M ?? null,
      },
      [
        claim(
          "suppliers",
          await id(r.A),
          "ships_to_kr",
          "bool",
          r.I === "가능" ? true : r.I === "불가" ? false : null,
          r.J,
          r.F,
          r.M,
        ),
      ],
    );
  }
  for (const { r, row } of rows("오퍼")) {
    if (r.A?.includes("-EX")) {
      results.push({
        sheet: "오퍼",
        row,
        status: "skipped",
        message: "가상 예시 행",
      });
      continue;
    }
    const oid = await id(r.A);
    const cs = [
      ["listed_price", "M", "N"],
      ["checkout_price", "O", "P"],
      ["cn_domestic_shipping", "R", "S"],
      ["intl_shipping_by_seller", "T", "U"],
    ].map(([f, v, s]) =>
      claim(
        "offers",
        oid,
        f,
        "money",
        num(r[v]),
        r[s],
        r.Z ?? r.D,
        r.AB,
        [r.AF, r.AA ? "파일명만으로는 증빙이 연결되지 않습니다: " + r.AA : ""]
          .filter(Boolean)
          .join(" · "),
        r.L,
        source(r.Y),
        r.AC,
      ),
    );
    // Ruten's mixed single/set range is not treated as a verified unit checkout price.
    if (seed && r.A === "O-004")
      cs[0] = claim(
        "offers",
        oid,
        "listed_price",
        "range",
        { min: 730, likely: 730, max: 2350, currency: "TWD" },
        "추정",
        r.D,
        r.AB,
        "단품·세트 혼합 범위. 단품 실결제가 미확인.",
        "TWD",
      );
    add(
      "오퍼",
      row,
      r.A,
      "offers",
      {
        id: oid,
        product_id: await id(r.B),
        supplier_id: await id(r.C),
        url: r.D ?? null,
        option_desc: r.E ?? null,
        option_kind:
          seed && r.A === "O-004"
            ? "unknown"
            : map(r.F, {
                단품: "single",
                세트: "set",
                랜덤: "random",
                지정: "designated",
              }),
        set_composition: r.G ?? null,
        random_rule: r.H ?? null,
        quantity_tier_min: num(r.I),
        quantity_tier_max: num(r.J),
        moq: num(r.K),
        currency: r.L ?? "CNY",
        includes_shipping_to: map(r.Q, {
          없음: "none",
          중국내: "cn_domestic",
          한국: "kr",
        }),
        authenticity_evidence: map(r.X, {
          판매자주장: "seller_claim",
          없음: "none",
          라이선스표시: "official_license_mark",
          인가서: "authorization_doc",
        }),
        status: map(
          r.AD,
          {
            후보: "candidate",
            검증: "verified",
            탈락: "rejected",
            선택: "chosen",
          },
          "candidate",
        ),
        rejection_reason: r.AE ?? null,
      },
      cs,
    );
  }
  const nodes: Record<string, string> = {
    판매자: "seller",
    대행창고: "forwarder_cn",
    한국통관: "kr_customs",
    한국고객: "customer_kr",
    고객: "customer_kr",
  };
  for (const { r, row } of rows("배송시나리오")) {
    if (r.A?.includes("-EX")) {
      results.push({
        sheet: "배송시나리오",
        row,
        status: "skipped",
        message: "가상 예시 행",
      });
      continue;
    }
    const sid = await id(r.A);
    add(
      "배송시나리오",
      row,
      r.A,
      "shipping_scenarios",
      {
        id: sid,
        product_id: await id(r.B),
        offer_id: r.C ? await id(r.C) : null,
        name: r.D,
        route_type: r.E === "배송대행" ? "forwarder" : "direct",
        customs_mode: map(r.AB, {
          목록통관: "list_clearance",
          일반통관: "general",
        }),
      },
      [
        claim(
          "shipping_scenarios",
          sid,
          "parcel_items",
          "number",
          num(r.F),
          r.G,
          r.AI,
          r.AH,
          r.AJ,
        ),
        claim(
          "shipping_scenarios",
          sid,
          "parcel_weight_g",
          "number",
          num(r.H),
          r.I,
          r.AI,
          r.AH,
        ),
        claim(
          "shipping_scenarios",
          sid,
          "duty",
          "money",
          num(r.AC),
          r.AD,
          r.AI,
          r.AH,
          "",
          "KRW",
        ),
        claim(
          "shipping_scenarios",
          sid,
          "vat",
          "money",
          num(r.AE),
          r.AF,
          r.AI,
          r.AH,
          "",
          "KRW",
        ),
      ],
    );
    for (const [seq, cols] of [
      ["1", ["J", "K", "L", "M", "N", "O"]],
      ["2", ["P", "Q", "R", "S", "T", "U"]],
      ["3", ["V", "W", "X", "Y", "Z", "AA"]],
    ] as const) {
      const [route, service, v, c, s, inc] = cols;
      if (!r[route]) continue;
      const [from, to] = r[route].split("→");
      const lid = await id(r.A + ":leg" + seq);
      add(
        "배송시나리오",
        row,
        r.A + ":" + seq,
        "shipping_legs",
        {
          id: lid,
          scenario_id: sid,
          seq: Number(seq),
          from_node: nodes[from] ?? from,
          to_node: nodes[to] ?? to,
          carrier_or_service: r[service] ?? "",
          cost_code:
            from === "판매자" && to === "대행창고"
              ? "cn_domestic_shipping"
              : from === "한국통관"
                ? "kr_domestic_shipping"
                : "intl_shipping",
          basis: "per_parcel",
          includes: r[inc] === "국내택배" ? ["kr_domestic_shipping"] : [],
        },
        [
          claim(
            "shipping_legs",
            lid,
            "cost",
            "money",
            num(r[v]),
            r[s],
            r.AI,
            r.AH,
            r[inc] ?? "",
            r[c] ?? "CNY",
          ),
        ],
      );
    }
  }
  for (const { r, row } of rows("요건")) {
    const rid = await id(r.A + ":" + r.D);
    add(
      "요건",
      row,
      r.A + ":" + r.D,
      "requirement_items",
      {
        id: rid,
        profile_id: await id(r.A),
        key: r.D,
        question: r.E,
        risk_level: map(
          r.J,
          { 낮음: "low", 중간: "medium", 높음: "high" },
          "medium",
        ),
        item_result: "unknown",
        condition_text: [r.I, r.F].filter(Boolean).join("\n"),
      },
      [
        claim(
          "requirement_items",
          rid,
          "answer",
          "text",
          r.F,
          r.G,
          r.K,
          r.L,
          r.I,
          "KRW",
          source(r.K),
          r.M,
        ),
      ],
    );
  }
  for (const { r, row } of rows("결정"))
    add("결정", row, r.A, "decisions", {
      id: await id(r.A),
      code: r.A,
      title: r.B,
      context: r.C ?? "",
      decision: r.D ?? "미결정 · 조사 결과와 사용자 선택 대기",
      rationale: r.E ?? r.C ?? "결정에 필요한 근거와 사용자 선택이 아직 없음",
      alternatives_json: (r.F ?? "")
        .split(";")
        .filter(Boolean)
        .map((option) => ({
          option: option.trim(),
          why_not: r.H === "채택" ? "선택한 안의 이유 참조" : "미검토",
        })),
      consequences: r.G ?? "",
      status: map(
        r.H,
        {
          제안: "proposed",
          채택: "accepted",
          기각: "rejected",
          대체: "superseded",
        },
        "proposed",
      ),
      decided_at: r.I ? stamp(r.I) : null,
      revisit_when: r.J ?? "",
    });
  const typeFor = (key: string) =>
    key.startsWith("P-")
      ? "products"
      : key.startsWith("SC-")
        ? "shipping_scenarios"
        : key.startsWith("O-")
          ? "offers"
          : key.startsWith("R-")
            ? "compliance_profiles"
            : key.startsWith("D-")
              ? "decisions"
              : null;
  for (const { r, row } of rows("작업"))
    add("작업", row, r.A, "tasks", {
      id: await id(r.A),
      title: r.B,
      entity_type: typeFor(r.C ?? ""),
      entity_id: r.C ? await id(r.C) : null,
      priority: num(r.D) ?? 3,
      status: map(
        r.E,
        {
          할일: "todo",
          진행: "doing",
          막힘: "blocked",
          완료: "done",
          취소: "cancelled",
        },
        "todo",
      ),
      due_at: r.F ?? null,
      blocked_kind: r.G?.includes("결정") ? "decision" : "external",
      blocked_reason: r.G ?? null,
      unblock_condition: r.H ?? null,
      recheck_at: r.I ?? null,
      detail: r.J ?? "",
    });
  for (const { r, row } of rows("환율")) {
    if (!r.C || !r.A) {
      results.push({
        sheet: "환율",
        row,
        status: "skipped",
        message: "환율·날짜 미확인. 0으로 만들지 않음",
      });
      continue;
    }
    add("환율", row, r.A + ":" + r.B, "fx_rates", {
      id: await id("fx:" + r.A + ":" + r.B + ":" + r.E),
      base_currency: r.B,
      rate: r.C,
      as_of_date: r.A,
      source: r.E,
      kind: map(
        r.D,
        { 수동: "manual", 고시: "reference", 카드실제: "card_actual" },
        "manual",
      ),
      note: r.F ?? "",
    });
  }
  for (const { r, row } of rows("경쟁사관찰"))
    add("경쟁사관찰", row, r.A ?? String(row), "notes", {
      id: await id("competitor:" + r.A),
      type: "competitor_observation",
      title: `경쟁사 관찰 · ${r.B ?? r.A}`,
      body_md:
        JSON.stringify(r, null, 2) +
        "\n경쟁사 관찰은 내 배송비·정품성·판매 가능성의 근거가 아닙니다.",
    });
  if (workbook["원가계산"])
    results.push({
      sheet: "원가계산",
      row: 0,
      status: "skipped",
      message:
        "수식·가상 예시는 가져오지 않습니다. 앱 계산기가 저장된 입력으로 다시 계산합니다.",
    });
  for (const op of ops) {
    try {
      let existing = await getRecord(db, op.type, op.record.id);
      if (op.type === "requirement_items") {
        const same = (await listRecords(db, "requirement_items")).find(
          (i) =>
            i.profile_id === op.record.profile_id && i.key === op.record.key,
        );
        if (same) {
          op.record.id = same.id;
          existing = same;
          for (const c of op.claims ?? []) c.owner_id = same.id;
        }
      }
      const { id: unused, ...v } = op.record;
      validateRecord(
        op.type,
        v,
        op.type === "fx_rates" ? null : existing,
        true,
      );
      const normalized = (op.claims ?? []).map((c) => normalizeClaim(c));
      const message = normalized.some((c) => c.downgraded)
        ? "증빙 원본이 없어 확인 → 추정"
        : existing
          ? "기존 ID 갱신"
          : "새 기록 추가";
      if (apply) {
        // Stable external IDs share the same services as manual entry. Re-import is an upsert.
        if (op.type !== "fx_rates" || !existing)
          await saveRecord(
            db,
            op.type,
            op.record,
            "조사 시트 가져오기",
            `import:${hash.slice(0, 12)}`,
            true,
          );
        for (const c of op.claims ?? [])
          await upsertClaim(db, c, `import:${hash.slice(0, 12)}`);
      }
      results.push({
        sheet: op.sheet,
        row: op.row,
        external_id: op.external_id,
        type: op.type,
        id: op.record.id,
        status: apply ? "applied" : "ready",
        message,
      });
    } catch (err) {
      results.push({
        sheet: op.sheet,
        row: op.row,
        external_id: op.external_id,
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (apply) {
    const bid = ulid(),
      at = new Date().toISOString();
    const row = {
      id: bid,
      kind: "excel_research",
      filename,
      mapping_json: JSON.stringify({
        version: 1,
        external_ids: ids,
        headers: Object.fromEntries(
          Object.entries(workbook).map(([k, v]) => [k, v[0] ?? {}]),
        ),
      }),
      rows_total: results.length,
      rows_ok: results.filter((r) => r.status === "applied").length,
      rows_failed: results.filter((r) => r.status === "failed").length,
      results_json: JSON.stringify(results),
      applied: 1,
      created_at: at,
    };
    await db.batch([
      db
        .prepare(
          `INSERT INTO import_batches(${Object.keys(row).join(",")}) VALUES(${Object.keys(
            row,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .bind(...Object.values(row)),
      audit(
        db,
        "import_batches",
        bid,
        null,
        row,
        "행별 적용 결과",
        "user",
        "import",
      ),
    ]);
    await reconcileTasks(db);
  }
  return {
    hash,
    applied: apply,
    results,
    ready: results.filter((r) => ["ready", "applied"].includes(r.status))
      .length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };
}
export async function seedResearch(db: D1Database) {
  await initialize(db);
  for (const n of seedNotes) {
    const nid = await stableId("note:" + n.key);
    if (!(await getRecord(db, "notes", nid)))
      await saveRecord(
        db,
        "notes",
        { id: nid, title: n.title, type: n.type, body_md: n.body },
        "기획서 초기 지식",
        "import:seed",
      );
  }
  const channelId = await stableId("channel:smartstore");
  if (!(await getRecord(db, "channels", channelId)))
    await saveRecord(
      db,
      "channels",
      { id: channelId, name: "스마트스토어", type: "smartstore" },
      "D-03 채택 · 수수료와 API 연동은 미확인",
      "import:seed",
    );
  const previous = await db
    .prepare("SELECT key FROM settings WHERE key='seed_research_v1'")
    .first();
  if (previous) return { already_seeded: true };
  const workbook = seedWorkbook as Workbook;
  const preview = await researchImport(
    db,
    workbook,
    "초기 조사 · SEED_RESEARCH.md",
    false,
    undefined,
    true,
  );
  if (preview.failed) fail("초기 조사 검증 실패");
  const result = await researchImport(
    db,
    workbook,
    "초기 조사 · SEED_RESEARCH.md",
    true,
    preview.hash,
    true,
  );
  if (!result.failed) {
    const charId = await stableId("char:핑구");
    await upsertClaim(
      db,
      {
        owner_type: "characters",
        owner_id: charId,
        field_key: "rights_holder",
        kind: "text",
        status: "confirmed",
        value_json:
          "Mattel (브랜드 포트폴리오); 저작권 표기 The Pygos Group / Joker, Inc.",
        source_type: "document",
        source_ref:
          "docs/SEED_RESEARCH.md 1장 · Mattel corporate brand portfolio / Wikipedia",
        checked_at: "2026-09-16T00:00:00Z",
        recheck_by: "2026-12-15",
        note: "기획서의 초기 조사 기록. 국내 상품 라이선싱 담당·공급처 허락 여부와 별개.",
        attachment_ids: [],
      },
      "import:seed",
    );
    const { setSetting } = await import("../services/workspace");
    await setSetting(
      db,
      "seed_research_v1",
      true,
      "초기 조사 입력 완료",
      "import:seed",
    );
  }
  return result;
}
