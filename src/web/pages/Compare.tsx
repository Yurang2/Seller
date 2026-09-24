import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { moneySchema, type Claim } from "../../domain/types/claim";
import { majorUnits } from "../../domain/money";
import { claimLabels, catalog } from "../../domain/records/catalog";
import { isStale } from "../../domain/claim";
import { marketTotal, safeWebLink } from "../../domain/market-comparison";
import { api, jsonBody } from "../api/client";
import {
  Badge,
  ClaimEditor,
  ClaimValue,
  ErrorBox,
  PageHead,
  recordUrl,
  title,
  useClaims,
  useWorkspace,
  type Row,
} from "./Workspace";
import "./compare.css";

const matches: Record<string, string> = {
  unknown: "일치 미확인",
  same: "동일 상품 관찰",
  similar: "유사 상품 · 직접 가격 비교 주의",
};
function legacyPrice(value: unknown) {
  const money = moneySchema.safeParse(value);
  if (money.success)
    return `${majorUnits(money.data).toString()} ${money.data.currency}`;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "미확인";
}
function WebLink({ url }: { url: unknown }) {
  const href = safeWebLink(url);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      판매 페이지 열기 ↗
    </a>
  ) : (
    <span className="muted">유효한 웹링크 없음</span>
  );
}

export function Compare() {
  const { productId } = useParams(),
    navigate = useNavigate(),
    q = useWorkspace(),
    cq = useClaims();
  const [editing, setEditing] = useState<{
    claim: Claim;
    currency: string;
  } | null>(null);
  const [form, setForm] = useState<{
    type: "offers" | "market_offers";
    row?: Row;
  } | null>(null);
  const editArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form || editing)
      editArea.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [form, editing]);
  const d = q.data,
    claims = cq.data;
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
  if (!d || !claims)
    return (
      <main className="page">
        <ErrorBox error={q.error || cq.error} />
        <p>비교 자료를 불러오는 중…</p>
      </main>
    );
  const p = d.records.products.find((r) => r.id === productId);
  const china = d.records.offers.filter((r) => r.product_id === p?.id);
  const korea = (d.records.market_offers ?? []).filter(
    (r) => r.product_id === p?.id,
  );
  const costings = d.records.costings.filter((r) => r.product_id === p?.id);
  const findClaim = (type: string, id: string, key: string) =>
    claims.find(
      (c) => c.owner_type === type && c.owner_id === id && c.field_key === key,
    );
  function fact(row: Row, type: string, key: string) {
    const c = findClaim(type, row.id, key);
    return (
      <div className="compare-fact" key={key}>
        <span>{claimLabels[key] ?? key}</span>
        <div>{c ? <ClaimValue claim={c} /> : "미확인"}</div>
        <small>
          확인 {c?.checked_at?.slice(0, 10) ?? "기록 없음"} · 재확인{" "}
          {c?.recheck_by ?? "미정"}
          {c && isStale(c, today) ? " · 기한 지남" : ""}
        </small>
        {c?.note && <small>{c.note}</small>}
        {c?.source_ref && (
          <small>
            출처:{" "}
            {safeWebLink(c.source_ref) ? (
              <a
                href={safeWebLink(c.source_ref)!}
                target="_blank"
                rel="noopener noreferrer"
              >
                기록한 근거 페이지 ↗
              </a>
            ) : (
              c.source_ref
            )}
          </small>
        )}
        {c?.attachment_ids.map((id, i) => (
          <a
            key={id}
            href={`/api/v1/attachments/${id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            증빙 {i + 1} ↗
          </a>
        ))}
        {c && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setEditing({
                claim: {
                  ...c,
                  source_ref: c.source_ref || row.url || "",
                  source_type:
                    type === "market_offers"
                      ? "competitor_observation"
                      : (c.source_type ?? "url"),
                },
                currency: type === "market_offers" ? "KRW" : row.currency,
              })
            }
          >
            금액·확인일·증빙 기록
          </button>
        )}
      </div>
    );
  }
  return (
    <main className="page compare-page">
      <PageHead
        eyebrow="COMPARE / 상품 조사"
        title="중국·한국 판매처 비교"
        description="동일 상품의 옵션·수량·배송 조건을 맞춰 보고, 링크와 가격 근거를 함께 기록하세요."
      />
      <label className="compare-product">
        비교할 상품
        <select
          value={p?.id ?? ""}
          onChange={(e) => {
            setForm(null);
            setEditing(null);
            navigate(`/compare/${e.target.value}`);
          }}
        >
          <option value="">상품을 선택하세요</option>
          {d.records.products.map((r) => (
            <option key={r.id} value={r.id}>
              {title(r)}
            </option>
          ))}
        </select>
      </label>
      {!p ? (
        <p>
          상품을 선택하면 연결된 중국 오퍼와 한국 판매처가 나타납니다.{" "}
          <Link to="/records/products">상품 등록 →</Link>
        </p>
      ) : (
        <>
          <p>
            <Link to={recordUrl("products", p.id)}>
              상품 상세·원가 계산·가격 결정 →
            </Link>
          </p>
          <p className="muted">
            수동 관찰 자료입니다. 옵션·정품 여부·수량이 다르면 같은 상품으로
            판단하지 마세요. 경쟁사 가격은 판매 요건 통과나 가격 확정의 근거를
            대신하지 않습니다.
          </p>
          <div ref={editArea} className="compare-edit-anchor" />
          {form && (
            <OfferForm
              key={`${p.id}:${form.type}:${form.row?.id ?? "new"}`}
              type={form.type}
              row={form.row}
              productId={p.id}
              suppliers={d.records.suppliers}
              onClose={() => setForm(null)}
            />
          )}
          {editing && (
            <div className="compare-editor">
              <ClaimEditor
                key={`${editing.claim.owner_id}:${editing.claim.field_key}`}
                claim={editing.claim}
                defaultCurrency={editing.currency}
                onClose={() => setEditing(null)}
              />
            </div>
          )}
          <div className="compare-columns">
            <section aria-label="중국 공급처">
              <div className="section-head">
                <h2>중국 공급처·오퍼 ({china.length})</h2>
                <button
                  type="button"
                  onClick={() => {
                    setForm({ type: "offers" });
                    setEditing(null);
                  }}
                >
                  중국 오퍼 추가
                </button>
              </div>
              {!china.length && (
                <p className="muted">공급처 링크와 옵션부터 기록하세요.</p>
              )}
              {china.map((row) => (
                <article className="panel compare-card" key={row.id}>
                  <h3>
                    {d.records.suppliers.find((s) => s.id === row.supplier_id)
                      ?.name ?? "공급처"}
                  </h3>
                  <WebLink url={row.url} />
                  <p>{row.option_desc || "옵션 미확인"}</p>
                  <p className="muted">
                    최소 주문 {row.moq ?? "미확인"} · 수량 구간{" "}
                    {row.quantity_tier_min ?? "미확인"} ~{" "}
                    {row.quantity_tier_max ?? "미확인"} · {row.currency}
                  </p>
                  <p className="muted">
                    가격 단위·세트 구성은 근거의 조건을 확인하세요. 중국
                    가격만으로 한국 도착 원가를 계산하지 않습니다.
                  </p>
                  {Object.keys(catalog.offers.claims!)
                    .filter((k) => k !== "lead_time_days")
                    .map((k) => fact(row, "offers", k))}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setForm({ type: "offers", row });
                      setEditing(null);
                    }}
                  >
                    링크·옵션 수정
                  </button>{" "}
                  <Link to={recordUrl("offers", row.id)}>전체 조건·이력 →</Link>
                </article>
              ))}
            </section>
            <section aria-label="한국 판매처">
              <div className="section-head">
                <h2>한국 판매처 ({korea.length})</h2>
                <button
                  type="button"
                  onClick={() => {
                    setForm({ type: "market_offers" });
                    setEditing(null);
                  }}
                >
                  한국 판매처 추가
                </button>
              </div>
              {!korea.length && (
                <p className="muted">
                  같은 상품을 판매하는 국내 판매처를 여러 개 기록할 수 있습니다.
                </p>
              )}
              {korea.map((row) => {
                const total = marketTotal(
                  findClaim("market_offers", row.id, "market_price"),
                  findClaim("market_offers", row.id, "market_shipping"),
                  row.pack_quantity,
                  today,
                );
                return (
                  <article className="panel compare-card" key={row.id}>
                    <h3>{row.name}</h3>
                    <WebLink url={row.url} />
                    <p>
                      <strong>{matches[row.match_kind]}</strong>
                    </p>
                    <p>
                      {row.option_desc} · {row.pack_quantity}개 묶음
                    </p>
                    <p className="muted">{row.notes}</p>
                    {fact(row, "market_offers", "market_price")}
                    {fact(row, "market_offers", "market_shipping")}
                    <div className="compare-total">
                      배송 포함{" "}
                      {total.total === null
                        ? "미확인 · 가격과 배송비 모두 필요"
                        : `${Number(total.total).toLocaleString("ko-KR")}원 / 묶음 · 개당 ${Number(total.perUnit).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`}{" "}
                      <Badge value={total.status} />
                      {total.stale && (
                        <p>재확인 기한 지남 · 현재 가격 재조사 필요</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setForm({ type: "market_offers", row });
                        setEditing(null);
                      }}
                    >
                      링크·옵션·수량 수정
                    </button>{" "}
                    <Link to={recordUrl("market_offers", row.id)}>
                      전체 기록·이력 →
                    </Link>
                  </article>
                );
              })}
            </section>
          </div>
          {Array.isArray(p.competitor_refs) && p.competitor_refs.length > 0 && (
            <section className="panel">
              <h2>기존 경쟁사 관찰</h2>
              <p className="muted">
                이전 기록은 그대로 보존했습니다. 옵션·수량·배송비·증빙을 확인한
                뒤 위 판매처로 직접 기록하세요.
              </p>
              {p.competitor_refs.map((r: Row, i: number) => (
                <p key={i}>
                  <WebLink url={r.url} /> · 당시 가격 {legacyPrice(r.price)} ·{" "}
                  {r.observed_at ?? "확인일 없음"} · {r.note}
                </p>
              ))}
            </section>
          )}
          <section className="panel">
            <h2>저장된 원가·수익성</h2>
            <p className="muted">
              아래 값은 저장 당시 조건입니다. 현재 가격과 다를 수 있으므로 상품
              계산기에서 환율·국제배송·세금·채널 수수료를 포함해 다시
              계산하세요.
            </p>
            {costings.length ? (
              costings.slice(0, 3).map((c) => (
                <p key={c.id}>
                  <Link to={recordUrl("costings", c.id)}>
                    {c.created_at?.slice(0, 10)} 스냅샷
                  </Link>{" "}
                  · 도착 원가 {c.outputs?.landed_per_unit ?? "미확인"}원/개 ·
                  공헌이익 {c.outputs?.contribution_per_unit ?? "미확인"}원/개{" "}
                  <Badge value={c.overall_status ?? "unknown"} />
                </p>
              ))
            ) : (
              <p>
                저장된 원가가 없습니다.{" "}
                <Link to={recordUrl("products", p.id)}>원가 계산 시작 →</Link>
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function OfferForm({
  type,
  row,
  productId,
  suppliers,
  onClose,
}: {
  type: "offers" | "market_offers";
  row?: Row;
  productId: string;
  suppliers: Row[];
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    korea = type === "market_offers";
  const [values, setValues] = useState<Row>(() =>
    row
      ? Object.fromEntries(
          Object.keys(catalog[type].fields).map((k) => [k, row[k]]),
        )
      : { product_id: productId, currency: "CNY", match_kind: "unknown" },
  );
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) =>
    setValues((old) => ({ ...old, [k]: v }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(values).filter(([k]) => k in catalog[type].fields),
      );
      await api(
        `/records/${type}`,
        jsonBody("PUT", { ...payload, ...(row ? { id: row.id } : {}), reason }),
      );
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const input = (
    key: string,
    label: string,
    kind = "text",
    required = true,
  ) => (
    <label>
      {label}
      <input
        type={kind}
        required={required}
        min={kind === "number" ? 1 : undefined}
        step={kind === "number" ? 1 : undefined}
        inputMode={kind === "number" ? "numeric" : undefined}
        value={values[key] ?? ""}
        onChange={(e) =>
          set(
            key,
            kind === "number"
              ? e.target.value === ""
                ? null
                : Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </label>
  );
  return (
    <form className="panel compare-form" onSubmit={save}>
      <div className="section-head">
        <h2>
          {korea ? "한국 판매처" : "중국 오퍼"} {row ? "수정" : "추가"}
        </h2>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          닫기
        </button>
      </div>
      <ErrorBox error={error} />
      <div className="form-grid">
        {korea ? (
          input("name", "판매처 이름")
        ) : (
          <label>
            공급처
            <select
              required
              value={values.supplier_id ?? ""}
              onChange={(e) => set("supplier_id", e.target.value)}
            >
              <option value="">선택하세요</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Link to="/records/suppliers">공급처가 없으면 먼저 등록 →</Link>
          </label>
        )}
        {input("url", "상품 웹링크", "url")}
        {input("option_desc", "옵션·규격 (색상, 크기, 구성)")}
        {korea ? (
          <>
            {input("pack_quantity", "표시 가격에 포함된 수량", "number")}
            <label>
              상품 일치 여부
              <select
                value={values.match_kind}
                onChange={(e) => set("match_kind", e.target.value)}
              >
                {Object.entries(matches).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              일치 판단 근거·배송 조건
              <textarea
                required={values.match_kind !== "unknown"}
                value={values.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            {input("moq", "최소 주문 수량", "number", false)}
            {input("quantity_tier_min", "수량 구간 최소", "number", false)}
            {input("quantity_tier_max", "수량 구간 최대", "number", false)}
            <label>
              원래 통화
              <select
                value={values.currency}
                onChange={(e) => set("currency", e.target.value)}
              >
                {["CNY", "TWD", "KRW", "USD", "JPY"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          저장·변경 이유
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <p className="muted">
        판매처 저장 후 카드의 ‘금액·확인일·증빙 기록’에서 가격과 배송비를
        기록하세요. 모르는 배송비는 미확인으로 두세요.
      </p>
      <button disabled={busy}>{busy ? "저장 중…" : "판매처 저장"}</button>
    </form>
  );
}
