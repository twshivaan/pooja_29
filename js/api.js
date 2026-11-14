/*
 * Storage helper and calls to the Apps Script endpoint for the birthday surprise.
 * Saves are full snapshots, so the queue only ever needs to keep the latest one.
 */

const IS_TEST = (function () {
  try { return new URLSearchParams(location.search).get("test") === "1"; } catch (e) { return false; }
})();

/* localStorage with an in-memory fallback (private mode, blocked storage, odd in-app browsers). */
const Store = (function () {
  const ns = IS_TEST ? "bs_test_" : "bs_";
  const mem = {};
  return {
    get(k) {
      if (Object.prototype.hasOwnProperty.call(mem, k)) return mem[k];
      try {
        const raw = localStorage.getItem(ns + k);
        if (raw == null) return null;
        const v = JSON.parse(raw);
        mem[k] = v;
        return v;
      } catch (e) { return null; }
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem(ns + k, JSON.stringify(v)); } catch (e) { /* memory only */ }
    },
    del(k) {
      delete mem[k];
      try { localStorage.removeItem(ns + k); } catch (e) { /* ignore */ }
    },
  };
})();

function uuid() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const API = (function () {
  const URL_ = CONFIG.ENDPOINT_URL;
  const configured = /^https:\/\//.test(URL_);
  const FATAL = ["bad_key", "closed"];
  const DELAYS = [2000, 5000, 10000, 20000, 40000, 60000];

  let fatalHandler = function () {};
  let statusHandler = function () {};

  if (!configured) console.warn("Birthday surprise: ENDPOINT_URL is not set in js/config.js yet.");

  function err(code) { const e = new Error(code); e.code = code; return e; }

  /* One POST. text/plain keeps it a "simple" request, so there is no CORS preflight. */
  function post(payload, opts) {
    opts = opts || {};
    if (!configured) return Promise.reject(err("not_configured"));
    const body = JSON.stringify(payload);
    const init = {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body,
      redirect: "follow",
      cache: "no-store",
    };
    if (opts.keepalive && body.length < 60000) init.keepalive = true;
    let timer = null;
    if (opts.timeout && typeof AbortController !== "undefined") {
      const ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(() => ctrl.abort(), opts.timeout);
    }
    return fetch(URL_, init)
      .then((r) => r.text())
      .then((txt) => {
        let data;
        try { data = JSON.parse(txt); } catch (e) { throw err("bad_response"); }
        if (!data || data.ok !== true) {
          const code = (data && data.error) || "error";
          if (FATAL.indexOf(code) >= 0) fatalHandler(code);
          throw err(code);
        }
        return data;
      })
      .catch((e) => { throw e && e.code ? e : err("network"); })
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  /* ---------- save queue ---------- */
  let latest = Store.get("pending_save");
  let inflight = null;
  let retryTimer = null;
  let attempt = 0;

  function setStatus(s) { statusHandler(s); }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const d = DELAYS[Math.min(attempt - 1, DELAYS.length - 1)];
    retryTimer = setTimeout(() => { run().catch(() => {}); }, d);
  }

  function run(opts) {
    if (inflight) return inflight;
    if (!latest) return Promise.resolve();
    clearTimeout(retryTimer);
    const p = latest;
    setStatus("saving");
    inflight = post(p, { timeout: 30000, keepalive: opts && opts.keepalive }).then(
      () => {
        inflight = null;
        attempt = 0;
        if (latest === p) {
          latest = null;
          Store.del("pending_save");
          setStatus("saved");
          return undefined;
        }
        return run();
      },
      (e) => {
        inflight = null;
        if (FATAL.indexOf(e.code) >= 0) { setStatus(""); throw e; }
        attempt++;
        setStatus("retry");
        scheduleRetry();
        throw e;
      }
    );
    return inflight;
  }

  /* Queue a snapshot and try to send it now. The promise settles after this snapshot (or a newer one) is sent. */
  function save(payload, opts) {
    latest = payload;
    Store.set("pending_save", payload);
    return run(opts);
  }

  /* Send anything left over from a previous visit. */
  function resume() {
    if (latest) run().catch(() => {});
  }

  function clearPending() {
    latest = null;
    clearTimeout(retryTimer);
    Store.del("pending_save");
  }

  function count(key) {
    return post({ action: "count", key: key }, { timeout: 8000 }).then((d) => d.count);
  }

  window.addEventListener("online", () => { if (latest) run().catch(() => {}); });

  return {
    configured,
    post,
    save,
    resume,
    clearPending,
    count,
    isFatal: (code) => FATAL.indexOf(code) >= 0,
    onFatal: (fn) => { fatalHandler = fn; },
    onStatus: (fn) => { statusHandler = fn; },
  };
})();
