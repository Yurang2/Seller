import { Link } from "react-router-dom";
import "./sourcing.css";

const sites = [
  {
    name: "알리익스프레스",
    url: "https://www.aliexpress.com/",
    category: "해외 소비자 대상 소매",
    role: "소비자 직구 가격 비교 · 샘플 구매",
    description: "한국 소비자도 직접 구매할 수 있습니다. 같은 상품을 다시 판매하려면 상품 선정·설명·검수·배송·응대 등 추가 가치와 비용을 함께 검토하세요.",
    check: "한국 배송 가능 여부, 배송 출발국, 같은 옵션의 배송 포함 가격, 신규 회원·쿠폰 조건",
  },
  {
    name: "1688",
    url: "https://www.1688.com/",
    category: "중국 내수 도매",
    role: "도매 공급처 · 수량별 단가 조사",
    description: "한국 소비자용 직배송 쇼핑몰로 전제하지 않습니다. 중국 내 배송과 국제 운송을 각각 확인해야 합니다.",
    check: "최소 주문량, 옵션별·수량별 단가, 결제 가능 수단, 배송대행·검수 비용",
  },
  {
    name: "Alibaba.com",
    url: "https://www.alibaba.com/",
    category: "국제 기업 간 도매",
    role: "공급업체 견적 · 샘플 · 도매 거래 조사",
    description: "해외 공급업체와 거래하는 플랫폼입니다. 표시 단가와 실제 주문 조건이 같은지 견적으로 대조하세요.",
    check: "최소 주문량, 샘플 가격, 한국 도착 견적, 운송·세금 포함 범위, 납기",
  },
  {
    name: "타오바오",
    url: "https://www.taobao.com/",
    category: "중국 소매",
    role: "상품 발견 · 소량 구매처 조사",
    description: "해외 구매 경로로 검토할 수 있지만, 모든 판매자와 상품이 한국 직배송을 지원하는 것은 아닙니다.",
    check: "실제 판매자, 선택 옵션, 결제가, 한국행 배송 또는 집운·배송대행 조건",
  },
  {
    name: "티몰 (Tmall)",
    url: "https://www.tmall.com/",
    category: "브랜드 중심 중국 소매",
    role: "브랜드 상품 · 모델 · 판매자 조사",
    description: "매장 이름만으로 공식 판매자나 정품을 확정하지 않습니다. 중국으로 수입하는 Tmall Global과 구분하세요.",
    check: "판매자 자격, 모델·구성품, 현재 옵션 가격, 한국행 배송 조건",
  },
];

export function Sourcing() {
  return (
    <main className="page sourcing-page">
      <p className="eyebrow">RESEARCH / 구매 경로</p>
      <h1>직구·해외 소싱 사이트</h1>
      <p>상품을 찾고 구매 조건을 조사하는 출발점입니다. 한국 직배송 여부와 판매용 공급처 적합성은 상품마다 확인하세요.</p>
      <div className="buttons">
        <Link className="button secondary" to="/records/suppliers">공급처 기록</Link>
        <Link className="button secondary" to="/compare">중국·한국 판매처 비교</Link>
      </div>
      <div className="sourcing-list">
        {sites.map((site) => (
          <article className="sourcing-card" key={site.url}>
            <p className="muted">{site.category}</p>
            <h2><a href={site.url} target="_blank" rel="noopener noreferrer">{site.name} ↗<span className="sourcing-new-tab"> (새 탭)</span></a></h2>
            <p><strong>{site.role}</strong></p>
            <p>{site.description}</p>
            <p><strong>확인할 조건:</strong> {site.check}</p>
          </article>
        ))}
      </div>
      <details className="sourcing-sources">
        <summary>분류 출처 · 2026-09-24 검토</summary>
        <p>플랫폼의 용도 분류이며, 개별 상품의 가격·배송·정품·판매 요건 확인을 의미하지 않습니다.</p>
        <ul>
          <li><a href="https://www.hkexnews.hk/listedco/listconews/sehk/2025/0626/2025062601784.pdf" target="_blank" rel="noopener noreferrer">Alibaba Group 2025 연차보고서 (PDF, 새 탭)</a></li>
          <li><a href="https://home.alibabagroup.com/en-US/about-alibaba-businesses-1941299332078632960" target="_blank" rel="noopener noreferrer">1688 공식 소개 (새 탭)</a></li>
          <li><a href="https://cdn.contract.alibaba.com/terms/common_product_agreement/20240510101912934/20240510101912934.html" target="_blank" rel="noopener noreferrer">AliExpress 한국 이용자 약관 (새 탭)</a></li>
        </ul>
      </details>
    </main>
  );
}
