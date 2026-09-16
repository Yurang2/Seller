import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Home, Settings, Claims, ResearchImport } from "./pages/Workspace";
import { Backup } from "./pages/Backup";
import { ResearchRecords } from "./pages/Research";
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
              <NavLink to="/" end>
                ⌂　오늘의 흐름
              </NavLink>
              <span className="nav-label">조사하고 판단하기</span>
              <NavLink to="/records/products">▦　상품 조사</NavLink>
              <NavLink to="/records/compliance_profiles">◇　판매 요건</NavLink>
              <NavLink to="/records/suppliers">↗　공급처·견적</NavLink>
              <NavLink to="/records/shipping_scenarios">⇄　배송 비교</NavLink>
              <span className="nav-label">기억하고 이어가기</span>
              <NavLink to="/records/tasks">☑　할 일·막힘</NavLink>
              <NavLink to="/records/notes">▤　지식 노트</NavLink>
              <NavLink to="/records/decisions">◈　결정 기록</NavLink>
              <NavLink to="/records/readiness_items">✓　사업 준비</NavLink>
              <span className="nav-label">자료와 기준</span>
              <NavLink to="/claims">◎　근거·재확인</NavLink>
              <NavLink to="/research-import">↓　조사 파일 가져오기</NavLink>
              <NavLink to="/backup">□　백업·복원</NavLink>
              <NavLink to="/settings">⚙　설정</NavLink>
            </nav>
            <div className="sidebar-note">
              조사 → 요건 → 원가 → 가격
              <br />
              기록을 쌓고 다음 행동을 이어갑니다.
            </div>
            <div className="stage">조사 모드 · 로컬 저장</div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <span>개인 업무 공간</span>
              <span>수동 기록 · 외부 연동 없음</span>
            </header>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/records/:type/:id?" element={<ResearchRecords />} />
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
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
