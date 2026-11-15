/*
 * Flow, routing, rendering and local autosave for the birthday surprise.
 * All wording and questions come from questions.js.
 */
(function () {
  "use strict";

  const $app = document.getElementById("app");
  const $top = document.getElementById("top");
  const $counter = document.getElementById("counter");
  const $fill = document.getElementById("progressFill");
  const $bar = document.getElementById("progressBar");
  const $status = document.getElementById("saveStatus");
  const reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const S = {
    key: null,
    rid: null,
    answers: {},
    pos: null,
    dir: 1,
    dirty: false,
    lastSec: null,
    started: false,
  };

  // What is on screen right now: conditional blocks, required questions, the Next button and its hint, timers.
  let live = { conds: [], required: [], next: null, hint: null, timers: [], cards: 0 };
  let mode = "other";  // "welcome", "form", "fail" (could not send), or "other" (sending, thank-you, message screens)

  /* ================= helpers ================= */

  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "value") el.value = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    add(el, kids);
    return el;
  }

  function add(el, kids) {
    if (kids == null || kids === false) return;
    if (Array.isArray(kids)) kids.forEach((k) => add(el, k));
    else el.appendChild(typeof kids === "string" ? document.createTextNode(kids) : kids);
  }

  function hash(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }

  /* Tilt (-1° to 1°), tape angle and tape colour, stable per card. */
  function cardStyle(id, flat) {
    const x = hash(id);
    const tilt = flat ? 0 : ((x % 21) - 10) / 10;
    const rot = ((x >>> 5) % 9) - 4;
    const tape = (x >>> 9) % 2 ? "var(--tape1)" : "var(--tape2)";
    return `--tilt:${tilt}deg;--tape-rot:${rot}deg;--tape:${tape}`;
  }

  function card(id, kids, opts) {
    opts = opts || {};
    return h("div", {
      class: "card" + (opts.flat ? " flat" : "") + (opts.cls ? " " + opts.cls : ""),
      style: cardStyle(id, opts.flat) + `;--i:${opts.i || 0}`,
    }, kids);
  }

  const ARROW = '<svg class="arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_BACK = '<svg class="arrow" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function primaryBtn(label, onClick, opts) {
    opts = opts || {};
    const b = h("button", { type: "button", class: "btn-primary" + (opts.cls ? " " + opts.cls : ""), onclick: onClick });
    b.appendChild(document.createTextNode(label));
    if (opts.arrow) b.insertAdjacentHTML("beforeend", ARROW);
    return b;
  }

  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function isEmpty(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.every((x) => !String(x || "").trim());
    if (typeof v === "object") return !Object.keys(v).length;
    return !String(v).trim();
  }

  function deadlinePassed() {
    const t = new Date(CONFIG.DEADLINE_ISO).getTime();
    return !isNaN(t) && Date.now() > t;
  }

  function deadlineLabel() {
    const l = String(CONFIG.DEADLINE_LABEL || "");
    return /^TODO/.test(l) ? "" : l;
  }

  function shareLink() {
    return location.origin + location.pathname + "?k=" + encodeURIComponent(S.key || "");
  }

  /* ================= answers ================= */

  /* Which section each answer belongs to, so a save can go out when someone moves on to the next one. */
  const SEC_OF = {};
  SECTIONS.forEach((sec) => sec.groups.forEach((g) => (g.questions || []).forEach((q) => {
    SEC_OF[q.id] = sec.id;
    if (q.otherKey) SEC_OF[q.otherKey] = sec.id;
  })));

  function setA(id, v) {
    const sec = SEC_OF[id];
    if (S.dirty && S.lastSec && sec !== S.lastSec) saveRemote();  // the previous section is done: push it
    S.lastSec = sec;
    if (isEmpty(v)) delete S.answers[id];
    else S.answers[id] = v;
    S.dirty = true;
    Store.set("answers", S.answers);
    refresh();
  }

  /* The pages, each with its sections (hidden ones included: they are toggled live). */
  function pages() {
    return PAGES.map((ids, i) => ({
      key: "p" + (i + 1), i, ids,
      secs: ids.map((id) => SECTIONS.find((x) => x.id === id)),
    }));
  }

  function optionVisible(o) { return !o.when || o.when(S.answers); }

  /* A sliders answer is { option: "0".."100" }; anything else (an old draft) counts as empty. */
  function levelsOf(q) {
    const v = S.answers[q.id];
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }

  function serialize(q) {
    const a = S.answers;
    const v = a[q.id];
    if (q.type === "sliders") {
      const lv = levelsOf(q);
      const parts = q.options.filter(optionVisible).filter((o) => lv[o.v]).map((o) => `${o.v}: ${lv[o.v]}%`);
      const other = String(a[q.otherKey] || "").trim();
      if (other) parts.push("Other: " + other);
      return parts.join("; ");
    }
    if (q.type === "three") return (Array.isArray(v) ? v : []).map((x) => String(x || "").trim()).filter(Boolean).join(", ");
    if (q.style === "emoji") return String(v || a[q.otherKey] || "").trim();
    if (q.otherKey && v === "Other") return String(a[q.otherKey] || "").trim() ? "Other: " + String(a[q.otherKey]).trim() : "Other";
    return v == null ? "" : String(v).trim();
  }

  /* The back end takes 5,000 characters per answer; some browsers count emoji as one when limiting a box. */
  const MAX_VALUE = 5000;
  function clip(s) {
    if (s.length <= MAX_VALUE) return s;
    const c = s.charCodeAt(MAX_VALUE - 1);
    return s.slice(0, c >= 0xd800 && c <= 0xdbff ? MAX_VALUE - 1 : MAX_VALUE);  // never cut an emoji in half
  }

  /* Field id → value for the Sheet. Anything hidden by routing goes as blank. */
  function exportAnswers() {
    const a = S.answers;
    const out = {};
    SECTIONS.forEach((sec) => {
      const sv = !sec.when || sec.when(a);
      sec.groups.forEach((g) => {
        const gv = sv && (!g.when || g.when(a));
        (g.questions || []).forEach((q) => {
          const qv = gv && (!q.when || q.when(a));
          out[q.id] = qv ? clip(serialize(q)) : "";
        });
      });
    });
    return out;
  }

  function payload(completed) {
    return {
      action: "save",
      key: S.key,
      response_id: S.rid,
      answers: exportAnswers(),
      completed: !!completed,
      is_test: IS_TEST,
    };
  }

  function saveRemote(opts) {
    if (!S.answers.name) return;
    S.dirty = false;
    API.save(payload(false), opts).catch(() => {});
  }

  /* ================= header ================= */

  function setHeader(item, total) {
    if (!item) { $top.hidden = true; return; }
    $top.hidden = false;
    const pct = Math.round(((item.i + 0.5) / total) * 100);
    $counter.textContent = COPY.counter(item.i + 1, total);
    $fill.style.width = pct + "%";
    $bar.setAttribute("aria-valuenow", String(pct));
  }

  function setStatus(s) {
    $status.textContent = s ? COPY.status[s] : "";
    $status.className = "save-status" + (s ? " is-" + s : "");
  }

  /* ================= screen plumbing ================= */

  function clearLive() {
    live.timers.forEach((t) => clearInterval(t));
    live = { conds: [], required: [], next: null, hint: null, timers: [], cards: 0 };
  }

  function show(screen) {
    screen.classList.add(S.dir < 0 ? "from-left" : "from-right");
    while ($app.firstChild) $app.removeChild($app.firstChild);
    $app.appendChild(screen);
    window.scrollTo(0, 0);
    const head = screen.querySelector("h1");
    if (head) { head.setAttribute("tabindex", "-1"); try { head.focus({ preventScroll: true }); } catch (e) { head.focus(); } }
    refresh();
  }

  function refresh() {
    live.conds.forEach((c) => { c.el.hidden = !c.when(S.answers); });
    const miss = missing();
    if (live.next) live.next.disabled = !!miss;
    if (live.hint) {
      live.hint.hidden = !miss;
      if (miss) live.hint.textContent = COPY.missing(miss.label);
    }
  }

  function missing() {
    return live.required.find((q) => isEmpty(S.answers[q.id])) || null;
  }

  function scrollToMissing() {
    const q = missing();
    const el = q && (document.getElementById("q-" + q.id) || document.getElementById("q-" + q.id + "-l"));
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    if (el.matches("input, textarea")) el.focus({ preventScroll: true });
  }

  /* ================= question renderers ================= */

  function label(q, id) {
    return h("label", { class: "q-label", for: id, id: id + "-l" }, [
      q.label,
      q.required ? h("span", { class: "req", "aria-hidden": "true", text: "\u00a0*" }) : null,
    ]);
  }

  function groupLabel(q, id) {
    return h("div", { class: "q-label", id: id }, [
      q.label,
      q.required ? h("span", { class: "req", "aria-hidden": "true", text: "\u00a0*" }) : null,
    ]);
  }

  function sub(q) {
    return q.sub ? h("div", { class: "q-sub", text: q.sub }) : null;
  }

  function autogrow(ta) {
    const fit = () => { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 130) + "px"; };
    ta.addEventListener("input", fit);
    requestAnimationFrame(fit);
  }

  function renderText(q) {
    const id = "q-" + q.id;
    const wrap = h("div", { class: "q q-" + q.type });
    const v = S.answers[q.id] || "";
    let input;
    if (q.type === "long") {
      input = h("textarea", {
        id, class: "text", rows: "4", maxlength: String(q.maxLength || 5000), value: v,
        "aria-required": q.required ? "true" : null,
      });
      autogrow(input);
      if (q.hints && q.hints.length) {
        let i = 0;
        input.placeholder = q.hints[0];
        const t = setInterval(() => {
          if (input.value) { clearInterval(t); return; }
          i = (i + 1) % q.hints.length;
          input.placeholder = q.hints[i];
        }, 2600);
        live.timers.push(t);
      }
    } else {
      input = h("input", {
        id, class: "text", type: "text", maxlength: String(q.maxLength || 500), value: v,
        autocomplete: q.autocomplete || "off", enterkeyhint: "next",
        "aria-required": q.required ? "true" : null,
        placeholder: q.example ? "e.g. " + q.example : null,
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    }
    let counter = null;
    if (q.counter) {
      counter = h("div", { class: "q-counter", "aria-live": "polite", text: `${v.length}/${q.maxLength}` });
    }
    input.addEventListener("input", () => {
      setA(q.id, input.value);
      if (counter) counter.textContent = `${input.value.length}/${q.maxLength}`;
    });
    add(wrap, [label(q, id), sub(q), input, counter]);
    return wrap;
  }

  function renderThree(q) {
    const id = "q-" + q.id;
    const vals = Array.isArray(S.answers[q.id]) ? S.answers[q.id].slice() : ["", "", ""];
    const row = h("div", { class: "three" });
    [0, 1, 2].forEach((i) => {
      const inp = h("input", {
        class: "text", type: "text", maxlength: "60", value: vals[i] || "", autocomplete: "off",
        "aria-label": `${q.label}: word ${i + 1}`, placeholder: `Word ${i + 1}`, id: i === 0 ? id : null,
      });
      inp.addEventListener("input", () => { vals[i] = inp.value; setA(q.id, vals.slice()); });
      row.appendChild(inp);
    });
    return h("div", { class: "q q-three" }, [label(q, id), sub(q), row]);
  }

  function swipe(btn) {
    if (reduceMotion) return;
    btn.classList.remove("swipe");
    void btn.offsetWidth;
    btn.classList.add("swipe");
  }

  function optText(o) { return (o.label || o.v) + (o.e ? " " + o.e : ""); }

  function renderSingle(q) {
    const lid = "q-" + q.id + "-l";
    const style = q.style || "list";
    const opts = q.options.filter(optionVisible);
    const wrap = h("div", { class: "q q-single style-" + style });
    const group = h("div", { class: "opts " + style, role: "group", "aria-labelledby": lid });
    const btns = [];
    let otherInput = null;
    let extra = null;

    function sync() {
      const cur = S.answers[q.id];
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
      if (otherInput && q.style !== "emoji") otherInput.parentNode.hidden = cur !== "Other";
      if (extra) extra(cur);
    }

    opts.forEach((o) => {
      let inner;
      if (style === "cards") inner = [h("span", { class: "big-emoji", "aria-hidden": "true", text: o.e }), h("span", { text: o.v })];
      else if (style === "posters") inner = [h("span", { class: "poster-emoji", "aria-hidden": "true", text: o.e }), h("span", { class: "poster-title", text: o.v })];
      else if (style === "emoji") inner = o.v;
      else inner = optText(o);
      const b = h("button", {
        type: "button", class: "opt", "data-v": o.v, "aria-pressed": "false",
        "aria-label": style === "emoji" ? "Emoji " + o.v : null,
        onclick: () => {
          const now = S.answers[q.id] === o.v ? null : o.v;
          setA(q.id, now);
          if (now && q.otherKey && style === "emoji") { setA(q.otherKey, null); if (otherInput) otherInput.value = ""; }
          if (now) swipe(b);
          sync();
          if (now && o.other && otherInput) otherInput.focus();
        },
      }, inner);
      btns.push(b);
      group.appendChild(b);
    });

    add(wrap, [groupLabel(q, lid), sub(q)]);

    if (style === "kids") {
      const icons = h("div", { class: "kids-icons", "aria-hidden": "true" });
      const babies = [0, 1, 2, 3].map(() => h("span", { class: "baby", text: "👶" }));
      const pet = h("span", { class: "baby pet", text: "🐶" });
      const plus = h("span", { class: "baby plus", text: "+" });
      add(icons, [pet, babies, plus]);
      extra = (cur) => {
        const n = cur === "4+" ? 4 : parseInt(cur, 10) || 0;
        pet.classList.toggle("on", cur === "0");
        babies.forEach((b, i) => b.classList.toggle("on", i < n));
        plus.classList.toggle("on", cur === "4+");
        icons.classList.toggle("is-empty", !cur);
      };
      wrap.appendChild(icons);
    }

    wrap.appendChild(group);

    if (q.otherKey) {
      const oid = "q-" + q.otherKey;
      otherInput = h("input", {
        id: oid, class: "text", type: "text", maxlength: "100", autocomplete: "off",
        value: S.answers[q.otherKey] || "",
        placeholder: style === "emoji" ? "🙂" : COPY.otherPlaceholder,
      });
      otherInput.addEventListener("input", () => {
        setA(q.otherKey, otherInput.value);
        if (style === "emoji" && otherInput.value.trim() && S.answers[q.id]) { setA(q.id, null); sync(); }
      });
      const lab = h("label", { class: "q-sub other-label", for: oid, text: style === "emoji" ? COPY.emojiOther : "Other" });
      wrap.appendChild(h("div", { class: "other-box" }, [lab, otherInput]));
    }
    sync();
    return wrap;
  }

  function pop(el) {
    if (reduceMotion) return;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }

  /*
   * A smooth 0–100 slider that starts unset: the thumb is ghosted in the middle until the first touch.
   * `labels` name equal zones along the track. opts: { labelledby, labels, get(), set(v or null), onSync(isSet) }
   */
  function slider(opts) {
    const MID = "50";
    const zone = (v) => Math.round((Number(v) / 100) * (opts.labels.length - 1));
    const isSet = (v) => v != null && v !== "";
    const input = h("input", {
      type: "range", class: "slider", min: "0", max: "100", step: "1", "aria-labelledby": opts.labelledby,
    });
    const out = h("span", { class: "slider-value", "aria-live": "polite" });
    const clear = h("button", {
      type: "button", class: "slider-clear", "aria-label": COPY.clear, text: "✕",
      onclick: () => { opts.set(null); sync(); },
    });
    let before;      // the answer when a touch began, in case it turns into a page scroll
    let shown = -1;  // the zone whose label is showing

    function sync() {
      const cur = opts.get();
      const on = isSet(cur);
      const z = on ? zone(cur) : -1;
      input.value = on ? cur : MID;
      input.classList.toggle("unset", !on);
      input.style.setProperty("--pct", on ? String(Number(cur) / 100) : "0");
      input.setAttribute("aria-valuetext", on ? opts.labels[z] : COPY.notAnswered);
      clear.hidden = !on;
      if (z !== shown) {
        out.textContent = on ? opts.labels[z] : "";
        if (on) pop(out);
        shown = z;
      }
      if (opts.onSync) opts.onSync(on);
    }
    function commit() {
      if (opts.get() !== input.value) opts.set(input.value);
      sync();
    }
    ["input", "change", "click", "pointerup"].forEach((e) => input.addEventListener(e, commit));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); commit(); } });
    input.addEventListener("pointerdown", () => { const v = opts.get(); before = isSet(v) ? v : null; });
    input.addEventListener("pointercancel", () => { opts.set(before); sync(); });
    sync();
    return { input, out, clear };
  }

  function renderScale(q) {
    const lid = "q-" + q.id + "-l";
    const ends = h("div", { class: "slider-ends", "aria-hidden": "true" }, [
      h("span", { text: COPY.scale[0] }), h("span", { text: COPY.scale[COPY.scale.length - 1] }),
    ]);
    const s = slider({
      labelledby: lid, labels: COPY.scale,
      get: () => S.answers[q.id],
      set: (v) => setA(q.id, v),
      onSync: (on) => { ends.hidden = on; },
    });
    return h("div", { class: "q q-scale" }, [
      groupLabel(q, lid), s.input, h("div", { class: "slider-foot" }, [ends, s.out, s.clear]),
    ]);
  }

  function renderSliders(q) {
    const lid = "q-" + q.id + "-l";
    const wrap = h("div", { class: "q q-sliders", role: "group", "aria-labelledby": lid }, [groupLabel(q, lid), sub(q)]);
    q.options.filter(optionVisible).forEach((o, i) => {
      const rid = "q-" + q.id + "-" + i;
      const ends = h("div", { class: "slider-ends", "aria-hidden": "true" }, [
        h("span", { text: q.levels[0] }), h("span", { text: q.levels[q.levels.length - 1] }),
      ]);
      const s = slider({
        labelledby: rid, labels: q.levels,
        get: () => levelsOf(q)[o.v],
        set: (v) => {
          const all = Object.assign({}, levelsOf(q));
          if (v != null && v !== "") all[o.v] = v; else delete all[o.v];
          setA(q.id, all);
        },
        onSync: (on) => { ends.hidden = on; },
      });
      // The answer sits under the track, in a row of fixed height, so nothing shifts while a finger is dragging.
      wrap.appendChild(h("div", { class: "srow", "data-v": o.v }, [
        h("div", { class: "srow-label", id: rid, text: optText(o) }),
        s.input,
        h("div", { class: "slider-foot" }, [ends, s.out, s.clear]),
      ]));
    });
    if (q.otherKey) {
      const oid = "q-" + q.otherKey;
      const input = h("input", {
        id: oid, class: "text", type: "text", maxlength: "100", autocomplete: "off",
        value: S.answers[q.otherKey] || "", placeholder: COPY.otherPlaceholder,
      });
      input.addEventListener("input", () => setA(q.otherKey, input.value));
      wrap.appendChild(h("div", { class: "other-box" }, [h("label", { class: "q-sub other-label", for: oid, text: q.otherLabel }), input]));
    }
    return wrap;
  }

  /* One "has she ever" statement: Yes / No / No comment, with a one-line reaction. */
  function renderEver(q, idx, total) {
    const lid = "q-" + q.id + "-l";
    const reaction = h("span", { class: "reaction", "aria-live": "polite" });
    const btns = COPY.everButtons.map((o) => {
      const b = h("button", {
        type: "button", class: "opt", "data-v": o.v, "aria-pressed": String(S.answers[q.id] === o.v),
        onclick: () => {
          const now = S.answers[q.id] === o.v ? null : o.v;
          setA(q.id, now);
          btns.forEach((x) => x.setAttribute("aria-pressed", String(!!now && x === b)));
          reaction.textContent = now ? pickRandom(COPY.everReactions[now]) : "";
          if (now) { swipe(b); pop(reaction); }
        },
      }, o.label);
      return b;
    });
    return h("div", { class: "q q-ever" }, [
      h("div", { class: "ever-top" }, [h("span", { class: "ever-count", text: `${idx + 1} / ${total}` }), reaction]),
      h("div", { class: "q-label", id: lid, text: q.label }),
      h("div", { class: "ever-btns", role: "group", "aria-labelledby": lid }, btns),
    ]);
  }

  function renderQ(q, g) {
    if (q.type === "short" || q.type === "long") return renderText(q);
    if (q.type === "three") return renderThree(q);
    if (q.type === "single") return renderSingle(q);
    if (q.type === "scale5") return renderScale(q);
    if (q.type === "sliders") return renderSliders(q);
    if (q.type === "ever") {
      const all = g.questions.filter((x) => x.type === "ever");
      return renderEver(q, all.indexOf(q), all.length);
    }
    return h("div");
  }

  const FLAT_TYPES = ["short", "long", "three", "sliders"];  // no tilt: inputs and long cards stay straight
  const COMPACT_TYPES = ["scale5", "ever"];

  /* Questions in a group; `attach: true` puts a question in the previous card. */
  function renderQuestions(g, into, list) {
    let cur = null;
    (list || g.questions).forEach((q) => {
      const el = renderQ(q, g);
      if (q.attach && cur) cur.appendChild(el);
      else {
        const cls = [g.cardClass, COMPACT_TYPES.indexOf(q.type) >= 0 ? "compact" : ""].filter(Boolean).join(" ");
        cur = card(q.id, el, { flat: FLAT_TYPES.indexOf(q.type) >= 0, cls, i: Math.min(live.cards++, 6) });
        into.appendChild(cur);
      }
      if (q.when) live.conds.push({ el: q.attach ? el : cur, when: q.when });
      if (q.required) live.required.push(q);
    });
  }

  /* ================= navigation ================= */

  function current() {
    const list = pages();
    const key = String(S.pos || "").split(":")[0];  // older drafts stored a section, or "section:screen"
    let i = list.findIndex((x) => x.key === key || x.ids.indexOf(key) >= 0);
    if (i < 0) i = 0;
    return { list, i, item: list[i] };
  }

  /*
   * The phone's Back button. Each page is a history entry ({ bs: page, prev: the entry under it, n: depth }),
   * so Back shows the previous page instead of closing the site. If the browser refuses, the on-screen
   * buttons still work on their own.
   */
  function hstate() { try { return history.state || null; } catch (e) { return null; } }
  function hpush(key) {
    try {
      const st = hstate();
      history.pushState({ bs: key, prev: (st && st.bs) || "welcome", n: ((st && st.n) || 0) + 1 }, "");
    } catch (e) { /* on-screen navigation only */ }
  }
  function hreplace(key) {
    try {
      const st = hstate();
      history.replaceState({ bs: key, prev: (st && st.prev) || null, n: (st && st.n) || 0 }, "");
    } catch (e) { /* ignore */ }
  }
  /* Back to the entry the site was opened on, so Back on the thank-you screen leaves in one go. */
  function hrewind() {
    try { const st = hstate(); if (st && st.n > 0) history.go(-st.n); } catch (e) { /* ignore */ }
  }

  function onPop(e) {
    if (mode === "other") return;
    const key = e.state && e.state.bs;
    const list = pages();
    const target = list.find((x) => x.key === key);
    const from = mode === "form" ? current().i : -1;
    if (mode === "form") saveRemote();
    if (target) {
      S.dir = target.i < from ? -1 : 1;
      S.pos = target.key;
      Store.set("pos", S.pos);
      render();
    } else {
      S.dir = -1;
      renderWelcome();
    }
  }

  /* The first page that still has an unanswered required question (an older draft, or the phone's Forward button). */
  function firstGap() {
    const a = S.answers;
    const on = (x) => !x.when || x.when(a);
    return pages().find((pg) => pg.secs.some((sec) => on(sec) && sec.groups.some((g) => on(g) &&
      (g.questions || []).some((q) => q.required && on(q) && isEmpty(a[q.id]))))) || null;
  }

  function go(delta) {
    const { list, i, item } = current();
    const nxt = list[i + delta];
    S.dir = delta;
    if (!nxt && delta > 0) {
      const gap = firstGap();
      if (!gap) { finish(); return; }
      S.dir = -1;
      S.pos = gap.key;
      Store.set("pos", S.pos);
      hreplace(gap.key);
      render();
      setTimeout(scrollToMissing, 60);
      return;
    }
    const st = hstate();
    const viaHistory = delta < 0 && st && st.n > 0 && st.bs === item.key && st.prev === (nxt ? nxt.key : "welcome");
    if (viaHistory) { history.back(); return; }  // onPop draws the page
    if (!nxt) { hreplace("welcome"); renderWelcome(); return; }
    saveRemote();
    S.pos = nxt.key;
    Store.set("pos", S.pos);
    if (delta > 0) hpush(nxt.key); else hreplace(nxt.key);
    render();
  }

  function nav(last) {
    const back = h("button", { type: "button", class: "btn-back", onclick: () => go(-1) });
    back.insertAdjacentHTML("beforeend", ARROW_BACK);
    back.appendChild(h("span", { text: COPY.back }));
    const next = primaryBtn(last ? COPY.submit : COPY.next, () => go(1), { arrow: !last });
    next.classList.add("nav-next");
    live.next = next;
    live.hint = h("button", { type: "button", class: "link-btn nav-hint", hidden: true, onclick: scrollToMissing });
    return [h("div", { class: "nav" }, [back, next]), live.hint];
  }

  /* ================= page ================= */

  function render() {
    clearLive();
    const { list, i, item } = current();
    if (!item) { renderWelcome(); return; }
    mode = "form";
    S.pos = item.key;
    setHeader(item, list.length);
    const screen = h("section", { class: "screen" });
    item.secs.forEach((sec, n) => {
      const box = h("div", { class: "sec" }, h("header", { class: "sec-head" }, [
        h(n ? "h2" : "h1", { class: "sec-title" }, [h("span", { text: sec.title }), " " + sec.emoji]),
        h("p", { class: "intro", text: sec.intro }),
      ]));
      sec.groups.forEach((g) => {
        const gb = h("div", { class: "group" });
        if (g.heading) gb.appendChild(h(n ? "h3" : "h2", { class: "group-head", text: g.heading }));
        if (g.kind === "photos") renderPhotos(g, gb);
        else renderQuestions(g, gb);
        if (g.when) live.conds.push({ el: gb, when: g.when });
        box.appendChild(gb);
      });
      if (sec.when) live.conds.push({ el: box, when: sec.when });
      screen.appendChild(box);
    });
    const last = i === list.length - 1;
    if (last) add(screen, photoNudge(item));
    add(screen, nav(last));
    show(screen);
  }

  /* Last page only, and only when no photo has been added: a reminder that opens the photo prompts in place. */
  function photoNudge(item) {
    const sec = SECTIONS.find((x) => x.id === "photos");
    const g = sec && sec.groups.find((x) => x.kind === "photos");
    if (!g || item.ids.indexOf("photos") >= 0 || Photos.count() > 0) return null;
    const T = COPY.photoNudge;
    const box = h("div", { class: "nudge" });
    const open = h("button", { type: "button", class: "btn-secondary", text: T.button, onclick: () => {
      const body = h("div", { class: "group" });
      renderPhotos(g, body);
      box.replaceChild(body, open);
      box.removeChild(text);
      refresh();
    } });
    const text = h("p", { class: "nudge-text", text: T.text });
    add(box, [h("h2", { class: "nudge-title", text: T.title }), text, open]);
    return box;
  }

  function renderPhotos(g, into) {
    g.slots.forEach((slot) => {
      const lid = "slot-" + slot.id;
      into.appendChild(card("slot-" + slot.id, [
        h("div", { class: "q-label", id: lid, text: slot.label }),
        slot.sub ? h("div", { class: "q-sub", text: slot.sub }) : null,
        Photos.renderSlot(slot, lid),
      ], { cls: "photo-frame", i: Math.min(live.cards++, 6) }));
      const after = g.questions.filter((q) => q.afterSlot === slot.id);
      if (after.length) renderQuestions(g, into, after);
    });
  }

  /* ================= welcome / end screens ================= */

  function simpleScreen(kids, cls) {
    clearLive();
    mode = cls === "welcome" ? "welcome" : "other";
    setHeader(null);
    const screen = h("section", { class: "screen solo " + (cls || "") }, kids);
    show(screen);
    return screen;
  }

  function renderWelcome() {
    const hasDraft = Object.keys(S.answers).length > 0 && S.pos;
    const label = deadlineLabel();
    const start = () => {
      S.dir = 1;
      S.started = true;
      S.pos = pages()[0].key;
      Store.set("pos", S.pos);
      hpush(S.pos);
      render();
    };
    const resume = () => {
      S.dir = 1;
      S.started = true;
      hpush(current().item.key);
      render();
    };
    const fresh = () => { newResponse(); renderWelcome(); };

    simpleScreen([
      card("welcome", [
        h("div", { class: "title-emoji big", "aria-hidden": "true", text: "🎈🎉" }),
        h("h1", { class: "welcome-title" }, h("span", { text: CONFIG.TITLE })),
        h("p", { class: "welcome-text", text: COPY.welcomeText }),
        label ? h("p", { class: "deadline", text: COPY.deadline(label) }) : null,
      ], { cls: "welcome-card" }),
      hasDraft
        ? card("resume", [
          h("p", { class: "resume-q", text: COPY.resumeQ }),
          primaryBtn(COPY.resumeYes, resume),
          h("button", { type: "button", class: "btn-secondary", text: COPY.resumeNo, onclick: fresh }),
        ], { cls: "resume-card", i: 1 })
        : primaryBtn(COPY.welcomeButton, start, { cls: "go" }),
    ], "welcome");
  }

  function renderMessage(emoji, text) {
    simpleScreen([card("msg", [
      h("div", { class: "title-emoji big", "aria-hidden": "true", text: emoji }),
      h("h1", { class: "msg-text", text }),
    ], { cls: "msg-card" })], "message");
  }

  function renderIncomplete() { renderMessage("🔗", COPY.incomplete); }
  function renderClosed() { renderMessage("🎈", COPY.closed); }

  function renderSending(text) {
    simpleScreen([card("sending", [
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("h1", { class: "msg-text", text: text || COPY.sending }),
    ], { cls: "msg-card" })], "message");
  }

  function renderSendFail(text, actions) {
    simpleScreen([card("fail", [
      h("div", { class: "title-emoji big", "aria-hidden": "true", text: "📶" }),
      h("h1", { class: "msg-text", text }),
      actions,
    ], { cls: "msg-card" })], "message");
    mode = "fail";  // the phone's Back button returns to the form from here
  }

  async function finish(skipPhotos) {
    S.dir = 1;
    if (!skipPhotos) {
      const left = Photos.uploadsLeft();
      renderSending(left ? COPY.sendingPhotos(left) : COPY.sending);
      const stuck = await Photos.flush();
      if (stuck > 0) {
        renderSendFail(COPY.photoFail(stuck), [
          primaryBtn(COPY.tryAgain, () => finish()),
          h("button", { type: "button", class: "btn-secondary", text: COPY.finishWithout, onclick: () => { Photos.dropPending(); finish(true); } }),
          h("button", { type: "button", class: "link-btn", text: COPY.back, onclick: () => render() }),
        ]);
        return;
      }
    }
    renderSending(COPY.sending);
    try {
      await API.save(payload(true));
    } catch (e) {
      if (API.isFatal(e.code)) return;  // the fatal handler already switched screens
      renderSendFail(COPY.sendFail, [
        primaryBtn(COPY.tryAgain, () => finish(true)),
        h("button", { type: "button", class: "link-btn", text: COPY.back, onclick: () => render() }),
      ]);
      return;
    }
    // Done: forget the draft, remember that this device finished.
    Store.set("done", true);
    clearDraft();
    renderThanks(true);
    hrewind();
  }

  function clearDraft() {
    Store.del("answers");
    Store.del("pos");
    Store.del("rid");
    Photos.reset();
    S.answers = {};
    S.pos = null;
    S.rid = null;
    S.dirty = false;
  }

  function newResponse() {
    clearDraft();
    S.rid = uuid();
    Store.set("rid", S.rid);
    Photos.load();
  }

  function renderThanks(celebrate) {
    const msg = h("h1", { class: "msg-text thanks-text", text: "🎉" });
    const label = deadlineLabel();
    const wa = "https://wa.me/?text=" + encodeURIComponent(COPY.shareText(label, shareLink()));
    const share = h("a", { class: "btn-primary btn-wa", href: wa, target: "_blank", rel: "noopener" }, COPY.share);
    simpleScreen([card("thanks", [
      h("div", { class: "title-emoji big", "aria-hidden": "true", text: "🥳" }),
      msg,
      share,
    ], { cls: "msg-card thanks-card" }),
    h("button", {
      type: "button", class: "link-btn another", text: COPY.addAnother,
      onclick: () => { Store.del("done"); newResponse(); renderWelcome(); },
    })], "thanks");
    API.count(S.key).then((n) => { msg.textContent = COPY.thanks(n); }, () => { msg.textContent = COPY.thanks(null); });
    if (celebrate) confetti();
  }

  function confetti() {
    if (reduceMotion) return;
    const colors = ["#FFD84D", "#F6A5B8", "#1F2A44", "#B42A32", "#8EC5FF"];
    const box = h("div", { class: "confetti", "aria-hidden": "true" });
    for (let i = 0; i < 90; i++) {
      const p = h("i", {
        style: `left:${Math.random() * 100}%;background:${pickRandom(colors)};` +
          `animation-delay:${Math.random() * 0.5}s;animation-duration:${2.2 + Math.random() * 1.6}s;` +
          `--dx:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720 - 360}deg;` +
          `width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px`,
      });
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 4800);
  }

  /* ================= boot ================= */

  function boot() {
    document.title = CONFIG.TITLE;
    document.getElementById("siteTitle").textContent = CONFIG.TITLE;
    if (IS_TEST) document.getElementById("testBadge").hidden = false;

    API.onStatus(setStatus);
    API.onFatal((code) => {
      if (code === "bad_key") { Store.del("key"); S.key = null; renderIncomplete(); }
      else if (code === "closed") renderClosed();
      hrewind();
    });

    try { history.scrollRestoration = "manual"; } catch (e) { /* ignore */ }
    try { history.replaceState({ bs: "welcome", prev: null, n: 0 }, ""); } catch (e) { /* ignore */ }
    window.addEventListener("popstate", onPop);

    let key = null;
    try { key = (new URLSearchParams(location.search).get("k") || "").trim(); } catch (e) { key = null; }
    if (key) Store.set("key", key);
    else key = Store.get("key");
    if (!key) { renderIncomplete(); return; }
    S.key = key;

    if (deadlinePassed()) { renderClosed(); return; }

    S.rid = Store.get("rid");
    if (!S.rid) { S.rid = uuid(); Store.set("rid", S.rid); }
    S.answers = Store.get("answers") || {};
    S.pos = Store.get("pos");

    Photos.init({
      ctx: () => ({
        key: S.key, rid: S.rid, name: S.answers.name, test: IS_TEST,
        typingName: !!document.activeElement && document.activeElement.id === "q-name",
      }),
      onChange: () => { S.dirty = true; refresh(); },
    });

    if (Store.get("done") && !Object.keys(S.answers).length) renderThanks(false);
    else {
      API.resume();
      renderWelcome();
    }

    // Check the key early so a wrong link shows the right screen before anyone types.
    if (API.configured) API.count(S.key).catch(() => {});

    // Leaving mid-way: push what we have, so the partial row is already in the Sheet.
    const flushOnLeave = () => { if (S.dirty) saveRemote({ keepalive: true }); };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnLeave(); });
    window.addEventListener("pagehide", flushOnLeave);
  }

  boot();
})();
