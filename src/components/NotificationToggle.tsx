"use client";
import { useState, useEffect } from "react";

type State = "unsupported" | "denied" | "prompt" | "granted" | "loading";

export default function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as State);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscribed(!!sub))
    );
  }, []);

  async function subscribe() {
    setState("loading");
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
    } catch {
      setState(Notification.permission as State);
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
  if (state === "loading") return <button className="dash-btn-ghost" disabled>Notifications…</button>;
  if (state === "denied") return <p style={{ fontSize: 13, color: "var(--d-muted)" }}>Notifications blocked — enable in iOS Settings.</p>;

  return (
    <button className="dash-btn-ghost" onClick={subscribed ? unsubscribe : subscribe}>
      {subscribed ? "Disable workout reminders" : "Enable workout reminders"}
    </button>
  );
}
