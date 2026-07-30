/* ============================================================
 * desk-core.js — 补货作业台核心引擎 v0.18
 *
 * 纯计算，不依赖 DOM——可以直接在 Node/jsdom 里单测，也是未来接 ERP/WMS API 时
 * 唯一不用改的部分：只需写一个把 ERP 字段映射进下面这个 input schema 的适配器，
 * planReplenishment() 本身不用动一行。
 *
 * 跟教学三塔（教学训练/自由沙盘/动画实验室）用的教学引擎的核心区别：
 * - 用真实日历日期（asOfDate + 各批次 etaDate），不是"第N天"这种教学用的相对天数；
 * - 供给侧是多批次在途 pipeline（每个批次各自的数量+ETA），不是"今天一次性补一批货"；
 * - 供给分两层——海外供给（决定发运提货）、全流程供给（决定采购备货）——对应两个
 *   彼此独立的决策，不是自由沙盘那个把两者混在一起算的 orderQty；
 * - 发运量会被国内可发库存封顶：这正是"缺 1,375 件却只能发 144 件"那道标准例题的机制
 *   （海外缺口再大，这一次能发的也不会超过国内现在实际有的货）。
 *
 * 教学三塔刻意保留理想化的单批次/相对天数模型——那是为了教学循序渐进，不是这里要
 * 修的 bug，本文件完全独立，不改任何教学逻辑。
 * ============================================================ */
