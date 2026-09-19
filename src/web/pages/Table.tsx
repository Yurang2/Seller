import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { catalog } from "../../domain/records/catalog";
import {
  Badge,
  GradeBadge,
  label,
  recordUrl,
  title,
  type Row,
  type WorkspaceData,
} from "./Workspace";

// 목록 보기 방식은 기기별 편의 설정이라 localStorage에 둔다(공유·복원 대상 아님).
export function useViewMode(type: string, fallback = "table") {
  const key = "seller:view:" + type;
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, mode);
    } catch {
      /* 비공개 창 등 */
    }
  }, [key, mode]);
  return [mode, setMode] as const;
}

type Col = {
  key: string;
  head: string;
  width?: number;
  render: (r: Row) => React.ReactNode;
  text?: (r: Row) => string; // 모바일 두 줄 목록의 둘째 줄
};

const shortDate = (iso?: string | null) => (iso ? iso.slice(5, 10) : "");
const statusOf = (r: Row) =>
  r.status ?? r.gate_result ?? r.item_result ?? r.overall_status ?? null;

export function columnsFor(
  type: string,
  data: WorkspaceData,
  openTasks: Map<string, number>,
): Col[] {
  const def = catalog[type];
  const cols: Col[] = [];
  const refTitle = (ref: string, id: unknown) => {
    const rec = data.records[ref]?.find((x) => x.id === id);
    return rec ? title(rec) : id ? String(id) : "";
  };
  if (type === "products")
    cols.push({
      key: "grade",
      head: "등급",
      width: 60,
      render: (r) =>
        data.grades[r.id] ? (
          <GradeBadge
            grade={data.grades[r.id].grade}
            estimated={data.grades[r.id].estimated}
            compact
          />
        ) : (
          <span className="grade X">?</span>
        ),
    });
  cols.push({
    key: "title",
    head: def.label,
    render: (r) => <Link to={recordUrl(type, r.id)}>{title(r)}</Link>,
  });
  if (type === "tasks") {
    cols.push(
      {
        key: "status",
        head: "상태",
        width: 120,
        render: (r) => <Badge value={r.status} />,
        text: (r) => label(r.status),
      },
      {
        key: "entity",
        head: "관련 기록",
        width: 200,
        render: (r) => (
          <span className="muted">
            {catalog[r.entity_type]?.label ?? label(r.entity_type)}
            {r.entity_type && catalog[r.entity_type]
              ? " · " + refTitle(r.entity_type, r.entity_id)
              : ""}
          </span>
        ),
        text: (r) =>
          (catalog[r.entity_type]?.label ?? "") +
          (catalog[r.entity_type]
            ? " · " + refTitle(r.entity_type, r.entity_id)
            : ""),
      },
      {
        key: "priority",
        head: "우선",
        width: 56,
        render: (r) => <span className="num">{r.priority}</span>,
      },
      {
        key: "recheck",
        head: "재확인",
        width: 84,
        render: (r) => (
          <span className="num">
            {shortDate(r.recheck_at ?? r.due_at) || "—"}
          </span>
        ),
      },
      {
        key: "cond",
        head: "해제 조건 · 메모",
        render: (r) => (
          <span className="muted">
            {r.unblock_condition ?? r.blocked_reason ?? r.detail ?? ""}
          </span>
        ),
        text: (r) => r.unblock_condition ?? r.blocked_reason ?? r.detail ?? "",
      },
    );
    return cols;
  }
  // 상태 열: 있는 기록 종류만
  const hasStatus = (data.records[type] ?? []).some((r) => statusOf(r));
  if (hasStatus)
    cols.push({
      key: "status",
      head: type === "compliance_profiles" ? "게이트" : "상태",
      width: 110,
      render: (r) => (statusOf(r) ? <Badge value={statusOf(r)} /> : null),
      text: (r) => (statusOf(r) ? label(statusOf(r)) : ""),
    });
  // 요약 열: 카탈로그 필드 중 짧은 것 3개(참조·선택지·숫자·날짜 우선)
  const titleKeys = new Set([
    "name",
    "title",
    "name_ko",
    "question",
    "option_desc",
    "carrier_or_service",
  ]);
  const skip = new Set(["status", "gate_result", "item_result"]);
  const fields = Object.entries(def.fields).filter(
    ([k, f]) =>
      !titleKeys.has(k) &&
      !skip.has(k) &&
      f.type !== "long" &&
      f.type !== "json" &&
      !f.managed,
  );
  const ranked = [
    ...fields.filter(([, f]) => f.type === "ref"),
    ...fields.filter(([, f]) => f.options),
    ...fields.filter(([, f]) => f.type === "number" || f.type === "date"),
    ...fields.filter(([, f]) => !f.type || (f.type === "text" && !f.options)),
  ].slice(0, 3);
  for (const [k, f] of ranked)
    cols.push({
      key: k,
      head: f.label.replace(/\s*\[.*\]/, ""),
      width: f.type === "number" || f.type === "date" ? 100 : 150,
      render: (r) => {
        const v = r[k];
        if (v == null || v === "") return <span className="muted">—</span>;
        if (f.ref)
          return (
            <Link to={recordUrl(f.ref, v)} className="muted">
              {refTitle(f.ref, v)}
            </Link>
          );
        if (f.options) return <span className="muted">{label(String(v))}</span>;
        if (f.type === "number")
          return (
            <span className="num">{Number(v).toLocaleString("ko-KR")}</span>
          );
        return <span className="muted">{String(v)}</span>;
      },
      text: (r) => {
        const v = r[k];
        if (v == null || v === "") return "";
        if (f.ref) return refTitle(f.ref, v);
        if (f.options) return label(String(v));
        return String(v);
      },
    });
  if (catalog[type]?.claims || type === "products")
    cols.push({
      key: "next",
      head: "다음 행동",
      width: 120,
      render: (r) => {
        const n = openTasks.get(type + ":" + r.id) ?? 0;
        return n ? (
          <Link to={recordUrl("tasks")} className="muted">
            열린 할 일 {n}개
          </Link>
        ) : (
          <span className="muted">—</span>
        );
      },
    });
  cols.push({
    key: "updated",
    head: "갱신",
    width: 68,
    render: (r) => (
      <span className="num muted">
        {shortDate(r.updated_at ?? r.created_at)}
      </span>
    ),
  });
  return cols;
}

