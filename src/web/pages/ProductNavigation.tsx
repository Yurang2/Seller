import { Link, useSearchParams } from "react-router-dom";
import "./product-navigation.css";
export const productSections = [
  ["overview", "요약"],
  ["compare", "판매처 비교"],
  ["cost", "원가·수익성"],
  ["prepare", "판매 준비"],
] as const;
export function useProductSection() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  return [...productSections.map(([key]) => key), "history"].includes(tab ?? "")
    ? tab!
    : "overview";
}
export function ProductNavigation({ id }: { id: string }) {
  const current = useProductSection();
  return (
    <nav className="product-navigation" aria-label="상품 작업">
      {productSections.map(([key, label]) => (
        <Link
          key={key}
          aria-current={current === key ? "page" : undefined}
          to={`/records/products/${id}?tab=${key}`}
        >
          {label}
        </Link>
      ))}
      <Link
        className="product-history-link"
        aria-current={current === "history" ? "page" : undefined}
        to={`/records/products/${id}?tab=history`}
      >
        기록·이력
      </Link>
    </nav>
  );
}
