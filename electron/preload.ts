import { ipcRenderer } from "electron";

// All additions live in the desktop shell; the shared React screens stay intact.
window.addEventListener("DOMContentLoaded", async () => {
  const info = await ipcRenderer.invoke("seller:info");
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.id = "seller-desktop-settings";
  const title = document.createElement("h2"); title.textContent = "데스크톱 저장 위치"; panel.appendChild(title);
  for (const [key, label] of [["database", "데이터베이스"], ["attachments", "첨부 파일"], ["backups", "종료 시 자동 백업"]]) {
    const row = document.createElement("p");
    const text = document.createElement("span"); text.textContent = `${label}: ${info.paths[key]} `;
    const button = document.createElement("button"); button.textContent = "폴더 열기"; button.type = "button";
    button.onclick = () => { void ipcRenderer.invoke("seller:open-folder", key).catch((error: Error) => { row.appendChild(document.createTextNode(` 열기 실패: ${error.message}`)); }); };
    row.appendChild(text); row.appendChild(button); panel.appendChild(row);
  }
  const hint = document.createElement("p"); hint.textContent = "변경 후 앱을 닫으면 백업 ZIP을 저장합니다. 최근 30개를 보관합니다."; panel.appendChild(hint);
  const releases = document.createElement("button"); releases.type = "button"; releases.textContent = "새 버전 확인 (GitHub 릴리스)";
  releases.onclick = () => { void ipcRenderer.invoke("seller:releases"); }; panel.appendChild(releases);
  const warning = document.createElement("div"); warning.className = "alert error"; warning.setAttribute("role", "alert");
  warning.textContent = "지난 종료 시 자동 백업에 실패했습니다. 설정에서 백업 폴더를 확인하고 백업·복원에서 ZIP을 직접 저장해주세요. " + (info.backupError ?? "");
  const update = () => {
    const main = document.querySelector("main.page");
    if (!main) return;
    if (location.pathname === "/settings" && !panel.isConnected) main.appendChild(panel);
    else if (location.pathname !== "/settings" && panel.isConnected) panel.remove();
    if (location.pathname === "/" && info.backupError && !warning.isConnected) main.insertBefore(warning, main.firstChild);
    else if (location.pathname !== "/" && warning.isConnected) warning.remove();
    if (location.pathname === "/backup") {
      for (const node of main.querySelectorAll("p, div[role='status']")) {
        if (node.textContent?.includes("자동 백업 연동 없음")) node.textContent = "앱 종료 시 변경 내용을 자동 백업합니다. 다운로드만으로 ‘복원 검증 완료’가 되지 않습니다.";
        else if (node.textContent?.includes("자동 백업은 아직 연결되지 않았습니다.")) node.textContent = "기록과 첨부 파일을 ZIP으로 내보냈습니다. 앱 종료 시에도 변경 내용을 자동 백업합니다.";
      }
    }
  };
  new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
  update();
});
