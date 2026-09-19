export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, init);
  const json: unknown = await res.json();
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // 세션이 끝났다. 로그인 화면으로 돌아간다.
    window.dispatchEvent(new Event("seller:login-required"));
  }
  if (!res.ok) {
    const err = json as { error?: { message?: string; details?: unknown } };
    const details = err.error?.details;
    throw new Error(
      (err.error?.message ?? "요청 실패") +
        (Array.isArray(details)
          ? " " + details.map((v: { message: string }) => v.message).join(" ")
          : ""),
    );
  }
  return json as T;
}
export const jsonBody = (data: unknown, payload?: unknown) => ({
  ...(payload !== undefined ? { method: String(data) } : {}),
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload === undefined ? data : payload),
});
