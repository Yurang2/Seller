import React from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, NavLink, Link } from "react-router-dom";
import { Home, Settings, Claims, ResearchImport } from "./pages/Workspace";
import { Backup } from "./pages/Backup";
import { ResearchRecords } from "./pages/Research";
import { Capture } from "./pages/Capture";
import { Login, useAuthStatus, logout } from "./pages/Login";
import { useEffect } from "react";
import "./styles.css";
import "./theme.css";
const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
function Shell() {
  const auth = useAuthStatus(),
    qc = useQueryClient();
  useEffect(() => {
    const h = () => qc.invalidateQueries({ queryKey: ["auth"] });
    window.addEventListener("seller:login-required", h);
    return () => window.removeEventListener("seller:login-required", h);
  }, [qc]);
  if (auth.isLoading) return <main className="page">확인 중…</main>;
  if (auth.error)
    return (
      <main className="page">
        <h1>서버에 연결할 수 없습니다</h1>
        <p>{String(auth.error)}</p>
      </main>
    );
  const s = auth.data!;
  if (s.mode !== "access" && !s.authenticated) return <Login status={s} />;
  return <App authenticated={s.mode !== "access"} />;
}
const Icon = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: d }}
  />
);
const icons = {
  home: '<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  check:
    '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  clip: '<path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  out: '<path d="M10 17l5-5-5-5M15 12H3M21 3v18"/>',
};
// 핵심 5개 활동만 레일·탭에 두고, 나머지 화면은 "더 보기"로 모은다(목업 v3).
const primary = [
  { to: "/", label: "홈", icon: icons.home, end: true },
  { to: "/records/products", label: "상품", icon: icons.box },
  { to: "/capture", label: "캡처", icon: icons.cam },
  { to: "/records/tasks", label: "할 일", icon: icons.check },
  { to: "/claims", label: "근거", icon: icons.clip },
  { to: "/more", label: "더 보기", icon: icons.more },
];
export const moreSections = [
  ["/records/compliance_profiles", "판매 요건", "게이트 13항목 · 근거 강도"],
  ["/records/suppliers", "공급처·견적", "오퍼 · 대화 기록"],
  ["/records/shipping_scenarios", "배송 비교", "경로 · 요율표 · 포워더"],
  ["/records/channels", "채널·등록 상품", "수동 절차 · 판매 중 기록"],
  ["/records/notes", "지식 노트", "관찰 · 메모"],
  ["/records/decisions", "결정 기록", "이유와 대안"],
  ["/records/readiness_items", "사업 준비", "판매 개시 체크리스트"],
  ["/research-import", "조사 파일 가져오기", "엑셀 템플릿 · 조각 적용"],
  ["/backup", "백업·복원", "ZIP 내보내기 · 미리보기 복원"],
  ["/settings", "설정", "사업 모델 · 환율 · 재확인 기본값"],
] as const;
function More({ authenticated }: { authenticated: boolean }) {
  return (
    <main className="page">
      <p className="eyebrow">MORE / 모든 화면</p>
      <h1>더 보기</h1>
      <div className="more-list">
        {moreSections.map(([to, name, sub]) => (
          <Link key={to} to={to}>
            <span>
              {name}
              <small>{sub}</small>
            </span>
          </Link>
        ))}
        {authenticated && (
          <button type="button" className="secondary" onClick={logout}>
            <span>
              로그아웃
              <small>모든 기기의 로그인이 함께 풀립니다</small>
            </span>
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 16 }}>
        수동 기록 · 외부 연동 없음. 미확인 금액은 계산에 쓰지 않습니다.
      </p>
    </main>
  );
}
function App({ authenticated }: { authenticated: boolean }) {
  const links = (cls: string) =>
    primary.map((p) => (
      <NavLink key={p.to} to={p.to} end={p.end} className={cls}>
        <Icon d={p.icon} />
        {p.label}
      </NavLink>
    ));
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="rail" aria-label="주요 화면">
          <span className="brand-symbol">S</span>
          {links("")}
          <span className="spacer" />
          {authenticated && (
            <button
              type="button"
              className="linklike"
              onClick={logout}
              aria-label="로그아웃"
              title="로그아웃"
            >
              <Icon d={icons.out} />
            </button>
          )}
        </nav>
        <div className="workspace">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/records/:type/:id?" element={<ResearchRecords />} />
            <Route path="/capture" element={<Capture />} />
            <Route
              path="/more"
              element={<More authenticated={authenticated} />}
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/research-import" element={<ResearchImport />} />
            <Route path="/backup" element={<Backup />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <h1>페이지가 없습니다</h1>
                  <NavLink to="/">기록으로 돌아가기</NavLink>
                </div>
              }
            />
          </Routes>
        </div>
        <nav className="tabbar" aria-label="주요 화면">
          {primary
            .filter((p) => p.to !== "/claims")
            .map((p) => (
              <NavLink key={p.to} to={p.to} end={p.end}>
                <Icon d={p.icon} />
                {p.label}
              </NavLink>
            ))}
        </nav>
      </div>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  </React.StrictMode>,
);
