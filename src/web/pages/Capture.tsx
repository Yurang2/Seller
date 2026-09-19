import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { catalog, claimLabels } from "../../domain/records/catalog";
import { defaultRecheck } from "../../domain/claim";
import type { Claim } from "../../domain/types/claim";
import {
  ClaimEditor,
  ErrorBox,
  PageHead,
  recordUrl,
  title,
  useWorkspace,
} from "./Workspace";

// 휴대폰에서 가장 자주 하는 일: 캡처를 찍고 어떤 기록의 어떤 값인지 골라 근거로 저장한다.
// 저장 자체는 기존 근거 편집기(첨부 업로드·확인/추정 규칙)를 그대로 쓴다.
const OWNER_ORDER = [
  "offers",
  "products",
  "requirement_items",
  "shipping_scenarios",
  "shipping_legs",
  "rate_cards",
  "channels",
  "suppliers",
  "characters",
  "product_variants",
  "fx_rates",
];
export function Capture() {
  const q = useWorkspace();
  const d = q.data;
  const [ownerType, setOwnerType] = useState("offers"),
    [ownerId, setOwnerId] = useState(""),
    [field, setField] = useState("");
  const ownerTypes = OWNER_ORDER.filter((t) => catalog[t]?.claims);
  const owners = useMemo(
    () => (d ? (d.records[ownerType] ?? []) : []),
    [d, ownerType],
  );
  const fields = Object.entries(catalog[ownerType]?.claims ?? {});
  const existing =
    d && ownerId && field
      ? d.claims.find(
          (c) =>
            c.owner_type === ownerType &&
            c.owner_id === ownerId &&
            c.field_key === field,
        )
      : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const draft: Claim | null =
    ownerId && field
      ? ((existing as unknown as Claim) ?? {
          owner_type: ownerType,
          owner_id: ownerId,
          field_key: field,
          kind: (catalog[ownerType].claims![field] as Claim["kind"]) ?? "text",
          status: "confirmed",
          value_json: null,
          source_type: "screenshot",
          source_ref: "",
          checked_at: today + "T00:00:00Z",
          recheck_by: defaultRecheck(field, today, ownerType),
          note: "",
          basis_json: {},
          attachment_ids: [],
        })
      : null;
  if (!d)
    return (
      <main className="page">
        <ErrorBox error={q.error} />
        <p className="muted">기록을 불러오는 중…</p>
      </main>
    );
  return (
    <main className="page">
      <PageHead
        eyebrow="CAPTURE / 근거 남기기"
        title="캡처를 근거로 연결"
        description="사진·캡처·PDF를 올리고 어떤 기록의 어떤 값인지 고릅니다. 캡처가 없으면 저장 시 추정으로 내려갑니다."
      />
      <section className="panel capture-steps">
        <label>
          어떤 종류의 기록인가요
          <select
            value={ownerType}
            onChange={(e) => {
              setOwnerType(e.target.value);
              setOwnerId("");
              setField("");
            }}
          >
            {ownerTypes.map((t) => (
              <option key={t} value={t}>
                {catalog[t].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          어느 기록인가요
          <select
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
              setField("");
            }}
          >
            <option value="">선택…</option>
            {owners.map((r) => (
              <option key={r.id} value={r.id}>
                {title(r)}
              </option>
            ))}
          </select>
        </label>
        {ownerId && (
          <label>
            어떤 값인가요
            <select value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">선택…</option>
              {fields.map(([k]) => (
                <option key={k} value={k}>
                  {claimLabels[k] ?? k}
                </option>
              ))}
            </select>
          </label>
        )}
        {!owners.length && (
          <p className="muted">
            이 종류의 기록이 아직 없습니다.{" "}
            <Link to={recordUrl(ownerType)}>먼저 기록을 만드세요.</Link>
          </p>
        )}
      </section>
      {draft && (
        <ClaimEditor
          key={ownerType + ownerId + field + (existing?.id ?? "new")}
          claim={draft as Claim & { id?: string }}
          onClose={() => setField("")}
        />
      )}
    </main>
  );
}
