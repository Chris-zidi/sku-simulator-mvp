/* ============================================================
 * mini-chart.js — 教学页嵌图引擎 v0.19
 *
 * 给 teach-core.js 的讲解阶段（renderLesson）用的"活插图"：拖一个滑块，
 * 曲线和公式同时变。跟 lab-core.js 的 draw() 不是一回事——那个是三栏
 * 100vh 钉死视口的舞台，教学页是 760px 单栏可滚页面，两种布局模式互斥
 * （teach-core.js switchTab() 里有注释说明原因），没法直接搬。
 *
 * project() 是纯多批次逐日推演，跟 desk-core.js 的 projectTimeline() 同一套
 * 算法口径（多批次到途注入 + clamp到0），只是这里用教学惯用的"第N天"相对天数，
 * 不是 desk-core 那边真实日历日期——verify_lab.js 里有一条断言，用等价输入
 * 分别喂给两边，钉住两套引擎算出的断货日必须一致，防止以后口径悄悄漂移。
 *
 * 声明式 figure schema（写在 teach-data.js 里，不用为每章写渲染代码）：
 *   { type: "curve"|"compare"|"pipeline", base: {...}, controls: [...], formula: [...] }
 * 支持的 controls 类型：
 *   - 滑块：{ key, label, min, max, step, unit }——直接改 base 里同名字段
 *   - 开关：{ key, type:"toggle", label, color }——目前只支持 key:"transitOn"，
 *     关掉时 base.transit 清空（这是 v0.19 唯一需要的"一键关掉某项"场景，
 *     没有做成通用规则引擎，是刻意的范围控制）
 * ============================================================ */
