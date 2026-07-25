/* ============================================================
 * lab-core.js — 动画实验室 v3（看图说话：每个元素都解释为啥用这个几何形状）
 * 设计：7 关逐步「长出」图；每关引入 1-2 个新视觉元素 + 解释它的几何含义。
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
  // element: 本关新加到图上的视觉元素
  // dict:    本关新引入的"看图词典"术语
  const STAGES = [
    {
      logic: "坐标系",
      title: "看图先认坐标系：横着是时间，竖着是库存",
      element: "axis",
      newParam: ["inventory"],
      newLabel: "📐 坐标系",
      intro:
        "先别急——这张图是个「坐标图」。<b>横着</b>（从左到右）是<b>时间</b>，单位「天」；<b>竖着</b>（从下到上）是<b>你手里有几件货</b>。" +
        "今天没开始卖，库存不变，所以是一条<b>横线</b>。横线<b>高度</b> = 你有几件货（值越大线越高）。",
      instruct: "拖【期初库存】让横线<b>明显地</b>上下平移——值越大，线越高；值=0，线贴底（注意 y 轴刻度是固定的 0/3千/6千/9千/12千，线会在这些刻度间上下走）。",
      observe: "观察：横线 = 库存不变。线的高度 = 你有几件货。",
      baseline: { inventory: 3000, demand: 0, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { inventory: 9000 },
      dict: [
        { k: "📐 坐标图", v: "横=时间(天)，竖=库存(件)。看任何经营指标都靠它。" },
        { k: "━ 横线", v: "高度 = 你有几件货。横着不动 = 库存不变。" }
      ]
    },
    {
      logic: "日销",
      title: "日均销量：库存线为啥从横变斜？",
      element: "demand",
      newParam: ["demand"],
      newLabel: "📉 每天卖出",
      intro:
        "「日均销量」= 平均每天卖几件。先假设每天卖一样多。<br>" +
        "<b>为啥库存线变斜了？</b>每过 1 天，库存就少「日均销量」件——线每走一格（向右 1 天）就向下掉「日销」件。<br>" +
        "<b>斜率</b>（线陡不陡）= -日销。日销越大，线越陡。<br>" +
        "<b>三角形面积</b> = 一共卖出了多少件。三角形 = (1/2) × 底 × 高 = (1/2) × 天数 × 库存 = 全部库存卖光。",
      instruct: "拖【真实日均销量】从 27 拉到 54：📉 绿斜线越来越陡（斜率绝对值变大），🔺 三角形被「压扁」——底变短（更快卖完）但高不变。",
      observe: "观察 📉 绿斜线：日销 ↑ → 斜率更陡 → 更快撞到 0。观察 ▨ 绿色填充：三角形面积 = 这批货一共能卖出的总件数。",
      baseline: { inventory: 4800, demand: 27, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { demand: 54 },
      dict: [
        { k: "📉 斜线", v: "每向右 1 天，库存减「日均销量」件。斜率 = -日销。" },
        { k: "🔺 三角形", v: "斜线 + 横线 + 纵线围成的面积 = 一共卖出几件 = 初始库存。" },
        { k: "▨ 绿色填充", v: "线下方到 0 的区域 = 「现在有货」覆盖的时间-件数对。" }
      ]
    },
    {
      logic: "售罄",
      title: "售罄日：库存线撞到 0 的那一天",
      element: "sellout",
      newParam: null,
      newLabel: "🔴 售罄日",
      intro:
        "斜线一路往下掉，撞到 0 那天就是<b>售罄日</b>——你货全卖光了，再往后就没得卖。<br>" +
        "从今天到售罄日之间的天数 = <b>库存覆盖天数</b> = 库存 ÷ 日销。<br>" +
        "<b>为啥用一根红色竖线？</b>竖线能精确标出「那一天」在时间轴的哪个位置——一眼看到还能撑多久。",
      instruct: "再拖【真实日均销量】拉高：▏红竖虚线往左移（更早断货）；拉低：红竖虚线右移（撑更久）。",
      observe: "观察 ▏红竖虚线 = 售罄日（📉 绿线撞到 0 那天）。观察读数「库存覆盖」= 库存 ÷ 日销 = 红线离今天多少天。",
      baseline: { inventory: 4800, demand: 32, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { demand: 64 },
      dict: [
        { k: "▏ 红竖线", v: "标记「库存掉到 0」的那一天在时间轴上的位置。" },
        { k: "📅 覆盖天数", v: "从今天到售罄日 = 库存 ÷ 日销。日销越大覆盖越短。" }
      ]
    },
    {
      logic: "预测",
      title: "预测线：你的「计划」vs 真实",
      element: "forecast",
      newParam: ["forecast"],
      newLabel: "🟣 预测线",
      intro:
        "你开工前会先「预测」每天能卖多少——这就是<b>计划</b>。<br>" +
        "<b>为啥用虚线？</b>虚线 = 还没发生 = 计划。绿实线 = 真实。<br>" +
        "如果预测 < 真实：你以为还够，其实已经偷偷断货；两条线分得越开，决策错得越远。",
      instruct: "拖【预测日均销量】从 32 拉到和真实 48 一样：╌ 紫虚线越来越贴近 📉 绿实线，两线重合 = 计划对得上现实。",
      observe: "观察 ╌ 紫虚线（计划）和 📉 绿实线（真实）之间的张口：口越大 = 预测错得越远。紫线更平缓 = 你低估了销量 → 会突然断货。",
      baseline: { inventory: 4800, demand: 48, forecast: 32, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { forecast: 48 },
      dict: [
        { k: "🟣 紫虚线", v: "「计划」曲线 = 按你预测的日销算出的库存走势。虚线代表还没发生。" },
        { k: "📊 双线差", v: "紫线低过绿线 = 计划低估了真实需求 → 决策会断货。" }
      ]
    },
    {
      logic: "补货",
      title: "补货提前期：箭头为啥在那一时刻？",
      element: "leadTime",
      newParam: ["leadTime", "replenish"],
      newLabel: "🟢 补货到货",
      intro:
        "现实里：库存快没了要补货，但货从下单到上架要等很久（<b>提前期</b>）。<br>" +
        "<b>绿色箭头 = 到货日</b>。箭头下方数字 = 一次补进来几件。<br>" +
        "如果<b>到货日 > 售罄日</b>，中间就是<b>红色缺货区</b>——你明明卖得动却没货可卖（少赚 + 评分降）。",
      instruct: "拖【补货提前期】从 140 拉到 160：🔻 绿箭头右移，🟥 红色缺货区变大；再拖【补货量】看补多少能把绿线抬回 0 之上。",
      observe: "观察 🔻 绿箭头（到货日）和 ▏红竖虚线（售罄日）的前后关系：箭头在红线右边 = 到货太晚 = 中间全是 🟥 缺货区。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { leadTime: 160 },
      dict: [
        { k: "🔻 绿箭头", v: "到货那一刻 = 下单日 + 提前期。箭头下方数字 = 一次补几件。" },
        { k: "🟥 红缺货区", v: "售罄日到到货日之间 = 零货可卖的天数。最痛的那段。" }
      ]
    },
    {
      logic: "安全",
      title: "安全库存：为啥要提前画一条线？",
      element: "safety",
      newParam: ["safetyDays"],
      newLabel: "🟠 安全库存线",
      intro:
        "别等售罄才下单！留个「安全垫」：<b>库存线掉到琥珀虚线就立刻下单</b>。<br>" +
        "<b>琥珀线高度 = 安全天数 × 日销</b>。比如安全 7 天、日销 48 → 线高度 = 336 件。<br>" +
        "它不延长物流，只把<b>下单那一刻提前</b>——箭头跟着提前，缺货区可能消失。",
      instruct: "拖【安全库存天数】从 14 拉到 30：⚌ 琥珀虚线抬高 → 库存线更早撞到它 → 下单提前 → 🔻 绿箭头左移 → 🟥 红缺口缩小甚至消失。",
      observe: "观察 ⚌ 琥珀虚线的高度 = 安全天数 × 日销（14 天 × 48 件 = 672 件）。观察 🔻 绿箭头：安全天数越大，箭头越靠左（越早到货）。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 14, promo: 1, promoDay: 60 },
      demoTarget: { safetyDays: 30 },
      dict: [
        { k: "⚌ 琥珀虚线", v: "「警戒线」。库存掉到这条线立刻下单。高度 = 安全天数 × 日销。" },
        { k: "🛟 缓冲", v: "安全天数越大 → 越早下单 → 越能躲过红缺货区，但会压更多库存。" }
      ]
    },
    {
      logic: "促销",
      title: "促销尖峰：线为啥突然变陡？",
      element: "promo",
      newParam: ["promo", "promoDay"],
      newLabel: "🟡 促销尖峰",
      intro:
        "大促期间销量会临时放大 N 倍（<b>促销系数</b>，1 表示不促销，2.5 表示日销 × 2.5）。<br>" +
        "<b>线为啥突然变陡？</b>斜率 = -日销，促销期日销变大 → 斜率绝对值变大 → 线更陡 = <b>尖峰</b>。<br>" +
        "<b>为啥用一条竖虚线标「促销开始」？</b>让你一眼看到「从这里开始斜率变了」。<br>" +
        "光加广告不补货 = 尖峰压垮库存，库存骤降到 0。",
      instruct: "拖【促销系数】从 1.4 拉到 2.5：🟡 尖峰更陡，库存断崖式下跌；再调【促销开始日】看 ▏琥珀竖虚线（= 斜率切换点）左右移动。",
      observe: "观察 🟡 尖峰：促销开始日之后 📉 绿线突然变陡（斜率 × 促销系数）。观察 ▏琥珀竖虚线：它标出「从这天起线变陡」。",
      baseline: { inventory: 4000, demand: 40, forecast: 40, leadTime: 140, replenish: 4000, safetyDays: 21, promo: 1.4, promoDay: 60 },
      demoTarget: { promo: 2.5 },
      dict: [
        { k: "🟡 尖峰", v: "促销期斜率临时放大 = 线突然变陡。日销 × 促销系数。" },
        { k: "▏ 琥珀竖虚线", v: "促销开始日 = 斜率「切换」那一刻。把它提前 → 库存要更早备够。" }
      ]
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

  // 每关累计的看图词典
  function dictFor(i) {
    const out = [];
    for (let s = 0; s <= i; s++) (STAGES[s].dict || []).forEach((d) => out.push(d));
    return out;
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

    // 预测线（第 4 关后）：按预测日销算出的「计划库存曲线」
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
  // 生成 4 档「好看」刻度（如 yMax=3200 → [0, 1000, 2000, 3000]）
  function makeTicks(yMax, n) {
    const step = Math.pow(10, Math.floor(Math.log10(yMax / n)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * step);
    const s = nice.find((v) => v * (n - 1) >= yMax) || step;
    const out = [];
    for (let v = 0; v <= yMax + 0.001; v += s) out.push(Math.round(v));
    if (out[out.length - 1] < yMax) out.push(Math.round(out[out.length - 1] + s));
    return out;
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

  // 中文时间轴标签：今天 / 60 天后 / 120 天后 / 180 天后
  function dayLabel(d) {
    if (d === 0) return "今天";
    return "第 " + (d + 1) + " 天";   // d=60 → 第 61 天（直觉：60 天后是第 61 天）
  }
  // 改：为了更直觉「60 天后」就直接是「60 天后」用别的格式
  function dayLabelV(d) {
    if (d === 0) return "今天";
    return d + " 天后";
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

    const padL = 60, padR = 16, padT = 22, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    // 第 1 关：yMax 固定为 12000（让库存线在固定刻度里上下移动，不被 inventory「顶天」）
    let yMax, yMin = Math.min(0, ...inv);
    if (si === 0) {
      yMax = 12000;
    } else {
      yMax = Math.max(p.inventory, ...inv, 1);
    }
    const x = (d) => padL + (d / HORIZON) * plotW;
    const y = (v) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const zeroY = y(0);

    ctx.clearRect(0, 0, W, H);

    // 网格 + 时间轴标签（中文）
    const grid = cssVar("--line");
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    [0, 60, 120, 180].forEach((d) => {
      ctx.beginPath(); ctx.moveTo(x(d), padT); ctx.lineTo(x(d), padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--muted"); ctx.font = "11.5px sans-serif";
      ctx.fillText(dayLabelV(d), x(d) - 14, H - 10);
    });

    // 库存线（粗、亮）
    ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let d = 0; d <= HORIZON; d++) {
      const yy = y(Math.max(inv[d], yMin));
      if (d === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
    }
    ctx.stroke();

    // y 轴刻度：第 1 关固定 5 档；其他关按 yMax 选 4 档
    const yTicks = (si === 0) ? [0, 3000, 6000, 9000, 12000] : makeTicks(yMax, 4);
    ctx.fillStyle = cssVar("--muted"); ctx.font = "11px sans-serif"; ctx.textAlign = "right";
    yTicks.forEach((t) => {
      if (t > 0) {
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y(t)); ctx.lineTo(padL + plotW, y(t)); ctx.stroke();
      }
      ctx.fillText((t >= 1000 ? (t / 1000) + "千" : t) + " 件", padL - 6, y(t) + 4);
    });
    ctx.textAlign = "left";

    // 第 1 关：横线 + 大字标"这是你的家底"（不画填充）
    if (si === 0) {
      ctx.fillStyle = cssVar("--ink"); ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("━ 这是一条横线，高度 = 你今天有 " + fmt(p.inventory) + " 件货", W / 2, padT + 22);
      ctx.fillStyle = cssVar("--muted"); ctx.font = "12px sans-serif";
      ctx.fillText("下面会教：让它一天天掉、撞到 0、撞到之前补货回来……", W / 2, padT + 42);
      ctx.textAlign = "left";
      return;
    }

    const progDay = Math.max(0, Math.min(HORIZON, Math.floor(progress * HORIZON)));

    // 绿色有货区（库存线下方到 0 的填充）
    ctx.fillStyle = "rgba(23,121,87,0.18)";
    ctx.beginPath(); ctx.moveTo(x(0), zeroY);
    for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.max(inv[d], 0)));
    ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();

    // 红色超卖区（第 3 关起）
    if (els.has("sellout")) {
      ctx.fillStyle = "rgba(184,60,52,0.22)";
      ctx.beginPath(); ctx.moveTo(x(0), zeroY);
      for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(Math.min(inv[d], 0)));
      ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();
    }

    // 真实库存曲线（覆盖到 0 之下时改红）
    ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2.4;
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
      ctx.fillText("你的预测（计划）", padL + plotW - 100, y(series.invF[progDay]) - 6);
    }

    // 促销起点竖线（第 7 关、且 promo>1）
    if (els.has("promo") && p.promo > 1 && p.promoDay <= progDay) {
      const px = x(p.promoDay);
      ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif";
      ctx.fillText("促销开始", px - 16, padT + 12);
    }

    // 安全库存警戒线（第 6 关起，琥珀横向虚线；高度 = 安全天数 × 日销）
    if (els.has("safety") && p.safetyDays > 0 && p.demand > 0) {
      const safeLevel = p.safetyDays * p.demand;
      if (safeLevel < yMax) {
        const sy = y(safeLevel);
        ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([7, 5]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(padL, sy); ctx.lineTo(padL + plotW, sy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cssVar("--amber"); ctx.font = "bold 11px sans-serif";
        ctx.fillText("⚠ 安全线 " + fmt(safeLevel) + " 件（" + p.safetyDays + " 天 × 日销）", padL + 6, sy - 6);
      }
    }

    // 补货箭头（第 5 关起）
    if (els.has("leadTime") && series.metrics.arrivalDay >= 0 && series.metrics.arrivalDay <= progDay && p.replenish > 0) {
      const ax = x(series.metrics.arrivalDay);
      ctx.strokeStyle = cssVar("--green"); ctx.fillStyle = cssVar("--green"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, padT + 4); ctx.lineTo(ax, padT + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 5, padT + 10); ctx.lineTo(ax, padT + 2); ctx.lineTo(ax + 5, padT + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cssVar("--green"); ctx.font = "11px sans-serif";
      ctx.fillText("+" + fmt(p.replenish), ax - 12, padT + 36);
    }

    // 售罄标记（第 3 关起）
    if (els.has("sellout") && series.metrics.sellOutDay >= 0 && series.metrics.sellOutDay <= progDay) {
      const sx = x(series.metrics.sellOutDay);
      ctx.strokeStyle = cssVar("--red"); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--red"); ctx.font = "bold 11px sans-serif";
      ctx.fillText("售罄 · 第 " + (series.metrics.sellOutDay + 1) + " 天", sx + 4, padT + 12);
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
    if (si >= 2) rows.push(["售罄日", m.sellOutDay < 0 ? "不会售罄" : "第 " + (m.sellOutDay + 1) + " 天（还能撑 " + Math.max(0, m.sellOutDay) + " 天）"]);
    if (si >= 3) rows.push(["预测覆盖", fmt(m.coverForecast) + " 天" + (m.coverForecast < m.coverDemand ? " ⚠偏低" : "")]);
    if (si >= 4) rows.push(["下单日 / 到货日", (m.orderDay >= 0 ? "第 " + (m.orderDay + 1) + " 天" : "—") + " / " + (m.arrivalDay >= 0 ? "第 " + (m.arrivalDay + 1) + " 天" : "—")]);
    if (si >= 4) rows.push(["缺货天数", m.stockoutDays > 0 ? badge(m.stockoutDays + " 天", "bad") : "0 天"]);
    if (si >= 6) rows.push(["促销期日销", fmt(state.current.demand * state.current.promo) + " 件/天"]);
    el.innerHTML = `<div class="ro-grid">` + rows.map(([k, v]) =>
      `<div class="ro-cell"><span class="ro-k">${k}</span><span class="ro-v">${v}</span></div>`).join("") + `</div>`;
    renderLegend(); // 图例跟着参数实时增减（如促销系数拉到 1 尖峰消失，图例也移除）
  }

  /* ---------- 滑块（只显示本关及之前解锁的因子）---------- */
  function buildSliders() {
    const wrap = $("labParams");
    if (!wrap) return;
    const params = unlockedParams(state.stageIndex);
    wrap.innerHTML = "";
    state.inputs = {}; // 清掉上一关残留的失效引用（否则 syncSliders 会摸到已拆除的 DOM）
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
      const lbl = $("labVal_" + name);
      if (!input || !lbl) return;
      input.value = state.current[name];
      lbl.textContent = fmt(Number(state.current[name])) + " " + PARAMS[name].unit;
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

  /* ---------- 看图词典（侧栏底部）---------- */
  function renderDict() {
    const el = $("labDict");
    if (!el) return;
    const items = dictFor(state.stageIndex);
    el.innerHTML =
      `<div class="lab-dict-head">📖 看图词典 · 跟着这一关学的几何</div>` +
      items.map((d) =>
        `<div class="lab-dict-row"><span class="lab-dict-k">${d.k}</span><span class="lab-dict-v">${d.v}</span></div>`
      ).join("");
  }

  /* ---------- 🧩 动态图例：只列「画布上此刻真实存在」的元素 ---------- */
  // 每条：icon(形状) / color(CSS 变量) / name / where(图里啥样) / why(为啥这形状) / biz(业务含义) / when(可见条件)
  const LEGEND = [
    {
      icon: "📐", color: "--muted", name: "坐标网格",
      where: "灰色竖线 + 底部「今天 / 60 天后…」+ 左侧「N 件」刻度",
      why: "横轴 = 时间（天），纵轴 = 库存（件）——所有元素都画在这个网格上",
      biz: "看任何经营走势图都先认这两根轴",
      when: () => true
    },
    {
      icon: "━", color: "--green", name: "库存横线（绿）",
      where: "一条水平的绿线，横贯全图",
      why: "还没开始卖 → 库存每天都一样 → 线不上不下 = 横线；高度 = 你有几件",
      biz: "这是你的「家底」：今天手里的全部货",
      when: (p, m, si) => si === 0
    },
    {
      icon: "📉", color: "--green", name: "库存斜线（绿）",
      where: "从左上往右下掉的绿线",
      why: "每过 1 天库存减「日销」件 → 线向右走 1 格就向下掉一点；斜率 = -日销，线越陡卖越快",
      biz: "你的货正在一天天变少",
      when: (p, m, si) => si >= 1
    },
    {
      icon: "▨", color: "--green", name: "绿色填充（有货区）",
      where: "绿线下方到 0 之间的淡绿色三角形区域",
      why: "面积 = (1/2)×天数×库存 = 这批货一共卖出的总件数",
      biz: "填充越大 = 这批货能创造的总销量越多",
      when: (p, m, si) => si >= 1
    },
    {
      icon: "▏", color: "--red", name: "红竖虚线（售罄日）",
      where: "一根从上到下的红色竖虚线 + 「售罄 · 第 N 天」标签",
      why: "竖线能精确标出「那一天」在时间轴的位置——绿线撞到 0 的那天",
      biz: "过了这天你就没货可卖了",
      when: (p, m, si) => si >= 2 && m.sellOutDay >= 0
    },
    {
      icon: "🟥", color: "--red", name: "红色缺货区",
      where: "0 线以下的淡红色区域",
      why: "库存已经是负数 = 「本来卖得掉却没货」的部分，面积越大损失越大",
      biz: "少赚的钱 + 断货导致的链接权重下降",
      when: (p, m, si) => si >= 2 && m.stockoutDays > 0
    },
    {
      icon: "╌", color: "--purple", name: "紫虚线（你的预测）",
      where: "一条紫色的虚线，和绿线一起往下走",
      why: "虚线 = 还没发生 = 计划；绿实线 = 真实。两线岔开 = 预测错了",
      biz: "预测偏低会突然断货；偏高会压仓",
      when: (p, m, si) => si >= 3
    },
    {
      icon: "🔻", color: "--green", name: "绿箭头（补货到货）",
      where: "顶部一个绿色向上箭头 + 「+N」件数",
      why: "箭头指向「到货那一刻」在时间轴的位置 = 下单日 + 提前期",
      biz: "货从下单到可售要等提前期，等太久就先断货",
      when: (p, m, si) => si >= 4 && m.arrivalDay >= 0
    },
    {
      icon: "⚌", color: "--amber", name: "琥珀横虚线（安全线）",
      where: "一条水平的琥珀色虚线 + 「⚠ 安全线 N 件」",
      why: "高度 = 安全天数 × 日销；绿线掉到这条线 = 立刻下单的信号",
      biz: "不等售罄才补货，提前下单躲开缺货区",
      when: (p, m, si) => si >= 5 && p.safetyDays > 0
    },
    {
      icon: "▏", color: "--amber", name: "琥珀竖虚线（促销开始）",
      where: "促销开始日位置一根琥珀色竖虚线",
      why: "标出「从这天起斜率切换」——线从这里开始突然变陡",
      biz: "大促开始的那一刻",
      when: (p, m, si) => si >= 6 && p.promo > 1
    },
    {
      icon: "🟡", color: "--amber", name: "促销尖峰",
      where: "竖虚线右侧，绿线突然变陡的那一段",
      why: "促销期日销 × 促销系数 → 斜率放大 → 更陡 = 尖峰",
      biz: "光加广告不补货 = 尖峰压垮库存，加速断货",
      when: (p, m, si) => si >= 6 && p.promo > 1
    },
    {
      icon: "●", color: "--purple", name: "紫色播放头",
      where: "一键模拟时从左扫到右的紫竖线 + 圆点",
      why: "标出动画「播到第几天」，圆点吸在当天的库存值上",
      biz: "带你逐天检查库存怎么变",
      when: (p, m, si) => si >= 1
    }
  ];

  function renderLegend() {
    const el = $("labLegend");
    if (!el) return;
    const si = state.stageIndex;
    const p = state.current;
    const m = computeSeries(si).metrics;
    const items = LEGEND.filter((it) => it.when(p, m, si));
    el.innerHTML =
      `<div class="lab-card-title">🧩 图上现在有什么（${items.length} 个元素）</div>` +
      items.map((it) => {
        return `<div class="lab-legend-item">` +
          `<span class="lab-legend-swatch" style="color:var(${it.color})">${it.icon}</span>` +
          `<span class="lab-legend-body">` +
            `<span class="lab-legend-name">${it.name}</span>` +
            `<span class="lab-legend-where">👁 图里啥样：${it.where}</span>` +
            `<span class="lab-legend-why">🤔 为啥这样画：${it.why}</span>` +
            `<span class="lab-legend-biz">💼 意味着：${it.biz}</span>` +
          `</span>` +
        `</div>`;
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
    $("labIntro").innerHTML =
      `<span class="lab-intro-badge">🧩 本关图上新增：${S.newLabel}</span>` + S.intro;
    $("labInstruct").innerHTML = S.instruct;
    $("labObserve").innerHTML = S.observe;
    const next = $("labNext");
    next.textContent = (state.stageIndex === STAGES.length - 1) ? "↺ 回到第 1 关" : "下一步 →";
    renderElements();
    renderDict();
    draw(1); updateReadout();
  }

  function demoStage() {
    const S = STAGES[state.stageIndex];
    if (!S.demoTarget) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    // 1) 滑块动画滑到 demoTarget（600ms，能看到线跟着参数变）
    Object.keys(S.demoTarget).forEach((k) => setParam(k, S.demoTarget[k], true));
    // 2) 参数到位后，播放头从今天扫到 180 天后（1.2s）
    setTimeout(() => {
      const dur = 1200, t0 = performance.now();
      state.playing = true;
      function frame(now) {
        let pr = (now - t0) / dur; if (pr > 1) pr = 1;
        state.progress = pr;
        draw(pr);
        if (pr < 1) state.raf = requestAnimationFrame(frame);
        else {
          state.playing = false; state.progress = 1; draw(1); updateReadout();
          // 3) 演示完恢复 baseline（方便你自己拖一遍）
          setTimeout(() => {
            Object.keys(S.baseline).forEach((k) => {
              const lbl = $("labVal_" + k);
              if (state.inputs[k] && lbl) {
                state.inputs[k].value = S.baseline[k];
                lbl.textContent = fmt(S.baseline[k]) + " " + PARAMS[k].unit;
              }
              state.current[k] = S.baseline[k];
            });
            draw(1); updateReadout();
          }, 800);
        }
      }
      state.raf = requestAnimationFrame(frame);
    }, 700);
  }
  function nextStage() { applyStage(state.stageIndex + 1); }

  /* ---------- 一键模拟（自动演示整段：瞬间设到本关关键参数 → 时间扫描 → 回到 baseline）---------- */
  function autoDemo() {
    const S = STAGES[state.stageIndex];
    if (state.raf) cancelAnimationFrame(state.raf);

    // 1) 立即把本关关键参数设到 demoTarget（库存线 / 斜率 / 三角形等都瞬间变到位）
    if (S.demoTarget) {
      Object.keys(S.demoTarget).forEach((k) => {
        const v = clamp(S.demoTarget[k], PARAMS[k].min, PARAMS[k].max);
        if (state.inputs[k]) {
          state.inputs[k].value = v;
          $("labVal_" + k).textContent = fmt(v) + " " + PARAMS[k].unit;
        }
        state.current[k] = v;
      });
    }
    draw(1); updateReadout();

    // 2) 播放头从今天扫到 180 天后
    const dur = 2400, t0 = performance.now();
    state.playing = true;
    function frame(now) {
      let p = (now - t0) / dur; if (p > 1) p = 1;
      state.progress = p;
      draw(p);
      if (p < 1) state.raf = requestAnimationFrame(frame);
      else {
        state.playing = false; state.progress = 1; draw(1); updateReadout();
        // 3) 演示完恢复 baseline（方便用户继续拖）
        Object.keys(S.baseline).forEach((k) => {
          if (state.inputs[k]) {
            state.inputs[k].value = S.baseline[k];
            $("labVal_" + k).textContent = fmt(S.baseline[k]) + " " + PARAMS[k].unit;
            state.current[k] = S.baseline[k];
          }
        });
        draw(1); updateReadout();
      }
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
    $("labPlay").addEventListener("click", autoDemo);
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
