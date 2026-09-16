import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import type { Claim } from "../../domain/types/claim";
import { api, jsonBody } from "../api/client";
type SavedClaim = Claim & { id: string; updated_at: string };
const labels = { confirmed: "확인", estimated: "추정", unknown: "미확인" };
export function Foundation() {
  const qc = useQueryClient();
  const claims = useQuery({
    queryKey: ["claims"],
    queryFn: () => api<{ data: SavedClaim[] }>("/claims"),
  });
  const [owner, setOwner] = useState(ulid),
    [field, setField] = useState("checkout_price"),
    [status, setStatus] = useState<Claim["status"]>("unknown");
  const [amount, setAmount] = useState(""),
    [currency, setCurrency] = useState("CNY"),
    [source, setSource] = useState(""),
    [sourceType, setSourceType] = useState("url");
  const [checked, setChecked] = useState(new Date().toISOString().slice(0, 10)),
    [recheck, setRecheck] = useState(
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
  const [note, setNote] = useState(""),
    [files, setFiles] = useState<FileList | null>(null),
    [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [backup, setBackup] = useState<File | null>(null),
    [report, setReport] = useState<{
      archive_hash: string;
      added: number;
      updated: number;
      unchanged: number;
      attachments: number;
    } | null>(null);
  const rows = claims.data?.data ?? [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const ids = [...attachmentIds];
      if (files)
        for (const f of Array.from(files)) {
          const data = new FormData();
          data.set("file", f);
          data.set("owner_type", "research");
          data.set("owner_id", owner);
          const r = await api<{ data: { id: string } }>("/attachments", {
            method: "POST",
            body: data,
          });
          ids.push(r.data.id);
        }
      setAttachmentIds(ids);
      setFiles(null);
      const minor =
        amount === ""
          ? null
          : Math.round(
              Number(amount) *
                (["KRW", "TWD", "JPY"].includes(currency) ? 1 : 100),
            );
      const input = {
        owner_type: "research",
        owner_id: owner,
        field_key: field,
        kind: "money",
        status,
        value_json:
          status === "unknown" ? null : { amount_minor: minor, currency },
        source_type: sourceType,
        source_ref: source || null,
        checked_at: checked ? `${checked}T00:00:00Z` : null,
        recheck_by: recheck,
        note,
        attachment_ids: ids,
        basis_json: {},
      };
      const res = await api<{
        data: SavedClaim;
        downgraded: boolean;
        message: string | null;
      }>("/claims", { method: "PUT", ...jsonBody(input) });
      setEditing(res.data.id);
      setStatus(res.data.status);
      setMessage(
        res.message ?? "저장했습니다. 아래 기록에서 다시 확인할 수 있습니다.",
      );
      await qc.invalidateQueries({ queryKey: ["claims"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(row: SavedClaim) {
    setOwner(row.owner_id);
    setEditing(row.id);
    setField(row.field_key);
    setStatus(row.status);
    const value = row.value_json as {
      amount_minor: number;
      currency: string;
    } | null;
    setCurrency(value?.currency ?? "CNY");
    setAmount(
      value
        ? String(
            value.amount_minor /
              (["KRW", "TWD", "JPY"].includes(value.currency) ? 1 : 100),
          )
        : "",
    );
    setSource(row.source_ref ?? "");
    setSourceType(row.source_type ?? "url");
    setChecked(row.checked_at?.slice(0, 10) ?? "");
    setRecheck(row.recheck_by);
    setNote(row.note);
    setAttachmentIds(row.attachment_ids);
    setFiles(null);
    setMessage("기록을 불러왔습니다.");
    setError("");
  }
  function reset() {
    setOwner(ulid());
    setEditing(null);
    setAmount("");
    setStatus("unknown");
    setSource("");
    setNote("");
    setAttachmentIds([]);
    setFiles(null);
    setMessage("");
    setError("");
  }
  async function restore(apply = false) {
    if (!backup) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<typeof report & { applied: boolean }>(
        "/import" + (apply ? "?apply=1" : ""),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/zip",
            ...(apply ? { "X-Archive-Hash": report!.archive_hash } : {}),
          },
          body: backup,
        },
      );
      setReport(r);
      if (apply) {
        setMessage("백업을 복원했습니다.");
        setReport(null);
        await qc.invalidateQueries({ queryKey: ["claims"] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SELLER / RESEARCH</div>
          <h1>확인한 만큼 기록하기</h1>
          <p>값과 근거를 함께 남겨, 나중에도 판단을 이어갈 수 있게.</p>
        </div>
        <button className="secondary" onClick={reset}>
          새 기록
        </button>
      </div>
      <div className="notice">
        현재 골격을 검증하고 있습니다. 조사 홈과 상품 기능은 다음 단계에서
        연결됩니다.
      </div>
      <div className="metrics">
        <div>
          <span>저장한 근거</span>
          <strong>{claims.isSuccess ? rows.length : "—"}</strong>
        </div>
        <div>
          <span>미확인</span>
          <strong>
            {claims.isSuccess
              ? rows.filter((c) => c.status === "unknown").length
              : "—"}
          </strong>
        </div>
        <div>
          <span>추정</span>
          <strong>
            {claims.isSuccess
              ? rows.filter((c) => c.status === "estimated").length
              : "—"}
          </strong>
        </div>
      </div>
      {(error || claims.error) && (
        <div role="alert" className="error">
          {error || (claims.error as Error).message}
        </div>
      )}
      {message && (
        <div role="status" className="success">
          {message}
        </div>
      )}
      <div className="content-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{editing ? "근거 수정" : "첫 근거 기록"}</h2>
            <span>미확인 ≠ 0원</span>
          </div>
          <form onSubmit={save}>
            <label>
              어떤 금액인가요?
              <select value={field} onChange={(e) => setField(e.target.value)}>
                <option value="checkout_price">상품 실결제가</option>
                <option value="listed_price">상품 표시가</option>
                <option value="intl_shipping">국제배송비 · 지출</option>
                <option value="cn_domestic_shipping">
                  중국 내 배송비 · 지출
                </option>
                <option value="customer_shipping_fee">
                  고객 청구 배송비 · 수입
                </option>
              </select>
            </label>
            <div className="form-row">
              <label>
                확인 상태
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Claim["status"])}
                >
                  <option value="unknown">미확인</option>
                  <option value="estimated">추정</option>
                  <option value="confirmed">확인</option>
                </select>
              </label>
              <label>
                통화
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {["CNY", "KRW", "TWD", "USD", "JPY"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              금액
              <input
                type="number"
                step={["CNY", "USD"].includes(currency) ? "0.01" : "1"}
                disabled={status === "unknown"}
                required={status !== "unknown"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={
                  status === "unknown"
                    ? "미확인 값은 비워 둡니다"
                    : "무료로 확인됐다면 0 입력"
                }
              />
            </label>
            <div className="form-row">
              <label>
                출처 유형
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                >
                  <option value="url">웹 페이지</option>
                  <option value="screenshot">화면 캡처</option>
                  <option value="message">판매자 메시지</option>
                  <option value="document">문서</option>
                  <option value="self_estimate">자체 추정</option>
                  <option value="competitor_observation">
                    경쟁사 관찰 · 참고
                  </option>
                </select>
              </label>
              <label>
                확인 날짜
                <input
                  type="date"
                  value={checked}
                  required={status !== "unknown"}
                  onChange={(e) => setChecked(e.target.value)}
                />
              </label>
            </div>
            <label>
              출처 링크 또는 설명
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                required={status !== "unknown"}
                placeholder="판매 페이지, 견적서 이름, 추정한 이유"
              />
            </label>
            <div className="form-row">
              <label>
                재확인 기한
                <input
                  type="date"
                  required
                  value={recheck}
                  onChange={(e) => setRecheck(e.target.value)}
                />
              </label>
              <label>
                증빙 첨부
                <input
                  type="file"
                  multiple
                  onChange={(e) => setFiles(e.target.files)}
                />
              </label>
            </div>
            <p className="hint">
              가격·배송 견적은 증빙 없이 ‘확인’을 선택하면 ‘추정’으로
              저장됩니다.
            </p>
            {attachmentIds.length > 0 && (
              <div className="attachment-list">
                {attachmentIds.map((id, i) => (
                  <a key={id} href={`/api/v1/attachments/${id}`}>
                    증빙 {i + 1} 내려받기
                  </a>
                ))}
              </div>
            )}
            <label>
              조건·메모
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="단품/세트, 옵션, 수량, 배송 포함 범위 등"
              />
            </label>
            <button disabled={busy} type="submit">
              {busy ? "처리 중…" : "근거와 함께 저장"}
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <div className="panel-heading">
              <h2>저장된 기록</h2>
              <span>서버에 보관</span>
            </div>
            {claims.isPending ? (
              <p>기록을 불러오는 중입니다.</p>
            ) : !rows.length ? (
              <div className="empty">
                <h3>아직 기록이 없습니다</h3>
                <p>모르는 금액도 ‘미확인’으로 남길 수 있습니다.</p>
              </div>
            ) : (
              <div className="records">
                {rows.map((row) => (
                  <button
                    className="record"
                    key={row.id}
                    onClick={() => edit(row)}
                  >
                    <div>
                      <span className={`badge ${row.status}`}>
                        {labels[row.status]}
                      </span>
                      <span className="record-key">
                        {(
                          {
                            checkout_price: "실결제가",
                            listed_price: "표시가",
                            intl_shipping: "국제배송비",
                            cn_domestic_shipping: "중국 내 배송비",
                            customer_shipping_fee: "고객 청구 배송비",
                          } as Record<string, string>
                        )[row.field_key] ?? row.field_key}
                      </span>
                    </div>
                    <strong>
                      {row.status === "unknown"
                        ? "아직 확인하지 못함"
                        : formatMoney(row.value_json)}
                    </strong>
                    <p>
                      {row.note ||
                        row.source_ref ||
                        "근거를 확인하는 중입니다."}
                    </p>
                    <small>재확인 {row.recheck_by}</small>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="panel backup">
            <div className="panel-heading">
              <h2>내 기록 보관하기</h2>
            </div>
            <p>
              기록과 증빙을 함께 내려받습니다. 복원은 변경 내용을 확인한 뒤
              적용합니다.
            </p>
            <a className="button secondary" href="/api/v1/export?pii=masked">
              백업 ZIP 내려받기 · 마스킹
            </a>
            <label>
              복원할 백업
              <input
                type="file"
                accept=".zip"
                onChange={(e) => {
                  setBackup(e.target.files?.[0] ?? null);
                  setReport(null);
                }}
              />
            </label>
            <button
              className="secondary"
              disabled={!backup || busy}
              onClick={() => restore()}
            >
              복원 미리보기
            </button>
            {report && (
              <div className="restore-report">
                <p>
                  추가 {report.added} · 갱신 {report.updated} · 동일{" "}
                  {report.unchanged}
                  <br />
                  첨부 {report.attachments}개
                </p>
                <button disabled={busy} onClick={() => restore(true)}>
                  위 변경을 확인하고 복원
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
function formatMoney(v: unknown) {
  const m = v as { amount_minor: number; currency: string };
  return `${(m.amount_minor / (["KRW", "TWD", "JPY"].includes(m.currency) ? 1 : 100)).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} ${m.currency}`;
}
