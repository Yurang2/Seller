import { mkdir, readFile, rename, rm, lstat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BlobStore } from "./storage";

export class FileBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private async file(key: string) {
    if (!key || key.includes("\\") || key.includes(":") || key.includes("\0") || key.split("/").some(p => !p || p === "." || p === ".."))
      throw new Error("Invalid blob key");
    const target = resolve(this.root, key);
    const rel = relative(this.root, target);
    if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("Invalid blob path");
    let current = this.root;
    for (const part of ["", ...rel.split(/[\\/]/)]) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not allowed in blob storage"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    return target;
  }
  async put(key: string, body: Parameters<BlobStore["put"]>[1], _options?: Parameters<BlobStore["put"]>[2]) {
    const target = await this.file(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = target + "." + randomUUID() + ".tmp";
    try {
      const bytes = ArrayBuffer.isView(body)
        ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        : new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
      const { writeFile } = await import("node:fs/promises");
      await writeFile(temp, bytes, { flag: "wx" });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
  }
  async get(key: string) {
    const target = await this.file(key);
    try {
      const bytes = Uint8Array.from(await readFile(target));
      return { body: new Response(bytes).body!, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string) { await rm(await this.file(key), { force: true }); }
}
