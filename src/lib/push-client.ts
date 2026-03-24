export function decodeVapidPublicKey(base64UrlString: string): Uint8Array<ArrayBuffer> {
  const sanitized = base64UrlString.replace(/[^A-Za-z0-9\-_]/g, "");

  if (!sanitized) {
    throw new Error("Missing valid VAPID public key.");
  }

  const padding = "=".repeat((4 - (sanitized.length % 4)) % 4);
  const base64 = (sanitized + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}
