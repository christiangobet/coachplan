"use client";
import { useState, useEffect } from "react";

type State = "unsupported" | "denied" | "prompt" | "granted" | "loading";

type Prefs = {
  notifPrevDayHour: number;
  notifSameDayEnabled: boolean;
  notifSameDayHour: number;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i); // 0..23

function fmtHour(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

const QUOTES = [
  "Consistency is everything. Your future self will thank you.",
  "Reminders help athletes show up even on tired days. You've got this.",
  "Small daily commitments compound into big race-day results. Keep going!",
  "You're one of the athletes who actually follows through. That's rare.",
  "Champions aren't made on race day — they're made in the daily grind.",
];

function isIosNonPwa(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

export default function NotificationToggle() {
  const [state, setState] = useState<State>(() => {
    if (typeof window === "undefined") return "loading";
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
    const perm = Notification.permission;
    return perm === "default" ? "prompt" : (perm as State);
  });
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    notifPrevDayHour: 18,
    notifSameDayEnabled: false,
    notifSameDayHour: 7,
  });
  const [saving, setSaving] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [quote] = useState(
    () => QUOTES[Math.floor(Math.random() * QUOTES.length)]
  );

  useEffect(() => {
    if (state === "unsupported") return;
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load prefs from server once subscribed
  useEffect(() => {
    if (!subscribed) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((u) => {
        if (typeof u.notifPrevDayHour === "number") {
          setPrefs({
            notifPrevDayHour: u.notifPrevDayHour,
            notifSameDayEnabled: !!u.notifSameDayEnabled,
            notifSameDayHour: u.notifSameDayHour ?? 7,
          });
        }
      })
      .catch(() => {});
  }, [subscribed]);

  async function savePrefs(next: Prefs) {
    const prev = prefs;
    setPrefs(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
    } catch {
      setPrefs(prev);
    } finally {
      setSaving(false);
    }
  }

  async function subscribe() {
    setState("loading");
    setSubError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setSubscribed(true);
      setState("granted");
    } catch (err) {
      const perm = Notification.permission;
      setState(perm === "default" ? "prompt" : perm as State);
      setSubError(err instanceof Error ? err.message : String(err));
    }
  }

  async function unsubscribe() {
    setState("loading");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setState("granted");
  }

  if (state === "unsupported") return null;
  if (state === "loading")
    return <button className="dash-btn-ghost" disabled>Notifications…</button>;
  if (state === "denied")
    return (
      <p style={{ fontSize: 13, color: "var(--d-muted)" }}>
        Notifications blocked — enable in iOS Settings.
      </p>
    );

  if (isIosNonPwa()) {
    return (
      <p style={{ fontSize: 13, color: "var(--d-muted)" }}>
        To enable reminders, add this app to your Home Screen first: tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo;.
      </p>
    );
  }

  if (!subscribed) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <button className="dash-btn-ghost" onClick={subscribe}>
          Enable workout reminders
        </button>
        {subError && (
          <p style={{ fontSize: 12, color: "var(--d-muted)", margin: 0 }}>
            Could not enable: {subError}
          </p>
        )}
      </div>
    );
  }

  const selectStyle: React.CSSProperties = {
    fontSize: 13,
    padding: "2px 6px",
    borderRadius: 6,
    border: "1px solid var(--d-border)",
    background: "var(--d-raised)",
    color: "var(--d-text)",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Encouraging message */}
      <p style={{ fontSize: 13, color: "var(--d-orange)", fontStyle: "italic", margin: 0 }}>
        {quote}
      </p>

      {/* Evening (prev-day) reminder */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: "var(--d-text)", flex: 1 }}>Evening reminder (night before)</span>
        <select
          value={prefs.notifPrevDayHour}
          onChange={(e) =>
            savePrefs({ ...prefs, notifPrevDayHour: Number(e.target.value) })
          }
          style={selectStyle}
        >
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {fmtHour(h)} UTC
            </option>
          ))}
        </select>
      </label>

      {/* Same-day toggle */}
      <label
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={prefs.notifSameDayEnabled}
          onChange={(e) =>
            savePrefs({ ...prefs, notifSameDayEnabled: e.target.checked })
          }
          style={{ accentColor: "var(--d-orange)", width: 16, height: 16, flexShrink: 0 }}
        />
        <span style={{ color: "var(--d-text)" }}>Morning reminder (day of workout)</span>
      </label>

      {/* Same-day hour picker — only shown when enabled */}
      {prefs.notifSameDayEnabled && (
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, paddingLeft: 24 }}
        >
          <span style={{ color: "var(--d-text-mid)", flex: 1 }}>Morning time</span>
          <select
            value={prefs.notifSameDayHour}
            onChange={(e) =>
              savePrefs({ ...prefs, notifSameDayHour: Number(e.target.value) })
            }
            style={selectStyle}
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {fmtHour(h)} UTC
              </option>
            ))}
          </select>
        </label>
      )}

      {saving && (
        <p style={{ fontSize: 12, color: "var(--d-muted)", margin: 0 }}>Saving…</p>
      )}

      <button
        className="dash-btn-ghost"
        style={{ fontSize: 12, color: "var(--d-muted)", alignSelf: "start" }}
        onClick={unsubscribe}
      >
        Disable reminders
      </button>
    </div>
  );
}
