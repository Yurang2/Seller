import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, describe, it, expect } from "vitest";
import worker from "../../src/api/index";
import type { Env } from "../../src/api/env";
import { exportArchive, restoreArchive } from "../../src/api/exporters/archive";
import { readClaims } from "../../src/db/repo/claims";
import { upsertClaim } from "../../src/api/services/claims";
import { saveAttachment } from "../../src/api/services/attachments";
const bindings = env as unknown as Env & {
  TEST_MIGRATIONS: never[];
  RESTORED_DB: D1Database;
  RESTORED_ATTACHMENTS: R2Bucket;
};
const request = (
  path: string,
  options?: RequestInit,
  overrides: Partial<Env> = {},
) =>
  worker.fetch(new Request("http://localhost/api/v1" + path, options), {
    ...bindings,
    ...overrides,
  });
const input = {
  owner_type: "research",
  owner_id: "01K56VQK6NXWSVK11FSKETC6K9",
  field_key: "checkout_price",
  kind: "money",
  status: "confirmed",
  value_json: { amount_minor: 5990, currency: "CNY" },
  source_type: "url",
  source_ref: "https://example.com/offer",
  checked_at: "2026-09-16T00:00:00Z",
  recheck_by: "2026-10-16",
};
beforeEach(async () => {
  await reset();
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  await applyD1Migrations(bindings.RESTORED_DB, bindings.TEST_MIGRATIONS);
});
describe("skeleton acceptance: real D1/R2 bindings", () => {
  it("health returns 200; invalid and unverified claims are handled by the service", async () => {
    expect((await request("/health")).status).toBe(200);
    const res = await request("/claims", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.downgraded).toBe(true);
    expect(data.data.status).toBe("estimated");
    const read = await request("/claims/" + data.data.id);
    expect(((await read.json()) as any).data.value_json).toEqual(
      input.value_json,
    );
    const second = await upsertClaim(
      bindings.DB,
      { ...input, note: "갱신" },
      "user",
    );
    expect(second.data.id).toBe(data.data.id);
    expect((await readClaims(bindings.DB)).length).toBe(1);
    const bad = await request("/claims", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, status: undefined }),
    });
    expect(bad.status).toBe(400);
    expect(
      (await bindings.DB.prepare("SELECT * FROM activity_log").all()).results
        .length,
    ).toBe(2);
  });
  it("a fabricated attachment id cannot turn a price into confirmed", async () => {
    await expect(
      upsertClaim(
        bindings.DB,
        { ...input, attachment_ids: ["01K56VQK6NXWSVK11FSKETC6K8"] },
        "user",
      ),
    ).rejects.toThrow("실제로 저장된");
  });
  it("exports a masked ZIP and restores the exact claim and attachment into an empty DB and bucket", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["supplier quote evidence"], "quote.png", {
        type: "image/png",
      }),
    );
    form.set("owner_type", "research");
    form.set("owner_id", input.owner_id);
    const attachment = await saveAttachment(bindings, form, "user");
    const saved = await upsertClaim(
      bindings.DB,
      { ...input, attachment_ids: [attachment.id] },
      "user",
    );
    expect(saved.data.status).toBe("confirmed");
    const bytes = await exportArchive(bindings);
    const target = {
      ...bindings,
      DB: bindings.RESTORED_DB,
      ATTACHMENTS: bindings.RESTORED_ATTACHMENTS,
    };
    const preview = await restoreArchive(target, bytes, false);
    expect(preview.applied).toBe(false);
    expect((await readClaims(target.DB)).length).toBe(0);
    await restoreArchive(target, bytes, true, preview.archive_hash);
    expect(await readClaims(target.DB)).toEqual(await readClaims(bindings.DB));
    expect(
      await (await target.ATTACHMENTS.get(attachment.r2_key))!.text(),
    ).toBe("supplier quote evidence");
    const repeat = await restoreArchive(target, bytes, false);
    expect(repeat.added).toBe(0);
    expect(repeat.updated).toBe(0);
  });
  it("soft deletes and requires a deletion reason", async () => {
    const saved = await upsertClaim(bindings.DB, input, "user");
    expect(
      (
        await request("/claims/" + saved.data.id, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: '{"reason":""}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/claims/" + saved.data.id, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: '{"reason":"중복 조사 기록 정리"}',
        })
      ).status,
    ).toBe(200);
    expect(await readClaims(bindings.DB)).toEqual([]);
    expect(
      (
        await bindings.DB.prepare("SELECT deleted_at FROM claims WHERE id=?")
          .bind(saved.data.id)
          .first()
      )?.deleted_at,
    ).toBeTruthy();
  });
  it("production API rejects absent or forged Access tokens and cross-origin mutation", async () => {
    expect(
      (await request("/health", undefined, { APP_ENV: "production" })).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/claims",
          { headers: { "Cf-Access-Jwt-Assertion": "fake" } },
          {
            APP_ENV: "production",
            ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
            ACCESS_AUD: "aud",
          },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/claims", {
          method: "PUT",
          headers: { Origin: "https://other.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect((await request("/export?pii=full")).status).toBe(400);
  });
});
