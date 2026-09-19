import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  catalog,
  labels,
  claimLabels,
  type Field,
} from "../../domain/records/catalog";
import type { Claim } from "../../domain/types/claim";
import { defaultRecheck } from "../../domain/claim";
import { api, jsonBody } from "../api/client";
import { RecordTable, useViewMode } from "./Table";
export type Row = Record<string, any>;
export type WorkspaceData = {
  records: Record<string, Row[]>;
  claims: (Claim & { id: string })[];
  settings: Row;
  activity: Row[];
  recent: Row[];
  stale: Claim[];
  cost_line_types: Row[];
  automation: string;
  mode: string;
  grades: Record<
    string,
    {
      grade: string;
      estimated: boolean;
      reasons: string[];
      next: string[];
      margin_rate: number | null;
    }
  >;
};
export function GradeBadge({
  grade,
  estimated,
  compact,
}: {
  grade: string;
  estimated?: boolean;
  compact?: boolean;
}) {
  const g = ["A", "B", "C", "D"].includes(grade) ? grade : "X";
  return (
    <span
      className={`grade ${g}`}
      title={`종합 등급 ${grade}${estimated ? " (추정)" : ""}: 요건 → 남은 조치 → 수익성 순으로 판정`}
      aria-label={`등급 ${grade}${estimated ? " 추정" : ""}`}
    >
      {g === "X" ? "?" : grade}
      {!compact && estimated ? "·" : ""}
    </span>
  );
}
export function useWorkspace() {
  return useQuery({
    queryKey: ["workspace"],
    queryFn: () => api<WorkspaceData>("/workspace"),
  });
}
export const label = (s: string) => labels[s] ?? s;
export const title = (r: Row) =>
  r.name ||
  r.title ||
  r.name_ko ||
  r.question ||
  r.option_desc ||
  r.carrier_or_service ||
  (r.assets_source !== undefined
    ? `채널 등록 상품${r.external_id ? " · " + r.external_id : ""}`
    : null) ||
  r.url ||
  (r.base_currency
    ? `${r.base_currency} · ${r.as_of_date}`
    : r.inputs_frozen
      ? `원가 검토 · ${r.created_at?.slice(0, 10)}`
      : "이름 없는 기록");