(function () {
  "use strict";

  function toDate(s) { return new Date(s + "T00:00:00"); }
  function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  // 不能用 d.toISOString().slice(0,10)——toISOString 先转 UTC 再切片，toDate() 造出来的
  // 都是本地时区的当天 00:00，东八区这种 UTC+8 的时区下 toISOString 会把日期拨回前一天
  // （本地 7/30 00:00 → UTC 7/29 16:00），导致断货日/最晚下单日全部显示早了一天。
  // 用本地年月日拼字符串，跟 toDate() 的解析方式对称，才能正确往返。
  function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function sumQty(batches) { return (batches || []).reduce((s, b) => s + (Number(b.qty) || 0), 0); }

  /* ---------- 逐日推演：多批次在途按各自 ETA 注入，扣日销，clamp 到 0 ----------
   * 语义跟 lab-core.js 的 simulate() 保持一致：inv[0] = 期初库存（今天，asOfDate 当天，
   * 还没发生任何消耗），从 day=1 起才依次注入当天到货、再扣当天销量。
   * ETA 早于或等于 asOfDate 的批次视为"已经到货"，直接并入期初库存（inv[0]）。 */
  function projectTimeline(input) {
    const asOf = toDate(input.asOfDate);
    const horizon = input.horizonDays;
    const daily = input.demand.dailyForecast;
    const arrivalByDay = {};
    let day0Extra = 0;
    (input.supply.overseasInTransit || []).forEach((b) => {
      const day = daysBetween(asOf, toDate(b.etaDate));
      if (day <= 0) day0Extra += Number(b.qty) || 0;
      else if (day <= horizon) arrivalByDay[day] = (arrivalByDay[day] || 0) + (Number(b.qty) || 0);
    });

    const inv = new Array(horizon + 1);
    inv[0] = input.supply.overseasOnHand + day0Extra;
    let stockoutDay = inv[0] <= 0 ? 0 : null;
    for (let day = 1; day <= horizon; day++) {
      const arrival = arrivalByDay[day] || 0;
      const available = inv[day - 1] + arrival;
      inv[day] = Math.max(0, available - daily);
      if (stockoutDay === null && inv[day] <= 0) stockoutDay = day;
    }

    const timeline = [];
    for (let day = 0; day <= horizon; day++) {
      timeline.push({ day, date: fmtDate(addDays(asOf, day)), inventory: inv[day], arrival: day === 0 ? day0Extra : (arrivalByDay[day] || 0) });
    }
    return { timeline, stockoutDay };
  }

  /* ---------- 单个决策（发运提货 / 采购备货）共用的计算——只是 leadDays/供给/封顶不同 ---------- */
  function decide(asOf, stockoutDay, daily, safetyDays, leadDays, supply, capQty) {
    const need = daily * (leadDays + safetyDays);
    const gapQty = Math.max(0, need - supply);
    const suggestedQty = capQty != null ? Math.min(gapQty, capQty) : gapQty;
    const cappedByDomestic = capQty != null && gapQty > capQty;
    let latestOrderDate = null, latestOrderDay = null, status = "ok";
    if (stockoutDay != null) {
      latestOrderDay = stockoutDay - leadDays - safetyDays;
      latestOrderDate = fmtDate(addDays(asOf, latestOrderDay));
      if (latestOrderDay < 0) status = "missed";
      else if (latestOrderDay <= 7) status = "urgent";
      else status = "ok";
    }
    return { leadDays, need, gapQty, suggestedQty, cappedByDomestic, latestOrderDate, latestOrderDay, status };
  }

  function planReplenishment(input) {
    const asOf = toDate(input.asOfDate);
    const daily = input.demand.dailyForecast;
    const safetyDays = input.policy.safetyDays;

    const { timeline, stockoutDay } = projectTimeline(input);
    const projectedStockoutDate = stockoutDay != null ? fmtDate(addDays(asOf, stockoutDay)) : null;

    // 两层供给：海外供给只算海外的（决定发运提货能不能接住）；全流程供给再加国内库存
    // 和采购在途（决定采购备货够不够）——这是本引擎跟自由沙盘"一个扁平供给数"的核心区别。
    const overseasSupply = input.supply.overseasOnHand + sumQty(input.supply.overseasInTransit);
    const fullSupply = overseasSupply + input.supply.domesticOnHand + sumQty(input.supply.purchaseInTransit);

    const shipLeadDays = input.leadTime.shipping.pickup + input.leadTime.shipping.shipping + input.leadTime.shipping.listing;
    const buyLeadDays = input.leadTime.purchase.reorderInterval + input.leadTime.purchase.production +
      input.leadTime.purchase.pickup + input.leadTime.purchase.shipping + input.leadTime.purchase.listing;

    // 发运提货：只看海外供给，受国内可发库存封顶——"缺1,375只能发144"就是这里的 capQty。
    const shipping = decide(asOf, stockoutDay, daily, safetyDays, shipLeadDays, overseasSupply, input.supply.domesticOnHand);
    // 采购备货：看全流程供给，不封顶（采购本身就是在给国内库存充值，没有"国内库存封顶采购"这回事）。
    const purchase = decide(asOf, stockoutDay, daily, safetyDays, buyLeadDays, fullSupply, null);

    return {
      sku: input.sku, asOfDate: input.asOfDate,
      projectedStockoutDate, daysOfCover: stockoutDay,
      overseasSupply, fullSupply,
      shipping, purchase, timeline
    };
  }

  /* ============================================================
   * 以下是补货作业台的渲染/交互逻辑——只在浏览器里跑（由 teach-core.js 的
   * switchTab("desk") 调用 onShow()），跟上面的纯计算引擎是两回事：
   * 上面的 planReplenishment 不碰 DOM，可以直接单测；下面这些函数全部
   * 依赖 document，verify_lab.js 只测上面那部分，不测这里。
   * ============================================================ */
  const STORAGE_KEY = "sku_desk_input_v1";

  const FIELD_IDS = {
    sku: "deskSku", asOfDate: "deskAsOfDate", dailyForecast: "deskDailyForecast",
    overseasOnHand: "deskOverseasOnHand", domesticOnHand: "deskDomesticOnHand",
    reorderInterval: "deskReorderInterval", production: "deskProduction",
    purchasePickup: "deskPurchasePickup", purchaseShipping: "deskPurchaseShipping", purchaseListing: "deskPurchaseListing",
    shipPickup: "deskShipPickup", shipShipping: "deskShipShipping", shipListing: "deskShipListing",
    safetyDays: "deskSafetyDays"
  };

  let deskInitialized = false;
  let lastResult = null;

  function todayStr() { return fmtDate(new Date()); }

  function defaultState() {
    return {
      sku: "", asOfDate: todayStr(), dailyForecast: 25,
      overseasOnHand: 0, overseasBatches: [],
      domesticOnHand: 0, purchaseBatches: [],
      reorderInterval: 14, production: 45, purchasePickup: 7, purchaseShipping: 53, purchaseListing: 0,
      shipPickup: 7, shipShipping: 53, shipListing: 0,
      safetyDays: 21
    };
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && typeof raw === "object") return Object.assign(defaultState(), raw);
    } catch (e) {}
    return defaultState();
  }

  function saveState(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // v0.19：真实感预设场景——用户反馈"一大堆空的参数让我填，都不知道要从哪里入口，
  // 都不像真实情况"。点一个按钮直接填满一整套有故事背景的数据，参照自由沙盘那 5 个
  // 预设的做法，不用面对空表单。
  const PRESETS = [
    {
      key: "eu_peak", label: "🇪🇺 EU 旺季备货",
      story: "旺季将近，海外仓库存充足、也有一批在途补给在路上，按正常节奏走就行。",
      build: (asOf) => ({
        sku: "EU-旺季款", dailyForecast: 42,
        overseasOnHand: 1800, overseasBatches: [{ qty: 2200, etaDate: fmtDate(addDays(asOf, 35)) }],
        domesticOnHand: 600, purchaseBatches: [{ qty: 3000, etaDate: fmtDate(addDays(asOf, 70)) }],
        reorderInterval: 14, production: 30, purchasePickup: 7, purchaseShipping: 45, purchaseListing: 3,
        shipPickup: 5, shipShipping: 25, shipListing: 2, safetyDays: 14
      })
    },
    {
      key: "new_launch", label: "🆕 新品首单",
      story: "刚上架的新品，海外/国内都还没有库存，第一批货全靠预估下单。",
      build: () => ({
        sku: "新品首单-SKU", dailyForecast: 18,
        overseasOnHand: 0, overseasBatches: [], domesticOnHand: 0, purchaseBatches: [],
        reorderInterval: 7, production: 45, purchasePickup: 7, purchaseShipping: 53, purchaseListing: 5,
        shipPickup: 7, shipShipping: 53, shipListing: 5, safetyDays: 21
      })
    },
    {
      key: "rescue", label: "🚨 断货抢救",
      story: "海外库存快见底、国内可发也不多，正常流程很可能已经来不及了。",
      build: (asOf) => ({
        sku: "紧急抢救-SKU", dailyForecast: 30,
        overseasOnHand: 200, overseasBatches: [],
        domesticOnHand: 50, purchaseBatches: [{ qty: 3000, etaDate: fmtDate(addDays(asOf, 120)) }],
        reorderInterval: 14, production: 45, purchasePickup: 7, purchaseShipping: 53, purchaseListing: 3,
        shipPickup: 7, shipShipping: 53, shipListing: 3, safetyDays: 21
      })
    },
    {
      key: "clearance", label: "📦 清库尾款",
      story: "SKU 快下市，库存压得多，日销也放缓，短期内完全不需要补货。",
      build: () => ({
        sku: "清库尾款-SKU", dailyForecast: 8,
        overseasOnHand: 4000, overseasBatches: [], domesticOnHand: 1500, purchaseBatches: [],
        reorderInterval: 14, production: 45, purchasePickup: 7, purchaseShipping: 53, purchaseListing: 3,
        shipPickup: 7, shipShipping: 53, shipListing: 3, safetyDays: 7
      })
    }
  ];

  function renderPresetButtons() {
    const box = $("deskPresets");
    if (!box) return;
    box.innerHTML = PRESETS.map((p) =>
      `<button type="button" class="desk-preset-btn" data-key="${p.key}" title="${p.story}">${p.label}</button>`
    ).join("");
    box.querySelectorAll(".desk-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = PRESETS.find((p) => p.key === btn.dataset.key);
        if (!preset) return;
        const asOf = new Date();
        const state = Object.assign(defaultState(), { asOfDate: fmtDate(asOf) }, preset.build(asOf));
        fillForm(state);
        saveState(state);
        runAndRender();
      });
    });
  }

  // v0.19：每个字段挂一个 ⓘ 提示——点开告诉你这个字段是什么、去哪儿要这个数据，
  // 解决"一堆空参数不知道从哪里入口"的问题。跟教学章节呼应的字段顺带提一句该看哪一章。
  const FIELD_HINTS = {
    dailyForecast: "预测未来平均每天能卖多少件——参考教学训练「Forecast到底是什么」一章，从ERP过去日销数据加权得到，不是拍脑袋定的。",
    overseasOnHand: "海外仓/FBA现在可售的库存件数——找物流或平台后台的库存报表要。",
    domesticOnHand: "国内仓现在可以马上发运的库存件数——这个数字会封顶「这次最多能发多少」，找国内仓库存系统要。",
    reorderInterval: "你多久下一次采购单的节奏（不是运输时间）——参考教学训练「LeadTime、安全库存与物流成本」一章，这是你自己定的备货节奏，不用找谁要。",
    production: "工厂生产/备货所需天数——找采购/供应商要。",
    purchasePickup: "采购这批货从工厂提货所需天数——找物流要。",
    purchaseShipping: "采购这批货运输在途天数（海运/空运）——找物流要。",
    purchaseListing: "货到仓库后上架可售所需天数——找仓库/运营要。",
    shipPickup: "从海外仓提货所需天数（不含生产）——找海外仓/物流要。",
    shipShipping: "从海外仓运到国内仓的运输天数——找物流要。",
    shipListing: "国内仓货物上架可售所需天数——找仓库要。",
    safetyDays: "你愿意为预测偏差和物流延误多留几天缓冲——参考教学训练「LeadTime、安全库存与物流成本」一章，这是你自己的风险策略，不是找谁要的客观数据。"
  };

  function injectFieldHints() {
    Object.keys(FIELD_HINTS).forEach((key) => {
      const input = $(FIELD_IDS[key]);
      if (!input) return;
      const field = input.closest(".desk-field");
      if (!field || field.querySelector(".desk-hint-btn")) return;
      const label = field.querySelector("label");
      if (!label) return;
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "desk-hint-btn"; btn.textContent = "ⓘ";
      btn.setAttribute("aria-label", "这个字段是什么、去哪儿要");
      const pop = document.createElement("div");
      pop.className = "desk-hint-pop"; pop.hidden = true; pop.textContent = FIELD_HINTS[key];
      btn.addEventListener("click", () => { pop.hidden = !pop.hidden; });
      label.appendChild(btn);
      field.appendChild(pop);
    });
  }

  function $(id) { return document.getElementById(id); }

  function batchRowHtml(qty, etaDate) {
    return `<div class="desk-batch-row">
      <input type="number" min="0" step="1" class="desk-batch-qty" value="${qty ? qty : ""}" placeholder="数量">
      <input type="date" class="desk-batch-eta" value="${etaDate || ""}">
      <button type="button" class="desk-batch-remove" title="删除">✕</button>
    </div>`;
  }

  function renderBatchRows(containerId, batches) {
    const box = $(containerId);
    if (!box) return;
    if (!batches || !batches.length) {
      box.innerHTML = '<p class="desk-batch-empty">暂无在途批次</p>';
      return;
    }
    box.innerHTML = batches.map((b) => batchRowHtml(b.qty, b.etaDate)).join("");
  }

  function addBatchRow(containerId) {
    const box = $(containerId);
    if (!box) return;
    if (box.querySelector(".desk-batch-empty")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", batchRowHtml("", ""));
  }

  function bindBatchContainerEvents(containerId) {
    const box = $(containerId);
    if (!box) return;
    box.addEventListener("click", (e) => {
      if (!e.target.classList.contains("desk-batch-remove")) return;
      const row = e.target.closest(".desk-batch-row");
      if (row) row.remove();
      if (!box.querySelector(".desk-batch-row")) box.innerHTML = '<p class="desk-batch-empty">暂无在途批次</p>';
    });
  }

  function readBatches(containerId) {
    const box = $(containerId);
    if (!box) return [];
    return Array.from(box.querySelectorAll(".desk-batch-row")).map((row) => ({
      qty: Number(row.querySelector(".desk-batch-qty").value) || 0,
      etaDate: row.querySelector(".desk-batch-eta").value
    })).filter((b) => b.qty > 0 && b.etaDate);
  }

  function fillForm(s) {
    Object.keys(FIELD_IDS).forEach((k) => {
      const el = $(FIELD_IDS[k]);
      if (el) el.value = s[k] != null ? s[k] : "";
    });
    renderBatchRows("deskOverseasBatches", s.overseasBatches);
    renderBatchRows("deskPurchaseBatches", s.purchaseBatches);
  }

  function readForm() {
    const s = {};
    Object.keys(FIELD_IDS).forEach((k) => {
      const el = $(FIELD_IDS[k]);
      if (!el) return;
      s[k] = (k === "sku" || k === "asOfDate") ? el.value : (Number(el.value) || 0);
    });
    s.overseasBatches = readBatches("deskOverseasBatches");
    s.purchaseBatches = readBatches("deskPurchaseBatches");
    return s;
  }

  function buildEngineInput(s) {
    return {
      sku: s.sku || "SKU",
      asOfDate: s.asOfDate || todayStr(),
      horizonDays: 180,
      demand: { dailyForecast: s.dailyForecast },
      supply: {
        overseasOnHand: s.overseasOnHand,
        overseasInTransit: s.overseasBatches,
        domesticOnHand: s.domesticOnHand,
        purchaseInTransit: s.purchaseBatches
      },
      leadTime: {
        purchase: { reorderInterval: s.reorderInterval, production: s.production, pickup: s.purchasePickup, shipping: s.purchaseShipping, listing: s.purchaseListing },
        shipping: { pickup: s.shipPickup, shipping: s.shipShipping, listing: s.shipListing }
      },
      policy: { safetyDays: s.safetyDays }
    };
  }

  function statusLabel(status) {
    if (status === "ok") return { cls: "good", text: "✅ 正常" };
    if (status === "urgent") return { cls: "warn", text: "⚠️ 紧急（7天内）" };
    return { cls: "bad", text: "🚨 已错过窗口" };
  }

  function renderHero(result) {
    const valueEl = $("deskStockoutDate"), subEl = $("deskStockoutSub");
    if (!valueEl || !subEl) return;
    if (result.projectedStockoutDate == null) {
      valueEl.textContent = "180 天内不会断货";
      subEl.textContent = "按当前库存/在途/日销测算，未来 180 天供给充足";
    } else {
      valueEl.textContent = result.projectedStockoutDate;
      subEl.textContent = `距今 ${result.daysOfCover} 天 · 海外供给 ${result.overseasSupply} 件 · 全流程供给 ${result.fullSupply} 件`;
    }
  }

  function renderDecisionCard(cardId, dateId, bodyId, decision, actionLabel) {
    const card = $(cardId), dateEl = $(dateId), body = $(bodyId);
    if (!card || !dateEl || !body) return;
    card.classList.remove("ok", "urgent", "missed");
    card.classList.add(decision.status);
    const st = statusLabel(decision.status);
    if (decision.latestOrderDate == null) {
      dateEl.textContent = "180 天内不会断货";
    } else if (decision.status === "missed") {
      dateEl.textContent = `已错过 ${Math.abs(decision.latestOrderDay)} 天（${decision.latestOrderDate}）`;
    } else {
      dateEl.textContent = `最晚 ${decision.latestOrderDate} 前${actionLabel}`;
    }
    let capNote = "";
    if (decision.cappedByDomestic) {
      capNote = `<br>⚠️ 缺口 ${decision.gapQty} 件，但国内可发库存封顶，这次最多能发 <b>${decision.suggestedQty}</b> 件`;
    }
    const missedNote = decision.status === "missed" ? "<br>🚨 正常流程已来不及，需走加急物流提拉" : "";
    body.innerHTML = `<span class="tag ${st.cls}">${st.text}</span><br>建议数量：<b>${decision.suggestedQty}</b> 件（缺口 ${decision.gapQty} 件）${capNote}${missedNote}`;
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  function drawTimeline(result) {
    const canvas = $("deskTimelineCanvas");
    if (!canvas || !canvas.getContext) return;
    const box = canvas.parentElement;
    const w = (box && box.clientWidth) || 600;
    const h = 220;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const timeline = result.timeline;
    const maxInv = Math.max(1, ...timeline.map((p) => p.inventory));
    const padL = 46, padR = 14, padT = 14, padB = 10;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const lineColor = cssVar("--accent", "#6c5ce7");
    const gridColor = cssVar("--line", "#e5e5e5");
    const redColor = cssVar("--red", "#c0392b");
    const mutedColor = cssVar("--muted", "#888");

    ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - (plotH * i) / 4;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = mutedColor;
      ctx.fillText(String(Math.round((maxInv * i) / 4)), 2, y + 3);
    }

    const xAt = (day) => padL + (plotW * day) / (timeline.length - 1);
    const yAt = (inv) => padT + plotH - (plotH * inv) / maxInv;

    ctx.beginPath();
    timeline.forEach((p, i) => {
      const x = xAt(p.day), y = yAt(p.inventory);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = lineColor;
    timeline.forEach((p) => {
      if (p.arrival > 0) {
        const x = xAt(p.day), y = yAt(p.inventory);
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    if (result.daysOfCover != null) {
      const x = xAt(result.daysOfCover);
      ctx.strokeStyle = redColor;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = redColor;
      ctx.fillText("断货", Math.min(x + 4, w - padR - 26), padT + 10);
    }
  }

  function runAndRender() {
    const s = readForm();
    saveState(s);
    const result = planReplenishment(buildEngineInput(s));
    lastResult = result;
    renderHero(result);
    renderDecisionCard("deskShippingCard", "deskShippingDate", "deskShippingBody", result.shipping, "提货发运");
    renderDecisionCard("deskPurchaseCard", "deskPurchaseDate", "deskPurchaseBody", result.purchase, "下单采购");
    drawTimeline(result);
  }

  function initDeskOnce() {
    deskInitialized = true;
    fillForm(loadState());
    renderPresetButtons();
    injectFieldHints();
    bindBatchContainerEvents("deskOverseasBatches");
    bindBatchContainerEvents("deskPurchaseBatches");
    const addOverseas = $("deskAddOverseasBatch");
    const addPurchase = $("deskAddPurchaseBatch");
    if (addOverseas) addOverseas.addEventListener("click", () => addBatchRow("deskOverseasBatches"));
    if (addPurchase) addPurchase.addEventListener("click", () => addBatchRow("deskPurchaseBatches"));
    const runBtn = $("deskRunBtn");
    if (runBtn) runBtn.addEventListener("click", runAndRender);
    // window resize 事件在容器宽度变化但视口本身没变（比如三栏CSS重排、devtools量宽度工具
    // 直接改viewport）时不一定触发——这正是 lab-core.js 在 v0.15 踩过、后来用 ResizeObserver
    // 兜底的同一类坑：canvas 的内联 style.width 是渲染时刻的快照，容器缩小后不会自己跟着变，
    // 不重画就会拿旧宽度撑爆容器出现横向滚动条。
    if (window.ResizeObserver) {
      const box = document.querySelector(".desk-canvas-box");
      if (box) new ResizeObserver(() => { if (lastResult) drawTimeline(lastResult); }).observe(box);
    } else {
      window.addEventListener("resize", () => { if (lastResult) drawTimeline(lastResult); });
    }
    runAndRender();
  }

  function onShow() {
    if (!deskInitialized) { initDeskOnce(); return; }
    if (lastResult) drawTimeline(lastResult);
  }

  // v0.19：教学章节完成页「▶ 用这组数据去作业台算一遍」按钮用的公开接口——跟 onShow() 一样
  // 是明确的生产用 API（不是 _debug）。teach-core.js 调用方式：先 loadExternalState(state)
  // 把数据填好、算好，再 switchTab("desk") 让作业台可见——switchTab 会把 desk.hidden 设成
  // false 之后再调 onShow()，那时 canvas 才有真实宽度，画布不会用隐藏状态下量到的 0 宽度。
  function loadExternalState(partialState) {
    const state = Object.assign(defaultState(), partialState);
    if (!deskInitialized) { initDeskOnce(); }
    fillForm(state);
    saveState(state);
    runAndRender();
  }

  window.DeskCore = {
    planReplenishment,
    onShow,
    loadExternalState,
    // 仅供 verify_lab.js 等自动化测试使用：暴露内部纯函数，不给 UI 用
    _debug: { planReplenishment, projectTimeline, toDate, addDays, fmtDate }
  };
})();
