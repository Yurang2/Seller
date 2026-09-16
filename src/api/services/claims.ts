import { normalizeClaim } from "../../domain/claim";
import { persistClaim, validAttachments } from "../../db/repo/claims";
import { AppError } from "../errors";
export async function upsertClaim(
  db: D1Database,
  input: unknown,
  actor: string,
) {
  const { claim, downgraded } = normalizeClaim(input);
  if (!(await validAttachments(db, claim.attachment_ids)))
    throw new AppError(
      400,
      "INVALID_ATTACHMENT",
      "실제로 저장된 증빙 파일만 연결할 수 있습니다.",
    );
  const record = await persistClaim(
    db,
    claim,
    actor,
    downgraded ? "첨부 없는 가격·배송 견적: 확인 → 추정" : "근거 기록 저장",
  );
  return {
    data: record,
    downgraded,
    message: downgraded ? "증빙 첨부가 없어 추정으로 저장했습니다." : null,
  };
}
