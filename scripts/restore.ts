import { readFile } from "node:fs/promises";
const [file, base = "http://127.0.0.1:5173", mode] = process.argv.slice(2);
if (!file)
  throw new Error("Usage: pnpm restore <backup.zip> [base-url] [--apply]");
const bytes = await readFile(file);
const headers: Record<string, string> = { "Content-Type": "application/zip" };
// For a protected deployment, obtain a valid Access token locally; never store it in a backup.
if (process.env.CF_ACCESS_JWT)
  headers["Cf-Access-Jwt-Assertion"] = process.env.CF_ACCESS_JWT;
const preview = await fetch(`${base}/api/v1/import`, {
  method: "POST",
  headers,
  body: bytes,
});
const report = (await preview.json()) as { archive_hash: string };
console.log(JSON.stringify(report, null, 2));
if (!preview.ok) process.exit(1);
if (mode === "--apply") {
  const result = await fetch(`${base}/api/v1/import?apply=1`, {
    method: "POST",
    headers: { ...headers, "X-Archive-Hash": report.archive_hash },
    body: bytes,
  });
  console.log(JSON.stringify(await result.json(), null, 2));
  if (!result.ok) process.exit(1);
}
