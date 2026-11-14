/*
 * Photo picking, resizing and upload for the birthday surprise.
 * Photos upload one at a time, as soon as they are picked, with retry on failure.
 */
const Photos = (function () {
  const MAX_PER_SLOT = 3;
  const MAX_TOTAL = 15;
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_EDGE = 3000;
  const QUALITY = 0.85;
  const THUMB = 160;
  const DELAYS = [2000, 5000, 10000, 20000, 40000, 60000];
  const ITEM_ERRORS = ["unreadable", "too_big", "bad_mime", "bad_slot", "limit", "too_long", "not_found"];
  const T = COPY.photo;

  let items = [];          // { id, slot, caption, sentCaption, thumb, state, progress, msg, file, blob, mime, removed, el }
  let queue = [];          // { type: "upload" | "caption" | "remove", item }
  let busy = false;
  let timer = null;
  let attempt = 0;
  let waiters = [];
  let ctx = () => ({});
  let onChange = () => {};
  const slotEls = {};

  /* ---------- state ---------- */

  function init(opts) {
    ctx = opts.ctx;
    onChange = opts.onChange || onChange;
    load();
  }

  function load() {
    items = [];
    queue = [];
    const saved = Store.get("photos") || [];
    saved.forEach((p) => {
      const it = Object.assign({}, p, { state: "done", progress: 100 });
      items.push(it);
      if (it.removed) queue.push({ type: "remove", item: it });
      else if ((it.caption || "") !== (it.sentCaption || "")) queue.push({ type: "caption", item: it });
    });
    if (queue.length) setTimeout(kick, 1500);
  }

  function persist() {
    Store.set("photos", items
      .filter((i) => i.state === "done")
      .map((i) => ({ id: i.id, slot: i.slot, caption: i.caption, sentCaption: i.sentCaption, thumb: i.thumb, removed: !!i.removed })));
  }

  function live(i) { return !i.removed && i.state !== "error"; }
  function count(slot) { return items.filter((i) => live(i) && (!slot || i.slot === slot)).length; }

  function reset() {
    clearTimeout(timer);
    items = [];
    queue = [];
    Store.del("photos");
    Object.keys(slotEls).forEach((k) => delete slotEls[k]);
  }

  /* ---------- image helpers ---------- */

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const t = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error("timeout")); }, 30000);
      img.onload = () => {
        clearTimeout(t);
        if (!img.naturalWidth) { URL.revokeObjectURL(url); reject(new Error("empty")); return; }
        resolve({ img, url });
      };
      img.onerror = () => { clearTimeout(t); URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  function toBlob(canvas, type, q) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, q);
      else {
        try {
          const d = canvas.toDataURL(type, q);
          const bin = atob(d.split(",")[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type }));
        } catch (e) { reject(e); }
      }
    });
  }

  /* Browsers apply EXIF orientation when drawing an <img>, so the result comes out the right way up. */
  async function makeThumb(it) {
    try {
      const { img, url } = await loadImage(it.file);
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = THUMB;
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, THUMB, THUMB);
      URL.revokeObjectURL(url);
      it.thumb = c.toDataURL("image/jpeg", 0.7);
    } catch (e) {
      it.undecodable = true;
    }
    paint(it);
  }

  function mimeOf(file) {
    if (file.type) return file.type.toLowerCase();
    if (/\.(heic)$/i.test(file.name || "")) return "image/heic";
    if (/\.(heif)$/i.test(file.name || "")) return "image/heif";
    return "";
  }

  function codeErr(code) { const e = new Error(code); e.code = code; return e; }

  /* Longest edge 3000 px, never upscaled, JPEG 0.85. Falls back to the original file if it can't be decoded. */
  async function prepare(it) {
    const file = it.file;
    const mime = mimeOf(file);
    if (!/^image\//.test(mime)) throw codeErr("bad_mime");
    let loaded = null;
    try { loaded = await loadImage(file); } catch (e) { loaded = null; }
    if (!loaded) {
      if (file.size <= MAX_BYTES) return { blob: file, mime };
      throw codeErr("unreadable");
    }
    const { img, url } = loaded;
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    let blob;
    try { blob = await toBlob(c, "image/jpeg", QUALITY); }
    catch (e) {
      if (file.size <= MAX_BYTES) return { blob: file, mime };
      throw codeErr("unreadable");
    } finally { c.width = c.height = 0; }
    if (blob.size > MAX_BYTES) throw codeErr("too_big");
    return { blob, mime: "image/jpeg" };
  }

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(codeErr("unreadable"));
      r.readAsDataURL(blob);
    });
  }

  /* ---------- queue ---------- */

  function base() {
    const c = ctx();
    return { key: c.key, response_id: c.rid, name: c.name || "", is_test: !!c.test };
  }

  async function runOp(op) {
    const it = op.item;
    if (op.type === "upload") {
      if (!it.blob) {
        setState(it, "processing");
        const r = await prepare(it);
        it.blob = r.blob;
        it.mime = r.mime;
      }
      setState(it, "uploading");
      startProgress(it);
      const data = await toBase64(it.blob);
      const cap = it.caption || "";
      await API.post(Object.assign(base(), {
        action: "photo", slot: it.slot, caption: cap, photo_id: it.id, mime: it.mime, data_base64: data,
      }), { timeout: 180000 });
      it.sentCaption = cap;
      it.file = null;
      it.blob = null;
      setState(it, "done");
      persist();
      if (it.removed) queue.push({ type: "remove", item: it });
      else if ((it.caption || "") !== cap) queueCaption(it);
    } else if (op.type === "caption") {
      const cap = it.caption || "";
      await API.post(Object.assign(base(), { action: "photo_caption", photo_id: it.id, caption: cap }), { timeout: 30000 });
      it.sentCaption = cap;
      persist();
    } else if (op.type === "remove") {
      await API.post(Object.assign(base(), { action: "photo_remove", photo_id: it.id }), { timeout: 30000 });
      items = items.filter((i) => i !== it);
      persist();
    }
  }

  async function kick() {
    if (busy) return;
    clearTimeout(timer);
    if (!queue.length) { settle(0); return; }
    // The Drive folder is named after the person, so hold on until the name is typed.
    const c = ctx();
    if (!String(c.name || "").trim() || c.typingName) {
      timer = setTimeout(kick, 1200);
      settle(pendingCount());
      return;
    }
    busy = true;
    const op = queue[0];
    try {
      await runOp(op);
      queue = queue.filter((o) => o !== op);
      attempt = 0;
    } catch (e) {
      const code = (e && e.code) || "network";
      if (API.isFatal(code)) { busy = false; settle(pendingCount()); return; }
      if (ITEM_ERRORS.indexOf(code) >= 0) {
        queue = queue.filter((o) => o !== op);
        if (op.type === "upload") {
          op.item.msg = code === "unreadable" ? T.unreadable : code === "too_big" ? T.tooBig : T.rejected;
          op.item.file = op.item.blob = null;
          setState(op.item, "error");
          drawSlot(op.item.slot);
          onChange();
        } else if (op.type === "remove") {
          items = items.filter((i) => i !== op.item);
          persist();
        }
      } else {
        attempt++;
        if (op.type === "upload") setState(op.item, "retry");
        busy = false;
        timer = setTimeout(kick, DELAYS[Math.min(attempt - 1, DELAYS.length - 1)]);
        settle(pendingCount());
        return;
      }
    }
    busy = false;
    kick();
  }

  function pendingCount() {
    const ups = queue.filter((o) => o.type === "upload").length;
    return queue.length ? Math.max(1, ups) : 0;
  }

  function settle(n) {
    const w = waiters;
    waiters = [];
    w.forEach((fn) => fn(n));
  }

  /* Try everything now. Resolves with how many photos are still not through (0 = all good). */
  function flush() {
    return new Promise((resolve) => {
      if (!queue.length && !busy) { resolve(0); return; }
      waiters.push(resolve);
      if (!busy) { attempt = 0; kick(); }
    });
  }

  function uploadsLeft() { return queue.filter((o) => o.type === "upload").length; }

  /* Give up on photos that still haven't gone through. */
  function dropPending() {
    clearTimeout(timer);
    queue.forEach((o) => {
      if (o.type === "upload") { o.item.msg = T.rejected; o.item.file = o.item.blob = null; setState(o.item, "error"); }
    });
    queue = [];
    onChange();
  }

  function queueCaption(it) {
    if (queue.some((o) => o.item === it && o.type !== "upload")) return;
    queue.push({ type: "caption", item: it });
    kick();
  }

  /* ---------- actions ---------- */

  function pick(slot, fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const roomSlot = MAX_PER_SLOT - count(slot);
    const roomTotal = MAX_TOTAL - count();
    const room = Math.max(0, Math.min(roomSlot, roomTotal));
    files.slice(0, room).forEach((f) => {
      const it = { id: uuid(), slot, caption: "", sentCaption: "", state: "queued", progress: 0, file: f };
      items.push(it);
      queue.push({ type: "upload", item: it });
      makeThumb(it);
    });
    if (files.length > room) note(slot, roomTotal < roomSlot ? T.totalFull(MAX_TOTAL) : T.full(MAX_PER_SLOT));
    else note(slot, "");
    drawSlot(slot);
    onChange();
    kick();
  }

  function remove(it) {
    const q = queue.findIndex((o) => o.item === it && o.type === "upload");
    const started = q === 0 && busy;
    if (it.state === "done") {
      it.removed = true;
      queue = queue.filter((o) => o.item !== it || (o.type === "remove"));
      queue.push({ type: "remove", item: it });
      persist();
      kick();
    } else if (started) {
      it.removed = true;               // removed on the server once its upload lands
    } else {
      queue = queue.filter((o) => o.item !== it);
      items = items.filter((i) => i !== it);
    }
    it.removed = true;
    note(it.slot, "");
    drawSlot(it.slot);
    onChange();
  }

  function setCaption(it, v) {
    it.caption = v;
    if (it.state === "done") { persist(); queueCaption(it); }
  }

  /* ---------- view ---------- */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function setState(it, s) {
    it.state = s;
    if (s === "done") it.progress = 100;
    if (s !== "uploading") stopProgress(it);
    paint(it);
  }

  function startProgress(it) {
    stopProgress(it);
    it.progress = Math.max(it.progress || 0, 8);
    it.tick = setInterval(() => {
      it.progress += (92 - it.progress) * 0.06;
      paint(it);
    }, 250);
  }

  function stopProgress(it) {
    if (it.tick) { clearInterval(it.tick); it.tick = null; }
  }

  function statusText(it) {
    switch (it.state) {
      case "queued": return String(ctx().name || "").trim() ? T.waiting : T.needName;
      case "processing": return T.processing;
      case "uploading": return T.uploading;
      case "done": return T.done;
      case "retry": return T.retry;
      case "error": return it.msg || T.rejected;
      default: return "";
    }
  }

  function itemEl(it) {
    if (it.el) return it.el;
    const row = el("div", "ph");
    const frame = el("div", "ph-img");
    const status = el("div", "ph-status");
    const bar = el("div", "ph-bar");
    const fill = el("i");
    bar.appendChild(fill);
    const x = el("button", "ph-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", T.remove);
    x.addEventListener("click", () => remove(it));
    const body = el("div", "ph-body");
    const cap = el("input", "text ph-cap");
    cap.type = "text";
    cap.maxLength = 150;
    cap.placeholder = T.caption;
    cap.setAttribute("aria-label", T.caption);
    cap.value = it.caption || "";
    let t = null;
    cap.addEventListener("input", () => {
      it.caption = cap.value;
      clearTimeout(t);
      t = setTimeout(() => setCaption(it, cap.value), 900);
    });
    cap.addEventListener("change", () => { clearTimeout(t); setCaption(it, cap.value); });
    frame.appendChild(bar);
    body.appendChild(cap);
    body.appendChild(status);
    row.appendChild(frame);
    row.appendChild(body);
    row.appendChild(x);
    it.el = row;
    it.refs = { frame, status, fill, bar, cap };
    paint(it);
    return row;
  }

  function paint(it) {
    if (!it.refs) return;
    const r = it.refs;
    if (it.thumb && !r.img) {
      const img = el("img");
      img.src = it.thumb;
      img.alt = "";
      r.frame.insertBefore(img, r.frame.firstChild);
      r.img = img;
      if (r.ph) { r.ph.remove(); r.ph = null; }
    } else if (!it.thumb && !r.ph && (it.undecodable || it.state === "done" || it.state === "error")) {
      r.ph = el("span", "ph-placeholder", "📷");
      r.ph.setAttribute("aria-hidden", "true");
      r.frame.insertBefore(r.ph, r.frame.firstChild);
    }
    r.status.textContent = statusText(it);
    r.status.className = "ph-status" + (it.state === "error" ? " is-error" : it.state === "done" ? " is-done" : "");
    r.fill.style.width = Math.round(it.progress || 0) + "%";
    r.bar.hidden = it.state === "done" || it.state === "error";
    r.cap.hidden = it.state === "error";
  }

  function note(slot, msg) {
    const s = slotEls[slot];
    if (s) s.note.textContent = msg;
  }

  function drawSlot(slot) {
    const s = slotEls[slot];
    if (!s) return;
    const list = items.filter((i) => i.slot === slot && !i.removed);
    while (s.list.firstChild) s.list.removeChild(s.list.firstChild);
    list.forEach((i) => s.list.appendChild(itemEl(i)));
    const n = count(slot);
    s.add.hidden = n >= MAX_PER_SLOT || count() >= MAX_TOTAL;
    s.addCount.textContent = ` (${n}/${MAX_PER_SLOT})`;
  }

  /* A taped photo frame for one slot. `labelId` ties the add button to the prompt. */
  function renderSlot(slot, labelId) {
    const list = el("div", "ph-list");
    const add = el("label", "add-photo");
    const input = el("input", "sr-only");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.setAttribute("aria-describedby", labelId);
    input.addEventListener("change", () => {
      pick(slot.id, input.files);
      try { input.value = ""; } catch (e) { /* ignore */ }
    });
    const plus = el("span", "add-plus", "+");
    plus.setAttribute("aria-hidden", "true");
    const addCount = el("span", "add-count");
    add.appendChild(input);
    add.appendChild(plus);
    add.appendChild(document.createTextNode(T.add));
    add.appendChild(addCount);
    const noteEl = el("div", "slot-note");
    noteEl.setAttribute("aria-live", "polite");
    const wrap = el("div", "slot");
    wrap.appendChild(list);
    wrap.appendChild(add);
    wrap.appendChild(noteEl);
    slotEls[slot.id] = { list, add, addCount, note: noteEl };
    drawSlot(slot.id);
    return wrap;
  }

  window.addEventListener("online", () => { if (queue.length && !busy) { attempt = 0; kick(); } });

  return { init, load, reset, renderSlot, count, flush, dropPending, uploadsLeft };
})();
