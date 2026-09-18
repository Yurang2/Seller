import { normalizeClaim } from "../../domain/claim";
import { persistClaim, attachmentProblem } from "../../db/repo/claims";
import { AppError } from "../errors";
import { getRecord, patchManaged, refreshGate, fail } from "./records";
import { catalog } from "../../domain/records/catalog";
export async function upsertClaim(
  db: D1Database,
  input: unknown,
  actor: string,
  options: { priceDecision?: boolean } = {},
) {
  const { claim, downgraded } = normalizeClaim(input);
  if (
    claim.owner_type === "products" &&
    ["decided_price", "decided_customer_shipping_fee"].includes(
      claim.field_key,
    ) &&
    !options.priceDecision
  )
    fail(
      "확정 가격은 가격 결정 화면에서 이유·대안·재검토 조건과 함께 변경하세요.",
    );
  if (
    catalog[claim.owner_type] &&
    !(await getRecord(db, claim.owner_type, claim.owner_id))
  )
    fail("근거를 연결할 원본 기록이 없습니다.");
  const expected = catalog[claim.owner_type]?.claims?.[claim.field_key];
  if (expected) {
    const allowed = ["duty", "vat", "insurance"].includes(claim.field_key)
      ? ["money", "percent", "range"]
      : expected === "money" || expected === "number" || expected === "percent"
        ? [expected, "range"]
        : expected === "range"
          ? ["range", "days"]
          : [expected];
    if (!allowed.includes(claim.kind))
      fail("이 항목의 값 형식이 맞지 않습니다: " + allowed.join(", "));
  }
  const problem = await attachmentProblem(db, claim);
  if (problem) throw new AppError(400, "INVALID_ATTACHMENT", problem);
  const record = await persistClaim(
    db,
    claim,
    actor,
    downgraded ? "첨부 없는 가격·배송 견적: 확인 → 추정" : "근거 기록 저장",
  );
  if (
    claim.owner_type === "requirement_items" &&
    claim.field_key === "answer"
  ) {
    const item = await getRecord(db, "requirement_items", claim.owner_id);
    if (item && item.item_result !== "unknown") {
      await patchManaged(
        db,
        "requirement_items",
        item,
        { item_result: "unknown" },
        "답변 근거가 변경되어 재판정 필요",
        actor,
      );
      await refreshGate(db, item.profile_id, actor);
    }
  }
  return {
    data: record,
    downgraded,
    message: downgraded ? "증빙 첨부가 없어 추정으로 저장했습니다." : null,
  };
}
