export const MCP_RECEIPT_LEGACY_WIDGET_URIS = [
  "ui://boxtier/basketball-receipt-v2.html",
  "ui://boxtier/basketball-receipt-v3.html",
];
export const MCP_RECEIPT_WIDGET_URI = "ui://boxtier/basketball-receipt-v4.html";
export const MCP_RECEIPT_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export const MCP_RECEIPT_WIDGET_HTML = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; background: transparent; }
    body { display: none; }
    main { width: min(100%, 540px); margin: 0 auto; }
    img { display: block; width: 100%; height: auto; }
    a {
      display: flex;
      min-height: 44px;
      margin-top: 10px;
      align-items: center;
      justify-content: center;
      border: 1px solid currentColor;
      border-radius: 10px;
      color: CanvasText;
      background: Canvas;
      font: 600 14px/1 system-ui, sans-serif;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <img id="receipt" alt="BoxTier 농구 경기 영수증">
    <a id="download" download="boxtier-basketball-receipt.png">PNG 다운로드</a>
  </main>
  <script>
    const receipt = document.getElementById("receipt");
    const download = document.getElementById("download");
    let objectUrl = "";

    function safeFileName(publicCode) {
      const code = typeof publicCode === "string"
        ? publicCode.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)
        : "";
      return code ? "boxtier-" + code + ".png" : "boxtier-basketball-receipt.png";
    }

    function base64ToBlob(data) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return new Blob([bytes], { type: "image/png" });
    }

    function showResult(candidate) {
      const result = candidate?.result ?? candidate;
      const content = Array.isArray(result?.content) ? result.content : [];
      const png = content.find((item) => (
        item?.type === "image"
        && item?.mimeType === "image/png"
        && typeof item?.data === "string"
      ));
      if (!png?.data) return false;

      const nextUrl = URL.createObjectURL(base64ToBlob(png.data));
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = nextUrl;
      receipt.src = nextUrl;
      download.href = nextUrl;
      download.download = safeFileName(result?.structuredContent?.publicCode);
      document.body.style.display = "block";
      return true;
    }

    showResult(window.openai?.toolOutput);
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message?.method === "ui/notifications/tool-result") showResult(message.params);
      if (message?.type === "openai:set_globals") showResult(message.globals?.toolOutput);
    });
    window.addEventListener("beforeunload", () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  </script>
</body>
</html>`;

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