(function () {
  "use strict";

  /* ---------- 纯计算：跟 desk-core.js 的 projectTimeline() 同口径，见文件头注释 ---------- */
  function project(params) {
    const horizon = params.horizonDays || 120;
    const daily = Number(params.demand) || 0;
    const arrivalByDay = {};
    (params.transit || []).forEach((b) => {
      const day = Math.round(Number(b.day) || 0);
      const qty = Number(b.qty) || 0;
      if (qty <= 0) return;
      if (day <= 0) arrivalByDay[0] = (arrivalByDay[0] || 0) + qty;
      else if (day <= horizon) arrivalByDay[day] = (arrivalByDay[day] || 0) + qty;
    });
    const inv = new Array(horizon + 1);
    inv[0] = (Number(params.inventory) || 0) + (arrivalByDay[0] || 0);
    let stockoutDay = inv[0] <= 0 ? 0 : null;
    for (let d = 1; d <= horizon; d++) {
      const arrival = arrivalByDay[d] || 0;
      const available = inv[d - 1] + arrival;
      inv[d] = Math.max(0, available - daily);
      if (stockoutDay === null && inv[d] <= 0) stockoutDay = d;
    }
    let troughInv = inv[0], troughDay = 0;
    for (let d = 1; d <= horizon; d++) { if (inv[d] < troughInv) { troughInv = inv[d]; troughDay = d; } }
    return { inv, stockoutDay, troughInv, troughDay, horizon };
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }

  /* ---------- 单条曲线（+ 谷底虚线 + 到货台阶），画到一个 canvas 上 ---------- */
  function drawCurve(canvas, result, opts) {
    if (!canvas || !canvas.getContext) return;
    const box = canvas.parentElement;
    const w = (box && box.clientWidth) || 320;
    const h = opts && opts.height ? opts.height : 160;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const inv = result.inv;
    const maxInv = Math.max(1, ...inv);
    const padL = 8, padR = 8, padT = 10, padB = 8;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const xAt = (d) => padL + (plotW * d) / (inv.length - 1);
    const yAt = (v) => padT + plotH - (plotH * v) / maxInv;

    const lineColor = cssVar("--green", "#177957");
    const redColor = cssVar("--red", "#b83c34");
    const blueColor = cssVar("--blue", "#246bce");
    const gridColor = cssVar("--line", "#e5e5e5");

    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();

    ctx.beginPath();
    inv.forEach((v, d) => { const x = xAt(d), y = yAt(v); if (d === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.stroke();

    // 谷底虚线：跌到 0 变红
    const troughColor = result.troughInv <= 0 ? redColor : blueColor;
    ctx.strokeStyle = troughColor; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(padL, yAt(result.troughInv)); ctx.lineTo(padL + plotW, yAt(result.troughInv)); ctx.stroke();
    ctx.setLineDash([]);

    // 到货台阶（在途批次）：蓝色小圆点
    (opts && opts.transit || []).forEach((b) => {
      const day = Math.round(b.day);
      if (day < 0 || day >= inv.length || !(Number(b.qty) > 0)) return;
      ctx.fillStyle = blueColor;
      ctx.beginPath(); ctx.arc(xAt(day), yAt(inv[day]), 3, 0, Math.PI * 2); ctx.fill();
    });

    // 断货：0 线上一小段红带
    if (result.stockoutDay != null) {
      const sx = xAt(result.stockoutDay);
      ctx.strokeStyle = redColor; ctx.setLineDash([3, 2]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + plotH); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* ---------- 管道图：静态示意"在途是什么"，几条传送带 + 库存池 + 出水口 ---------- */
  function drawPipeline(canvas, spec) {
    if (!canvas || !canvas.getContext) return;
    const box = canvas.parentElement;
    const w = (box && box.clientWidth) || 320;
    const h = 170;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const blueColor = cssVar("--blue", "#246bce");
    const greenColor = cssVar("--green", "#177957");
    const redColor = cssVar("--red", "#b83c34");
    const inkColor = cssVar("--ink", "#18201d");
    const surface2 = cssVar("--surface-2", "#eef1ea");

    const transit = spec.transit || [];
    const poolX = w * 0.32, poolW = w * 0.32, poolY = h * 0.42, poolH = h * 0.4;

    // 传送带：从左边进来，指向库存池
    const laneH = Math.min(22, (poolY - 12) / Math.max(1, transit.length));
    transit.forEach((b, i) => {
      const ly = 14 + i * laneH;
      ctx.strokeStyle = blueColor; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(4, ly); ctx.lineTo(poolX - 6, ly); ctx.stroke();
      ctx.fillStyle = blueColor;
      ctx.beginPath(); ctx.moveTo(poolX - 6, ly); ctx.lineTo(poolX - 14, ly - 5); ctx.lineTo(poolX - 14, ly + 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = inkColor; ctx.font = "10.5px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(fmt(b.qty) + " 件 · 第 " + b.day + " 天到", 6, ly - 5);
    });

    // 库存池
    ctx.fillStyle = surface2;
    ctx.fillRect(poolX, poolY, poolW, poolH);
    ctx.strokeStyle = inkColor; ctx.lineWidth = 1.2;
    ctx.strokeRect(poolX, poolY, poolW, poolH);
    ctx.fillStyle = inkColor; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("库存池", poolX + poolW / 2, poolY + poolH / 2 - 4);
    ctx.font = "11px sans-serif";
    ctx.fillText(fmt(spec.inventory) + " 件", poolX + poolW / 2, poolY + poolH / 2 + 12);

    // 出水口：日销
    const outX = poolX + poolW + 30, outY = poolY + poolH / 2;
    ctx.strokeStyle = redColor; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(poolX + poolW + 4, outY); ctx.lineTo(outX, outY); ctx.stroke();
    ctx.fillStyle = redColor;
    ctx.beginPath(); ctx.moveTo(outX, outY); ctx.lineTo(outX - 8, outY - 5); ctx.lineTo(outX - 8, outY + 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = inkColor; ctx.font = "10.5px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("日销 " + fmt(spec.demand) + " 件/天", outX + 4, outY + 3);
    ctx.textAlign = "left";
  }

  /* ---------- 公式行：按项拼色，term/result 跟图上同色元素对应 ---------- */
  function activeTransit(base, state) {
    if (state.transitOn === false) return [];
    return base.transit || [];
  }

  function formulaHTML(formulaSpec, base, state, result) {
    const transit = activeTransit(base, state);
    const transitSum = transit.reduce((s, b) => s + (Number(b.qty) || 0), 0);
    return (formulaSpec || []).map((part) => {
      if (part.text != null) return `<span>${part.text}</span>`;
      if (part.term) {
        const val = part.term === "transit" ? transitSum : (base[part.term] != null ? base[part.term] : "");
        return `<span class="mc-term" style="color:var(${part.color || "--ink"})">${fmt(Number(val) || 0)}</span>`;
      }
      if (part.result) {
        const val = part.result === "trough" ? result.troughInv : result[part.result];
        return `<span class="mc-term mc-result">${fmt(Number(val) || 0)}${part.unit ? " " + part.unit : ""}</span>`;
      }
      return "";
    }).join("");
  }

  /* ---------- 总入口：建 DOM（canvas + 控件 + 公式行），绑事件，返回销毁函数 ---------- */
  function renderFigure(container, spec) {
    if (!container || !spec) return function destroy() {};
    const state = { transitOn: true };
    const base = Object.assign({}, spec.base);

    container.innerHTML = "";
    container.className = "mc-figure";

    if (spec.type === "compare") {
      container.innerHTML =
        `<div class="mc-compare">
          <div class="mc-compare-col"><div class="mc-compare-label mc-bad">❌ 忘了算在途</div><div class="mc-canvas-box"><canvas></canvas></div><div class="mc-compare-note" id="mcNoteBad"></div></div>
          <div class="mc-compare-col"><div class="mc-compare-label mc-good">✅ 算上在途</div><div class="mc-canvas-box"><canvas></canvas></div><div class="mc-compare-note" id="mcNoteGood"></div></div>
        </div>`;
      const canvases = container.querySelectorAll("canvas");
      const withoutTransit = project(Object.assign({}, base, { transit: [] }));
      const withTransit = project(base);
      drawCurve(canvases[0], withoutTransit, {});
      drawCurve(canvases[1], withTransit, { transit: base.transit });
      const noteBad = container.querySelector("#mcNoteBad");
      const noteGood = container.querySelector("#mcNoteGood");
      if (noteBad) noteBad.textContent = withoutTransit.stockoutDay != null
        ? "第 " + withoutTransit.stockoutDay + " 天就断货" : "不会断货";
      if (noteGood) noteGood.textContent = withTransit.stockoutDay != null
        ? "第 " + withTransit.stockoutDay + " 天才断货" : "全程不断货";
      const ro = new ResizeObserver(() => { drawCurve(canvases[0], withoutTransit, {}); drawCurve(canvases[1], withTransit, { transit: base.transit }); });
      canvases.forEach((c) => ro.observe(c.parentElement));
      return function destroy() { ro.disconnect(); };
    }

    if (spec.type === "pipeline") {
      container.innerHTML = `<div class="mc-canvas-box mc-pipeline-box"><canvas></canvas></div>`;
      const canvas = container.querySelector("canvas");
      const draw = () => drawPipeline(canvas, base);
      draw();
      const ro = new ResizeObserver(draw);
      ro.observe(canvas.parentElement);
      return function destroy() { ro.disconnect(); };
    }

    // 默认 type: "curve"——控件 + 曲线 + 公式行
    const controlsHTML = (spec.controls || []).map((c) => {
      if (c.type === "toggle") {
        return `<label class="mc-toggle"><input type="checkbox" data-key="${c.key}" checked> <span style="color:var(${c.color || "--ink"})">${c.label}</span></label>`;
      }
      return `<div class="mc-slider-field">
        <div class="mc-slider-top"><span>${c.label}</span><span class="mc-slider-val" data-valfor="${c.key}"></span></div>
        <input type="range" data-key="${c.key}" min="${c.min}" max="${c.max}" step="${c.step || 1}">
      </div>`;
    }).join("");

    container.innerHTML =
      `<div class="mc-canvas-box"><canvas></canvas></div>` +
      `<div class="mc-controls">${controlsHTML}</div>` +
      `<div class="mc-formula" id="mcFormula"></div>`;

    const canvas = container.querySelector("canvas");
    const formulaEl = container.querySelector("#mcFormula");

    function currentParams() {
      return Object.assign({}, base, { transit: activeTransit(base, state) });
    }
    function rerender() {
      const result = project(currentParams());
      drawCurve(canvas, result, { transit: activeTransit(base, state) });
      if (formulaEl) formulaEl.innerHTML = formulaHTML(spec.formula, base, state, result);
    }

    const listeners = [];
    (spec.controls || []).forEach((c) => {
      if (c.type === "toggle") {
        const el = container.querySelector(`input[type=checkbox][data-key="${c.key}"]`);
        if (!el) return;
        const handler = () => { state[c.key] = el.checked; rerender(); };
        el.addEventListener("change", handler);
        listeners.push({ el, type: "change", handler });
      } else {
        const el = container.querySelector(`input[type=range][data-key="${c.key}"]`);
        const valEl = container.querySelector(`[data-valfor="${c.key}"]`);
        if (!el) return;
        el.value = base[c.key];
        if (valEl) valEl.textContent = fmt(base[c.key]) + (c.unit || "");
        const handler = () => {
          base[c.key] = Number(el.value);
          if (valEl) valEl.textContent = fmt(base[c.key]) + (c.unit || "");
          rerender();
        };
        el.addEventListener("input", handler);
        listeners.push({ el, type: "input", handler });
      }
    });

    rerender();
    const ro = new ResizeObserver(rerender);
    ro.observe(canvas.parentElement);

    return function destroy() {
      ro.disconnect();
      listeners.forEach(({ el, type, handler }) => el.removeEventListener(type, handler));
    };
  }

  window.MiniChart = {
    project,
    renderFigure,
    // 仅供 verify_lab.js 等自动化测试使用：暴露内部纯函数，不给 UI 用
    _debug: { project, cssVar, formulaHTML, activeTransit }
  };
})();
