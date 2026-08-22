export const MCP_RECEIPT_WIDGET_URI = "ui://boxtier/basketball-receipt-v3.html";
export const MCP_RECEIPT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const MCP_RECEIPT_WIDGET_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, sans-serif;
      --receipt-widget-muted: #737373;
      --receipt-widget-action: #f97316;
      --receipt-widget-action-text: #171717;
      --receipt-widget-secondary: #e5e5e5;
      --receipt-widget-secondary-text: #171717;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --receipt-widget-muted: #a3a3a3;
        --receipt-widget-secondary: #404040;
        --receipt-widget-secondary-text: #fafafa;
      }
    }
    body { margin: 0; background: transparent; }
    main { display: grid; place-items: center; gap: 12px; min-height: 96px; padding: 8px; }
    img { display: none; width: min(100%, 540px); height: auto; border-radius: 12px; box-shadow: 0 8px 30px rgb(0 0 0 / .22); }
    p { margin: 0; color: var(--receipt-widget-muted); font-size: 14px; }
    #actions { display: none; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .action {
      box-sizing: border-box;
      min-height: 44px;
      padding: 11px 16px;
      border: 0;
      border-radius: 10px;
      background: var(--receipt-widget-action);
      color: var(--receipt-widget-action-text);
      font: 700 14px/1 ui-sans-serif, system-ui, sans-serif;
      text-decoration: none;
      cursor: pointer;
    }
    .action.secondary { display: none; background: var(--receipt-widget-secondary); color: var(--receipt-widget-secondary-text); }
  </style>
</head>
<body>
  <main>
    <img id="receipt" alt="BoxTier 농구 경기 영수증">
    <div id="actions">
      <a id="download" class="action" download="boxtier-basketball-receipt.png">PNG 다운로드</a>
      <button id="share" class="action secondary" type="button">공유·저장</button>
    </div>
    <p id="status">영수증 이미지를 불러오는 중</p>
  </main>
  <script>
    const image = document.getElementById("receipt");
    const actions = document.getElementById("actions");
    const download = document.getElementById("download");
    const share = document.getElementById("share");
    const status = document.getElementById("status");
    let receiptUrl = "";
    let receiptFile = null;

    function toPngBlob(data) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: "image/png" });
    }

    function prepareActions(data) {
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
      const receiptBlob = toPngBlob(data);
      receiptFile = typeof File === "function"
        ? new File([receiptBlob], "boxtier-basketball-receipt.png", { type: "image/png" })
        : null;
      receiptUrl = URL.createObjectURL(receiptBlob);
      download.href = receiptUrl;
      actions.style.display = "flex";
      share.style.display = receiptFile && navigator.share && navigator.canShare?.({ files: [receiptFile] })
        ? "inline-block"
        : "none";
    }

    share.addEventListener("click", async () => {
      if (!receiptFile) return;
      try {
        await navigator.share({ files: [receiptFile], title: "BoxTier 농구 경기 영수증" });
      } catch (error) {
        if (error?.name !== "AbortError") {
          status.textContent = "공유할 수 없습니다. PNG 다운로드를 이용하세요.";
          status.hidden = false;
        }
      }
    });

    function showResult(candidate) {
      const result = candidate?.result ?? candidate;
      const content = Array.isArray(result?.content) ? result.content : [];
      const png = content.find((item) => item?.type === "image" && item?.mimeType === "image/png");
      const metadata = result?._meta ?? result;
      const inlinePng = metadata?.["boxtier/image"];
      const data = png?.data || (inlinePng?.mimeType === "image/png" ? inlinePng.data : "");
      if (!data) return false;
      image.src = "data:image/png;base64," + data;
      image.style.display = "block";
      prepareActions(data);
      status.hidden = true;
      return true;
    }

    showResult(window.openai?.toolResponseMetadata);
    showResult(window.openai?.toolOutput);
    window.addEventListener("openai:set_globals", (event) => {
      const globals = event.detail?.globals ?? event.detail;
      showResult(globals?.toolResponseMetadata);
      showResult(globals?.toolOutput);
    });
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message?.method === "ui/notifications/tool-result") showResult(message.params);
      if (message?.type === "openai:set_globals") {
        showResult(message.globals?.toolResponseMetadata);
        showResult(message.globals?.toolOutput);
      }
    });
    window.addEventListener("beforeunload", () => {
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
    });
  </script>
</body>
</html>`;
