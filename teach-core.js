/* ============================================================
 * teach-core.js — 判断训练系统引擎
 * 渲染教学首页 / 章节详情（经验循环）/ Forecast 经验本 / 四维度评分 / 沙盘解锁
 * 依赖 teach-data.js 提供的 CHAPTERS（全局）
 * ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const JOURNAL_KEY = "sku_forecast_journal_v1";

  /* ---------- 经验本（localStorage） ---------- */
  function loadJournal() {
    try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveJournal(list) {
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(list)); } catch (e) {}
  }
  let journal = loadJournal();

  function completedSet() {
    return new Set(journal.filter(j => j.done).map(j => j.chapterId));
  }
  function isChapterDone(id) { return completedSet().has(id); }
  function isUnlocked(ch) {
    if (ch.type === "opt") return true;            // 选学始终开放
    if (ch.n === 1) return true;                    // 第一章开放
    const prev = CHAPTERS.find(c => c.type === "req" && c.n === ch.n - 1);
    return prev ? isChapterDone(prev.id) : true;
  }
  function loopsDone() { return journal.filter(j => j.done).length; }
  function sandboxUnlocked() { return loopsDone() >= 3; }

  /* ---------- 评分：四维度 ---------- */
  function scoreChapter(ch, st) {
    const loop = ch.loop;
    // ① 观察质量
    const expIdx = loop.observeOptions.map((o, i) => o.exp ? i : -1).filter(i => i >= 0);
    const hits = st.obs.filter(i => loop.observeOptions[i].exp).length;
    const misses = st.obs.filter(i => !loop.observeOptions[i].exp).length;
    const obs = clamp(100 * (hits / expIdx.length) - misses * 15, 0, 100);

    // ② 逻辑依据
    let logic = 50;
    if (loop.reasonOptions && loop.reasonOptions[st.reason]) {
      logic = loop.reasonOptions[st.reason].ok ? 100 : 45;
    }
    if (st.rule && st.rule.trim().length >= 6) logic = Math.min(100, logic + 10);

    // ③ 数值偏差（或决策正确度）
    let dev, errPct;
    if (loop.kind === "choice") {
      dev = (st.forecast === loop.idealChoice) ? 100 : 40;
      errPct = (st.forecast === loop.idealChoice) ? 0 : 0.4;
    } else {
      const actual = loop.truth.actual;
      errPct = Math.abs(st.forecast - actual) / actual;
      if (errPct <= 0.10) dev = 100;
      else if (errPct <= 0.25) dev = 72;
      else if (errPct <= 0.50) dev = 45;
      else dev = 22;
    }

    // ④ 信心校准
    const conf = st.confidence;
    let confScore;
    if (errPct <= 0.10) confScore = conf >= 70 ? 100 : 82;
    else if (errPct <= 0.25) confScore = conf >= 70 ? 62 : 86;
    else confScore = conf >= 70 ? 30 : 72;

    return {
      obs: Math.round(obs), logic: Math.round(logic),
      dev: Math.round(dev), conf: Math.round(confScore),
      errPct
    };
  }

  /* ---------- 首页统计 ---------- */
  function homeStats() {
    let over = 0, under = 0, ok = 0;
    const rootCount = {};
    journal.forEach(j => {
      if (j.deviationPct != null) {
        if (j.deviationPct > 5) over++;
        else if (j.deviationPct < -5) under++;
        else ok++;
      }
      if (j.root) rootCount[j.root] = (rootCount[j.root] || 0) + 1;
    });
    let topMistake = "—";
    let max = 0;
    Object.entries(rootCount).forEach(([k, v]) => { if (v > max) { max = v; topMistake = k; } });
    return { total: journal.length, over, under, ok, topMistake };
  }

  /* ---------- 视图状态 ---------- */
  const state = { view: "home", chapterId: null, step: 0, draft: {} };

  function getRange(ch) {
    if (ch.loop.kind === "choice") return { min: 0, max: 3, step: 1 };
    const a = ch.loop.truth.actual;
    const max = Math.max(120, Math.ceil(a * 4));
    return { min: 0, max, step: 1 };
  }

  /* ============================================================
   * 渲染：教学首页
   * ============================================================ */
  function renderHome() {
    const req = CHAPTERS.filter(c => c.type === "req");
    const opt = CHAPTERS.filter(c => c.type === "opt");
    const st = homeStats();
    const done = loopsDone();
    const unlocked = sandboxUnlocked();

    const card = (ch) => {
      const open = isUnlocked(ch);
      const doneMark = isChapterDone(ch.id) ? "✅" : (open ? "🔓" : "🔒");
      return `<button class="ch-card ${open ? "" : "locked"}" data-ch="${ch.id}" ${open ? "" : "disabled"}>
        <div class="ch-icon">${ch.icon}</div>
        <div class="ch-body">
          <div class="ch-top"><span class="ch-num">${ch.type === "opt" ? "选学" : "第" + ch.n + "章"}</span><span class="ch-mark">${doneMark}</span></div>
          <h3>${ch.title}</h3>
          <p>${ch.why}</p>
        </div>
      </button>`;
    };

    const view = $("teachView");
    view.innerHTML = `
      <section class="teach-hero">
        <div class="eyebrow">判断训练系统 · 从零学 Forecast</div>
        <h1>你不是来背公式的，<br>是来练「在不确定里下判断」的。</h1>
        <p>每一章都走同一条路：<b>观察数据 → 你下判断并写理由+信心 → 看模拟结果 → 复盘偏差根因 → 提炼一条自己的规则</b>。完成 3 次完整循环，解锁自由沙盘。</p>
        <div class="overall">
          <div class="row"><span>完整循环</span><span><b id="loopCount">${done}</b> / 3（解锁沙盘）</span></div>
          <div class="meter"><i id="loopBar" style="width:${Math.min(100, done / 3 * 100)}%"></i></div>
        </div>
      </section>

      <section class="journal-strip">
        <div class="js-title">📒 Forecast 经验本</div>
        <div class="js-grid">
          <div class="js-cell"><b>${st.total}</b><span>已完成循环</span></div>
          <div class="js-cell over"><b>${st.over}</b><span>高估次数</span></div>
          <div class="js-cell under"><b>${st.under}</b><span>低估次数</span></div>
          <div class="js-cell ok"><b>${st.ok}</b><span>较准确</span></div>
        </div>
        <div class="js-mistake">最常犯的错误：<b>${st.topMistake}</b></div>
      </section>

      <section class="chapter-group">
        <div class="group-head"><span class="num req">必修</span><h2>主线 · Forecast → 库存 → 补货</h2></div>
        <div class="ch-grid">${req.map(card).join("")}</div>
      </section>

      <section class="chapter-group">
        <div class="group-head"><span class="num opt">选学</span><h2>进阶 · 不阻塞主线</h2></div>
        <div class="ch-grid">${opt.map(card).join("")}</div>
      </section>

      <div class="sandbox-cta ${unlocked ? "on" : ""}">
        ${unlocked
          ? `<button class="primary-btn" id="gotoSandbox">🧪 进入自由沙盘（已解锁）</button>`
          : `<div class="lock-note">🔒 再完成 <b>${3 - done}</b> 次完整循环，解锁自由沙盘</div>`}
      </div>
    `;

    view.querySelectorAll(".ch-card:not(.locked)").forEach(b => {
      b.addEventListener("click", () => openChapter(b.dataset.ch));
    });
    const gs = $("gotoSandbox");
    if (gs) gs.addEventListener("click", () => switchTab("sandbox"));
  }

  /* ============================================================
   * 渲染：章节详情（经验循环）
   * ============================================================ */
  function openChapter(id) {
    const ch = CHAPTERS.find(c => c.id === id);
    if (!ch || !isUnlocked(ch)) return;
    state.chapterId = id;
    state.step = 0;
    state.draft = { obs: [], forecast: null, reason: null, confidence: 50, root: null, rule: "" };
    renderChapter();
  }

  function renderChapter() {
    const ch = CHAPTERS.find(c => c.id === state.chapterId);
    const loop = ch.loop;
    const d = state.draft;
    const view = $("teachView");

    const obsTable = ch.observe.labels.map((lb, i) =>
      `<div class="obs-row"><span>${lb}</span><b>${ch.observe.values[i]}</b></div>`).join("");

    // ① 观察
    const stepObserve = `
      <div class="loop-step">
        <div class="step-tag">① 观察</div>
        <h3>先看数据，勾出你注意到的点</h3>
        <div class="obs-table">${obsTable}</div>
        <div class="check-list">
          ${loop.observeOptions.map((o, i) =>
            `<label class="chk"><input type="checkbox" data-obs="${i}" ${d.obs.includes(i) ? "checked" : ""}><span>${o.k}</span></label>`).join("")}
        </div>
        <button class="primary-btn" data-act="next">下一步 · 下判断</button>
      </div>`;

    // ② 判断
    const inputUI = loop.kind === "choice"
      ? `<div class="choice-list">${loop.choiceOptions.map((o, i) =>
          `<label class="chk"><input type="radio" name="fc" data-fc="${i}" ${d.forecast === i ? "checked" : ""}><span>${o.k}</span></label>`).join("")}</div>`
      : (() => {
          const r = getRange(ch);
          return `<div class="num-field">
            <input type="range" id="fcRange" min="${r.min}" max="${r.max}" step="${r.step}" value="${d.forecast != null ? d.forecast : Math.round(r.max / 2)}">
            <div class="num-show">你的判断：<b id="fcVal">${d.forecast != null ? d.forecast : Math.round(r.max / 2)}</b></div>
          </div>`;
        })();

    const stepJudge = `
      <div class="loop-step">
        <div class="step-tag">② 判断</div>
        <h3>${loop.prompt}</h3>
        ${inputUI}
        <button class="primary-btn" data-act="next">下一步 · 写理由</button>
      </div>`;

    // ③ 承诺
    const reasonUI = loop.reasonOptions
      ? `<div class="choice-list">${loop.reasonOptions.map((o, i) =>
          `<label class="chk"><input type="radio" name="rs" data-rs="${i}" ${d.reason === i ? "checked" : ""}><span>${o.k}</span></label>`).join("")}</div>`
      : `<textarea id="ruleReason" placeholder="用一句话说说你为什么这么判断">${typeof d.reasonText === "string" ? d.reasonText : ""}</textarea>`;

    const stepCommit = `
      <div class="loop-step">
        <div class="step-tag">③ 承诺理由 + 信心</div>
        <h3>写下你的依据，并说清你有多确定</h3>
        ${reasonUI}
        <div class="conf-row">
          <span>我对这个判断的把握：</span>
          <div class="conf-btns">
            ${[30, 50, 70, 90].map(c => `<button class="conf-btn ${d.confidence === c ? "on" : ""}" data-conf="${c}">${c}%</button>`).join("")}
          </div>
        </div>
        <button class="primary-btn" data-act="reveal">看模拟结果</button>
      </div>`;

    // ④ 看结果
    let resultHTML = "";
    if (state.step >= 3) {
      const sc = scoreChapter(ch, d);
      let verdict;
      if (loop.kind === "choice") {
        verdict = (d.forecast === loop.idealChoice) ? "✅ 决策正确" : "⚠️ 决策有偏差";
      } else {
        const actual = loop.truth.actual;
        const diff = d.forecast - actual;
        const pct = (diff / actual * 100);
        verdict = Math.abs(pct) <= 5 ? "✅ 较准确（±5%内）"
          : diff > 0 ? `📈 高估约 ${pct.toFixed(0)}%` : `📉 低估约 ${Math.abs(pct).toFixed(0)}%`;
      }
      resultHTML = `
        <div class="loop-step">
          <div class="step-tag">④ 看结果</div>
          <h3>系统模拟了一个月后的真实情况</h3>
          <div class="result-card">
            <div class="rc-line"><span>真实走势</span><b>${loop.truth.trend}</b></div>
            ${loop.kind === "choice"
              ? `<div class="rc-line"><span>最优决策</span><b>${loop.choiceOptions[loop.idealChoice].k}</b></div>`
              : `<div class="rc-line"><span>实际日均</span><b>${loop.truth.actual}</b></div>`}
            <div class="rc-line"><span>你的判断</span><b>${loop.kind === "choice" ? loop.choiceOptions[d.forecast].k : d.forecast}</b></div>
            <div class="rc-verdict">${verdict}</div>
            <p class="rc-note">${loop.truth.note}</p>
          </div>
          <button class="primary-btn" data-act="next">下一步 · 复盘</button>
        </div>`;
    }

    // ⑤ 复盘
    let reviewHTML = "";
    if (state.step >= 4) {
      reviewHTML = `
        <div class="loop-step">
          <div class="step-tag">⑤ 复盘归因</div>
          <h3>这次偏差（或正确）的根因是什么？</h3>
          <div class="choice-list">${loop.rootOptions.map((o, i) =>
            `<label class="chk"><input type="radio" name="rt" data-rt="${i}" ${d.root === i ? "checked" : ""}><span>${o.k}</span></label>`).join("")}</div>
          <button class="primary-btn" data-act="next">下一步 · 提炼规则</button>
        </div>`;
    }

    // ⑥ 提炼
    let ruleHTML = "";
    if (state.step >= 5) {
      ruleHTML = `
        <div class="loop-step">
          <div class="step-tag">⑥ 提炼一条自己的规则</div>
          <h3>把这次变成下次能用的一句话</h3>
          <textarea id="ruleText" placeholder="${loop.ruleHint}">${d.rule || loop.ruleHint}</textarea>
          <button class="primary-btn" data-act="save">保存并解锁下一章</button>
        </div>`;
    }

    // 完成
    let doneHTML = "";
    if (state.step >= 6) {
      const sc = scoreChapter(ch, d);
      doneHTML = `
        <div class="loop-step done">
          <div class="step-tag ok">✅ 已存入经验本</div>
          <h3>四维度评分</h3>
          <div class="score-grid">
            ${scoreCell("数据观察", sc.obs)}
            ${scoreCell("逻辑依据", sc.logic)}
            ${scoreCell("数值偏差", sc.dev)}
            ${scoreCell("信心校准", sc.conf)}
          </div>
          <div class="saved-rule">你的规则：<b>${d.rule}</b></div>
          <div class="done-actions">
            <button class="secondary-btn" data-act="home">返回首页</button>
            <button class="primary-btn" data-act="next-ch">${nextChapter(ch) ? "下一章 →" : "回首页"}</button>
          </div>
        </div>`;
    }

    view.innerHTML = `
      <div class="chapter-detail">
        <button class="back-link" data-act="home">← 返回章节列表</button>
        <div class="cd-head">
          <span class="cd-icon">${ch.icon}</span>
          <div>
            <div class="eyebrow">${ch.type === "opt" ? "选学" : "第" + ch.n + "章"}</div>
            <h2>${ch.title}</h2>
          </div>
        </div>
        <div class="problem-box"><b>真实问题：</b>${ch.problem}</div>
        ${stepObserve}
        ${state.step >= 1 ? stepJudge : ""}
        ${state.step >= 2 ? stepCommit : ""}
        ${resultHTML}
        ${reviewHTML}
        ${ruleHTML}
        ${doneHTML}
      </div>
    `;

    bindChapterEvents(ch);
  }

  function scoreCell(label, v) {
    const cls = v >= 80 ? "good" : v >= 55 ? "mid" : "low";
    return `<div class="score-cell ${cls}"><b>${v}</b><span>${label}</span></div>`;
  }

  function nextChapter(ch) {
    if (ch.type === "opt") return null;
    return CHAPTERS.find(c => c.type === "req" && c.n === ch.n + 1) || null;
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bindChapterEvents(ch) {
    const view = $("teachView");
    const d = state.draft;

    view.querySelectorAll("[data-obs]").forEach(cb => {
      cb.addEventListener("change", () => {
        const i = Number(cb.dataset.obs);
        if (cb.checked) { if (!d.obs.includes(i)) d.obs.push(i); }
        else d.obs = d.obs.filter(x => x !== i);
      });
    });
    const range = $("fcRange");
    if (range) range.addEventListener("input", () => { d.forecast = Number(range.value); $("fcVal").textContent = range.value; });
    view.querySelectorAll("[data-fc]").forEach(r => r.addEventListener("change", () => { d.forecast = Number(r.dataset.fc); }));
    view.querySelectorAll("[data-rs]").forEach(r => r.addEventListener("change", () => { d.reason = Number(r.dataset.rs); }));
    const rt = view.querySelectorAll("[data-rt]");
    rt.forEach(r => r.addEventListener("change", () => { d.root = Number(r.dataset.rt); }));
    view.querySelectorAll("[data-conf]").forEach(b => b.addEventListener("click", () => {
      d.confidence = Number(b.dataset.conf);
      view.querySelectorAll("[data-conf]").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
    }));
    const rsn = $("ruleReason");
    if (rsn) rsn.addEventListener("input", () => { d.reasonText = rsn.value; });

    view.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "home") { state.view = "home"; renderHome(); }
        else if (act === "next") {
          // 进入判断前，确保观察已记录（无所谓对错）
          if (state.step === 0) state.step = 1;
          else if (state.step === 1) { if (d.forecast == null && ch.loop.kind !== "choice") d.forecast = Number($("fcRange").value); state.step = 2; }
          else if (state.step === 2) {
            if (ch.loop.reasonOptions) { if (d.reason == null) { alert("请选择一个依据"); return; } }
            else { d.reasonText = ($("ruleReason").value || "").trim(); if (!d.reasonText) { alert("请写一句依据"); return; } }
            state.step = 3;
          }
          else if (state.step === 3) state.step = 4;
          else if (state.step === 4) {
            if (d.root == null) { alert("请选择复盘根因"); return; }
            state.step = 5;
          }
          else if (state.step === 5) state.step = 6;
          renderChapter();
        }
        else if (act === "reveal") {
          if (ch.loop.kind !== "choice" && d.forecast == null) d.forecast = Number($("fcRange").value);
          if (ch.loop.reasonOptions) { if (d.reason == null) { alert("请选择一个依据"); return; } }
          else { d.reasonText = ($("ruleReason").value || "").trim(); if (!d.reasonText) { alert("请写一句依据"); return; } }
          state.step = 3; renderChapter();
        }
        else if (act === "save") {
          const rtEl = $("ruleText");
          d.rule = (rtEl.value || "").trim() || ch.loop.ruleHint;
          saveEntry(ch);
          state.step = 6; renderChapter();
        }
        else if (act === "next-ch") {
          const nx = nextChapter(ch);
          if (nx) openChapter(nx.id); else { state.view = "home"; renderHome(); }
        }
      });
    });
  }

  function saveEntry(ch) {
    const d = state.draft;
    const loop = ch.loop;
    const sc = scoreChapter(ch, d);
    let deviationPct = null, actual = null, forecastLabel;
    if (loop.kind === "choice") {
      forecastLabel = loop.choiceOptions[d.forecast].k;
    } else {
      actual = loop.truth.actual;
      forecastLabel = d.forecast;
      deviationPct = +(((d.forecast - actual) / actual) * 100).toFixed(1);
    }
    const entry = {
      chapterId: ch.id, n: ch.n, title: ch.title, type: ch.type,
      forecast: forecastLabel, actual, deviationPct,
      reason: loop.reasonOptions ? loop.reasonOptions[d.reason].k : d.reasonText,
      confidence: d.confidence,
      root: loop.rootOptions[d.root].k,
      rule: d.rule, scores: sc, done: true,
      ts: Date.now()
    };
    journal = journal.filter(j => j.chapterId !== ch.id); // 覆盖同一章旧记录
    journal.push(entry);
    saveJournal(journal);
  }

  /* ============================================================
   * Tab 切换
   * ============================================================ */
  function switchTab(which) {
    const teach = $("teachView");
    const sand = $("sandboxView");
    const lab = $("labView");
    const tb = $("tabTeach"), sb = $("tabSandbox"), lb = $("tabLab");
    if (teach) teach.hidden = true;
    if (sand) sand.hidden = true;
    if (lab) lab.hidden = true;
    if (tb) tb.classList.remove("on");
    if (sb) sb.classList.remove("on");
    if (lb) lb.classList.remove("on");
    if (which === "lab") {
      if (lab) lab.hidden = false;
      if (lb) lb.classList.add("on");
      if (window.LabCore && window.LabCore.onShow) window.LabCore.onShow();
      return;
    }
    if (which === "teach") {
      if (teach) teach.hidden = false;
      if (tb) tb.classList.add("on");
      state.view = "home"; renderHome();
      return;
    }
    // sandbox
    if (!sandboxUnlocked()) { renderSandboxLock(); return; }
    if (sand) sand.hidden = false;
    if (sb) sb.classList.add("on");
  }

  function renderSandboxLock() {
    const sand = $("sandboxView");
    const need = 3 - loopsDone();
    sand.hidden = false; $("teachView").hidden = true;
    $("tabSandbox").classList.add("on"); $("tabTeach").classList.remove("on");
    sand.innerHTML = `<div class="sandbox-lock">
      <div class="lock-emoji">🔒</div>
      <h2>自由沙盘尚未解锁</h2>
      <p>先把「判断训练」走完——完成 <b>${need}</b> 次完整循环（观察→判断→结果→复盘→规则），就能解锁。</p>
      <button class="primary-btn" id="backTeach">← 回到训练</button>
    </div>`;
    $("backTeach").addEventListener("click", () => switchTab("teach"));
  }

  /* ============================================================
   * 注入 CSS + 初始化
   * ============================================================ */
  function injectCSS() {
    const css = `
    .tabbar{display:flex;gap:8px;padding:10px 16px 0;max-width:1100px;margin:0 auto;}
    .tabbar button{font:inherit;font-size:15px;padding:10px 18px;border-radius:12px 12px 0 0;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;opacity:.7;}
    .tabbar button.on{opacity:1;font-weight:700;border-bottom-color:transparent;background:var(--paper);}
    #teachView{max-width:1100px;margin:0 auto;padding:8px 16px 60px;}
    #sandboxView[hidden]{display:none;}
    .teach-hero{background:linear-gradient(135deg,var(--accent-soft),var(--paper));border:1px solid var(--line);border-radius:18px;padding:26px;margin:14px 0;}
    .teach-hero h1{font-size:26px;line-height:1.3;margin:8px 0 10px;}
    .teach-hero p{color:var(--ink-soft);line-height:1.7;}
    .overall{margin-top:16px;}
    .overall .row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px;}
    .meter{height:10px;background:var(--line);border-radius:6px;overflow:hidden;}
    .meter i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .4s;}
    .journal-strip{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin:14px 0;}
    .js-title{font-weight:700;margin-bottom:10px;}
    .js-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
    .js-cell{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center;}
    .js-cell b{font-size:22px;display:block;}
    .js-cell span{font-size:12px;color:var(--ink-soft);}
    .js-cell.over b{color:#e0533d;}.js-cell.under b{color:#2f7de0;}.js-cell.ok b{color:#1c9d5b;}
    .js-mistake{margin-top:10px;font-size:13px;color:var(--ink-soft);}
    .js-mistake b{color:var(--ink);}
    .chapter-group{margin:18px 0;}
    .group-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
    .group-head h2{font-size:18px;}
    .group-head .num{font-size:12px;padding:3px 10px;border-radius:20px;}
    .num.req{background:rgba(120,90,255,.14);color:var(--accent-2);}
    .num.opt{background:rgba(40,150,120,.14);color:#1c9d5b;}
    .ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}
    .ch-card{display:flex;gap:12px;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;cursor:pointer;transition:.15s;font:inherit;color:var(--ink);}
    .ch-card:hover{border-color:var(--accent);transform:translateY(-2px);}
    .ch-card.locked{opacity:.55;cursor:not-allowed;}
    .ch-icon{font-size:26px;}
    .ch-body{flex:1;}
    .ch-top{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);}
    .ch-body h3{font-size:15px;margin:4px 0 6px;}
    .ch-body p{font-size:13px;color:var(--ink-soft);line-height:1.5;}
    .sandbox-cta{text-align:center;margin:20px 0;}
    .lock-note{color:var(--ink-soft);font-size:14px;}
    .lock-note b{color:var(--accent-2);}
    .primary-btn{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;border:none;padding:12px 22px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;}
    .secondary-btn{background:var(--panel);border:1px solid var(--line);color:var(--ink);padding:12px 22px;border-radius:12px;font:inherit;cursor:pointer;}
    .chapter-detail{max-width:760px;margin:0 auto;}
    .back-link{background:none;border:none;color:var(--accent-2);font:inherit;cursor:pointer;padding:8px 0;font-size:14px;}
    .cd-head{display:flex;gap:12px;align-items:center;margin:6px 0 14px;}
    .cd-icon{font-size:30px;}
    .eyebrow{font-size:12px;color:var(--accent-2);font-weight:700;letter-spacing:.5px;}
    .problem-box{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:14px;margin-bottom:16px;line-height:1.7;}
    .loop-step{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:14px;}
    .step-tag{display:inline-block;font-size:13px;font-weight:700;color:#fff;background:var(--accent);padding:4px 12px;border-radius:20px;margin-bottom:10px;}
    .step-tag.ok{background:#1c9d5b;}
    .loop-step h3{font-size:17px;margin-bottom:14px;}
    .obs-table{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;}
    .obs-row{display:flex;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px;}
    .obs-row b{color:var(--accent-2);}
    .check-list,.choice-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;}
    .chk{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;font-size:14px;}
    .chk input{width:18px;height:18px;accent-color:var(--accent);}
    .num-field{margin-bottom:16px;}
    .num-field input[type=range]{width:100%;accent-color:var(--accent);}
    .num-show{text-align:center;font-size:16px;margin-top:8px;}
    .num-show b{font-size:24px;color:var(--accent-2);}
    textarea{width:100%;min-height:80px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;color:var(--ink);resize:vertical;}
    .conf-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:16px;}
    .conf-btns{display:flex;gap:8px;}
    .conf-btn{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px;cursor:pointer;font:inherit;color:var(--ink);}
    .conf-btn.on{background:var(--accent);color:#fff;border-color:var(--accent);}
    .result-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px;}
    .rc-line{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line);font-size:14px;}
    .rc-verdict{font-size:18px;font-weight:700;margin:12px 0 6px;color:var(--accent-2);}
    .rc-note{font-size:13px;color:var(--ink-soft);line-height:1.6;margin:0;}
    .score-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 16px;}
    .score-cell{text-align:center;border-radius:12px;padding:14px 6px;border:1px solid var(--line);}
    .score-cell b{font-size:24px;display:block;}
    .score-cell span{font-size:12px;color:var(--ink-soft);}
    .score-cell.good{background:rgba(28,157,91,.12);}.score-cell.good b{color:#1c9d5b;}
    .score-cell.mid{background:rgba(230,160,40,.12);}.score-cell.mid b{color:#d98a1a;}
    .score-cell.low{background:rgba(224,83,61,.12);}.score-cell.low b{color:#e0533d;}
    .saved-rule{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px;font-size:14px;}
    .saved-rule b{color:var(--accent-2);}
    .done-actions{display:flex;gap:10px;justify-content:flex-end;}
    .sandbox-lock{text-align:center;padding:60px 20px;}
    .lock-emoji{font-size:54px;}
    .sandbox-lock h2{margin:12px 0;}
    .sandbox-lock p{color:var(--ink-soft);line-height:1.7;max-width:420px;margin:0 auto 18px;}
    @media(max-width:600px){
      .js-grid{grid-template-columns:repeat(2,1fr);}
      .score-grid{grid-template-columns:repeat(2,1fr);}
      .obs-table{grid-template-columns:1fr;}
      .teach-hero h1{font-size:22px;}
    }`;
    const style = document.createElement("style");
    style.id = "teachStyle";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    injectCSS();
    // 顶部 Tab
    const header = document.querySelector("header .header-inner");
    const bar = document.createElement("nav");
    bar.className = "tabbar";
    bar.innerHTML = `<button id="tabTeach" class="on">📚 教学训练</button><button id="tabSandbox">🧪 自由沙盘</button><button id="tabLab">🎬 动画实验室</button>`;
    header.parentNode.insertBefore(bar, header.nextSibling);
    $("tabTeach").addEventListener("click", () => switchTab("teach"));
    $("tabSandbox").addEventListener("click", () => switchTab("sandbox"));
    $("tabLab").addEventListener("click", () => switchTab("lab"));
    // 把原 main 标记为沙盘视图
    const main = document.querySelector("main");
    if (main && !main.id) main.id = "sandboxView";
    // 教学视图容器
    let tv = $("teachView");
    if (!tv) {
      tv = document.createElement("div");
      tv.id = "teachView";
      main.parentNode.insertBefore(tv, main.nextSibling);
    }
    switchTab("teach");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
