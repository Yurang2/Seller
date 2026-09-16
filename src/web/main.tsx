import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Foundation } from "./pages/Foundation";
import "./styles.css";
const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <div className="app">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-symbol">S</span>Seller
            </div>
            <p className="workspace-label">사용자님의 사업 기록</p>
            <nav>
              <NavLink to="/">기록 시작하기</NavLink>
            </nav>
            <div className="sidebar-note">
              조사 → 요건 → 원가 → 가격
              <br />
              기록을 쌓고 다음 행동을 이어갑니다.
            </div>
            <div className="stage">현재: 골격 검증 단계</div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <span>개인 업무 공간</span>
              <span>수동 기록 · 외부 연동 없음</span>
            </header>
            <Routes>
              <Route path="/" element={<Foundation />} />
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
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
