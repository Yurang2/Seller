import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../api/client";
import {
  Records,
  useWorkspace,
  recordUrl,
  title,
  label,
  Badge,
  ErrorBox,
  ClaimEditor,
  ClaimValue,
  type Row,
  type WorkspaceData,
} from "./Workspace";
import { claimLabels, stages } from "../../domain/records/catalog";
export function ResearchRecords() {
  const { type, id } = useParams();
  return (
    <Records key={type + ":" + id}>
      {type === "products" && id ? (
        <ProductTools id={id} />
      ) : type === "costings" && id ? (
        <Snapshot id={id} />
      ) : type === "channels" && id ? (
        <ChannelTools id={id} />
      ) : null}
    </Records>
  );
}
function ChannelTools({ id }: { id: string }) {
  const q = useWorkspace();
  const d = q.data,
    ch = d?.records.channels.find((c) => c.id === id);
  if (!d || !ch) return null;
  const sop = (key: string) => d.records.sops.find((s) => s.key === key);
  const listings = (d.records.listings ?? []).filter(
    (l) => l.channel_id === id,
  );
  return (
    <>
      {ch.integration_state !== "api" && (
        <div className="alert" role="status">
          <strong>연동 안 됨 · {label(ch.integration_state ?? "none")}</strong>{" "}
          이 채널과 주고받는 자료는 모두 사람이 옮깁니다. 절차:{" "}
          {sop("listing_manual") ? (
            <Link to={recordUrl("sops", sop("listing_manual")!.id)}>
              상품 올리기(수동)
            </Link>
          ) : (
            "상품 올리기(수동) 절차 없음"
          )}
          {" · "}
          {sop("orders_manual") ? (
            <Link to={recordUrl("sops", sop("orders_manual")!.id)}>
              주문 처리(수동)
            </Link>
          ) : (
            "주문 처리(수동) 절차 없음"
          )}
          . API 연동은 자동화 단계(M4)에서 붙습니다.
        </div>
      )}
      <section className="panel">
        <div className="section-head">
          <h2>이 채널의 등록 상품</h2>
          <Link className="button secondary" to={recordUrl("listings")}>
            등록 상품 기록 →
          </Link>
        </div>
        {listings.length ? (
          <ul className="plain-list">
            {listings.map((l) => (
              <li key={l.id}>
                <Link to={recordUrl("listings", l.id)}>
                  <Badge value={l.status} />{" "}
                  {d.records.products.find((p) => p.id === l.product_id)
                    ?.name ?? l.product_id}
                  {l.external_id && ` · ${l.external_id}`}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">아직 이 채널에 등록한 상품 기록이 없습니다.</p>
        )}
      </section>
    </>
  );
}
function ProductTools({ id }: { id: string }) {
  const q = useWorkspace(),
    qc = useQueryClient();
  const [status, setStatus] = useState("researching"),
    [reason, setReason] = useState(""),
    [recheck, setRecheck] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [showTransition, setShowTransition] = useState(false),
    [alt, setAlt] = useState(""),
    [why, setWhy] = useState(""),
    [revisit, setRevisit] = useState("");
  const d = q.data,
    p = d?.records.products.find((p) => p.id === id);
  if (!p || !d) return null;
  async function transition() {
    try {
      await api(
        "/products/" + id + "/transition",
        jsonBody("POST", { status, reason, recheck_at: recheck || null }),
      );
      await qc.invalidateQueries();
      setShowTransition(false);
      setMessage("단계와 변경 이유를 기록했습니다.");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function price() {
    try {
      await api(
        "/products/" + id + "/price-decision",
        jsonBody("POST", {
          reason,
          alternatives: [{ option: alt, why_not: why }],
          revisit_when: revisit,
        }),
      );
      await qc.invalidateQueries();
      setMessage("현재 원가를 근거로 가격 결정을 기록했습니다.");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  const profile = d.records.compliance_profiles.find(
    (r) => r.id === p.profile_id,
  );
  return (
    <>
      <section className="panel">
        <div className="section-head">
          <h2>조사에서 가격 결정까지</h2>
          <button
            className="secondary"
            onClick={() => setShowTransition(!showTransition)}
          >
            단계 변경
          </button>
        </div>
        <div className="pipeline">
          {[
            "discovered",
            "researching",
            "costing",
            "pricing",
            "listing_ready",
            "live",
          ].map((s, i) => (
            <div className={p.status === s ? "current" : ""} key={s}>
              <small>0{i + 1}</small>
              <strong>{label(s)}</strong>
              {p.status === s && <span>현재 단계</span>}
            </div>
          ))}
        </div>
        <p>
          판매 요건: <Badge value={profile?.gate_result ?? "unknown"} />{" "}
          {profile && (
            <Link to={recordUrl("compliance_profiles", profile.id)}>
              항목별 이유 확인 →
            </Link>
          )}
        </p>
        {profile?.gate_result === "fail" && (
          <div className="alert error">
            가격 결정 진행 불가 · {profile.gate_reason}
          </div>
        )}
        <ErrorBox error={error} />
        {message && (
          <div role="status" className="alert">
            {message}
          </div>
        )}
        {showTransition && (
          <div className="form-grid">
            <label>
              이동할 단계
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {stages
                  .filter((s) => s !== "paused" || p.status === "live")
                  .map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              변경 이유
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {status === "on_hold" && (
              <label>
                다시 검토할 날
                <input
                  type="date"
                  value={recheck}
                  onChange={(e) => setRecheck(e.target.value)}
                />
              </label>
            )}
            <button disabled={!reason.trim()} onClick={transition}>
              요건 확인 후 단계 변경
            </button>
          </div>
        )}
        <div className="buttons">
          <Link className="button secondary" to={recordUrl("offers")}>
            오퍼·견적 기록
          </Link>
          <Link
            className="button secondary"
            to={recordUrl("shipping_scenarios")}
          >
            배송 경로 기록
          </Link>
          <Link className="button secondary" to={recordUrl("product_variants")}>
            옵션 기록
          </Link>
        </div>
      </section>
      {["listing_ready", "live", "paused"].includes(p.status) && (
        <section className="panel">
          <div className="section-head">
            <h2>채널 등록</h2>
            <Link className="button secondary" to={recordUrl("listings")}>
              + 등록 상품 기록
            </Link>
          </div>
          <p className="muted">
            채널에 실제로 올린 뒤 채널 상품 번호·노출 확인일·이미지 출처를
            기록하고 상태를 판매 중으로 바꿉니다. 등록 판매가는 결정 판매가와
            같아야 합니다.{" "}
            {d.records.sops.find((s) => s.key === "listing_manual") && (
              <Link
                to={recordUrl(
                  "sops",
                  d.records.sops.find((s) => s.key === "listing_manual")!.id,
                )}
              >
                절차 보기 →
              </Link>
            )}
          </p>
          {(d.records.listings ?? []).filter((l) => l.product_id === p.id)
            .length ? (
            <ul className="plain-list">
              {(d.records.listings ?? [])
                .filter((l) => l.product_id === p.id)
                .map((l) => (
                  <li key={l.id}>
                    <Link to={recordUrl("listings", l.id)}>
                      <Badge value={l.status} />{" "}
                      {
                        d.records.channels.find((c) => c.id === l.channel_id)
                          ?.name
                      }
                      {l.external_id && ` · ${l.external_id}`}
                      {l.listed_price &&
                        ` · ${Number(l.listed_price.amount_minor).toLocaleString("ko-KR")}원`}
                    </Link>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="empty">
              등록 상품 기록이 없습니다. 판매 중으로 가려면 하나가 필요합니다.
            </p>
          )}
        </section>
      )}
      <Calculator product={p} data={d} />
      {p.status === "pricing" && (
        <section className="panel">
          <h2>가격 결정 · 왜 이 가격인가요?</h2>
          <p>
            아래 가정 판매가·청구 배송비와 최신 원가 스냅샷을 묶어 결정으로
            남깁니다.
          </p>
          <div className="form-grid">
            <label>
              결정 이유
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              다른 대안
              <input value={alt} onChange={(e) => setAlt(e.target.value)} />
            </label>
            <label>
              대안을 고르지 않은 이유
              <input value={why} onChange={(e) => setWhy(e.target.value)} />
            </label>
            <label>
              다시 검토할 조건
              <input
                value={revisit}
                onChange={(e) => setRevisit(e.target.value)}
                placeholder="예: 실제 배송 견적 변경 또는 환율 5% 상승"
              />
            </label>
          </div>
          <button onClick={price}>현재 가정 가격을 결정으로 저장</button>
        </section>
      )}
    </>
  );
}
const won = (x: unknown) =>
  x == null
    ? "미확인"
    : Number(x).toLocaleString("ko-KR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + "원";
function CostResult({ result }: { result: Row }) {
  if (!result.outputs)
    return (
      <div className="cost-incomplete">
        <h3>계산 불가 · 미확인 {result.unknown_keys.length}개</h3>
        <p>입력이 없는 비용은 0원으로 계산하지 않습니다.</p>
      </div>
    );
  return (
    <>
      <div className="cost-summary">
        <div>
          <span>개당 공헌이익</span>
          <strong>{won(result.outputs.contribution_per_unit)}</strong>
        </div>
        <div>
          <span>공헌이익률</span>
          <strong>
            {(Number(result.outputs.margin_rate) * 100).toFixed(2)}%
          </strong>
        </div>
        <div>
          <span>개당 착지원가</span>
          <strong>{won(result.outputs.landed_per_unit)}</strong>
        </div>
      </div>
      <Badge value={result.overall_status} />
      <p className="muted">
        공헌이익에서 월 광고비·고정비를 배분한 순이익 추정:{" "}
        {won(result.outputs.net_est_per_unit)} · 손익분기 판매가{" "}
        {won(result.outputs.breakeven_price)}
      </p>
      {(result.ranges ?? result.outputs.ranges) && (
        <p>
          공헌이익 범위:{" "}
          {won(
            (result.ranges ?? result.outputs.ranges).contribution_per_unit.min,
          )}{" "}
          ~{" "}
          {won(
            (result.ranges ?? result.outputs.ranges).contribution_per_unit.max,
          )}{" "}
          (보수적 범위)
        </p>
      )}
    </>
  );
}
function Calculator({
  product: p,
  data: d,
}: {
  product: Row;
  data: WorkspaceData;
}) {
  const qc = useQueryClient();
  const offers = d.records.offers.filter(
    (o) => o.product_id === p.id && o.status !== "rejected",
  );
  const [offer, setOffer] = useState(
      p.chosen_offer_id ??
        offers.find((o) =>
          d.records.shipping_scenarios.some((s) => s.offer_id === o.id),
        )?.id ??
        offers[0]?.id ??
        "",
    ),
    [channel, setChannel] = useState(d.records.channels[0]?.id ?? ""),
    [fx, setFx] = useState(d.records.fx_rates[0]?.id ?? ""),
    [results, setResults] = useState<Row[]>([]),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(null);
  const scenarios = d.records.shipping_scenarios.filter(
    (s) => s.product_id === p.id && (!s.offer_id || s.offer_id === offer),
  );
  const invalidate = () => {
    setResults([]);
    setMessage("");
  };
  const payload = (scenario_id: string) => ({
    product_id: p.id,
    offer_id: offer,
    scenario_id,
    channel_id: channel || null,
    fx_rate_id: fx || null,
    reason,
    note: "상품 배송 경로 비교",
  });
  async function preview() {
    setBusy(true);
    setError("");
    try {
      const all = await Promise.all(
        scenarios.map((s) =>
          api<Row>("/costings/preview", jsonBody("POST", payload(s.id))),
        ),
      );
      setResults(all);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(scenario_id: string) {
    setBusy(true);
    try {
      const r = await api<{ data: Row }>(
        "/costings",
        jsonBody("POST", payload(scenario_id)),
      );
      await qc.invalidateQueries();
      setMessage(
        "스냅샷을 저장했습니다. 이후 입력이 바뀌어도 이 기록은 유지됩니다.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const missingName = (key: string) =>
    key.startsWith("leg:")
      ? `배송 구간 ${d.records.shipping_legs.find((l) => l.id === key.slice(4))?.seq ?? ""} 비용`
      : key.startsWith("fx:")
        ? key.slice(3) + " 환율"
        : key === "shipping_legs"
          ? "배송 구간"
          : (claimLabels[key] ?? key);
  const inputClaim = (r: Row, key: string) => r.inputs_frozen.claims[key];
  return (
    <section className="panel calculator">
      <div className="section-head">
        <h2>원가·배송 경로 비교</h2>
        <span className="kicker">예상 손익 · 실거래 아님</span>
      </div>
      <p className="muted">
        같은 오퍼를 직배송과 배송대행으로 비교합니다. 고객에게 받는 배송비와
        업체에 내는 배송비는 별도 항목입니다.
      </p>
      <ErrorBox error={error} />
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      <div className="form-grid">
        <label>
          기준 오퍼
          <select
            value={offer}
            onChange={(e) => {
              setOffer(e.target.value);
              invalidate();
            }}
          >
            <option value="">선택하세요</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {d.records.suppliers.find((s) => s.id === o.supplier_id)?.name}{" "}
                · {o.option_desc || o.currency}
              </option>
            ))}
          </select>
        </label>
        <label>
          판매 채널 수수료
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              invalidate();
            }}
          >
            <option value="">미확인 · 채널 선택 필요</option>
            {d.records.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Link to={recordUrl("channels")}>채널 조건 기록 →</Link>
        </label>
        <label>
          고정할 환율
          <select
            value={fx}
            onChange={(e) => {
              setFx(e.target.value);
              invalidate();
            }}
          >
            <option value="">미확인 (원화만 쓰면 필요 없음)</option>
            {d.records.fx_rates.map((f) => (
              <option key={f.id} value={f.id}>
                {f.base_currency} 1 = {f.rate}원 · {f.as_of_date}
              </option>
            ))}
          </select>
          <Link to={recordUrl("fx_rates")}>새 환율 기록 →</Link>
        </label>
        <label>
          스냅샷 저장 이유
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 4개 소포 가정에서 두 경로 비교"
          />
        </label>
      </div>
      <button disabled={busy || !offer || !scenarios.length} onClick={preview}>
        {busy ? "계산 중…" : `${scenarios.length}개 배송 경로 비교`}
      </button>
      {!scenarios.length && (
        <p className="muted">
          선택한 오퍼에 연결된 배송 시나리오를 먼저 추가하세요.
        </p>
      )}
      {edit && (
        <ClaimEditor
          key={edit.id}
          claim={edit}
          onClose={() => {
            setEdit(null);
            invalidate();
          }}
        />
      )}
      <div className="comparison-grid">
        {results.map((r) => (
          <article key={r.scenario_id} className="comparison">
            <div className="section-head">
              <h3>
                {
                  d.records.shipping_scenarios.find(
                    (s) => s.id === r.scenario_id,
                  )?.name
                }
              </h3>
              <Link to={recordUrl("shipping_scenarios", r.scenario_id)}>
                구간 보기 ↗
              </Link>
            </div>
            {r.warnings.map((w: string) => (
              <div className="alert" key={w}>
                {w}
              </div>
            ))}
            <CostResult result={r} />
            {!r.outputs && (
              <div className="missing-inputs">
                {r.unknown_keys.map((key: string) => {
                  const c = inputClaim(r, key);
                  return c ? (
                    <button
                      className="secondary"
                      key={key}
                      onClick={() => setEdit(c)}
                    >
                      {missingName(key)} 입력 →
                    </button>
                  ) : (
                    <span key={key}>{missingName(key)} · 연결 필요</span>
                  );
                })}
              </div>
            )}
            {r.outputs && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>개당 금액</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l: Row, i: number) => (
                      <tr key={i}>
                        <td>
                          {d.cost_line_types.find((t) => t.code === l.code)
                            ?.name ?? l.code}
                        </td>
                        <td>{won(l.per_unit_minor)}</td>
                        <td>
                          <Badge value={l.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              className="secondary"
              disabled={!reason.trim() || busy}
              onClick={() => save(r.scenario_id)}
            >
              이 경로의 스냅샷 저장
            </button>
          </article>
        ))}
      </div>
      {p.current_costing_id && (
        <Snapshot
          key={p.current_costing_id}
          id={p.current_costing_id}
          compact
        />
      )}
    </section>
  );
}
function Snapshot({ id, compact = false }: { id: string; compact?: boolean }) {
  const q = useQuery({
    queryKey: ["snapshot", id],
    queryFn: () => api<{ data: Row; changed: boolean }>("/costings/" + id),
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <p>저장된 원가 확인 중…</p>;
  const r = q.data.data;
  return (
    <section className={compact ? "saved-snapshot" : "panel"}>
      <div className="section-head">
        <h2>저장된 원가 스냅샷</h2>
        {q.data.changed ? (
          <span className="badge estimated">현재 값과 다름</span>
        ) : (
          <span className="badge confirmed">저장된 입력과 일치</span>
        )}
      </div>
      <p className="muted">
        {new Date(r.created_at).toLocaleString("ko-KR")} · {r.note}
      </p>
      <CostResult result={r} />
      {q.data.changed && (
        <p>현재 값을 반영하려면 다시 비교한 뒤 새 스냅샷으로 저장하세요.</p>
      )}
      <details>
        <summary>고정된 근거·환율 확인</summary>
        <pre>{JSON.stringify(r.inputs_frozen, null, 2)}</pre>
      </details>
      {compact && (
        <Link to={recordUrl("costings", id)}>이 스냅샷 기록 열기 →</Link>
      )}
    </section>
  );
}
