/* ============================================================
 * lab-core.js — 动画实验室 v2（搭积木式：一个元素一个元素加）
 * 设计：每关只往图上加【一个新元素】，只给当前关相关的滑块。
 * 依赖：index.html 中的 #labView / #labCanvas / 引导侧栏节点
 * 主题：复用全局 CSS 变量（--green/--red/--amber/--purple/--ink/--muted/--line）
 * ============================================================ */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const HORIZON = 180;

  // —— 所有可拖动因子（数值范围/说明）——
  const PARAMS = {
    inventory:  { label: "期初库存",     min: 0,    max: 12000, step: 50,  unit: "件",   note: "今天手里有多少货" },
    demand:     { label: "真实日均销量", min: 5,    max: 120,  step: 1,    unit: "件/天", note: "市场实际每天卖出多少" },
    forecast:   { label: "预测日均销量", min: 5,    max: 120,  step: 1,    unit: "件/天", note: "你开工前判断的每天能卖多少（计划）" },
    leadTime:   { label: "补货提前期",   min: 14,   max: 160,  step: 1,    unit: "天",   note: "从下单到海外可售的客观时长" },
    replenish:  { label: "补货量",       min: 0,    max: 12000, step: 50,   unit: "件",   note: "到货时一次性补进来的数量" },
    safetyDays: { label: "安全库存天数", min: 0,    max: 45,   step: 1,    unit: "天",   note: "把补货警戒线提前的缓冲" },
    promo:      { label: "促销系数",     min: 1,    max: 4,    step: 0.1,  unit: "×",    note: "促销期销量放大倍数" },
    promoDay:   { label: "促销开始日",   min: 0,    max: 170,  step: 1,    unit: "天",   note: "从第几天起进入促销" }
  };

  // —— 7 关：每关只新增【一个元素】+【一个因子滑块】——
  // newParam: 本关新解锁、可拖动的滑块（数组=一次解锁多个耦合因子）
  // element: 本关新加到图上的视觉元素（累计显示）
  const STAGES = [
    {
      logic: "库存",
      title: "先认识：库存是一堆能卖的货",
      element: null,
      newParam: ["inventory"],
      newLabel: "📦 库存本体",
      intro: "这是你仓库里现在的货量。它现在<b>不动</b>——因为还没开始卖。记住：所有预测和备货，都是为了不让这堆货在你要卖的时候断了。",
      instruct: "先拖【期初库存】，看左边那根线上下移动。这就是你能卖的「家底」。",
      observe: "观察：线的高度 = 你手里有几件货。",
      baseline: { inventory: 4800, demand: 0, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { inventory: 8000 }
    },
    {
      logic: "卖出",
      title: "每天卖出 → 库存一天天消失",
      element: "demand",
      newParam: ["demand"],
      newLabel: "📉 每日卖出",
      intro: "现在开始卖了：每天稳定卖出去一些。看曲线怎么一天天往下掉——这就是「库存消失」。",
      instruct: "拖【真实日均销量】从 32 拉到 64，看曲线是不是掉得更陡、更早触底。",
      observe: "观察：日销越大，曲线越陡，库存消失越快。",
      baseline: { inventory: 4800, demand: 32, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { demand: 64 }
    },
    {
      logic: "售罄",
      title: "卖到 0 的那天 = 售罄日",
      element: "sellout",
      newParam: null,
      newLabel: "🔴 售罄日",
      intro: "库存掉到 0 的那一天，就是「售罄日」。从今天到售罄，就是这堆货能撑的天数——叫「库存覆盖天数」。",
      instruct: "再拖【真实日均销量】：拉高它，红色售罄线就往左移（更早断货）；拉低它，售罄线右移。",
      observe: "观察：红色竖线 = 售罄日。覆盖天数 = 库存 ÷ 日销。",
      baseline: { inventory: 4800, demand: 32, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { demand: 64 }
    },
    {
      logic: "预测",
      title: "你的预测 vs 真实：计划线",
      element: "forecast",
      newParam: ["forecast"],
      newLabel: "🟣 预测线",
      intro: "你开工前会先「预测」每天能卖多少，紫色虚线是你的<b>计划</b>。如果预测 < 真实，你就会「以为还够」却悄悄断货。",
      instruct: "拖【预测日均销量】把它从 32 拉到和真实(48)一样。看紫虚线(计划)追上蓝实线(真实)，覆盖天数才准。",
      observe: "观察：紫虚线=你的预测。预测偏低 = 自欺欺人。",
      baseline: { inventory: 4800, demand: 48, forecast: 32, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { forecast: 48 }
    },
    {
      logic: "补货",
      title: "提前期：下单后多久才到货",
      element: "leadTime",
      newParam: ["leadTime", "replenish"],
      newLabel: "🟢 补货到货",
      intro: "现实里：库存快没了你要补货，但货从下单到上架要等很久（提前期）。绿色箭头是「到货日」。如果到货日晚于售罄日，中间就是缺货红区。",
      instruct: "拖【补货提前期】从 140 拉到 160：箭头右移，红色缺货缺口变大。再拖【补货量】看补多少能填平。",
      observe: "观察：绿色箭头 = 到货日。提前期越长，越容易在售罄前到不了。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { leadTime: 160 }
    },
    {
      logic: "安全",
      title: "安全库存：把警戒线提前",
      element: "safety",
      newParam: ["safetyDays"],
      newLabel: "🟠 安全库存线",
      intro: "别等掉到 0 才补——留条安全垫，提前下单。琥珀虚线就是安全库存线，到这条线就该下单了。",
      instruct: "拖【安全库存天数】从 7 拉到 30：下单提前→箭头提前→红色缺口缩小甚至消失。",
      observe: "观察：琥珀线 = 安全线。它不延长物流，只把补货触发提前。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 7, promo: 1, promoDay: 60 },
      demoTarget: { safetyDays: 30 }
    },
    {
      logic: "促销",
      title: "促销尖峰：瞬间压垮库存",
      element: "promo",
      newParam: ["promo", "promoDay"],
      newLabel: "🟡 促销尖峰",
      intro: "大促期间销量会猛涨（尖峰）。看第 60 天后的那个凸起——它让库存骤降、售罄大幅提前。",
      instruct: "拖【促销系数】从 1 拉到 2.5：第 60 天后尖峰更高，库存掉更快。这就为什么大促要提前拉高预测+备货。",
      observe: "观察：促销期尖峰。光加广告不补货 = 加速缺货。",
      baseline: { inventory: 4000, demand: 40, forecast: 40, leadTime: 140, replenish: 4000, safetyDays: 21, promo: 1, promoDay: 60 },
      demoTarget: { promo: 2.5 }
    }
  ];

  // 每关解锁的因子（累计）
  function unlockedParams(i) {
    const set = new Set();
    for (let s = 0; s <= i; s++) {
      const np = STAGES[s].newParam;
      if (!np) continue;
      (Array.isArray(np) ? np : [np]).forEach((p) => set.add(p));
    }
    return [...set];
  }

  // 每关解锁的视觉元素（累计）
  function unlockedElements(i) {
    const set = new Set();
    for (let s = 0; s <= i; s++) if (STAGES[s].element) set.add(STAGES[s].element);
    return set;
  }

  const state = {
    current: {},
    stageIndex: 0,
    playing: false,
    raf: null,
    progress: 1,
    inputs: {},
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0
  };

  /* ---------- 计算库存序列（按当前关 gate）---------- */
  function computeSeries(stageIndex) {
    const p = state.current;
    const hasLead = stageIndex >= 4;     // leadTime 在第 5 关解锁
    const hasPromo = stageIndex >= 6;    // promo 在第 7 关解锁
    const hasSafety = stageIndex >= 5;

    const inv = new Array(HORIZON + 1).fill(0);
    inv[0] = p.inventory;
    let ordered = false, orderDay = -1;
    for (let t = 1; t <= HORIZON; t++) {
      const promoOn = hasPromo && t >= p.promoDay;
      const c = p.demand * (promoOn ? p.promo : 1);
      inv[t] = inv[t - 1] - c;
      if (hasLead && !ordered) {
        const cover = inv[t] / (p.demand || 1);
        if (cover <= p.safetyDays + p.leadTime) { ordered = true; orderDay = t; }
      }
    }
    const sellOutWithout = (function () {
      for (let t = 1; t <= HORIZON; t++) if (inv[t] <= 0) return t;
      return -1;
    })();
    const arrivalDay = (hasLead && orderDay >= 0) ? Math.min(HORIZON, orderDay + p.leadTime) : -1;

    const invB = inv.slice();
    if (hasLead && arrivalDay >= 0 && p.replenish > 0) invB[arrivalDay] += p.replenish;

    let sellOutDay = -1, stockoutDays = 0;
    for (let t = 1; t <= HORIZON; t++) {
      if (sellOutDay < 0 && invB[t] <= 0) sellOutDay = t;
      if (invB[t] < 0) stockoutDays++;
    }

    // 预测线（仅第 4 关后）：按预测日销算出的「计划库存曲线」
    let invF = null;
    if (stageIndex >= 3) {
      invF = new Array(HORIZON + 1).fill(0);
      invF[0] = p.inventory;
      for (let t = 1; t <= HORIZON; t++) {
        const promoOn = hasPromo && t >= p.promoDay;
        const c = p.forecast * (promoOn ? p.promo : 1);
        invF[t] = invF[t - 1] - c;
      }
    }

    return {
      inv: invB, invF,
      metrics: {
        sellOutDay, sellOutWithout, orderDay, arrivalDay, stockoutDays,
        coverForecast: p.forecast > 0 ? p.inventory / p.forecast : 0,
        coverDemand: p.demand > 0 ? p.inventory / p.demand : 0,
        endInv: invB[HORIZON]
      }
    };
  }

  /* ---------- 画布 ---------- */
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
  function draw(progress, stageIndex) {
    const c = state.canvas, ctx = state.ctx;
    if (!c || !ctx) return;
    const W = state.cssW, H = state.cssH;
    if (!W || !H) return;
    const si = stageIndex == null ? state.stageIndex : stageIndex;
    const els = unlockedElements(si);
    const series = computeSeries(si);
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

    // 网格
    const grid = cssVar("--line");
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    [0, 60, 120, 180].forEach((d) => {
      ctx.beginPath(); ctx.moveTo(x(d), padT); ctx.lineTo(x(d), padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--muted"); ctx.font = "11px sans-serif";
      ctx.fillText("D" + d, x(d) - 8, H - 8);
    });

    // 第 1 关：还没开始卖 → 平静的横线上写大字
    if (si === 0) {
      ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x(0), zeroY); ctx.lineTo(x(HORIZON), zeroY); ctx.stroke();
      ctx.fillStyle = cssVar("--ink"); ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("📦 库存 " + fmt(p.inventory) + " 件 —— 还没开始卖", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }

    const progDay = Math.max(0, Math.min(HORIZON, Math.floor(progress * HORIZON)));

    // 安全库存线（第 6 关起）
    if (els.has("safety")) {
      const safeLevel = p.safetyDays * p.demand;
      if (safeLevel <= yMax && safeLevel >= yMin) {
        ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(padL, y(safeLevel)); ctx.lineTo(padL + plotW, y(safeLevel)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif";
        ctx.fillText("安全库存线", padL + 4, y(safeLevel) - 5);
      }
    }

    // 绿色有货区
    ctx.fillStyle = "rgba(23,121,87,0.20)";
    ctx.beginPath(); ctx.moveTo(x(0), zeroY);
    for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.max(inv[d], 0)));
    ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();

    // 红色超卖区（第 3 关起）
    if (els.has("sellout")) {
      ctx.fillStyle = "rgba(184,60,52,0.20)";
      ctx.beginPath(); ctx.moveTo(x(0), zeroY);
      for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.min(inv[d], 0)));
      ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();
    }

    // 真实库存曲线
    ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let d = 0; d <= progDay; d++) {
      const yy = y(inv[d]);
      if (d === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
    }
    ctx.stroke();

    // 预测线（第 4 关起，虚线）
    if (els.has("forecast") && series.invF) {
      ctx.strokeStyle = cssVar("--purple"); ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let d = 0; d <= progDay; d++) {
        const yy = y(series.invF[d]);
        if (d === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
      }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--purple"); ctx.font = "11px sans-serif";
      ctx.fillText("你的预测（计划）", padL + plotW - 96, y(series.invF[progDay]) - 6);
    }

    // 促销起点竖线（第 7 关、且 promo>1）
    if (els.has("promo") && p.promo > 1 && p.promoDay <= progDay) {
      const px = x(p.promoDay);
      ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif";
      ctx.fillText("促销开始", px - 12, padT + 12);
    }

    // 补货箭头（第 5 关起）
    if (els.has("leadTime") && series.metrics.arrivalDay >= 0 && series.metrics.arrivalDay <= progDay && p.replenish > 0) {
      const ax = x(series.metrics.arrivalDay);
      ctx.strokeStyle = cssVar("--green"); ctx.fillStyle = cssVar("--green"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, padT + 4); ctx.lineTo(ax, padT + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 5, padT + 10); ctx.lineTo(ax, padT + 2); ctx.lineTo(ax + 5, padT + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cssVar("--green"); ctx.font = "11px sans-serif";
      ctx.fillText("+" + fmt(p.replenish), ax - 10, padT + 36);
    }

    // 售罄标记（第 3 关起）
    if (els.has("sellout") && series.metrics.sellOutDay >= 0 && series.metrics.sellOutDay <= progDay) {
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

  /* ---------- 读数面板（按关显示相关指标）---------- */
  function updateReadout() {
    const el = $("labReadout");
    if (!el) return;
    const si = state.stageIndex;
    const m = computeSeries(si).metrics;
    const badge = (txt, cls) => `<span class="ro-badge ${cls}">${txt}</span>`;
    const rows = [];
    rows.push(["库存", fmt(state.current.inventory) + " 件"]);
    if (si >= 1) rows.push(["日均销量", fmt(state.current.demand) + " 件/天"]);
    if (si >= 1) rows.push(["库存覆盖", fmt(m.coverDemand) + " 天"]);
    if (si >= 2) rows.push(["售罄日", m.sellOutDay < 0 ? "不会售罄" : "D" + m.sellOutDay + " 天"]);
    if (si >= 3) rows.push(["预测覆盖", fmt(m.coverForecast) + " 天" + (m.coverForecast < m.coverDemand ? " ⚠偏低" : "")]);
    if (si >= 4) rows.push(["下单日 / 到货日", (m.orderDay >= 0 ? "D" + m.orderDay : "—") + " / " + (m.arrivalDay >= 0 ? "D" + m.arrivalDay : "—")]);
    if (si >= 4) rows.push(["缺货天数", m.stockoutDays > 0 ? badge(m.stockoutDays + " 天", "bad") : "0 天"]);
    if (si >= 6) rows.push(["促销期日销", fmt(state.current.demand * state.current.promo) + " 件/天"]);
    el.innerHTML = `<div class="ro-grid">` + rows.map(([k, v]) =>
      `<div class="ro-cell"><span class="ro-k">${k}</span><span class="ro-v">${v}</span></div>`).join("") + `</div>`;
  }

  /* ---------- 滑块（只显示本关及之前解锁的因子）---------- */
  function buildSliders() {
    const wrap = $("labParams");
    if (!wrap) return;
    const params = unlockedParams(state.stageIndex);
    wrap.innerHTML = "";
    const newSet = new Set(Array.isArray(STAGES[state.stageIndex].newParam)
      ? STAGES[state.stageIndex].newParam : (STAGES[state.stageIndex].newParam ? [STAGES[state.stageIndex].newParam] : []));
    params.forEach((name) => {
      const def = PARAMS[name];
      const row = document.createElement("div");
      row.className = "lab-field" + (newSet.has(name) ? " glow" : "");
      row.dataset.param = name;
      row.innerHTML =
        `<div class="lab-field-top"><label>${def.label}${newSet.has(name) ? ' <span class="lab-new">新</span>' : ''}</label><span class="lab-val" id="labVal_${name}"></span></div>` +
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
    Object.keys(state.inputs).forEach((name) => {
      const input = state.inputs[name];
      if (!input) return;
      input.value = state.current[name];
      $("labVal_" + name).textContent = fmt(Number(state.current[name])) + " " + PARAMS[name].unit;
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

  /* ---------- 元素进度条 ---------- */
  function renderElements() {
    const el = $("labElements");
    if (!el) return;
    el.innerHTML = STAGES.map((s, i) => {
      const done = i < state.stageIndex;
      const cur = i === state.stageIndex;
      const cls = cur ? "current" : (done ? "done" : "");
      return `<span class="lab-chip ${cls}" title="${s.newLabel}">${s.newLabel}</span>`;
    }).join("");
  }

  /* ---------- 切关 ---------- */
  function applyStage(i) {
    state.stageIndex = (i + STAGES.length) % STAGES.length;
    const S = STAGES[state.stageIndex];
    state.current = Object.assign({}, S.baseline);
    buildSliders();
    syncSliders();
    $("labLogic").textContent = S.logic;
    $("labStep").textContent = (state.stageIndex + 1) + " / " + STAGES.length;
    $("labTitle").textContent = S.title;
    $("labIntro").innerHTML = S.intro;
    $("labInstruct").innerHTML = `<b>怎么拖：</b>${S.instruct}`;
    $("labObserve").innerHTML = `<b>看什么：</b>${S.observe}`;
    const next = $("labNext");
    next.textContent = (state.stageIndex === STAGES.length - 1) ? "↺ 回到第 1 关" : "下一步 →";
    renderElements();
    draw(1); updateReadout();
  }

  function demoStage() {
    const S = STAGES[state.stageIndex];
    if (!S.demoTarget) return;
    Object.keys(S.demoTarget).forEach((k) => setParam(k, S.demoTarget[k], true));
  }
  function nextStage() { applyStage(state.stageIndex + 1); }

  /* ---------- 一键模拟 ---------- */
  function play() {
    if (typeof requestAnimationFrame === "undefined") { draw(1); return; }
    if (state.raf) cancelAnimationFrame(state.raf);
    const dur = 2400, t0 = performance.now();
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
    applyStage(0);
    $("labPlay").addEventListener("click", play);
    $("labReset").addEventListener("click", () => applyStage(state.stageIndex));
    $("labDemo").addEventListener("click", demoStage);
    $("labNext").addEventListener("click", nextStage);
    window.addEventListener("resize", () => {
      if ($("labView") && !$("labView").hidden) { resizeCanvas(); draw(state.progress || 1); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