export const recordUrl = (type: string, id?: string) =>
  `/records/${type}${id ? "/" + id : ""}`;
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{label(value)}</span>;
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="alert error">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function PageHead({
  eyebrow,
  title: heading,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{heading}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Home() {
  const q = useWorkspace(),
    qc = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const d = q.data;
  const [progress, setProgress] = useState("");
  async function seed() {
    setBusy(true);
    setError("");
    try {
      // 서버는 한 번에 일부 행만 적용하고 next를 돌려준다(Workers 요청당 D1 호출 상한). 끝날 때까지 반복한다.
      let r: Row = { next: 0, batch_id: undefined };
      while (r.next !== null && r.next !== undefined) {
        r = await api<Row>(
          "/seed",
          jsonBody("POST", { from: r.next, limit: 10, batch_id: r.batch_id }),
        );
        if (r.already_seeded) break;
        setProgress(`${Math.min(r.next ?? r.total, r.total)}/${r.total}`);
      }
      setProgress("");
      if (r.failed)
        throw new Error(
          `초기 조사 ${r.failed}개 행 실패: ${r.results
            .filter((x: Row) => x.status === "failed")
            .map((x: Row) => x.message)
            .join(" / ")}`,
        );
      await qc.invalidateQueries();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!d)
    return (
      <main className="page">
        <ErrorBox error={q.error} />
        <p>사업 기록을 불러오는 중…</p>
      </main>
    );
  const todayStr = new Date().toISOString().slice(0, 10);
  const daysSince = (iso?: string | null) =>
    iso
      ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000))
      : 0;
  const tasks = d.records.tasks.filter(
    (t) => !["done", "cancelled"].includes(t.status),
  );
  const blockers = tasks
    .filter((t) => t.status === "blocked")
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  const nextActions = tasks
    .filter((t) => t.status !== "blocked")
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.due_at ?? "9").localeCompare(b.due_at ?? "9") ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    )
    .slice(0, 10);
  const readiness = d.records.readiness_items;
  const readinessOpen = readiness.filter(
    (r) => !["done", "not_applicable"].includes(r.status),
  );
  const products = d.records.products;
  const listings = d.records.listings ?? [];
  const liveListings = listings.filter((l) => l.status === "live");
  const oldest = products
    .filter((p) => !["live", "discontinued", "rejected"].includes(p.status))
    .map((p) => ({ p, days: daysSince(p.stage_entered_at ?? p.created_at) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);
  const snapshots = (d.records.costings ?? [])
    .filter((c) => c.is_current === 1 && c.outputs)
    .map((c) => ({
      c,
      product: products.find((p) => p.id === c.product_id),
    }));
  const wonInt = (x: unknown) =>
    x == null ? "미확인" : Math.round(Number(x)).toLocaleString("ko-KR") + "원";
  // 같은 제목의 파생 할 일(예: 프로필 6개의 같은 조건)은 홈에서 한 줄로 묶는다. 전체 목록은 할 일 화면에.
  const groupRows = (rows: Row[]) => {
    const seen = new Map<string, Row & { _n: number }>();
    for (const t of rows) {
      const k = t.status + ":" + t.title;
      const g = seen.get(k);
      if (g) g._n += 1;
      else seen.set(k, { ...t, _n: 1 });
    }
    return [...seen.values()];
  };
  const taskLink = (t: Row) =>
    recordUrl(
      t.entity_type && catalog[t.entity_type] ? t.entity_type : "tasks",
      t.entity_type && catalog[t.entity_type] ? t.entity_id : t.id,
    );
  return (
    <main className="page">
      <PageHead
        eyebrow={`WORKSPACE / ${d.mode === "operations" ? "운영 모드" : "조사 모드"}`}
        title="사용자님, 여기서 이어가세요."
        description="조사한 근거와 결정한 이유를 한곳에. 다음에 할 일을 놓치지 않도록."
      />
      <ErrorBox error={error} />
      {!d.settings.seed_research_v1 && (
        <section className="panel intro">
          <div>
            <h2>핑구 상품 조사부터 시작할 준비가 됐어요.</h2>
            <p>
              기획서의 상품 4개·공급처·배송 비교·결정을 가져옵니다. 미확인
              가격은 그대로 비워둡니다.
            </p>
          </div>
          <button disabled={busy} onClick={seed}>
            {busy
              ? `초기 기록을 연결하는 중… ${progress}`
              : "초기 조사 기록 불러오기"}
          </button>
        </section>
      )}
      <div className="kpis">
        <Link className="kpi" to={recordUrl("readiness_items")}>
          <span>판매 개시까지</span>
          <strong>
            {readinessOpen.length
              ? `${readinessOpen.length}단계 남음`
              : "준비 완료"}
          </strong>
          <small>
            {readinessOpen
              .slice(0, 3)
              .map((r) => r.title)
              .join(" · ") || "필수 사업 준비를 마쳤습니다"}
          </small>
        </Link>
        <Link
          className={`kpi ${blockers.length ? "warn" : ""}`}
          to={recordUrl("tasks")}
        >
          <span>막힘</span>
          <strong>{blockers.length}개</strong>
          <small>
            {blockers.length
              ? Object.entries(
                  blockers.reduce<Record<string, number>>((m, t) => {
                    const k = label(t.blocked_kind ?? "internal");
                    m[k] = (m[k] ?? 0) + 1;
                    return m;
                  }, {}),
                )
                  .map(([k, n]) => `${k} ${n}`)
                  .join(" · ")
              : "막힌 일이 없습니다"}
          </small>
        </Link>
        <Link className="kpi" to="/claims">
          <span>재확인 기한 지남</span>
          <strong>{d.stale.length}개</strong>
          <small>근거 재확인 대상</small>
        </Link>
        <Link className="kpi" to={recordUrl("products")}>
          <span>상품</span>
          <strong>
            {
              products.filter(
                (p) => !["live", "discontinued", "rejected"].includes(p.status),
              ).length
            }
            개 진행 중
          </strong>
          <small>
            {["A", "B", "C", "D"]
              .map(
                (g) =>
                  [
                    g,
                    Object.values(d.grades).filter((x) => x.grade === g).length,
                  ] as const,
              )
              .filter(([, n]) => n)
              .map(([g, n]) => `${g} ${n}`)
              .join(" · ") || "등급 판정 전"}
          </small>
        </Link>
      </div>
      <div className="home-columns">
        <section>
          <div className="section-head">
            <h2>다음 행동</h2>
            <Link to={recordUrl("tasks")}>전체 보기</Link>
          </div>
          {blockers.length + nextActions.length ? (
            <div className="rt-wrap">
              <div className="rt-scroll">
                <table className="rt">
                  <colgroup>
                    <col style={{ width: 84 }} />
                    <col />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>상태</th>
                      <th>할 일</th>
                      <th>관련</th>
                      <th>필요한 것</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows([...blockers, ...nextActions]).map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Badge value={t.status} />
                        </td>
                        <td>
                          <Link to={taskLink(t)}>{t.title}</Link>
                          {t._n > 1 && <span className="muted"> ×{t._n}</span>}
                        </td>
                        <td className="muted">
                          {catalog[t.entity_type]?.label ??
                            label(t.entity_type ?? "")}
                        </td>
                        <td
                          className="muted"
                          title={t.unblock_condition ?? t.detail ?? ""}
                        >
                          {t.unblock_condition ?? t.detail ?? ""}
                        </td>
                        <td>
                          <Link
                            className="button secondary small"
                            to={taskLink(t)}
                          >
                            {t.rule_key === "decide_business_model"
                              ? "결정하기"
                              : "열기"}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rt-mobile">
                {groupRows([...blockers, ...nextActions]).map((t) => (
                  <Link className="rt-row" key={t.id} to={taskLink(t)}>
                    <Badge value={t.status} />
                    <div>
                      <strong>
                        {t.title}
                        {t._n > 1 ? ` ×${t._n}` : ""}
                      </strong>
                      <small>
                        {(catalog[t.entity_type]?.label ?? "") +
                          ((t.unblock_condition ?? t.detail)
                            ? " · " + (t.unblock_condition ?? t.detail)
                            : "")}
                      </small>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty">현재 열린 할 일이 없습니다.</p>
          )}
          <div className="rt-foot">
            막힘은 오래된 순, 할 일은 우선순위 순입니다. 막힘 {blockers.length}
            개 · 할 일 {nextActions.length}개
          </div>
          <div style={{ marginTop: 14 }}>
            <Link className="cta" to="/capture">
              캡처 올리고 근거로 연결
            </Link>
          </div>
        </section>
        <section className="panel">
          <h2>이어서 하기</h2>
          <p className="muted">사용자님이 최근에 편집한 기록입니다.</p>
          {d.recent.map((a) => {
            const r = d.records[a.entity_type]?.find(
              (r) => r.id === a.entity_id,
            );
            return (
              <Link
                className="resume-card"
                key={a.id}
                to={recordUrl(a.entity_type, a.entity_id)}
              >
                <small>{catalog[a.entity_type]?.label}</small>
                <h3>{r ? title(r) : a.entity_id}</h3>
                <p>{a.reason}</p>
                <time>
                  {new Date(a.at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </time>
              </Link>
            );
          })}
          {!d.recent.length && (
            <div className="empty">
              직접 편집한 기록이 아직 없습니다.
              <br />첫 기록을 남기면 여기에 이어서 표시됩니다.
            </div>
          )}
          <h2>가장 오래 머문 상품</h2>
          {oldest.map(({ p, days }) => (
            <Link
              className="action-row"
              key={p.id}
              to={recordUrl("products", p.id)}
            >
              <span className="step-number">{days}일</span>
              <span>
                <strong>{p.name}</strong>
                <small>{label(p.status)} 단계</small>
              </span>
              <span>↗</span>
            </Link>
          ))}
          {!oldest.length && (
            <p className="empty">진행 중인 상품이 없습니다.</p>
          )}
          <div className="honest-state">
            <span className="status-dot" /> 연동된 자동화 없음
            <br />
            <small>
              현재는 수동 기록과 계산 규칙만 동작합니다. 채널 등록·주문은{" "}
              <Link to={recordUrl("sops")}>수동 절차</Link>를 따릅니다.
            </small>
          </div>
        </section>
      </div>
      <div className="home-columns">
        <section className="panel">
          <div className="section-head">
            <h2>판매 개시까지 남은 것</h2>
            <Link to={recordUrl("readiness_items")}>체크리스트 →</Link>
          </div>
          {readinessOpen.length ? (
            <ul className="plain-list">
              {readinessOpen.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={recordUrl("readiness_items", r.id)}>
                    <Badge value={r.status} /> {r.title}
                  </Link>
                </li>
              ))}
              {readinessOpen.length > 6 && (
                <li className="muted">외 {readinessOpen.length - 6}개</li>
              )}
            </ul>
          ) : (
            <p>필수 사업 준비를 모두 마쳤습니다.</p>
          )}
          <p className="muted">
            등록 준비 단계 상품{" "}
            {products.filter((p) => p.status === "listing_ready").length}개 ·
            판매 중 상품 {products.filter((p) => p.status === "live").length}개
            · 채널 등록 {liveListings.length}건 판매 중
          </p>
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>돈</h2>
            <span className="kicker">
              {d.mode === "operations" ? "실거래 기록 전" : "조사 예상만"}
            </span>
          </div>
          <p className="muted">
            실제 거래 기록은 아직 없습니다(주문·정산 기능은 다음 단계). 아래는
            저장된 원가 스냅샷의 개당 예상입니다.
          </p>
          {snapshots.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>상품</th>
                    <th>개당 착지원가</th>
                    <th>개당 공헌이익</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(({ c, product }) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={recordUrl("costings", c.id)}>
                          {product?.name ?? c.product_id}
                        </Link>
                      </td>
                      <td>{wonInt(c.outputs?.landed_per_unit)}</td>
                      <td>{wonInt(c.outputs?.contribution_per_unit)}</td>
                      <td>
                        <Badge value={c.overall_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">완성된 원가 스냅샷이 아직 없습니다.</p>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>상품이 판매에 이르는 흐름</h2>
        <div className="pipeline">
          {[
            "discovered",
            "researching",
            "costing",
            "pricing",
            "listing_ready",
            "live",
          ].map((s, i) => (
            <Link to={recordUrl("products")} key={s}>
              <small>0{i + 1}</small>
              <strong>{label(s)}</strong>
              <span>{products.filter((p) => p.status === s).length}개</span>
            </Link>
          ))}
        </div>
        <p className="muted">
          주문·배송 실무·정산·외부 자동화는 후속 단계입니다. 현재 화면의 금액은
          조사 가정입니다.
        </p>
      </section>
    </main>
  );
}
function FieldInput({
  field,
  value,
  onChange,
  data,
}: {
  field: Field;
  value: any;
  onChange: (v: any) => void;
  data: WorkspaceData;
}) {
  if (field.ref)
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        required={field.required}
      >
        <option value="">연결 안 됨</option>
        {data.records[field.ref]?.map((r) => (
          <option key={r.id} value={r.id}>
            {title(r)}
          </option>
        ))}
      </select>
    );
  if (field.options)
    return (
      <select
        value={value ?? field.default ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options.map((o) => (
          <option value={o} key={o}>
            {label(o)}
          </option>
        ))}
      </select>
    );
  if (field.type === "json")
    return (
      <StructuredInput
        field={field}
        value={value ?? field.default}
        onChange={onChange}
        data={data}
      />
    );
  if (field.type === "long")
    return (
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    );
  return (
    <input
      type={
        field.type === "date"
          ? "date"
          : field.type === "number"
            ? "number"
            : "text"
      }
      min={field.type === "number" ? 0 : undefined}
      value={value ?? ""}
      required={field.required}
      onChange={(e) =>
        onChange(
          field.type === "number"
            ? e.target.value === ""
              ? null
              : Number(e.target.value)
            : e.target.value,
        )
      }
    />
  );
}
function StructuredInput({
  field,
  value,
  onChange,
  data,
}: {
  field: Field;
  value: any;
  onChange: (v: any) => void;
  data: WorkspaceData;
}) {
  if (field.label === "포함 비용 코드")
    return (
      <div>
        {data.cost_line_types
          .filter((c) => c.stage === "transport")
          .map((c) => (
            <label className="check-label" key={c.code}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(c.code)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...(value ?? []), c.code]
                      : (value ?? []).filter((x: string) => x !== c.code),
                  )
                }
              />
              {c.name}
            </label>
          ))}
      </div>
    );
  const schemas: Record<string, Record<string, string>> = {
    대안: { option: "검토한 대안", why_not: "선택하지 않은 이유" },
    단계: { n: "순서", text: "할 일", check: "완료 확인 기준" },
    "경쟁사 관찰": {
      url: "출처 URL",
      price: "관찰 가격 (KRW)",
      observed_at: "관찰일",
      note: "조건·메모",
    },
    "무게 구간": { max_g: "상한 무게 (g)", price_claim_id: "가격 근거" },
  };
  const schema = Object.entries(schemas).find(([prefix]) =>
    field.label.startsWith(prefix),
  )?.[1];
  if (schema) {
    const rows = Array.isArray(value) ? value : [];
    return (
      <div className="structured-rows">
        {rows.map((r: Row, i: number) => (
          <div className="structured-row" key={i}>
            {Object.entries(schema).map(([key, name]) => (
              <label key={key}>
                {name}
                {key === "price_claim_id" ? (
                  <select
                    value={r[key] ?? ""}
                    onChange={(e) =>
                      onChange(
                        rows.map((row, n) =>
                          n === i ? { ...row, [key]: e.target.value } : row,
                        ),
                      )
                    }
                  >
                    <option value="">근거 선택</option>
                    {data.claims
                      .filter((c) => c.kind === "money")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {claimLabels[c.field_key] ?? c.field_key} ·{" "}
                          {title(
                            data.records[c.owner_type]?.find(
                              (r) => r.id === c.owner_id,
                            ) ?? {},
                          )}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    value={
                      key === "price"
                        ? (r.price?.amount_minor ?? "")
                        : (r[key] ?? "")
                    }
                    type={
                      key === "observed_at"
                        ? "date"
                        : key === "max_g" || key === "n" || key === "price"
                          ? "number"
                          : "text"
                    }
                    onChange={(e) =>
                      onChange(
                        rows.map((row, n) =>
                          n === i
                            ? {
                                ...row,
                                [key]:
                                  key === "price"
                                    ? e.target.value
                                      ? {
                                          amount_minor: Number(e.target.value),
                                          currency: "KRW",
                                        }
                                      : null
                                    : key === "max_g" || key === "n"
                                      ? Number(e.target.value)
                                      : e.target.value,
                              }
                            : row,
                        ),
                      )
                    }
                  />
                )}
              </label>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() => onChange(rows.filter((_, n) => n !== i))}
            >
              이 항목 제거
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange([
              ...rows,
              Object.fromEntries(
                Object.keys(schema).map((k) => [
                  k,
                  k === "n" ? rows.length + 1 : "",
                ]),
              ),
            ])
          }
        >
          + 항목 추가
        </button>
      </div>
    );
  }
  if (Array.isArray(value))
    return (
      <textarea
        value={value.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").filter(Boolean))}
        rows={3}
        placeholder="항목을 한 줄에 하나씩 적어주세요."
      />
    );
  if (field.label.includes("(KRW)"))
    return (
      <input
        type="number"
        min={0}
        value={value?.amount_minor ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value === ""
              ? null
              : { amount_minor: Number(e.target.value), currency: "KRW" },
          )
        }
        placeholder="원 단위 정수. 모르면 비움"
      />
    );
  const object = value && typeof value === "object" ? value : {};
  const keys =
    field.label === "고지 문구"
      ? [
          "purchase_agency_notice",
          "random_notice",
          "origin_notice",
          "return_notice",
        ]
      : field.label === "정책"
        ? [
            "shipping_fee_policy",
            "return_policy_text",
            "purchase_agency_notice",
            "random_notice",
          ]
        : ["note"];
  const names: Row = {
    shipping_fee_policy: "배송비 정책",
    return_policy_text: "반품 정책",
    purchase_agency_notice: "구매대행 고지",
    random_notice: "랜덤 상품 고지",
    origin_notice: "원산지·수입자 표기",
    return_notice: "반품·교환 고지",
    note: "내용",
  };
  return (
    <div>
      {keys.map((k) => (
        <label key={k}>
          {names[k]}
          <textarea
            value={object[k] ?? ""}
            onChange={(e) => onChange({ ...object, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
export function RecordEditor({
  type,
  record,
  data,
  onSaved,
  onCancel,
}: {
  type: string;
  record?: Row;
  data: WorkspaceData;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const def = catalog[type],
    qc = useQueryClient();
  const [form, setForm] = useState<Row>(() =>
      Object.fromEntries(
        Object.entries(def.fields)
          .filter(([, f]) => !f.managed)
          .map(([k, f]) => [k, record?.[k] ?? f.default ?? null]),
      ),
    ),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = { ...form };
      for (const [k, f] of Object.entries(def.fields))
        if (f.type === "json" && typeof values[k] === "string")
          values[k] = JSON.parse(values[k]);
      const result = await api<{ data: Row }>(
        `/records/${type}`,
        jsonBody("PUT", { ...values, id: record?.id, reason }),
      );
      await qc.invalidateQueries();
      onSaved(result.data.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel record-editor" onSubmit={save}>
      <div className="section-head">
        <h2>{record ? "기록 수정" : "새 " + def.label}</h2>
        <button type="button" className="secondary" onClick={onCancel}>
          닫기
        </button>
      </div>
      <ErrorBox error={error} />
      <div className="form-grid">
        {Object.entries(def.fields)
          .filter(([, f]) => !f.managed)
          .map(([key, f]) => (
            <label
              key={key}
              className={f.type === "long" || f.type === "json" ? "wide" : ""}
            >
              {f.label.replace(/\s*\[.*\]/, "")}
              {f.required && " *"}
              {["from_type", "to_type", "entity_type"].includes(key) ? (
                <select
                  value={form[key] ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [key]: e.target.value,
                      [key.replace("_type", "_id")]: null,
                    })
                  }
                >
                  <option value="">연결 안 함</option>
                  {Object.entries(catalog).map(([t, d]) => (
                    <option key={t} value={t}>
                      {d.label}
                    </option>
                  ))}
                </select>
              ) : ["from_id", "to_id", "entity_id"].includes(key) ? (
                <select
                  value={form[key] ?? ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                >
                  <option value="">기록 선택</option>
                  {data.records[form[key.replace("_id", "_type")]]?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {title(r)}
                    </option>
                  ))}
                </select>
              ) : (
                <FieldInput
                  field={f}
                  value={form[key]}
                  onChange={(v) => setForm({ ...form, [key]: v })}
                  data={data}
                />
              )}
            </label>
          ))}
      </div>
      <div className="form-actions">
        <label>
          이번 기록·변경의 이유 *
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="나중에 다시 봐도 이해할 수 있게 적어주세요."
          />
        </label>
        <button disabled={busy}>
          {busy ? "저장 중…" : "이유와 함께 저장"}
        </button>
      </div>
    </form>
  );
}
export function ClaimEditor({
  claim,
  onClose,
}: {
  claim: Claim & { id?: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(claim.status),
    [kind, setKind] = useState(claim.kind),
    [value, setValue] = useState(() =>
      claim.kind === "money"
        ? String(
            (claim.value_json as any)?.amount_minor == null
              ? ""
              : (claim.value_json as any).amount_minor /
                  (["CNY", "USD"].includes((claim.value_json as any).currency)
                    ? 100
                    : 1),
          )
        : claim.kind === "percent"
          ? String(
              claim.value_json == null ? "" : Number(claim.value_json) / 100,
            )
          : claim.kind === "range"
            ? JSON.stringify(
                claim.value_json ?? { min: null, likely: null, max: null },
              )
            : String(claim.value_json ?? ""),
    );
  const [currency, setCurrency] = useState(
      (claim.value_json as any)?.currency ?? "KRW",
    ),
    [source, setSource] = useState(claim.source_ref ?? ""),
    [sourceType, setSourceType] = useState(claim.source_type ?? "url"),
    [checked, setChecked] = useState(
      claim.checked_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    ),
    [recheck, setRecheck] = useState(claim.recheck_by),
    [note, setNote] = useState(claim.note ?? ""),
    [basis, setBasis] = useState(
      JSON.stringify(claim.basis_json ?? {}, null, 2),
    ),
    [files, setFiles] = useState<FileList | null>(null),
    [ids, setIds] = useState(claim.attachment_ids ?? []),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const attachments = [...ids];
      if (files)
        for (const file of Array.from(files)) {
          const fd = new FormData();
          fd.set("file", file);
          fd.set("owner_type", claim.owner_type);
          fd.set("owner_id", claim.owner_id);
          const result = await api<{ data: { id: string } }>("/attachments", {
            method: "POST",
            body: fd,
          });
          attachments.push(result.data.id);
        }
      setIds(attachments);
      setFiles(null);
      let v: any = null;
      if (status !== "unknown") {
        if (value === "")
          throw new Error("확인·추정 값은 빈칸으로 저장할 수 없습니다.");
        v =
          kind === "money"
            ? {
                amount_minor: Math.round(
                  Number(value) * (["CNY", "USD"].includes(currency) ? 100 : 1),
                ),
                currency,
              }
            : kind === "percent"
              ? Math.round(Number(value) * 100)
              : ["number", "days"].includes(kind)
                ? Number(value)
                : kind === "bool"
                  ? value === "true"
                  : kind === "range"
                    ? JSON.parse(value)
                    : value;
      }
      const result = await api<Row>(
        "/claims",
        jsonBody("PUT", {
          ...claim,
          kind,
          status,
          value_json: v,
          source_type: sourceType,
          source_ref: source,
          checked_at: status === "unknown" ? null : checked + "T00:00:00Z",
          recheck_by: recheck,
          note,
          basis_json: JSON.parse(basis),
          attachment_ids: attachments,
        }),
      );
      setStatus(result.data.status);
      setMessage(result.message ?? "근거가 저장됐습니다.");
      await qc.invalidateQueries();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel claim-editor" onSubmit={submit}>
      <div className="section-head">
        <h2>{claimLabels[claim.field_key] ?? claim.field_key} · 근거 기록</h2>
        <button className="secondary" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="muted">
        미확인은 빈칸입니다. 무료임을 확인했다면 0과 근거를 함께 기록하세요.
      </p>
      <ErrorBox error={error} />
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      <div className="form-grid">
        <label>
          상태
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            {["unknown", "estimated", "confirmed"].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          값 형식
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as any);
              setValue("");
            }}
          >
            {[
              "money",
              "percent",
              "number",
              "bool",
              "text",
              "enum",
              "range",
              "days",
            ].map((k) => (
              <option key={k} value={k}>
                {
                  (
                    {
                      money: "금액",
                      percent: "비율 (%)",
                      number: "수량·숫자",
                      bool: "예 / 아니오",
                      text: "텍스트",
                      enum: "선택값",
                      range: "범위",
                      days: "일수",
                    } as Row
                  )[k]
                }
              </option>
            ))}
          </select>
        </label>
        {status !== "unknown" && (
          <>
            <label>
              값{" "}
              {kind === "percent"
                ? "(%)"
                : kind === "range"
                  ? "({min, likely, max, currency?} · 금액은 최소 단위: CNY·USD는 1/100, KRW는 원)"
                  : ""}
              {kind === "bool" ? (
                <select
                  value={value}
                  required
                  onChange={(e) => setValue(e.target.value)}
                >
                  <option value="">선택</option>
                  <option value="true">예</option>
                  <option value="false">아니오</option>
                </select>
              ) : (
                <input
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </label>
            {kind === "money" && (
              <label>
                통화
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {["KRW", "CNY", "TWD", "USD", "JPY"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        <label>
          출처 유형
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as any)}
          >
            {[
              "url",
              "screenshot",
              "message",
              "call",
              "document",
              "competitor_observation",
              "self_estimate",
              "api",
            ].map((s) => (
              <option value={s} key={s}>
                {
                  (
                    {
                      url: "웹페이지",
                      screenshot: "화면 캡처",
                      message: "판매자 답변",
                      call: "전화",
                      document: "문서",
                      competitor_observation: "경쟁사 관찰",
                      self_estimate: "직접 세운 가정",
                      api: "API 결과",
                    } as Row
                  )[s]
                }
              </option>
            ))}
          </select>
        </label>
        <label>
          출처 URL·문서명
          <input
            required={status !== "unknown"}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          확인일
          <input
            type="date"
            required={status !== "unknown"}
            value={checked}
            onChange={(e) => {
              setChecked(e.target.value);
              if (e.target.value)
                setRecheck(
                  defaultRecheck(
                    claim.field_key,
                    e.target.value,
                    claim.owner_type,
                  ),
                );
            }}
          />
        </label>
        <label>
          재확인 기한
          <input
            type="date"
            required
            value={recheck}
            onChange={(e) => setRecheck(e.target.value)}
          />
        </label>
        <label className="wide">
          조건·메모
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="wide">
          증빙 파일 (가격·배송비 확인에 필요)
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
          />
          <small>
            {ids.length}개 첨부됨{" "}
            {ids.map((id, i) => (
              <a key={id} href={"/api/v1/attachments/" + id}>
                증빙 {i + 1} ↗{" "}
              </a>
            ))}
          </small>
        </label>
        <details className="wide">
          <summary>수량·옵션·포함 항목 등 구조화된 조건</summary>
          <textarea value={basis} onChange={(e) => setBasis(e.target.value)} />
        </details>
      </div>
      <button
        disabled={
          busy ||
          ["decided_price", "decided_customer_shipping_fee"].includes(
            claim.field_key,
          )
        }
      >
        {["decided_price", "decided_customer_shipping_fee"].includes(
          claim.field_key,
        )
          ? "확정 가격은 상품의 가격 결정에서 변경하세요"
          : busy
            ? "저장 중…"
            : "근거 저장"}
      </button>
    </form>
  );
}
export function ClaimValue({ claim }: { claim: Claim }) {
  let v = claim.value_json as any;
  const text =
    claim.status === "unknown"
      ? "미확인"
      : claim.kind === "money"
        ? `${(v.amount_minor / (["CNY", "USD"].includes(v.currency) ? 100 : 1)).toLocaleString("ko-KR")} ${v.currency}`
        : claim.kind === "percent"
          ? `${v / 100}%`
          : claim.kind === "bool"
            ? v
              ? "예"
              : "아니오"
            : claim.kind === "range"
              ? `${v.min} ~ ${v.max} (기준 ${v.likely}) ${v.currency ?? ""}`
              : String(v);
  return (
    <>
      <strong>{text}</strong>
      <Badge value={claim.status} />
    </>
  );
}
export function Records({ children }: { children?: React.ReactNode }) {
  const { type = "notes", id } = useParams(),
    q = useWorkspace(),
    navigate = useNavigate(),
    qc = useQueryClient();
  const [editing, setEditing] = useState(false),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState(""),
    [activeClaim, setActiveClaim] = useState<(Claim & { id: string }) | null>(
      null,
    ),
    [error, setError] = useState(""),
    [deleteReason, setDeleteReason] = useState("");
  const [view, setView] = useViewMode(type);
  const d = q.data,
    def = catalog[type];
  if (!def) return <main className="page">기록 종류가 없습니다.</main>;
  if (!d)
    return (
      <main className="page">
        <ErrorBox error={q.error} />
        기록 불러오는 중…
      </main>
    );
  const rows = d.records[type] ?? [],
    record = rows.find((r) => r.id === id),
    filtered = rows.filter((r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
    );
  const relatedTypes =
    [
      ["products", "characters", "product_variants", "costings"],
      ["compliance_profiles", "requirement_items"],
      ["suppliers", "offers", "supplier_messages"],
      ["shipping_scenarios", "shipping_legs", "forwarders", "rate_cards"],
      ["notes", "decisions", "links", "sops"],
      ["channels", "listings", "sops"],
      ["readiness_items", "fx_rates"],
    ].find((g) => g.includes(type)) ?? [];
  const claims = record
    ? d.claims.filter((c) => c.owner_type === type && c.owner_id === record.id)
    : [];
  const related = record
    ? d.records.links.filter(
        (l) =>
          (l.from_type === type && l.from_id === id) ||
          (l.to_type === type && l.to_id === id),
      )
    : [];
  async function remove() {
    try {
      await api(
        `/records/${type}/${id}`,
        jsonBody("DELETE", { reason: deleteReason }),
      );
      await qc.invalidateQueries();
      navigate(recordUrl(type));
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main className="page">
      <PageHead
        eyebrow="RESEARCH / 사업 기록"
        title={record ? title(record) : def.label}
        description={
          record
            ? "근거 · 관련 결정 · 할 일 · 변경 이력을 함께 확인하세요."
            : `${rows.length}개의 기록 · 미확인 항목은 확인 전까지 계산에 쓰지 않습니다.`
        }
      >
        <div className="buttons">
          {record && (
            <Link className="button secondary" to={recordUrl(type)}>
              목록
            </Link>
          )}
          {type !== "costings" && (
            <button
              onClick={() => (record ? setEditing(true) : setAdding(true))}
            >
              {record ? "기록 수정" : "+ 새 기록"}
            </button>
          )}
        </div>
      </PageHead>
      <ErrorBox error={error} />
      {relatedTypes.length > 1 && (
        <div className="section-tabs">
          {relatedTypes.map((t) => (
            <Link
              className={t === type ? "active" : ""}
              key={t}
              to={recordUrl(t)}
            >
              {catalog[t].label}
            </Link>
          ))}
        </div>
      )}
      {((editing && record) || adding) && (
        <RecordEditor
          key={(editing ? record?.id : "new") + type}
          type={type}
          record={editing ? record : undefined}
          data={d}
          onCancel={() => {
            setEditing(false);
            setAdding(false);
          }}
          onSaved={(id) => {
            setEditing(false);
            setAdding(false);
            navigate(recordUrl(type, id));
          }}
        />
      )}
      {activeClaim && (
        <ClaimEditor
          key={activeClaim.id}
          claim={activeClaim}
          onClose={() => setActiveClaim(null)}
        />
      )}
      {!record ? (
        <>
          <div className="list-toolbar">
            <input
              aria-label="기록 검색"
              placeholder="이름·내용·상태 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="muted">{filtered.length}개 표시</span>
            <span className="seg" role="group" aria-label="보기 방식">
              <button
                type="button"
                className={view === "table" ? "on" : ""}
                onClick={() => setView("table")}
              >
                표
              </button>
              <button
                type="button"
                className={view === "cards" ? "on" : ""}
                onClick={() => setView("cards")}
              >
                카드
              </button>
              {type === "products" && (
                <button
                  type="button"
                  className={view === "board" ? "on" : ""}
                  onClick={() => setView("board")}
                >
                  단계별
                </button>
              )}
            </span>
          </div>
          {view === "table" ? (
            <RecordTable
              type={type}
              rows={filtered}
              data={d}
              foot={
                type === "products"
                  ? "등급 = 요건 게이트 → 남은 조치 → 수익성 순서 판정. 미확인 금액은 비워 둡니다(0으로 계산하지 않음)."
                  : type === "tasks"
                    ? "상태는 파생 규칙이 계산하며 직접 바꾸지 않습니다. 행을 누르면 근거·이력이 열립니다."
                    : undefined
              }
            />
          ) : view === "board" && type === "products" ? (
            <ProductBoard products={filtered} grades={d.grades} />
          ) : (
            <div className="record-grid">
              {filtered.map((r) => (
                <Link
                  className="record-card"
                  key={r.id}
                  to={recordUrl(type, r.id)}
                >
                  <div className="section-head">
                    <small>
                      {label(r.code ?? r.platform ?? r.category ?? def.label)}
                    </small>
                    {(r.status ?? r.gate_result ?? r.item_result) && (
                      <Badge
                        value={r.status ?? r.gate_result ?? r.item_result}
                      />
                    )}
                  </div>
                  <h3>{title(r)}</h3>
                  <p>
                    {r.rationale ??
                      r.blocked_reason ??
                      r.notes ??
                      r.trust_notes ??
                      r.condition_text ??
                      r.gate_reason ??
                      ""}
                  </p>
                  <span className="record-card-footer">기록과 근거 보기 ↗</span>
                </Link>
              ))}
            </div>
          )}
          {!rows.length && (
            <div className="panel empty">
              아직 기록이 없습니다. 새 기록을 만들어 시작하세요.
            </div>
          )}
          {!["fx_rates", "costings"].includes(type) && <Trash type={type} />}
        </>
      ) : (
        <>
          {children}
          <section className="panel">
            <div className="detail-grid">
              {Object.entries(def.fields).map(([k, f]) => {
                let v = record[k];
                if (v == null || v === "") return null;
                if (f.ref) {
                  const ref = d.records[f.ref]?.find((r) => r.id === v);
                  return (
                    <div key={k}>
                      <dt>{f.label.replace(/\s*\[.*\]/, "")}</dt>
                      <dd>
                        <Link to={recordUrl(f.ref, v)}>
                          {ref ? title(ref) : v}
                        </Link>
                      </dd>
                    </div>
                  );
                }
                return (
                  <div
                    key={k}
                    className={
                      f.type === "long" || f.type === "json" ? "wide" : ""
                    }
                  >
                    <dt>{f.label.replace(/\s*\[.*\]/, "")}</dt>
                    <dd>
                      {f.options ? (
                        <Badge value={v} />
                      ) : f.type === "json" ? (
                        <StructuredValue value={v} />
                      ) : (
                        String(v)
                      )}
                    </dd>
                  </div>
                );
              })}
            </div>
          </section>
          {!!claims.length && (
            <section className="panel">
              <h2>확인할 값과 근거</h2>
              <div className="claims-grid">
                {claims.map((c) => (
                  <button
                    className="claim-card"
                    key={c.id}
                    onClick={() => setActiveClaim(c)}
                  >
                    <span>{claimLabels[c.field_key] ?? c.field_key}</span>
                    <div>
                      <ClaimValue claim={c} />
                    </div>
                    <small>{c.source_ref ?? "출처를 연결하세요."}</small>
                    <small
                      className={
                        c.recheck_by < new Date().toISOString().slice(0, 10)
                          ? "overdue"
                          : ""
                      }
                    >
                      재확인 {c.recheck_by} · 증빙 {c.attachment_ids.length}개
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="panel">
            <h2>연결된 기록</h2>
            <div className="related-links">
              {Object.entries(catalog).flatMap(([other, definition]) =>
                Object.entries(definition.fields)
                  .filter(([, f]) => f.ref === type)
                  .flatMap(([key]) =>
                    d.records[other]
                      .filter((r) => r[key] === id)
                      .map((r) => (
                        <Link key={other + r.id} to={recordUrl(other, r.id)}>
                          <span>{definition.label}</span>
                          <strong>{title(r)}</strong>
                        </Link>
                      )),
                  ),
              )}
              {related.map((l) => {
                const other = l.from_id === id ? l.to_type : l.from_type,
                  oid = l.from_id === id ? l.to_id : l.from_id;
                return (
                  <Link key={l.id} to={recordUrl(other, oid)}>
                    {l.note || label(l.relation)} →{" "}
                    {catalog[other]?.label ?? other}
                  </Link>
                );
              })}
            </div>
            <Link to={recordUrl("links")}>기록 간 연결 추가 →</Link>
          </section>
          <section className="panel">
            <h2>왜 이렇게 됐나요?</h2>
            {d.activity
              .filter((a) => a.entity_type === type && a.entity_id === id)
              .slice(0, 20)
              .map((a) => (
                <div className="history-row" key={a.id}>
                  <time>{new Date(a.at).toLocaleString("ko-KR")}</time>
                  <strong>{a.reason}</strong>
                  <small>
                    {a.actor === "user"
                      ? "사용자 입력"
                      : a.actor.startsWith("import")
                        ? "가져온 기록"
                        : "규칙에 따른 변경"}
                  </small>
                  <details>
                    <summary>변경 전·후</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          before: a.before_json
                            ? JSON.parse(a.before_json)
                            : null,
                          after: JSON.parse(a.after_json),
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
          </section>
          {!["costings", "fx_rates"].includes(type) && (
            <details className="panel">
              <summary>기록 삭제</summary>
              <p>
                연결된 기록이 있으면 삭제할 수 없습니다. 변경 이력은 남습니다.
              </p>
              <input
                aria-label="삭제 이유"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="삭제 이유"
              />
              <button
                className="secondary"
                disabled={!deleteReason.trim()}
                onClick={remove}
              >
                이유를 남기고 삭제
              </button>
            </details>
          )}
        </>
      )}
    </main>
  );
}
function Trash({ type }: { type: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const q = useQuery({
    queryKey: ["deleted", type],
    queryFn: () => api<{ data: Row[] }>(`/records/${type}?deleted=1`),
    enabled: open,
  });
  async function restore(id: string) {
    try {
      await api(`/records/${type}/${id}/restore`, jsonBody("POST", { reason }));
      await qc.invalidateQueries();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <details
      className="panel"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>삭제된 기록 보기·복구</summary>
      <p className="muted">
        삭제는 되돌릴 수 있습니다. 복구에도 이유가 남습니다.
      </p>
      <ErrorBox error={error} />
      <input
        aria-label="복구 이유"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="복구 이유"
      />
      {q.data?.data.length === 0 && (
        <p className="empty">삭제된 기록이 없습니다.</p>
      )}
      {q.data?.data.map((r) => (
        <div className="history-row" key={r.id}>
          <strong>{title(r)}</strong>
          <small>삭제 {r.deleted_at?.slice(0, 10)}</small>
          <button
            type="button"
            className="secondary"
            disabled={!reason.trim()}
            onClick={() => restore(r.id)}
          >
            복구
          </button>
        </div>
      ))}
    </details>
  );
}
function ProductBoard({
  products,
  grades,
}: {
  products: Row[];
  grades: WorkspaceData["grades"];
}) {
  const order: Record<string, number> = {
    A: 0,
    B: 1,
    C: 2,
    D: 4,
    "판정 불가": 3,
  };
  const sorted = [...products].sort(
    (a, b) =>
      (order[grades[a.id]?.grade] ?? 9) - (order[grades[b.id]?.grade] ?? 9),
  );
  const stages = [
    "discovered",
    "researching",
    "costing",
    "pricing",
    "listing_ready",
    "live",
    "paused",
    "on_hold",
    "rejected",
    "discontinued",
  ];
  return (
    <div className="product-board">
      {stages
        .filter((s, i) => i < 6 || products.some((p) => p.status === s))
        .map((s, i) => (
          <section className="board-column" key={s}>
            <div className="section-head">
              <strong>{label(s)}</strong>
              <span>{products.filter((p) => p.status === s).length}</span>
            </div>
            <p className="board-hint">
              {[
                "상품 후보 모으기",
                "판매 요건과 공급처 확인",
                "배송비·환율·손익 비교",
                "근거를 남기고 가격 결정",
                "필수 사업 준비 마무리",
                "채널에 올리고 등록 상품 기록",
              ][i] ?? "이유와 재검토 조건 보관"}
            </p>
            {sorted
              .filter((p) => p.status === s)
              .map((p) => (
                <Link
                  to={recordUrl("products", p.id)}
                  className="board-card"
                  key={p.id}
                >
                  <small>
                    {label(p.category)} · {label(p.option_scheme)}
                  </small>
                  <h3>{p.name}</h3>
                  {grades[p.id] && (
                    <p>
                      <GradeBadge
                        grade={grades[p.id].grade}
                        estimated={grades[p.id].estimated}
                      />{" "}
                      <small>{grades[p.id].reasons[0]}</small>
                    </p>
                  )}
                  <p>{p.notes}</p>
                  <span>기록과 다음 행동 →</span>
                </Link>
              ))}
            {!products.some((p) => p.status === s) && (
              <div className="board-empty">아직 이 단계의 상품이 없어요.</div>
            )}
          </section>
        ))}
    </div>
  );
}
function StructuredValue({ value }: { value: any }) {
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            {typeof v === "object"
              ? Object.entries(v).map(([k, x]) => (
                  <span key={k}>
                    {k === "url" ? (
                      <a href={String(x)} target="_blank" rel="noreferrer">
                        출처 열기 ↗
                      </a>
                    ) : (
                      `${({ price: "관찰 가격", observed_at: "관찰일", note: "메모", source_type: "근거 종류", option: "대안", why_not: "선택하지 않은 이유", n: "순서", text: "할 일", check: "완료 기준", max_g: "무게 상한(g)", price_claim_id: "가격 근거" } as Row)[k] ?? k}: ${x && typeof x === "object" && "amount_minor" in x ? `${Number((x as Row).amount_minor) / (["CNY", "USD"].includes((x as Row).currency) ? 100 : 1)} ${(x as Row).currency}` : typeof x === "object" ? (x === null ? "미확인" : JSON.stringify(x)) : label(String(x ?? "미확인"))}`
                    )}{" "}
                  </span>
                ))
              : String(v)}
          </li>
        ))}
      </ul>
    ) : (
      <span className="muted">기록 없음</span>
    );
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
export function Settings() {
  const q = useWorkspace(),
    qc = useQueryClient(),
    [model, setModel] = useState("undecided"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(
        "/settings",
        jsonBody("PUT", { key: "business_model", value: model, reason }),
      );
      await qc.invalidateQueries();
      setMessage("D-01 결정과 사업 모델 설정을 저장했습니다.");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main className="page">
      <PageHead
        eyebrow="SETTINGS / 기본값"
        title="사업의 기준을 정하는 곳"
        description="금액은 상품의 근거에서, 환율은 기준일과 출처를 함께 기록합니다."
      />
      <ErrorBox error={error} />
      {message && (
        <div role="status" className="alert">
          {message}
        </div>
      )}
      <form className="panel" onSubmit={save}>
        <h2>사업 모델 · D-01</h2>
        <p>
          현재:{" "}
          <strong>
            {label(q.data?.settings.business_model ?? "undecided")}
          </strong>
        </p>
        <div className="form-grid">
          <label>
            선택
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {Object.entries({
                undecided: "미결정 유지",
                purchase_agency: "해외구매대행",
                import_resale: "수입 후 판매",
                hybrid: "혼합",
                domestic_wholesale: "국내 정식 도매",
              }).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            결정 이유
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
        <button>결정 기록과 함께 저장</button>
      </form>
      <div className="record-grid">
        <Link className="record-card" to={recordUrl("fx_rates")}>
          <h3>환율</h3>
          <p>
            직접 확인한 기준일·환율·출처를 기록합니다. 저장한 환율은 바뀌지
            않습니다.
          </p>
        </Link>
        <Link className="record-card" to={recordUrl("sops")}>
          <h3>업무 절차</h3>
          <p>
            반복할 순서와 실패했을 때의 대응을 남깁니다. 외부 연동은 아직
            없습니다.
          </p>
        </Link>
      </div>
      <section className="panel">
        <h2>비용 항목 사전</h2>
        <p className="muted">
          고객 청구 배송비는 수입, 배송업체에 내는 비용은 지출입니다.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>방향</th>
                <th>배분 기준</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.cost_line_types.map((r) => (
                <tr key={r.code}>
                  <td>{r.name}</td>
                  <td>{r.direction === "income" ? "수입" : "지출"}</td>
                  <td>{label(r.basis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
export function Claims() {
  const q = useWorkspace(),
    [selected, setSelected] = useState<any>(null),
    [staleOnly, setStaleOnly] = useState(false);
  return (
    <main className="page">
      <PageHead
        eyebrow="EVIDENCE / 근거"
        title="값을 믿을 수 있는 이유"
        description="가격·배송비는 실제 증빙을 첨부해야 확인 상태가 됩니다."
      />
      {selected && (
        <ClaimEditor
          key={selected.id}
          claim={selected}
          onClose={() => setSelected(null)}
        />
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={staleOnly}
          onChange={(e) => setStaleOnly(e.target.checked)}
        />
        재확인 기한 지난 항목만
      </label>
      <div className="claims-grid">
        {q.data?.claims
          .filter(
            (c) =>
              !catalog[c.owner_type] ||
              q.data?.records[c.owner_type]?.some((r) => r.id === c.owner_id),
          )
          .filter(
            (c) =>
              !staleOnly ||
              (c.status !== "unknown" &&
                c.recheck_by < new Date().toISOString().slice(0, 10)),
          )
          .map((c) => (
            <button
              key={c.id}
              className="claim-card"
              onClick={() => setSelected(c)}
            >
              <span>{claimLabels[c.field_key] ?? c.field_key}</span>
              <small>
                {title(
                  q.data?.records[c.owner_type]?.find(
                    (r) => r.id === c.owner_id,
                  ) ?? {},
                )}
              </small>
              <div>
                <ClaimValue claim={c} />
              </div>
              <small>재확인 {c.recheck_by}</small>
            </button>
          ))}
      </div>
    </main>
  );
}
export function ResearchImport() {
  const [file, setFile] = useState<File | null>(null),
    [report, setReport] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    qc = useQueryClient();
  const [progress, setProgress] = useState("");
  async function run(apply = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // 조각 단위로 반복 호출한다(Workers 요청당 D1 호출 상한). 미리보기는 결과를 이어 붙이고, 적용은 서버 배치 행에 누적된다.
      let r: Row = { next: 0 };
      const previewRows: Row[] = [];
      while (r.next !== null && r.next !== undefined) {
        r = await api<Row>(
          `/research-import?from=${r.next}&limit=10${apply ? "&apply=1" : ""}`,
          {
            method: "POST",
            headers: {
              "X-Filename": encodeURIComponent(file.name),
              ...(apply ? { "X-Preview-Hash": report!.hash } : {}),
              ...(apply && r.batch_id ? { "X-Import-Batch": r.batch_id } : {}),
            },
            body: file,
          },
        );
        if (!apply) previewRows.push(...r.results);
        setProgress(`${Math.min(r.next ?? r.total, r.total)}/${r.total}`);
      }
      setProgress("");
      if (!apply) {
        const c = (st: string[]) =>
          previewRows.filter((x) => st.includes(x.status)).length;
        r = {
          ...r,
          results: previewRows,
          ready: c(["ready"]),
          failed: c(["failed"]),
          skipped: c(["skipped"]),
        };
      }
      setReport(r);
      if (apply) await qc.invalidateQueries();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <PageHead
        eyebrow="IMPORT / 조사 자료"
        title="엑셀 조사 기록 가져오기"
        description="research_template.xlsx의 열 이름과 ID를 유지하세요. 같은 ID는 중복 생성하지 않습니다."
      />
      <section className="panel">
        <p>
          가격 캡처 파일명만으로는 증빙이 연결되지 않습니다. 예시(-EX1)와
          계산식은 가져오지 않습니다.
        </p>
        <input
          type="file"
          accept=".xlsx"
          aria-label="조사 엑셀 파일"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setReport(null);
          }}
        />
        <div className="buttons">
          <button disabled={!file || busy} onClick={() => run()}>
            행별 미리보기
          </button>
          {report && !report.applied && (
            <button
              disabled={busy || report.failed > 0}
              onClick={() => run(true)}
            >
              검토한 {report.ready}개 기록 적용
            </button>
          )}
        </div>
        <ErrorBox error={error} />
        {busy && (
          <p role="status">행별 연결과 근거를 검증하는 중… {progress}</p>
        )}
        {report && (
          <>
            <h3>{report.applied ? "적용 결과" : "적용 전 미리보기"}</h3>
            <p>
              정상 {report.ready} · 실패 {report.failed} · 제외 {report.skipped}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>시트 / 행</th>
                    <th>ID</th>
                    <th>결과</th>
                    <th>설명</th>
                  </tr>
                </thead>
                <tbody>
                  {report.results.map((r: Row, i: number) => (
                    <tr key={i}>
                      <td>
                        {r.sheet} / {r.row}
                      </td>
                      <td>{r.external_id ?? "—"}</td>
                      <td>
                        {
                          (
                            {
                              ready: "적용 가능",
                              applied: "적용됨",
                              failed: "실패",
                              skipped: "제외",
                              notice: "안내",
                            } as Row
                          )[r.status]
                        }
                      </td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
