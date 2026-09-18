import type { ClaimStatus } from "./types/claim";
// 종합 등급: 평균 점수가 아니라 순서가 있는 판정이다.
// 1) 판매 요건 게이트가 막히면 수익성과 무관하게 최하 등급 또는 판정 불가.
// 2) 남은 조치(미확인 요건·막힘·조건부)가 무거우면 등급을 낮춘다.
// 3) 그 다음에야 원가 스냅샷의 공헌이익률로 A~C를 나눈다. 미확인은 0으로 치지 않는다(R-02).
export type Grade = "A" | "B" | "C" | "D" | "판정 불가";
export type GradeInput = {
  product: {
    id: string;
    name: string;
    status: string;
    profile_id: string | null;
  };
  profile: { gate_result: string; gate_reason?: string | null } | null;
  items: { key: string; risk_level: string; item_result: string }[];
  openTasks: { status: string; priority: number; title: string }[];
  costing: {
    overall_status: ClaimStatus | string;
    unknown_keys: string[];
    outputs: {
      margin_rate?: string;
      contribution_per_unit?: string;
      net_est_per_unit?: string;
    } | null;
  } | null;
};
export type GradeResult = {
  grade: Grade;
  estimated: boolean;
  reasons: string[];
  next: string[];
  margin_rate: number | null;
};
const MARGIN_A = 0.3,
  MARGIN_B = 0.15;
const down = (g: Grade): Grade =>
  g === "A" ? "B" : g === "B" ? "C" : g === "C" ? "D" : g;
export function gradeProduct(i: GradeInput): GradeResult {
  const reasons: string[] = [],
    next: string[] = [];
  if (["rejected", "discontinued"].includes(i.product.status))
    return {
      grade: "D",
      estimated: false,
      reasons: ["탈락·종료된 상품"],
      next: [],
      margin_rate: null,
    };
  if (!i.profile) {
    return {
      grade: "판정 불가",
      estimated: false,
      reasons: ["판매 요건 프로필이 연결되지 않음"],
      next: ["캐릭터×카테고리 요건 프로필 연결"],
      margin_rate: null,
    };
  }
  if (i.profile.gate_result === "fail")
    return {
      grade: "D",
      estimated: false,
      reasons: [
        "판매 요건 실패: " + (i.profile.gate_reason || "항목 판정 참고"),
      ],
      next: ["사업 모델 변경(국내 정식 도매 등) 또는 상품군 교체 검토"],
      margin_rate: null,
    };
  const unknownItems = i.items.filter((x) => x.item_result === "unknown"),
    unknownHigh = unknownItems.filter((x) => x.risk_level === "high"),
    conditional = i.items.filter((x) => x.item_result === "conditional");
  if (i.profile.gate_result === "unknown") {
    reasons.push(
      `판매 요건 미확인 ${unknownItems.length}개 (위험도 높음 ${unknownHigh.length}개)`,
    );
    next.push(
      unknownHigh.length
        ? "위험도 높음 요건부터 확인: " +
            unknownHigh.map((x) => x.key).join(", ")
        : "남은 요건 항목 판정",
    );
    if (!i.costing?.outputs) next.push("원가 스냅샷 완성(미확인 입력 채우기)");
    return {
      grade: "판정 불가",
      estimated: false,
      reasons,
      next,
      margin_rate: null,
    };
  }
  // 게이트 통과·조건부. 수익성 판단.
  const margin =
    i.costing?.outputs?.margin_rate != null
      ? Number(i.costing.outputs.margin_rate)
      : null;
  let grade: Grade;
  if (margin === null) {
    grade = "C";
    reasons.push(
      i.costing
        ? `원가 미확인 입력 ${i.costing.unknown_keys.length}개 → 수익성 판단 불가`
        : "원가 스냅샷 없음 → 수익성 판단 불가",
    );
    next.push("원가 스냅샷 완성 후 등급 재계산");
  } else if (margin < 0) {
    grade = "D";
    reasons.push(`공헌이익률 ${(margin * 100).toFixed(1)}% (손실)`);
    next.push("판매가·배송 경로·공급처 재검토");
  } else if (margin >= MARGIN_A) {
    grade = "A";
    reasons.push(`공헌이익률 ${(margin * 100).toFixed(1)}%`);
  } else if (margin >= MARGIN_B) {
    grade = "B";
    reasons.push(`공헌이익률 ${(margin * 100).toFixed(1)}% (기준 30% 미만)`);
    next.push("가격·배송비·소포당 개수 조정으로 마진 개선 여지 확인");
  } else {
    grade = "C";
    reasons.push(`공헌이익률 ${(margin * 100).toFixed(1)}% (기준 15% 미만)`);
    next.push("손익분기 판매가 확인, 광고·반품 예비 반영 시 손실 위험");
  }
  const estimated = i.costing?.overall_status === "estimated";
  if (estimated)
    reasons.push("원가에 추정 입력 포함 (캡처로 확인하면 등급이 확정됨)");
  if (conditional.length) {
    reasons.push(
      `조건부 요건 ${conditional.length}개: ${conditional.map((x) => x.key).join(", ")}`,
    );
    next.push("조건부 요건의 조건 이행 기록");
    if (conditional.length >= 3) {
      grade = down(grade);
      reasons.push("조건부 3개 이상 → 한 등급 하향");
    }
  }
  const blocked = i.openTasks.filter((t) => t.status === "blocked");
  if (blocked.length) {
    reasons.push(
      `막힘 ${blocked.length}개: ${blocked.map((t) => t.title).join(" / ")}`,
    );
    if (grade !== "D") {
      grade = down(grade);
      reasons.push("막힘이 남아 있어 한 등급 하향");
    }
    next.push("막힘 해소");
  }
  if (
    ["listing_ready", "live", "paused"].includes(i.product.status) === false &&
    grade === "A"
  )
    next.push("가격 결정과 사업 준비를 마치고 등록 준비로 이동");
  return { grade, estimated, reasons, next, margin_rate: margin };
}
