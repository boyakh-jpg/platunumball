function safeAppPath(value) {
  try {
    const raw = String(value || "/app/notifications");
    const url = new URL(raw, self.location.origin);
    return !/[\\\r\n]/.test(raw)
      && url.origin === self.location.origin
      && /^\/app(?:\/|$)/.test(url.pathname)
      && !/^\/app\/(?:auth|login)(?:\/|$)/.test(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}`
      : "/app/notifications";
  } catch {
    return "/app/notifications";
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = {}; }
  const normalized = {
    id: String(payload.id ?? "").slice(0, 100),
    type: String(payload.type ?? "notification").slice(0, 100),
    title: String(payload.title ?? "BOXTIER 알림").slice(0, 120),
    body: String(payload.body ?? "새 알림이 있습니다.").slice(0, 500),
    path: safeAppPath(payload.path),
    tag: String(payload.tag ?? `boxtier-${payload.id || "notification"}`).slice(0, 140),
    timestamp: String(payload.timestamp ?? new Date().toISOString()).slice(0, 50),
  };
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleClient = windows.find((client) => client.visibilityState === "visible");
    if (visibleClient) {
      visibleClient.postMessage({ type: "boxtier:push", payload: normalized });
      return;
    }
    await self.registration.showNotification(normalized.title, {
      body: normalized.body,
      tag: normalized.tag,
      icon: "/assets/boxtier_logo.png",
      badge: "/assets/boxtier_logo.png",
      data: { path: normalized.path },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeAppPath(event.notification.data?.path);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows[0];
    if (client) {
      await client.focus();
      if ("navigate" in client) await client.navigate(path);
      return;
    }
    await self.clients.openWindow(path);
  })());
});
