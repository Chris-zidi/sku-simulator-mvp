/* ============================================================
 * lab-core.js — 动画实验室（Forecast 可视化教学）
 * 依赖：index.html 中的 #labView / #labCanvas / 引导侧栏节点
 * 主题：复用全局 CSS 变量（--green/--red/--amber/--purple/--ink/--muted）
 * ============================================================ */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const HORIZON = 180;

  // —— 参数定义（可拖动）——
  const PARAMS = {
    forecast:   { label: "预测日均销量", min: 5,  max: 120,  step: 1,    unit: "件/天", note: "你判断的每天能卖多少（计划用）" },
    demand:     { label: "真实日均销量", min: 5,  max: 120,  step: 1,    unit: "件/天", note: "市场实际每天卖出（现实）" },
    inventory:  { label: "期初库存",     min: 0,  max: 12000, step: 50,   unit: "件",   note: "今天手里有多少货" },
    leadTime:   { label: "补货提前期",   min: 14, max: 160,  step: 1,    unit: "天",   note: "从下单到海外可售的客观时长" },
    safetyDays: { label: "安全库存天数", min: 0,  max: 45,   step: 1,    unit: "天",   note: "把补货警戒线提前的缓冲" },
    replenish:  { label: "补货量",       min: 0,  max: 12000, step: 50,   unit: "件",   note: "到货时一次性补进来的数量" },
    promo:      { label: "促销系数",     min: 1,  max: 4,    step: 0.1,  unit: "×",    note: "促销期销量放大倍数" },
    promoDay:   { label: "促销开始日",   min: 0,  max: 170,  step: 1,    unit: "天",   note: "从第几天起进入促销" }
  };

  // —— 引导课程（一个概念一个概念）——
  const LESSONS = [
    { logic: "库存", title: "库存会一天天消失", ref: "指标-库存",
      instruct: "先不动别的，只拖【真实日均销量】。把它从 32 拉到 64，看库存曲线怎么更早触底、售罄日怎么往左移。",
      observe: "关注：售罄日（红色竖线）、期末库存。库存覆盖天数 = 期初库存 ÷ 日均销量——卖得越快，库存消失得越早。",
      baseline: { forecast: 32, demand: 32, inventory: 4800, leadTime: 140, safetyDays: 21, replenish: 0, promo: 1, promoDay: 60 },
      target: { param: "demand", value: 64 } },
    { logic: "预测", title: "预测 ≠ 真实：偏差让你来不及备货", ref: "攻略P2",
      instruct: "这里真实销量(48)比你预测(32)高。拖【预测日均销量】把它拉到 48，看“你以为能卖的天数”追上“实际能卖的天数”。",
      observe: "关注：计划覆盖天数 vs 真实覆盖天数。预测偏低→以为还够→真缺货了才发现来不及补。预测是供应计划的起点。",
      baseline: { forecast: 32, demand: 48, inventory: 4800, leadTime: 140, safetyDays: 21, replenish: 0, promo: 1, promoDay: 60 },
      target: { param: "forecast", value: 48 } },
    { logic: "真实", title: "超卖：需求 > 供给，承诺了却发不出", ref: "指标-ROI",
      instruct: "拖【真实日均销量】从 64 拉到 95。库存早早归零后，曲线掉到 0 以下变红——那一段就是“超卖/缺货”（卖出去但没货发）。",
      observe: "关注：红色超卖区、缺货天数。Forecast 必须 ≥ 真实需求，否则订单承诺出去却发不出=超卖赔信誉+丢单。",
      baseline: { forecast: 64, demand: 64, inventory: 3000, leadTime: 140, safetyDays: 21, replenish: 0, promo: 1, promoDay: 60 },
      target: { param: "demand", value: 95 } },
    { logic: "补货", title: "补货提前期(Lead Time)决定能否救场", ref: "攻略P2.5",
      instruct: "有 4000 件补货在途。拖【补货提前期】从 140 拉到 160，看“到货日”右移、红色缺货缺口变大。",
      observe: "关注：到货日、缺货天数。下单时点 = 库存覆盖 ≤ Lead Time + 安全库存；提前期越长，越难在售罄前到货。",
      baseline: { forecast: 48, demand: 48, inventory: 3000, leadTime: 140, safetyDays: 21, replenish: 4000, promo: 1, promoDay: 60 },
      target: { param: "leadTime", value: 160 } },
    { logic: "安全", title: "安全库存：把警戒线提前", ref: "指标-安全",
      instruct: "拖【安全库存天数】从 7 拉到 30。下单会提前触发→到货提前→红色缺口缩小。",
      observe: "关注：到货日、缺货天数。安全库存不延长物理流程，只把补货警戒线提前，缓冲波动。",
      baseline: { forecast: 48, demand: 48, inventory: 3000, leadTime: 140, safetyDays: 7, replenish: 4000, promo: 1, promoDay: 60 },
      target: { param: "safetyDays", value: 30 } },
    { logic: "促销", title: "促销尖峰会瞬间压垮库存", ref: "攻略P2.5/P6",
      instruct: "从第 60 天起有促销。拖【促销系数】从 1 拉到 2.5，看第 60 天后销量尖峰、库存骤降、售罄大幅提前。",
      observe: "关注：售罄日、缺货天数。大促要敢拉高预测+提前备货；光加广告不补货只会加速缺货。",
      baseline: { forecast: 40, demand: 40, inventory: 4000, leadTime: 140, safetyDays: 21, replenish: 4000, promo: 1, promoDay: 60 },
      target: { param: "promo", value: 2.5 } },
    { logic: "节奏", title: "Q4 大胆预测：别被过去数据吓住", ref: "攻略P7",
      instruct: "真实需求已经涨到 70，但你的预测还停在 40。拖【预测日均销量】到 70，看计划覆盖天数追上真实，避免“以为够、实际早缺”。",
      observe: "关注：计划覆盖 vs 真实覆盖。Q4 增长别被历史低销量吓住，要敢按趋势预测、提前备货。",
      baseline: { forecast: 40, demand: 70, inventory: 4000, leadTime: 140, safetyDays: 21, replenish: 4000, promo: 1, promoDay: 60 },
      target: { param: "forecast", value: 70 } }
  ];

  const state = {
    current: {},
    lessonIndex: 0,
    progress: 1,
    playing: false,
    raf: null,
    inputs: {},
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0
  };

  /* ---------- 计算库存序列 ---------- */
  function computeSeries() {
    const p = state.current;
    const inv = new Array(HORIZON + 1).fill(0);
    const cons = new Array(HORIZON + 1).fill(0);
    inv[0] = p.inventory;
    let ordered = false, orderDay = -1;

    // Pass A：不加补货，找下单触发日、售罄日
    for (let t = 1; t <= HORIZON; t++) {
      const promoOn = t >= p.promoDay;
      const c = p.demand * (promoOn ? p.promo : 1);
      cons[t] = c;
      inv[t] = inv[t - 1] - c;
      if (!ordered) {
        const cover = inv[t] / (p.demand || 1);
        if (cover <= p.safetyDays + p.leadTime) { ordered = true; orderDay = t; }
      }
    }
    const sellOutWithout = (function () {
      for (let t = 1; t <= HORIZON; t++) if (inv[t] <= 0) return t;
      return -1;
    })();

    const arrivalDay = orderDay >= 0 ? Math.min(HORIZON, orderDay + p.leadTime) : -1;

    // Pass B：在到货日加补货，重算序列
    const invB = new Array(HORIZON + 1).fill(0);
    invB[0] = p.inventory;
    for (let t = 1; t <= HORIZON; t++) {
      const promoOn = t >= p.promoDay;
      const c = p.demand * (promoOn ? p.promo : 1);
      invB[t] = invB[t - 1] - c;
      if (arrivalDay >= 0 && t === arrivalDay && p.replenish > 0) invB[t] += p.replenish;
    }
    let sellOutDay = -1, stockoutDays = 0;
    for (let t = 1; t <= HORIZON; t++) {
      if (sellOutDay < 0 && invB[t] <= 0) sellOutDay = t;
      if (invB[t] < 0) stockoutDays++;
    }

    const metrics = {
      coverForecast: p.forecast > 0 ? p.inventory / p.forecast : 0,
      coverDemand: p.demand > 0 ? p.inventory / p.demand : 0,
      endInv: invB[HORIZON],
      sellOutDay,
      sellOutWithout,
      orderDay,
      arrivalDay,
      stockoutDays
    };
    return { inv: invB, cons, metrics };
  }

  /* ---------- 画布绘制 ---------- */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  }

  function resizeCanvas() {
    const c = state.canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || (c.parentElement ? c.parentElement.clientWidth : 600);
    const h = c.clientHeight || 320;
    state.cssW = w; state.cssH = h;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    state.ctx = c.getContext("2d");
    if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(progress) {
    const c = state.canvas, ctx = state.ctx;
    if (!c || !ctx) return;
    const W = state.cssW, H = state.cssH;
    if (!W || !H) return;
    const series = computeSeries();
    const inv = series.inv;
    const p = state.current;

    const padL = 46, padR = 14, padT = 16, padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const yMax = Math.max(p.inventory, ...inv, 1);
    const yMin = Math.min(0, ...inv);
    const x = (d) => padL + (d / HORIZON) * plotW;
    const y = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const zeroY = y(0);

    ctx.clearRect(0, 0, W, H);

    // 背景网格
    const grid = cssVar("--line");
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    [0, 60, 120, 180].forEach((d) => {
      ctx.beginPath(); ctx.moveTo(x(d), padT); ctx.lineTo(x(d), padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--muted"); ctx.font = "11px sans-serif";
      ctx.fillText("D" + d, x(d) - 8, H - 8);
    });

    // 安全库存线
    const safeLevel = p.safetyDays * p.demand;
    if (safeLevel <= yMax) {
      ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y(safeLevel)); ctx.lineTo(padL + plotW, y(safeLevel)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif";
      ctx.fillText("安全库存线", padL + 4, y(safeLevel) - 5);
    }

    // 进度裁剪
    const progDay = Math.max(0, Math.min(HORIZON, Math.floor(progress * HORIZON)));

    // 绿色有货区（inv 钳到 >=0）
    const green = cssVar("--green");
    ctx.fillStyle = "rgba(23,121,87,0.20)";
    ctx.beginPath();
    ctx.moveTo(x(0), zeroY);
    for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.max(inv[d], 0)));
    ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();

    // 红色超卖区（inv 钳到 <=0）
    ctx.fillStyle = "rgba(184,60,52,0.20)";
    ctx.beginPath();
    ctx.moveTo(x(0), zeroY);
    for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.min(inv[d], 0)));
    ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();

    // 曲线
    ctx.strokeStyle = green; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let d = 0; d <= progDay; d++) {
      const yy = y(inv[d]);
      if (d === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
    }
    ctx.stroke();

    // 补货箭头
    if (series.metrics.arrivalDay >= 0 && series.metrics.arrivalDay <= progDay && p.replenish > 0) {
      const ax = x(series.metrics.arrivalDay);
      ctx.strokeStyle = green; ctx.fillStyle = green; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, padT + 4); ctx.lineTo(ax, padT + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 5, padT + 10); ctx.lineTo(ax, padT + 2); ctx.lineTo(ax + 5, padT + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = green; ctx.font = "11px sans-serif";
      ctx.fillText("+" + fmt(p.replenish), ax - 10, padT + 36);
    }

    // 售罄标记
    if (series.metrics.sellOutDay >= 0 && series.metrics.sellOutDay <= progDay) {
      const sx = x(series.metrics.sellOutDay);
      ctx.strokeStyle = cssVar("--red"); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--red"); ctx.font = "bold 11px sans-serif";
      ctx.fillText("售罄 D" + series.metrics.sellOutDay, sx - 4, padT + 12);
    }

    // 播放头
    if (progDay > 0) {
      const hx = x(progDay);
      ctx.strokeStyle = cssVar("--purple"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--purple");
      ctx.beginPath(); ctx.arc(hx, y(inv[progDay]), 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- 读数面板 ---------- */
  function updateReadout() {
    const el = $("labReadout");
    if (!el) return;
    const m = computeSeries().metrics;
    const badge = (txt, cls) => `<span class="ro-badge ${cls}">${txt}</span>`;
    let sellOut = m.sellOutDay < 0 ? "未售罄" : "D" + m.sellOutDay + " 天";
    if (m.sellOutWithout >= 0 && m.sellOutDay !== m.sellOutWithout)
      sellOut += ` <small>(不补货 D${m.sellOutWithout})</small>`;
    const rows = [
      ["售罄日", sellOut],
      ["缺货天数", m.stockoutDays > 0 ? badge(m.stockoutDays + " 天", "bad") : "0 天"],
      ["下单日 / 到货日", (m.orderDay >= 0 ? "D" + m.orderDay : "—") + " / " + (m.arrivalDay >= 0 ? "D" + m.arrivalDay : "—")],
      ["计划覆盖(÷预测)", fmt(m.coverForecast) + " 天"],
      ["真实覆盖(÷真实)", fmt(m.coverDemand) + " 天"],
      ["期末库存", fmt(m.endInv) + " 件"]
    ];
    el.innerHTML = `<div class="ro-grid">` + rows.map(([k, v]) =>
      `<div class="ro-cell"><span class="ro-k">${k}</span><span class="ro-v">${v}</span></div>`).join("") + `</div>`;
  }

  /* ---------- 滑块联动 ---------- */
  function buildSliders() {
    const wrap = $("labParams");
    if (!wrap) return;
    wrap.innerHTML = "";
    Object.keys(PARAMS).forEach((name) => {
      const def = PARAMS[name];
      const row = document.createElement("div");
      row.className = "lab-field";
      row.dataset.param = name;
      row.innerHTML =
        `<div class="lab-field-top"><label>${def.label}</label><span class="lab-val" id="labVal_${name}"></span></div>` +
        `<input type="range" id="labIn_${name}" min="${def.min}" max="${def.max}" step="${def.step}">` +
        `<span class="lab-note">${def.note}</span>`;
      wrap.appendChild(row);
      const input = row.querySelector("input");
      state.inputs[name] = input;
      input.addEventListener("input", () => {
        state.current[name] = Number(input.value);
        $("labVal_" + name).textContent = fmt(Number(input.value)) + " " + def.unit;
        draw(1); updateReadout();
      });
    });
  }

  function syncSliders() {
    Object.keys(PARAMS).forEach((name) => {
      const input = state.inputs[name];
      if (!input) return;
      input.value = state.current[name];
      $("labVal_" + name).textContent = fmt(Number(state.current[name])) + " " + PARAMS[name].unit;
    });
  }

  function highlightParam(name) {
    Object.keys(state.inputs).forEach((n) => {
      const row = state.inputs[n].closest(".lab-field");
      if (row) row.classList.toggle("glow", n === name);
    });
  }

  function setParam(name, value, animate) {
    const input = state.inputs[name];
    if (!input) return;
    value = clamp(value, PARAMS[name].min, PARAMS[name].max);
    if (animate) {
      const from = Number(input.value), to = value, dur = 600, t0 = performance.now();
      function step(now) {
        let k = (now - t0) / dur; if (k > 1) k = 1;
        const v = from + (to - from) * k;
        input.value = v; state.current[name] = Number(v);
        $("labVal_" + name).textContent = fmt(Number(v)) + " " + PARAMS[name].unit;
        draw(1); updateReadout();
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    } else {
      input.value = value; state.current[name] = value;
      $("labVal_" + name).textContent = fmt(value) + " " + PARAMS[name].unit;
      draw(1); updateReadout();
    }
  }

  /* ---------- 引导课程 ---------- */
  function applyLesson(i) {
    state.lessonIndex = (i + LESSONS.length) % LESSONS.length;
    const L = LESSONS[state.lessonIndex];
    state.current = Object.assign({}, L.baseline);
    syncSliders();
    highlightParam(L.target.param);
    $("labLogic").textContent = L.logic;
    $("labStep").textContent = (state.lessonIndex + 1) + " / " + LESSONS.length;
    $("labTitle").textContent = L.title;
    $("labInstruct").innerHTML = `<b>怎么拖：</b>${L.instruct}<br><span class="lab-ref">📌 ${L.ref}</span>`;
    $("labObserve").innerHTML = `<b>看什么：</b>${L.observe}`;
    draw(1); updateReadout();
  }

  function demoLesson() {
    const L = LESSONS[state.lessonIndex];
    setParam(L.target.param, L.target.value, true);
  }

  function nextLesson() { applyLesson(state.lessonIndex + 1); }

  /* ---------- 一键模拟 ---------- */
  function play() {
    if (typeof requestAnimationFrame === "undefined") { draw(1); return; }
    if (state.raf) cancelAnimationFrame(state.raf);
    const dur = 2600, t0 = performance.now();
    state.playing = true;
    function frame(now) {
      let p = (now - t0) / dur; if (p > 1) p = 1;
      state.progress = p;
      draw(p);
      if (p < 1) state.raf = requestAnimationFrame(frame);
      else { state.playing = false; state.progress = 1; draw(1); }
    }
    state.raf = requestAnimationFrame(frame);
  }

  /* ---------- 公开接口 ---------- */
  window.LabCore = {
    onShow() { resizeCanvas(); draw(state.progress || 1); updateReadout(); }
  };

  function init() {
    state.canvas = $("labCanvas");
    if (!state.canvas) return;
    buildSliders();
    resizeCanvas();
    applyLesson(0);
    $("labPlay").addEventListener("click", play);
    $("labReset").addEventListener("click", () => applyLesson(state.lessonIndex));
    $("labDemo").addEventListener("click", demoLesson);
    $("labNext").addEventListener("click", nextLesson);
    window.addEventListener("resize", () => { if ($("labView") && !$("labView").hidden) { resizeCanvas(); draw(state.progress || 1); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
