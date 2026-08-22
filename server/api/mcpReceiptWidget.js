export const MCP_RECEIPT_WIDGET_URI = "ui://boxtier/basketball-receipt.html";
export const MCP_RECEIPT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const MCP_RECEIPT_WIDGET_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: transparent; }
    main { display: grid; place-items: center; min-height: 96px; padding: 8px; }
    img { display: none; width: min(100%, 540px); height: auto; border-radius: 12px; box-shadow: 0 8px 30px rgb(0 0 0 / .22); }
    p { margin: 0; color: #737373; font-size: 14px; }
  </style>
</head>
<body>
  <main><img id="receipt" alt="BoxTier 농구 경기 영수증"><p id="status">영수증 이미지를 불러오는 중</p></main>
  <script>
    const image = document.getElementById("receipt");
    const status = document.getElementById("status");

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
      status.hidden = true;
      return true;
    }

    showResult(window.openai?.toolResponseMetadata);
    showResult(window.openai?.toolOutput);
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message?.method === "ui/notifications/tool-result") showResult(message.params);
      if (message?.type === "openai:set_globals") {
        showResult(message.globals?.toolResponseMetadata);
        showResult(message.globals?.toolOutput);
      }
    });
  </script>
</body>
</html>`;
