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
    stackIdx: 0,
    dir: 1,
    dirty: false,
    started: false,
  };

  // What is on screen right now: conditional blocks, required questions, the Next button, timers.
  let live = { conds: [], required: [], next: null, timers: [] };

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

  function setA(id, v) {
    if (isEmpty(v)) delete S.answers[id];
    else S.answers[id] = v;
    S.dirty = true;
    Store.set("answers", S.answers);
    refresh();
  }

  function visibleSections() {
    return SECTIONS.filter((s) => !s.when || s.when(S.answers));
  }

  /* Every screen in order, with section title cards, for the current answers. */
  function flat() {
    const out = [];
    visibleSections().forEach((sec, si) => {
      out.push({ sec, si, key: sec.id + ":title", title: true });
      sec.screens.forEach((sc) => {
        if (!sc.when || sc.when(S.answers)) out.push({ sec, si, sc, key: sec.id + ":" + sc.id });
      });
    });
    return out;
  }

  function optionVisible(o) { return !o.when || o.when(S.answers); }

  function serialize(q) {
    const a = S.answers;
    const v = a[q.id];
    if (q.type === "multi") {
      const vis = q.options.filter(optionVisible);
      return (Array.isArray(v) ? v : [])
        .map((x) => vis.find((o) => o.v === x))
        .filter(Boolean)
        .map((o) => (o.other ? (String(a[q.otherKey] || "").trim() ? "Other: " + String(a[q.otherKey]).trim() : "Other") : o.v))
        .join("; ");
    }
    if (q.type === "three") return (Array.isArray(v) ? v : []).map((x) => String(x || "").trim()).filter(Boolean).join(", ");
    if (q.style === "emoji") return String(v || a[q.otherKey] || "").trim();
    if (q.otherKey && v === "Other") return String(a[q.otherKey] || "").trim() ? "Other: " + String(a[q.otherKey]).trim() : "Other";
    return v == null ? "" : String(v).trim();
  }

  /* Field id → value for the Sheet. Anything hidden by routing goes as blank. */
  function exportAnswers() {
    const a = S.answers;
    const out = {};
    SECTIONS.forEach((sec) => {
      const sv = !sec.when || sec.when(a);
      sec.screens.forEach((sc) => {
        const scv = sv && (!sc.when || sc.when(a));
        (sc.questions || []).forEach((q) => {
          const qv = scv && (!q.when || q.when(a));
          out[q.id] = qv ? serialize(q) : "";
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

  function setHeader(item, list) {
    if (!item) { $top.hidden = true; return; }
    $top.hidden = false;
    const total = visibleSections().length;
    const inSec = list.filter((x) => x.sec === item.sec);
    const k = inSec.indexOf(item);
    const frac = (item.si + (k + 1) / inSec.length) / total;
    $counter.textContent = COPY.counter(item.si + 1, total);
    $fill.style.width = Math.max(3, Math.round(frac * 100)) + "%";
    $bar.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  }

  function setStatus(s) {
    $status.textContent = s ? COPY.status[s] : "";
    $status.className = "save-status" + (s ? " is-" + s : "");
  }

  /* ================= screen plumbing ================= */

  function clearLive() {
    live.timers.forEach((t) => clearInterval(t));
    live = { conds: [], required: [], next: null, timers: [] };
  }

  function show(screen, opts) {
    opts = opts || {};
    document.body.classList.toggle("spicy", !!opts.spicy);
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
    if (live.next) live.next.disabled = !requiredOk();
  }

  function requiredOk() {
    return live.required.every((q) => !isEmpty(S.answers[q.id]));
  }

  /* ================= question renderers ================= */

  const TEXT_TYPES = ["short", "long", "three"];

  function label(q, id) {
    return h("label", { class: "q-label", for: id, id: id + "-l" }, [
      q.label,
      q.required ? h("span", { class: "req", "aria-hidden": "true", text: " *" }) : null,
    ]);
  }

  function groupLabel(q, id) {
    return h("div", { class: "q-label", id: id }, [
      q.label,
      q.required ? h("span", { class: "req", "aria-hidden": "true", text: " *" }) : null,
    ]);
  }

  function sub(q) {
    return [
      q.sub ? h("div", { class: "q-sub", text: q.sub }) : null,
      q.example ? h("div", { class: "q-example", text: "e.g. " + q.example }) : null,
    ];
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
      else if (style === "lie") inner = [h("span", { class: "lie-text", text: o.v }), h("span", { class: "lie-stamp", "aria-hidden": "true", text: COPY.lieStamp })];
      else inner = optText(o);
      const b = h("button", {
        type: "button", class: "opt", "data-v": o.v, "aria-pressed": "false",
        "aria-label": style === "emoji" ? "Emoji " + o.v : null,
        onclick: () => {
          const now = S.answers[q.id] === o.v ? null : o.v;
          setA(q.id, now);
          if (now && q.otherKey && style === "emoji") { setA(q.otherKey, null); if (otherInput) otherInput.value = ""; }
          if (now) {
            swipe(b);
            if (style === "lie" && !reduceMotion) { b.classList.remove("flip"); void b.offsetWidth; b.classList.add("flip"); }
          }
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

  function renderMulti(q) {
    const lid = "q-" + q.id + "-l";
    const opts = q.options.filter(optionVisible);
    const wrap = h("div", { class: "q q-multi" });
    const group = h("div", { class: "opts chips", role: "group", "aria-labelledby": lid });
    const counter = h("div", { class: "picked", "aria-live": "polite" });
    const btns = [];
    let otherBox = null;
    let otherInput = null;

    const cur = () => (Array.isArray(S.answers[q.id]) ? S.answers[q.id].filter((v) => opts.some((o) => o.v === v)) : []);

    function sync() {
      const sel = cur();
      btns.forEach((b) => {
        const on = sel.indexOf(b.dataset.v) >= 0;
        b.setAttribute("aria-pressed", String(on));
        b.classList.toggle("dim", !on && sel.length >= q.max);
      });
      counter.textContent = COPY.picked(sel.length, q.max);
      if (otherBox) otherBox.hidden = sel.indexOf("Other") < 0;
    }

    opts.forEach((o) => {
      const b = h("button", {
        type: "button", class: "opt", "data-v": o.v, "aria-pressed": "false",
        onclick: () => {
          const sel = cur();
          const i = sel.indexOf(o.v);
          if (i >= 0) sel.splice(i, 1);
          else if (sel.length >= q.max) {
            counter.classList.remove("shake"); void counter.offsetWidth; counter.classList.add("shake");
            return;
          } else { sel.push(o.v); swipe(b); }
          setA(q.id, sel);
          sync();
          if (o.other && sel.indexOf("Other") >= 0 && otherInput) otherInput.focus();
        },
      }, optText(o));
      btns.push(b);
      group.appendChild(b);
    });

    add(wrap, [groupLabel(q, lid), sub(q), counter, group]);

    if (q.otherKey) {
      const oid = "q-" + q.otherKey;
      otherInput = h("input", {
        id: oid, class: "text", type: "text", maxlength: "100", autocomplete: "off",
        value: S.answers[q.otherKey] || "", placeholder: COPY.otherPlaceholder,
      });
      otherInput.addEventListener("input", () => setA(q.otherKey, otherInput.value));
      otherBox = h("div", { class: "other-box" }, [h("label", { class: "q-sub other-label", for: oid, text: "Other" }), otherInput]);
      wrap.appendChild(otherBox);
    }
    sync();
    return wrap;
  }

  function renderScale(q) {
    const lid = "q-" + q.id + "-l";
    const wrap = h("div", { class: "q q-scale" });
    const row = h("div", { class: "scale", role: "group", "aria-labelledby": lid });
    const out = h("div", { class: "scale-label", "aria-live": "polite" });
    const btns = [];
    function sync() {
      const cur = S.answers[q.id];
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
      out.textContent = cur ? COPY.scale[Number(cur) - 1] : "";
    }
    [1, 2, 3, 4, 5].forEach((n) => {
      const v = String(n);
      const b = h("button", {
        type: "button", class: "dot", "data-v": v, "aria-pressed": "false",
        "aria-label": `${n}: ${COPY.scale[n - 1]}`,
        onclick: () => { const now = S.answers[q.id] === v ? null : v; setA(q.id, now); if (now) swipe(b); sync(); },
      }, v);
      btns.push(b);
      row.appendChild(b);
    });
    const ends = h("div", { class: "scale-ends", "aria-hidden": "true" }, [
      h("span", { text: COPY.scale[0] }), h("span", { text: COPY.scale[4] }),
    ]);
    add(wrap, [groupLabel(q, lid), row, ends, out]);
    sync();
    return wrap;
  }

  function renderQ(q) {
    if (q.type === "short" || q.type === "long") return renderText(q);
    if (q.type === "three") return renderThree(q);
    if (q.type === "single") return renderSingle(q);
    if (q.type === "multi") return renderMulti(q);
    if (q.type === "scale5") return renderScale(q);
    return h("div");
  }

  /* Questions on a screen; `attach: true` puts a question in the previous card. */
  function renderQuestions(sc, into, list) {
    let cur = null;
    let i = 0;
    (list || sc.questions).forEach((q) => {
      const el = renderQ(q);
      if (q.attach && cur) cur.appendChild(el);
      else {
        const isText = TEXT_TYPES.indexOf(q.type) >= 0;
        cur = card(q.id, el, { flat: isText, cls: sc.cardClass, i: i++ });
        into.appendChild(cur);
      }
      if (q.when) live.conds.push({ el: q.attach ? el : cur, when: q.when });
      if (q.required) live.required.push(q);
    });
  }

  /* ================= navigation ================= */

  function current() {
    const list = flat();
    let i = list.findIndex((x) => x.key === S.pos);
    if (i < 0) i = 0;
    return { list, i, item: list[i] };
  }

  function go(delta) {
    const { list, i, item } = current();
    const nxt = list[i + delta];
    S.dir = delta;
    if (!nxt) {
      if (delta > 0) { finish(); return; }
      renderWelcome(); return;
    }
    if (nxt.sec !== item.sec) saveRemote();
    if (nxt.sc && nxt.sc.kind === "stack") {
      const qs = nxt.sc.questions;
      if (delta < 0) S.stackIdx = qs.length;
      else { const f = qs.findIndex((q) => !S.answers[q.id]); S.stackIdx = f < 0 ? qs.length : f; }
    }
    S.pos = nxt.key;
    Store.set("pos", S.pos);
    render();
  }

  function nav(opts) {
    opts = opts || {};
    const back = h("button", { type: "button", class: "btn-back", onclick: opts.onBack || (() => go(-1)) });
    back.insertAdjacentHTML("beforeend", ARROW_BACK);
    back.appendChild(h("span", { text: COPY.back }));
    const next = primaryBtn(opts.nextLabel || COPY.next, opts.onNext || (() => go(1)), { arrow: !opts.nextLabel });
    next.classList.add("nav-next");
    live.next = next;
    return h("div", { class: "nav" }, [back, next]);
  }

  /* Section label above every screen. The h1 is visually hidden unless the screen has its own heading. */
  function miniHead(item, text, hideHeading) {
    return h("div", { class: "mini" }, [
      h("div", { class: "sec-label", text: COPY.sectionLabel(item.si + 1) + " · " + item.sec.title + " " + item.sec.emoji }),
      text ? h("h1", { class: "mini-head" + (hideHeading ? " sr-only" : ""), text }) : null,
    ]);
  }

  /* ================= screens ================= */

  function render() {
    clearLive();
    const { list, i, item } = current();
    if (!item) { renderWelcome(); return; }
    S.pos = item.key;
    setHeader(item, list);
    const last = i === list.length - 1;
    const screen = h("section", { class: "screen" });

    if (item.title) renderTitle(item, screen);
    else if (item.sc.kind === "stack") { renderStack(item, screen); return; }
    else if (item.sc.kind === "unlock") renderUnlock(item, screen);
    else if (item.sc.kind === "photos") renderPhotos(item, screen);
    else {
      screen.appendChild(miniHead(item, item.sc.heading || item.sec.title, !item.sc.heading));
      renderQuestions(item.sc, screen);
    }
    screen.appendChild(nav({ nextLabel: last ? COPY.submit : null }));
    show(screen, { spicy: item.sec.variant === "spicy" });
  }

  function renderTitle(item, screen) {
    const sec = item.sec;
    const spicy = sec.variant === "spicy";
    screen.appendChild(card(sec.id + "-title", [
      spicy ? h("div", { class: "secret-stamp", text: COPY.secretStamp }) : null,
      h("div", { class: "title-emoji", "aria-hidden": "true", text: sec.emoji }),
      h("div", { class: "sec-label", text: COPY.sectionLabel(item.si + 1) }),
      h("h1", { class: "sec-title" }, h("span", { text: sec.title })),
      h("p", { class: "intro", text: sec.intro }),
    ], { cls: "title-card" + (spicy ? " secret" : "") }));
  }

  /* ---- "Has she ever" card stack ---- */

  function renderStack(item, screen) {
    const qs = item.sc.questions;
    screen.appendChild(miniHead(item, COPY.everIntro));
    const holder = h("div", { class: "stack" });
    screen.appendChild(holder);
    let locked = false;

    function draw(dir) {
      while (holder.firstChild) holder.removeChild(holder.firstChild);
      const idx = S.stackIdx;
      if (idx >= qs.length) {
        holder.appendChild(card("ever-done", [
          h("div", { class: "title-emoji", "aria-hidden": "true", text: "🎉" }),
          h("p", { class: "ever-done", text: COPY.everDone(qs.length) }),
          h("p", { class: "q-sub", text: COPY.everDoneSub }),
        ], { cls: "ever-card slide-" + (dir < 0 ? "left" : "right") }));
        return;
      }
      const q = qs[idx];
      const reaction = h("div", { class: "reaction", "aria-live": "polite" });
      const btns = COPY.everButtons.map((o) => {
        const b = h("button", {
          type: "button", class: "opt", "data-v": o.v, "aria-pressed": String(S.answers[q.id] === o.v),
          onclick: () => {
            if (locked) return;
            locked = true;
            setA(q.id, o.v);
            btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
            swipe(b);
            reaction.textContent = pickRandom(COPY.everReactions[o.v]);
            reaction.classList.add("pop");
            setTimeout(() => { locked = false; S.stackIdx = idx + 1; draw(1); }, reduceMotion ? 500 : 1000);
          },
        }, o.label);
        return b;
      });
      holder.appendChild(card("ever-" + q.id, [
        h("div", { class: "stack-count", text: `${idx + 1} / ${qs.length}` }),
        h("div", { class: "ever-lead", text: COPY.everIntro }),
        h("p", { class: "ever-statement", id: "ever-q", text: q.label }),
        h("div", { class: "ever-btns", role: "group", "aria-labelledby": "ever-q" }, btns),
        reaction,
      ], { cls: "ever-card slide-" + (dir < 0 ? "left" : "right") }));
      holder.appendChild(h("button", {
        type: "button", class: "link-btn", text: COPY.everSkip,
        onclick: () => { if (!locked) { S.stackIdx = idx + 1; draw(1); } },
      }));
    }

    screen.appendChild(nav({
      onBack: () => { if (locked) return; if (S.stackIdx > 0) { S.stackIdx--; draw(-1); } else go(-1); },
      onNext: () => { if (locked) return; if (S.stackIdx < qs.length) { S.stackIdx++; draw(1); } else go(1); },
    }));
    draw(S.dir);
    show(screen);
  }

  /* ---- spicy unlock ---- */

  function renderUnlock(item, screen) {
    const cur = S.answers.spicy_unlocked;
    const yes = h("button", {
      type: "button", class: "btn-primary btn-chilli", "aria-pressed": String(cur === "yes"), text: COPY.unlockYes,
      onclick: () => {
        setA("spicy_unlocked", "yes");
        if (reduceMotion) { go(1); return; }
        const flash = h("div", { class: "chilli-flash", "aria-hidden": "true" }, h("span", { text: "🌶️" }));
        document.body.appendChild(flash);
        setTimeout(() => { flash.remove(); go(1); }, 750);
      },
    });
    const no = h("button", {
      type: "button", class: "btn-secondary", "aria-pressed": String(cur === "no"), text: COPY.unlockNo,
      onclick: () => { setA("spicy_unlocked", "no"); go(1); },
    });
    screen.appendChild(miniHead(item, null));
    screen.appendChild(card("unlock", [
      h("div", { class: "title-emoji", "aria-hidden": "true", text: "🔒" }),
      h("h1", { class: "unlock-text", text: COPY.unlockText }),
      S.answers.relation === "Work" ? h("p", { class: "q-sub", text: COPY.unlockWork }) : null,
      h("div", { class: "unlock-btns" }, [yes, no]),
    ], { cls: "unlock-card" }));
  }

  /* ---- photos ---- */

  function renderPhotos(item, screen) {
    screen.appendChild(miniHead(item, item.sec.title, true));
    item.sc.slots.forEach((slot, i) => {
      const lid = "slot-" + slot.id;
      screen.appendChild(card("slot-" + slot.id, [
        h("div", { class: "q-label", id: lid, text: slot.label }),
        slot.sub ? h("div", { class: "q-sub", text: slot.sub }) : null,
        Photos.renderSlot(slot, lid),
      ], { cls: "photo-frame", i }));
      const after = item.sc.questions.filter((q) => q.afterSlot === slot.id);
      if (after.length) renderQuestions(item.sc, screen, after);
    });
  }

  /* ================= welcome / end screens ================= */

  function simpleScreen(kids, cls) {
    clearLive();
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
      S.pos = flat()[0].key;
      Store.set("pos", S.pos);
      render();
    };
    const resume = () => {
      S.dir = 1;
      S.started = true;
      const c = current();
      if (c.item.sc && c.item.sc.kind === "stack") {
        const f = c.item.sc.questions.findIndex((q) => !S.answers[q.id]);
        S.stackIdx = f < 0 ? c.item.sc.questions.length : f;
      }
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
    });

    let key = null;
    try { key = new URLSearchParams(location.search).get("k"); } catch (e) { key = null; }
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
      ctx: () => ({ key: S.key, rid: S.rid, name: S.answers.name, test: IS_TEST }),
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
