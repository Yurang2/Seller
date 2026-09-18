// The binding contract contains only the object operations used by the app.
// Cloudflare R2 implements it structurally; the desktop implementation is file-backed.
export interface BlobObject {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}
export interface BlobStore {
  put(key: string, body: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
}
