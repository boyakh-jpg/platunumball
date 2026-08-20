import { useEffect, useState } from "react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";

const DEFAULTS = {
  preferences: { mode: "none", gameRecruiting: true, team: true, recordTier: true, service: false },
  contact: { enabled: false, kakaoEnabled: false, kakaoOpenProfileUrl: "" },
  pushSubscriptionCount: 0,
};

function decodeVapidKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(`${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function ExternalNotificationSettingsCard({ app, discordLinked }) {
  const [draft, setDraft] = useState(DEFAULTS);
  const [devicePushEnabled, setDevicePushEnabled] = useState(false);
  const [status, setStatus] = useState("불러오는 중");
  const [pending, setPending] = useState(false);
  const pushSupported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const needsIosHomeScreen = typeof window !== "undefined" && typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent)
    && !window.matchMedia("(display-mode: standalone)").matches
    && !navigator.standalone;

  useEffect(() => {
    if (!app.serverProfileBound) return undefined;
    let active = true;
    app.actions.runServerAction("/api/notifications/external-settings", { operation: "load" }).then(async (result) => {
      if (!active) return;
      if (!result || result.ok === false) {
        setStatus("설정을 불러오지 못했습니다.");
        return;
      }
      setDraft({ preferences: result.preferences, contact: result.contact, pushSubscriptionCount: result.pushSubscriptionCount });
      if (pushSupported) {
        const registration = await navigator.serviceWorker.ready;
        if (active) setDevicePushEnabled(Boolean(await registration.pushManager.getSubscription()));
      }
      setStatus("저장됨");
    }).catch(() => {
      if (active) setStatus("설정을 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [app.actions, app.serverProfileBound]);

  const save = async () => {
    setPending(true);
    setStatus("");
    const result = await app.actions.runServerAction("/api/notifications/external-settings", {
      operation: "save",
      preferences: draft.preferences,
      contact: draft.contact,
    });
    setPending(false);
    setStatus(result?.ok ? "저장됨" : "저장하지 못했습니다. 카카오 URL을 확인하세요.");
  };
  const enablePush = async () => {
    if (!pushSupported || needsIosHomeScreen || !import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY) {
      setStatus("이 기기에서 푸시를 설정할 수 없습니다.");
      return;
    }
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("브라우저 알림 권한이 필요합니다.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      let created = false;
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY),
        });
        created = true;
      }
      const result = await app.actions.runServerAction("/api/notifications/external-settings", { operation: "subscribe", subscription: subscription.toJSON() });
      if (!result?.ok) {
        if (created) await subscription.unsubscribe();
        throw new Error("subscribe_failed");
      }
      setDraft((current) => ({ ...current, pushSubscriptionCount: Math.max(1, current.pushSubscriptionCount) }));
      setDevicePushEnabled(true);
      setStatus("이 기기 푸시가 연결되었습니다.");
    } catch {
      setStatus("푸시 연결에 실패했습니다.");
    } finally {
      setPending(false);
    }
  };
  const disablePush = async () => {
    setPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const result = await app.actions.runServerAction("/api/notifications/external-settings", { operation: "unsubscribe", endpoint: subscription.endpoint });
        if (!result?.ok) throw new Error("unsubscribe_failed");
        await subscription.unsubscribe();
      }
      setDraft((current) => ({ ...current, pushSubscriptionCount: Math.max(0, current.pushSubscriptionCount - 1) }));
      setDevicePushEnabled(false);
      setStatus("이 기기 푸시를 해제했습니다.");
    } catch {
      setStatus("푸시 해제에 실패했습니다.");
    } finally {
      setPending(false);
    }
  };

  const categoryOptions = [
    ["gameRecruiting", "경기·모집"], ["team", "팀"], ["recordTier", "기록·티어"], ["service", "서비스"],
  ];
  return (
    <Card as="fieldset" className="section-card settings-fieldset-card settings-preference-card external-notification-card">
      <legend className="section-title-row"><div><p className="eyebrow">External notifications</p><h2>외부 알림·연락</h2></div></legend>
      <div className="settings-fieldset-status-row">
        <Badge tone={devicePushEnabled ? "green" : "neutral"}>{devicePushEnabled ? `PUSH ON · ${draft.pushSubscriptionCount}대` : "PUSH OFF"}</Badge>
      </div>
      <div className="settings-preference-group">
        <div className="settings-preference-heading"><strong>알림 경로</strong><span>앱 내부 알림은 항상 유지됩니다. Discord는 아래 DM 설정도 켜야 합니다.</span></div>
        <div className="ui-segmented-control segmented-control external-mode-control" role="radiogroup" aria-label="알림 경로">
          {[["push", "푸시"], ["discord", "Discord"], ["both", "둘 다"], ["none", "사용 안 함"]].map(([mode, label]) => (
            <button key={mode} type="button" className={draft.preferences.mode === mode ? "active" : ""} aria-pressed={draft.preferences.mode === mode} disabled={pending || ((mode === "discord" || mode === "both") && !discordLinked)} onClick={() => setDraft((current) => ({ ...current, preferences: { ...current.preferences, mode } }))}>{label}</button>
          ))}
        </div>
        <div className="settings-toggle-grid ui-design-choice-list">
          {categoryOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.preferences[key]} disabled={pending} onChange={(event) => setDraft((current) => ({ ...current, preferences: { ...current.preferences, [key]: event.target.checked } }))} />{label}</label>)}
        </div>
        {needsIosHomeScreen ? <small>iPhone은 Safari 공유 → 홈 화면에 추가한 뒤 앱에서 푸시를 켜세요.</small> : null}
        <div className="ui-action-row settings-address-actions">
          <Button type="button" variant="secondary" disabled={pending || !pushSupported || needsIosHomeScreen} onClick={devicePushEnabled ? disablePush : enablePush}>{devicePushEnabled ? "이 기기 푸시 해제" : "이 기기 푸시 연결"}</Button>
        </div>
      </div>
      <div className="settings-preference-group">
        <div className="settings-preference-heading"><strong>방 참가자 연락</strong><span>같은 활성 경기·모집방 참가자에게만 프로필 카드에서 공개됩니다.</span></div>
        <div className="settings-toggle-grid ui-design-choice-list">
          <label><input type="checkbox" checked={draft.contact.enabled} disabled={pending} onChange={(event) => setDraft((current) => ({ ...current, contact: { ...current.contact, enabled: event.target.checked } }))} />연락 허용</label>
          <label><input type="checkbox" checked={draft.contact.kakaoEnabled} disabled={pending || !draft.contact.enabled} onChange={(event) => setDraft((current) => ({ ...current, contact: { ...current.contact, kakaoEnabled: event.target.checked } }))} />카카오 오픈프로필</label>
        </div>
        <label className="external-contact-url"><span>오픈프로필 URL</span><input type="url" value={draft.contact.kakaoOpenProfileUrl} disabled={pending || !draft.contact.enabled || !draft.contact.kakaoEnabled} placeholder="https://open.kakao.com/o/..." onChange={(event) => setDraft((current) => ({ ...current, contact: { ...current.contact, kakaoOpenProfileUrl: event.target.value } }))} /></label>
      </div>
      <div className="settings-save-row"><small role="status" aria-live="polite">{status}</small><Button type="button" disabled={pending} onClick={save}>{pending ? "처리 중" : "저장"}</Button></div>
    </Card>
  );
}