export function RecordTable({
  type,
  rows,
  data,
  foot,
}: {
  type: string;
  rows: Row[];
  data: WorkspaceData;
  foot?: React.ReactNode;
}) {
  const openTasks = new Map<string, number>();
  for (const t of data.records.tasks ?? [])
    if (!["done", "cancelled"].includes(t.status))
      openTasks.set(
        t.entity_type + ":" + t.entity_id,
        (openTasks.get(t.entity_type + ":" + t.entity_id) ?? 0) + 1,
      );
  const cols = columnsFor(type, data, openTasks);
  const second = (r: Row) =>
    cols
      .filter((c) => c.text && c.key !== "title")
      .map((c) => c.text!(r))
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");
  const lead = cols.find((c) => c.key === "status" || c.key === "grade");
  return (
    <>
      <div className="rt-wrap">
        <div className="rt-scroll">
          <table className="rt">
            <colgroup>
              {cols.map((c) => (
                <col
                  key={c.key}
                  style={c.width ? { width: c.width + "px" } : undefined}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key}>{c.head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {cols.map((c) => (
                    <td key={c.key}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rt-mobile">
          {rows.map((r) => (
            <Link className="rt-row" key={r.id} to={recordUrl(type, r.id)}>
              {lead?.render(r)}
              <div>
                <strong>{title(r)}</strong>
                <small>{second(r) || catalog[type].label}</small>
              </div>
              <svg
                className="chev"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
      {foot && <div className="rt-foot">{foot}</div>}
    </>
  );
}
