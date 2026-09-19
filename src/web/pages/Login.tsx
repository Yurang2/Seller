import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../api/client";
export type AuthStatus = {
  mode: string;
  configured: boolean;
  authenticated: boolean;
};
export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth"],
    queryFn: () => api<AuthStatus>("/auth/status"),
    retry: false,
  });
}
export function Login({ status }: { status: AuthStatus }) {
  const qc = useQueryClient();
  const [pass, setPass] = useState(""),
    [again, setAgain] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!status.configured && pass !== again)
      return setError("두 번 입력한 비밀문구가 다릅니다.");
    setBusy(true);
    try {
      await api(
        status.configured ? "/auth/login" : "/auth/setup",
        jsonBody("POST", { passphrase: pass }),
      );
      await qc.invalidateQueries();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page login-page">
      <form className="panel login" onSubmit={submit}>
        <h1>
          {status.configured ? "Seller 로그인" : "처음 한 번, 비밀문구 정하기"}
        </h1>
        <p className="muted">
          {status.configured
            ? "사용자님만 아는 비밀문구를 입력하세요. 30일 동안 유지됩니다."
            : "이 주소는 인터넷에 열려 있습니다. 12자 이상의 긴 문장으로 정하세요. 잊으면 복구 방법이 없으니 안전한 곳에 적어 두세요."}
        </p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        <label>
          비밀문구
          <input
            type="password"
            autoComplete={
              status.configured ? "current-password" : "new-password"
            }
            minLength={status.configured ? 1 : 12}
            required
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        {!status.configured && (
          <label>
            한 번 더
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy}>
          {busy
            ? "확인 중…"
            : status.configured
              ? "로그인"
              : "비밀문구 저장하고 시작"}
        </button>
      </form>
    </main>
  );
}
export async function logout() {
  await api("/auth/logout", jsonBody("POST", {}));
  window.location.reload();
}
