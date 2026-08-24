export const MCP_RECEIPT_LEGACY_WIDGET_URIS = [
  "ui://boxtier/basketball-receipt-v2.html",
  "ui://boxtier/basketball-receipt-v3.html",
];
export const MCP_RECEIPT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const MCP_RECEIPT_LEGACY_WIDGET_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html, body { margin: 0; background: transparent; }
    body { display: none; }
    img { display: block; width: min(100%, 540px); height: auto; margin: 0 auto; }
  </style>
</head>
<body>
  <img id="receipt" alt="BoxTier 농구 경기 영수증">
  <script>
    const receipt = document.getElementById("receipt");

    function showResult(candidate) {
      const result = candidate?.result ?? candidate;
      const content = Array.isArray(result?.content) ? result.content : [];
      const png = content.find((item) => (
        item?.type === "image"
        && item?.mimeType === "image/png"
        && typeof item?.data === "string"
      ));
      const debugBase64 = typeof result?.base64 === "string" ? result.base64 : "";
      const data = png?.data || debugBase64;
      if (!data) return false;
      receipt.src = "data:image/png;base64," + data;
      document.body.style.display = "block";
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
