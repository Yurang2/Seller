import { ulid } from "ulid";
import type { Env } from "../env";
import { readClaims } from "../../db/repo/claims";
import { isStale } from "../../domain/claim";
import { loadRecords, today, type Row } from "../services/records";
import { claimLabels, catalog } from "../../domain/records/catalog";

// 매일 아침 "오늘 다시 봐야 할 것"을 집계해 job_runs에 남기고, 이메일 설정이 있으면 보낸다.
// 집계만 하고 아무것도 자동으로 바꾸지 않는다(R-10). 이메일이 없으면 홈에서 마지막 요약을 본다.
export type DigestSummary = {
  date: string;
  stale_claims: { label: string; owner: string; recheck_by: string }[];
  due_tasks: { title: string; status: string; recheck_at: string | null }[];
  orders_waiting: { title: string; status: string }[];
  counts: { stale: number; tasks: number; orders: number; blocked: number };
  email: "sent" | "skipped" | "failed";
};
export async function buildDigest(db: D1Database): Promise<DigestSummary> {
  const t = today();
  const recs = await loadRecords(db, [
    "tasks",
    "orders",
    ...Object.keys(catalog).filter((k) => !["tasks", "orders"].includes(k)),
  ]);
  const claims = await readClaims(db);
  const stale = claims
    .filter(
      (c) =>
        isStale(c, t) &&
        (!catalog[c.owner_type] ||
          recs[c.owner_type]?.some((r) => r.id === c.owner_id)),
    )
    .map((c) => {
      const owner = recs[c.owner_type]?.find((r) => r.id === c.owner_id);
      return {
        label: claimLabels[c.field_key] ?? c.field_key,
        owner: owner?.name ?? owner?.title ?? owner?.question ?? c.owner_id,
        recheck_by: c.recheck_by,
      };
    });
  const open = recs.tasks.filter(
    (x) => !["done", "cancelled"].includes(x.status),
  );
  const due = open
    .filter(
      (x) =>
        (x.status === "blocked" && x.recheck_at && x.recheck_at <= t) ||
        (x.due_at && x.due_at <= t),
    )
    .map((x) => ({
      title: x.title,
      status: x.status,
      recheck_at: x.recheck_at ?? null,
    }));
  const orders = (recs.orders ?? [])
    .filter((o) => ["received", "shipped_cn", "delivered"].includes(o.status))
    .map((o) => ({ title: `주문 ${o.order_no}`, status: o.status }));
  return {
    date: t,
    stale_claims: stale.slice(0, 50),
    due_tasks: due.slice(0, 50),
    orders_waiting: orders.slice(0, 50),
    counts: {
      stale: stale.length,
      tasks: due.length,
      orders: orders.length,
      blocked: open.filter((x) => x.status === "blocked").length,
    },
    email: "skipped",
  };
}
export function renderDigestText(s: DigestSummary) {
  const lines = [
    `Seller 재확인 요약 · ${s.date}`,
    `재확인 기한 지난 근거 ${s.counts.stale}개 · 기한 지난 할 일 ${s.counts.tasks}개 · 처리 대기 주문 ${s.counts.orders}개 · 막힘 ${s.counts.blocked}개`,
    "",
  ];
  if (s.stale_claims.length) {
    lines.push("[근거 재확인]");
    for (const c of s.stale_claims.slice(0, 15))
      lines.push(`- ${c.owner} · ${c.label} (기한 ${c.recheck_by})`);
    lines.push("");
  }
  if (s.due_tasks.length) {
    lines.push("[기한 지난 할 일]");
    for (const x of s.due_tasks.slice(0, 15)) lines.push(`- ${x.title}`);
    lines.push("");
  }
  if (s.orders_waiting.length) {
    lines.push("[주문]");
    for (const o of s.orders_waiting.slice(0, 15))
      lines.push(`- ${o.title} · ${o.status}`);
    lines.push("");
  }
  lines.push("앱에서 확인: https://seller.a98763969.workers.dev");
  return lines.join("\n");
}
async function sendEmail(env: Env, subject: string, text: string) {
  if (!env.RESEND_API_KEY || !env.DIGEST_EMAIL) return "skipped" as const;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Seller <onboarding@resend.dev>",
      to: [env.DIGEST_EMAIL],
      subject,
      text,
    }),
  });
  return res.ok ? ("sent" as const) : ("failed" as const);
}
export async function runDailyDigest(env: Env) {
  const id = ulid(),
    started = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO job_runs(id,job_key,started_at,status) VALUES(?,?,?,?)",
  )
    .bind(id, "daily_digest", started, "running")
    .run();
  try {
    const summary = await buildDigest(env.DB);
    summary.email = await sendEmail(
      env,
      `[Seller] ${summary.date} 재확인 ${summary.counts.stale}개 · 할 일 ${summary.counts.tasks}개`,
      renderDigestText(summary),
    );
    await env.DB.prepare(
      "UPDATE job_runs SET finished_at=?, status=?, summary_json=? WHERE id=?",
    )
      .bind(new Date().toISOString(), "ok", JSON.stringify(summary), id)
      .run();
    return { id, summary };
  } catch (e) {
    await env.DB.prepare(
      "UPDATE job_runs SET finished_at=?, status=?, summary_json=? WHERE id=?",
    )
      .bind(
        new Date().toISOString(),
        "failed",
        JSON.stringify({ error: String(e) }),
        id,
      )
      .run();
    throw e;
  }
}
