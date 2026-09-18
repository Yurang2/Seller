import { unzipSync, strFromU8 } from "fflate";

// Same comparison as backup:verify: all rows, original audit history, and bytes.
export function compareArchives(originalBytes: Uint8Array, restoredBytes: Uint8Array) {
  const original = unzipSync(originalBytes), restored = unzipSync(restoredBytes);
  const json = (files: typeof original, key: string) => JSON.parse(strFromU8(files[key]));
  const canonical = (row: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
  let records = 0;
  const counts = json(original, "manifest.json").counts;
  for (const table of Object.keys(counts)) {
    const key = `entities/${table}.json`;
    const expected = json(original, key).map(canonical).sort();
    const actual = json(restored, key).map(canonical).sort();
    if (table === "activity_log") {
      const all = new Set(actual);
      if (expected.some((row: string) => !all.has(row))) throw new Error("Original audit history mismatch");
    } else {
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Roundtrip mismatch: ${table}`);
      records += expected.length;
    }
  }
  const attachments = json(original, "attachments/manifest.json");
  for (const attachment of attachments) {
    if (!restored[attachment.path] || Buffer.compare(original[attachment.path], restored[attachment.path]) !== 0)
      throw new Error(`Attachment byte mismatch: ${attachment.id}`);
  }
  return { result: "passed", verified_records: records, attachments: attachments.length, original_activity_logs: counts.activity_log };
}
