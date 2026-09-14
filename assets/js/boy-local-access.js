(() => {
  "use strict";
  const KEY = "boy-owner-local-access-v1";
  const DAYS = 30;
  const config = window.BOY_CENTRAL_CONFIG || {};
  const localSecret = window.BOY_LOCAL_SECRET || {};

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!value?.expiresAt || Date.now() >= value.expiresAt) { localStorage.removeItem(KEY); return null; }
      return value;
    } catch (_) { localStorage.removeItem(KEY); return null; }
  }

  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function verifyPin(pin) {
    if (!localSecret.ownerPinHash || await digest(String(pin)) !== localSecret.ownerPinHash) return false;
    localStorage.setItem(KEY, JSON.stringify({
      userId: config.ownerUserId,
      email: config.ownerLoginEmail,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + DAYS * 24 * 60 * 60 * 1000
    }));
    return true;
  }

  function session() {
    const value = read();
    return value ? { user: { id: value.userId, email: value.email }, localAccess: true } : null;
  }

  window.BOY_LOCAL_ACCESS = {
    configured: () => Boolean(localSecret.ownerPinHash),
    hasAccess: () => Boolean(read()),
    verifyPin,
    session,
    clear: () => localStorage.removeItem(KEY)
  };
})();
