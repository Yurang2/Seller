import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { PageHead, ErrorBox, type Row } from "./Workspace";
export function Backup() {
  const [file, setFile] = useState<File | null>(null),
    [report, setReport] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    qc = useQueryClient();
  async function restore(apply = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<Row>("/import" + (apply ? "?apply=1" : ""), {
        method: "POST",
        headers: apply ? { "X-Archive-Hash": report!.archive_hash } : {},
        body: file,
      });
      setReport(r);
      if (apply) {
        setMessage("백업을 복원했습니다. 행별 변경 이력이 남았습니다.");
        await qc.invalidateQueries();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setError("");
    try {
      const r = await fetch("/api/v1/export");
      if (!r.ok) {
        const e = (await r.json()) as Row;
        throw new Error(e.error?.message ?? "백업 실패");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `seller-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        "기록과 첨부 파일을 ZIP으로 내보냈습니다. 자동 백업은 아직 연결되지 않았습니다.",
      );
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main className="page">
      <PageHead
        eyebrow="BACKUP / 내 데이터"
        title="기록은 사용자님의 자산입니다."
        description="JSON·CSV·첨부 원본을 함께 내보내고, 복원 전에 변경 내용을 검토하세요."
      />
      <ErrorBox error={error} />
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      <section className="panel">
        <h2>전체 기록 내보내기</h2>
        <p>
          개인정보 마스킹이 기본입니다. 첨부 파일은 원본으로 포함되므로 보관
          위치를 확인하세요.
        </p>
        <button onClick={download}>백업 ZIP 내려받기</button>
        <p className="muted">
          자동 백업 연동 없음 · 다운로드만으로 “복원 검증 완료”가 되지 않습니다.
        </p>
      </section>
      <section className="panel">
        <h2>백업 복원</h2>
        <input
          type="file"
          accept=".zip"
          aria-label="복원할 백업 ZIP"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setReport(null);
          }}
        />
        <div className="buttons">
          <button disabled={!file || busy} onClick={() => restore()}>
            복원 내용 미리보기
          </button>
          {report && !report.applied && (
            <button disabled={busy} onClick={() => restore(true)}>
              확인한 변경 적용
            </button>
          )}
        </div>
        {report && (
          <>
            <p>
              추가 {report.added} · 변경 {report.updated} · 동일{" "}
              {report.unchanged} · 첨부 {report.attachments}
            </p>
            <details>
              <summary>행별 결과</summary>
              <pre>{JSON.stringify(report.results, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
