/* ============================================================
 * lab-core.js — 动画实验室 v0.11（预测因果链打通 + 关卡重排）
 * 设计：7 关逐步「长出」图；每关引入 1-2 个新视觉元素 + 解释它的几何含义。
 * 依赖：index.html 中的 #labView / #labCanvas / 引导侧栏节点
 * 主题：复用全局 CSS 变量（--green/--red/--amber/--purple/--ink/--muted/--line）
 *
 * v0.11 关键修复（见计划 http-200-v0-9-3-ancient-volcano.md）：
 * - 修「预测」空转 bug：旧版下单时机判断用的是真实日销 demand，forecast 滑块从头到尾不影响
 *   任何结果——现实里 Forecast 的全部意义恰恰是「你不知道真实需求，只能凭预测做决策」。
 *   现在决策侧（何时下单/下多少）用 forecast 算，结果侧（真实消耗）永远用 demand 算，
 *   预测错了会真实体现在缺货/压仓上。
 * - 关卡重排：补货、安全库存提到 Forecast 之前——前 5 关先假设「你预测得准」，
 *   Forecast 作为最后的「大 boss」关卡才把这个假设拿掉。
 * - 关卡序号判断改用元素名（hasElement/stageIndexOf），不再写死 si>=N——上次重排就因为
 *   硬编码序号到处踩坑，这次改法能扛住以后再调整顺序。
 * - 新增少赚金额/压仓占用金额（单件毛利口径来自 Govee 利润表真实数据）。
 *
 * v0.10 修复（仍然有效）：
 * - 坐标轴：横轴恒定 180 天、纵轴恒定按库存+补货推算，不再跟着日销联动缩放
 * - 库存不再画成负数：clamp 到 0，缺货改成 0 线上方的红色「缺货带」
 * - 舞台钉死视口、未解锁关卡只显示 🔒、撤销/重做/播放控制、一键模拟恢复用户自己的值
 * ============================================================ */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const HORIZON = 180;
  // 单件毛利/成本口径：来自 Govee 利润表.xlsx 真实数据（EU 原价 €79.99，采购+头程+尾程成本
  // 约 31，净利润率落在 12%~25% 区间），与项目沙盘部分（index.html）的 BASE_PRICE/UNIT_COST
  // 保持同一口径。这里独立定义一份同值常量，不跨 <script> 依赖全局（lab-core.js 是独立 IIFE，
  // verify_lab.js 的 jsdom 环境也不加载 index.html 的内联 script）。
  const UNIT_PRICE = 79;
  const UNIT_COST = 31;
  const UNIT_MARGIN = UNIT_PRICE - UNIT_COST; // 48：卖一件的毛利


  // —— 所有可拖动因子（数值范围/说明）——
  const PARAMS = {
    inventory:  { label: "期初库存",     min: 0,    max: 12000, step: 50,  unit: "件",   note: "今天手里有多少货" },
    demand:     { label: "真实日均销量", min: 0,    max: 120,  step: 1,    unit: "件/天", note: "市场实际每天卖出多少" },
    forecast:   { label: "预测日均销量", min: 0,    max: 120,  step: 1,    unit: "件/天", note: "你开工前判断的每天能卖多少（计划）" },
    leadTime:   { label: "补货提前期",   min: 14,   max: 160,  step: 1,    unit: "天",   note: "从下单到海外可售的客观时长" },
    replenish:  { label: "补货量",       min: 0,    max: 12000, step: 50,   unit: "件",   note: "到货时一次性补进来的数量" },
    safetyDays: { label: "安全库存天数", min: 0,    max: 45,   step: 1,    unit: "天",   note: "把补货警戒线提前的缓冲" },
    promo:      { label: "促销系数",     min: 1,    max: 4,    step: 0.1,  unit: "×",    note: "促销期销量放大倍数" },
    promoDay:   { label: "促销开始日",   min: 0,    max: 170,  step: 1,    unit: "天",   note: "从第几天起进入促销" }
  };

  // —— 7 关：每关只新增【一个元素】+【一个因子滑块】——
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
        "<b>三角形面积</b> = 一共卖出了多少件。三角形 = (1/2) × 底 × 高 = (1/2) × 天数 × 库存 = 全部库存卖光。<br>" +
        "<b>本关坐标轴固定不变</b>：横轴永远是 180 天、纵轴永远按库存换算——这样日销一变，你才能亲眼看到线真的变陡、三角形真的变小，而不是图跟着参数一起跑，看起来「没变」。",
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
        "<b>为啥用一根红色竖线？</b>竖线能精确标出「那一天」在时间轴的哪个位置——一眼看到还能撑多久。<br>" +
        "<b>售罄之后呢？</b>库存不会变成负数（你没有「负货」可卖）——只会停在 0，图上用 0 线上方的红色「缺货带」告诉你：这段时间你本来卖得掉，却没货可卖，少赚了多少。",
      instruct: "再拖【真实日均销量】拉高：▏红竖虚线往左移（更早断货），🟥 缺货带变长；拉低：▏红竖虚线右移（撑更久），缺货带缩短甚至消失。",
      observe: "观察 ▏红竖虚线 = 售罄日（📉 绿线撞到 0 那天）。观察读数「库存覆盖」= 库存 ÷ 日销 = 红线离今天多少天。",
      baseline: { inventory: 4800, demand: 32, forecast: 0, leadTime: 140, replenish: 0, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { demand: 64 },
      dict: [
        { k: "▏ 红竖线", v: "标记「库存掉到 0」的那一天在时间轴上的位置。" },
        { k: "📅 覆盖天数", v: "从今天到售罄日 = 库存 ÷ 日销。日销越大覆盖越短。" },
        { k: "🟥 缺货带", v: "售罄后到有货为止，本来卖得掉却没货可卖的这段时间，不是负库存。" }
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
        "如果<b>到货日 > 售罄日</b>，中间就是<b>红色缺货带</b>——你明明卖得动却没货可卖（少赚 + 评分降）。<br>" +
        "<b>先声明一件事</b>：这一关和下一关，我们先假设你对销量的判断和真实完全一致（预测=真实）——把「什么时候该下单」这件事先学会，最后一关才会把这个假设拿掉。",
      instruct: "拖【补货提前期】从 140 拉到 160：🔻 绿箭头右移，🟥 红色缺货带变大；再拖【补货量】看补多少能把绿线抬回 0 之上。",
      observe: "观察 🔻 绿箭头（到货日）和 ▏红竖虚线（售罄日）的前后关系：箭头在红线右边 = 到货太晚 = 中间全是 🟥 缺货带。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 0, promo: 1, promoDay: 60 },
      demoTarget: { leadTime: 160 },
      dict: [
        { k: "🔻 绿箭头", v: "到货那一刻 = 下单日 + 提前期。箭头下方数字 = 一次补几件。" },
        { k: "🟥 红缺货带", v: "售罄日到到货日之间 = 零货可卖的天数。最痛的那段。" }
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
        "它不延长物流，只把<b>下单那一刻提前</b>——箭头跟着提前，缺货带可能消失。",
      instruct: "拖【安全库存天数】从 14 拉到 30：⚌ 琥珀虚线抬高 → 库存线更早撞到它 → 下单提前 → 🔻 绿箭头左移 → 🟥 红缺口缩小甚至消失。",
      observe: "观察 ⚌ 琥珀虚线的高度 = 安全天数 × 日销（14 天 × 48 件 = 672 件）。观察 🔻 绿箭头：安全天数越大，箭头越靠左（越早到货）。",
      baseline: { inventory: 3000, demand: 48, forecast: 48, leadTime: 140, replenish: 4000, safetyDays: 14, promo: 1, promoDay: 60 },
      demoTarget: { safetyDays: 30 },
      dict: [
        { k: "⚌ 琥珀虚线", v: "「警戒线」。库存掉到这条线立刻下单。高度 = 安全天数 × 日销。" },
        { k: "🛟 缓冲", v: "安全天数越大 → 越早下单 → 越能躲过红缺货带，但会压更多库存。" }
      ]
    },
    {
      logic: "预测",
      title: "Forecast 大 boss：前面几关的「预测=真实」是假的",
      element: "forecast",
      newParam: ["forecast"],
      newLabel: "🟣 预测线",
      supersedes: ["replenish"], // 从这关起，补货量不再手动拖，改成按预测自动算——见 instruct
      intro:
        "揭晓一件事：前面几关「下单时机」「下单量」的判断，都是<b>用真实日销算的</b>——等于你有上帝视角，事先就知道明天能卖多少。<br>" +
        "<b>现实里你没有这个视角，你只有「预测」</b>。这一关开始，「什么时候下单、下多少」全部改成<b>按你的预测算</b>，真实销量只负责决定库存实际怎么消耗——预测和真实终于要分开了。<br>" +
        "<b>预测偏低</b>：你以为还能撑很久，其实早就该下单了——下单晚、下单少 → 🟥 缺货带变大 → <b>少赚钱</b>。<br>" +
        "<b>预测偏高</b>：你以为很快要断货，赶紧多下单——货到了却卖不完，压在仓库里 → <b>占用资金</b>。<br>" +
        "<small>（这一关把【补货提前期】先调回 30 天——140 天太长，180 天的时间轴里连一整个「下单→到货→卖完」的周期都放不下，看不出预测误差的效果；想看长提前期的压力，可以再拖回 140。）</small>",
      instruct: "拖【预测日均销量】：往下拖到 20（比真实 48 低很多）看缺货带怎么变大、少赚多少钱；再拖到 90（比真实高很多）看期末剩下一堆货、占用多少资金。拖回 48（等于真实）两种代价都会趋近于 0。",
      observe: "观察读数「少赚金额」「压仓占用」：这两个数不是装饰——预测的每一分误差，最后都变成了真金白银的损失。补货量这一关起不再手动拖，系统按你的预测自动算「该补多少」，算错了 lostSales/期末库存会立刻告诉你。",
      baseline: { inventory: 5000, demand: 48, forecast: 48, leadTime: 30, replenish: 4000, safetyDays: 14, promo: 1, promoDay: 60 },
      demoTarget: { forecast: 20 },
      dict: [
        { k: "🟣 紫虚线", v: "「计划」曲线 = 按你预测的日销算出的库存走势。虚线代表还没发生。" },
        { k: "🧭 决策 vs 结果", v: "下单时机、下单量 = 按预测算（决策）；库存实际消耗 = 按真实销量算（结果）。两者第一次分开。" },
        { k: "💰 少赚", v: "预测偏低 → 下单太晚太少 → 断货变大 → 少赚的钱 = 少卖件数 × 单件毛利。" },
        { k: "🏚 压仓", v: "预测偏高 → 下单太早太多 → 期末剩货 → 占用资金 = 剩余件数 × 采购成本。" }
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
        "光加广告不补货 = 尖峰压垮库存，加速断货、加速少赚。",
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
      if (np) (Array.isArray(np) ? np : [np]).forEach((p) => set.add(p));
      // supersedes：某个滑块被后面关卡的自动计算取代后，不再显示（比如「补货量」到 Forecast 关起改成自动算）
      if (STAGES[s].supersedes) STAGES[s].supersedes.forEach((p) => set.delete(p));
    }
    return [...set];
  }

  // 每关解锁的视觉元素（累计）
  function unlockedElements(i) {
    const set = new Set();
    for (let s = 0; s <= i; s++) if (STAGES[s].element) set.add(STAGES[s].element);
    return set;
  }

  // 是否已经解锁某个元素（累计判断，取代硬编码的 si>=N——上次关卡重排就是因为写死了
  // 序号，这次全部改成按元素名判断，以后再调顺序也不用逐处改数字）
  function hasElement(si, name) { return unlockedElements(si).has(name); }
  // 某个元素是「当前这一关」新引入的（不是"已解锁"，是"正是这一关"），用于只出现一次的教学标注
  function stageIndexOf(name) { return STAGES.findIndex((s) => s.element === name); }

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
    currentDay: HORIZON,
    inputs: {},
    canvas: null,
    ctx: null,
    cssW: 0,
    cssH: 0,
    history: [],
    redoStack: [],
    dragTimer: null,
    dragParam: null,
    lastLegendKey: null
  };

  /* ---------- 计算库存序列（clamp 到 0，不再出现负库存）---------- */
  // simulate：单次前向模拟。injectReplenish=true 时在到货日注入补货量。
  // lostSales/stockoutDays 统计的是「本来会卖出但没货」的部分（raw < 0 的那部分），
  // 而不是让库存本身变成负数——现实里库存不会是负的。
  //
  // v0.11 核心修复：「决策」和「结果」彻底分开——
  //   决策侧（什么时候下单、下多少）永远用 forecastDaily 算，因为现实里你下单那一刻
  //   并不知道真实销量，只有预测；结果侧（库存实际怎么消耗）永远用 p.demand 算，因为
  //   货卖出去多少是真实发生的事，不受你预测对不对影响。
  //   hasForecastDriven=false 时 forecastDaily 等于 p.demand（前 5 关的「假设预测=真实」），
  //   两侧用的是同一个数，跟旧版行为完全一致，不会回归；hasForecastDriven=true 时
  //   forecastDaily 才真正等于 p.forecast，预测错了，决策就会跟着错。
  function simulate(p, hasLead, hasPromo, hasForecastDriven, injectReplenish) {
    const inv = new Array(HORIZON + 1).fill(0);
    inv[0] = p.inventory;
    let ordered = false, orderDay = -1, arrivalDay = -1, suggestedQty = 0;
    let lostSales = 0, stockoutDays = 0, sellOutDay = -1, soldQty = 0;
    const forecastDaily = hasForecastDriven ? p.forecast : p.demand;
    for (let t = 1; t <= HORIZON; t++) {
      const promoOn = hasPromo && t >= p.promoDay;
      const realDemandToday = p.demand * (promoOn ? p.promo : 1);
      if (hasLead && !ordered) {
        // 用「预测」算还能撑几天——预测错了，这一步就会跟着错（这是本次修复的关键）
        const cover = inv[t - 1] / (forecastDaily || 1);
        if (cover <= p.safetyDays + p.leadTime) {
          ordered = true; orderDay = t; arrivalDay = Math.min(HORIZON, t + p.leadTime);
          // 建议补货量：这个简化模型只模拟「一次下单」（没有做周期性再订货），
          // 所以这一次补货必须够撑到 180 天演示结束——按预测日销 × 到货后剩下的天数来算。
          // 预测准 → 刚好够用到结束（少量安全垫剩余，接近 0 成本）；
          // 预测偏低 → 按偏低的日销算出的量不够撑到结束 → 会在结束前再次断货 → 少赚；
          // 预测偏高 → 按偏高的日销算出的量算多了 → 结束时还剩一大堆 → 压仓。
          suggestedQty = Math.max(0, forecastDaily * (HORIZON - arrivalDay));
        }
      }
      const replenishQty = hasForecastDriven ? suggestedQty : p.replenish;
      const available = inv[t - 1] + ((injectReplenish && arrivalDay === t && replenishQty > 0) ? replenishQty : 0);
      const sold = Math.min(realDemandToday, available); // 结果侧：真实卖出多少，永远受真实需求和真实库存约束
      soldQty += sold;
      const raw = available - realDemandToday;
      if (raw < 0) { lostSales += -raw; stockoutDays++; }
      inv[t] = Math.max(0, raw);
      if (sellOutDay < 0 && inv[t] <= 0) sellOutDay = t;
    }
    return { inv, ordered, orderDay, arrivalDay, lostSales, stockoutDays, sellOutDay, suggestedQty, soldQty };
  }

  function computeSeries(stageIndex) {
    const p = state.current;
    const hasLead = hasElement(stageIndex, "leadTime");
    const hasPromo = hasElement(stageIndex, "promo");
    const hasForecastDriven = hasElement(stageIndex, "forecast");

    const sim = simulate(p, hasLead, hasPromo, hasForecastDriven, true);

    // 预测线（Forecast 关起）：按预测日销算出的「计划库存曲线」（不 clamp，纯粹是「计划」，不代表真实库存）
    let invF = null;
    if (hasForecastDriven) {
      invF = new Array(HORIZON + 1).fill(0);
      invF[0] = p.inventory;
      for (let t = 1; t <= HORIZON; t++) {
        const promoOn = hasPromo && t >= p.promoDay;
        const c = p.forecast * (promoOn ? p.promo : 1);
        invF[t] = invF[t - 1] - c;
      }
    }

    return {
      inv: sim.inv, invF,
      metrics: {
        sellOutDay: sim.sellOutDay,
        orderDay: sim.orderDay,
        arrivalDay: sim.arrivalDay,
        stockoutDays: sim.stockoutDays,
        lostSales: sim.lostSales,
        suggestedQty: sim.suggestedQty,
        soldQty: sim.soldQty,
        coverForecast: p.forecast > 0 ? p.inventory / p.forecast : 0,
        coverDemand: p.demand > 0 ? p.inventory / p.demand : 0,
        endInv: sim.inv[HORIZON],
        lostMoney: sim.lostSales * UNIT_MARGIN,
        overstockMoney: sim.inv[HORIZON] * UNIT_COST
      }
    };
  }

  // 统一的「售罄时刻」：leadTime 关之前用连续公式（库存/日销，demand 全程不变，公式精确）；
  // leadTime 关起（有提前期/补货/促销）demand 不再全程恒定，改用离散模拟结果。
  // 这样售罄的红线位置和读数「库存覆盖」永远来自同一个数，不会再出现两套算法差一天的问题。
  function selloutMoment(si, m) {
    if (!hasElement(si, "leadTime")) return m.coverDemand;
    return m.sellOutDay;
  }
  function selloutDayLabel(si, m) {
    const v = selloutMoment(si, m);
    if (v == null || v < 0) return "—";
    return "第 " + Math.ceil(hasElement(si, "leadTime") ? v + 1 : v) + " 天";
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
  function dayLabelV(d) {
    if (d === 0) return "今天";
    return d + " 天后";
  }

  // 小圆点 + 短标签的节点标注（统一样式，图上任何「关键节点」都用它画）
  function drawNodeDot(ctx, px, py, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.stroke();
  }

  function draw(dayFraction, stageIndex) {
    const c = state.canvas, ctx = state.ctx;
    if (!c || !ctx) return;
    const W = state.cssW, H = state.cssH;
    if (!W || !H) return;
    const si = stageIndex == null ? state.stageIndex : stageIndex;
    const AXIS_STAGE = stageIndexOf("axis");
    const els = unlockedElements(si);
    const series = computeSeries(si);
    const inv = series.inv;
    const m = series.metrics;
    const p = state.current;

    const padL = 60, padR = 16, padT = 22, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // —— 坐标轴固定，不随「被拖动的日销」联动缩放（这是 v0.10 的核心修复）——
    // 横轴恒为 180 天；纵轴只跟「期初库存 + 补货量」这类会真正抬高库存上限的输入相关，
    // 不受日销/促销/售罄造成的负值影响——避免两层自动缩放叠加互相抵消。
    // 注意：yMax 必须取「最高一条刻度线」的值，而不是任意常数——否则刻度标签（如 15千）
    // 和它实际画的像素位置会对不上（数值被 clamp 到 yMax，但标签写的是更大的刻度值）。
    const xMax = HORIZON;
    const replenishForScale = els.has("forecast") ? m.suggestedQty : p.replenish;
    const yMaxBase = si === AXIS_STAGE ? 12000 : Math.max(12000, p.inventory + (replenishForScale || 0));
    const yTicks = (si === AXIS_STAGE) ? [0, 3000, 6000, 9000, 12000] : makeTicks(yMaxBase, 4);
    const yMax = yTicks[yTicks.length - 1];
    const yMin = 0;
    const x = (d) => padL + (clamp(d, 0, xMax) / xMax) * plotW;
    const y = (v) => padT + plotH - ((clamp(v, yMin, yMax) - yMin) / (yMax - yMin)) * plotH;
    const zeroY = y(0);

    ctx.clearRect(0, 0, W, H);

    // 网格 + 时间轴标签（中文，固定 5 等分）
    const grid = cssVar("--line");
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    const gridSteps = [0, 45, 90, 135, 180];
    gridSteps.forEach((d) => {
      ctx.beginPath(); ctx.moveTo(x(d), padT); ctx.lineTo(x(d), padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--muted"); ctx.font = "11.5px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(dayLabelV(d), x(d), H - 10);
    });
    ctx.textAlign = "left";

    // y 轴刻度
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
    if (si === AXIS_STAGE) {
      ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(x(0), y(p.inventory)); ctx.lineTo(x(HORIZON), y(p.inventory)); ctx.stroke();
      ctx.fillStyle = cssVar("--ink"); ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("━ 这是一条横线，高度 = 你今天有 " + fmt(p.inventory) + " 件货", W / 2, padT + 22);
      ctx.fillStyle = cssVar("--muted"); ctx.font = "12px sans-serif";
      ctx.fillText("下面会教：让它一天天掉、撞到 0、撞到之前补货回来……", W / 2, padT + 42);
      ctx.textAlign = "left";
      renderNodeCard(0, si, series);
      return;
    }

    const progDay = clamp(Math.round(dayFraction * HORIZON), 0, HORIZON);

    // 绿色有货区（库存线下方到 0 的填充）
    ctx.fillStyle = "rgba(23,121,87,0.18)";
    ctx.beginPath(); ctx.moveTo(x(0), zeroY);
    for (let d = 0; d <= progDay; d++) ctx.lineTo(x(d), y(inv[d]));
    ctx.lineTo(x(progDay), zeroY); ctx.closePath(); ctx.fill();

    // 库存曲线
    ctx.strokeStyle = cssVar("--green"); ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let d = 0; d <= progDay; d++) {
      const yy = y(inv[d]);
      if (d === 0) ctx.moveTo(x(d), yy); else ctx.lineTo(x(d), yy);
    }
    ctx.stroke();

    // 红色缺货带（售罄关起）：0 线上方的窄带，不再画负库存
    if (els.has("sellout") && m.stockoutDays > 0) {
      const startMoment = selloutMoment(si, m);
      const endDay = (hasElement(si, "leadTime") && m.arrivalDay >= 0) ? m.arrivalDay : HORIZON;
      if (startMoment >= 0 && startMoment <= progDay) {
        const sX = x(startMoment), eX = x(Math.min(endDay, progDay));
        const bandH = 10;
        ctx.fillStyle = "rgba(184,60,52,0.30)";
        ctx.fillRect(Math.min(sX, eX), zeroY - bandH, Math.max(2, eX - sX), bandH);
        if (progDay - startMoment > 8) {
          ctx.fillStyle = cssVar("--red"); ctx.font = "11px sans-serif"; ctx.textAlign = "center";
          // Forecast 关起，缺货带的标注要把「少赚多少钱」直接写出来——这是本轮修复要解决的核心：
          // 之前预测偏差只影响一条平行虚线，看不出任何后果；现在少卖的件数直接换算成钱。
          const moneyTxt = els.has("forecast") ? " · 少赚 ¥" + fmt(m.lostMoney) : "";
          ctx.fillText("🟥 缺货 " + m.stockoutDays + " 天 · 少卖约 " + fmt(m.lostSales) + " 件" + moneyTxt, (sX + eX) / 2, zeroY - bandH - 4);
          ctx.textAlign = "left";
        }
      }
    }

    // 压仓块（Forecast 关起）：期末还剩的库存画成右侧一块灰蓝色矩形 + 占用资金标注——
    // 回答「预测偏高会怎样」：货没断，但钱被压在仓库里没变现。
    if (els.has("forecast") && m.endInv > 0 && progDay === HORIZON) {
      const boxW = 14;
      const bx = x(HORIZON) - boxW;
      const by = y(m.endInv);
      ctx.fillStyle = "rgba(110,130,160,0.45)";
      ctx.fillRect(bx, by, boxW, zeroY - by);
      ctx.strokeStyle = "rgba(110,130,160,0.9)"; ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, boxW, zeroY - by);
      ctx.fillStyle = cssVar("--ink"); ctx.font = "bold 11px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("🏚 压仓 " + fmt(m.endInv) + " 件 · 占用 ¥" + fmt(m.overstockMoney), x(HORIZON) - boxW - 6, by + 12);
      ctx.textAlign = "left";
    }

    // 斜线中点 + 终点 教学标签（日销关，让"日销 = 斜率"一眼可见，只在这一关出现一次）
    if (si === stageIndexOf("demand") && progDay > 10 && p.demand > 0) {
      const sellout = Math.floor(p.inventory / p.demand);
      const midDay = Math.min(Math.floor(sellout / 2), progDay);
      const midX = x(midDay), midY = y(inv[midDay]);
      ctx.fillStyle = cssVar("--green"); ctx.font = "bold 12.5px sans-serif"; ctx.textAlign = "left";
      ctx.fillText("斜率 = 每天少 " + p.demand + " 件", midX - 30, midY - 8);
      const totalSold = Math.min(sellout, HORIZON) * p.demand;
      ctx.fillStyle = cssVar("--ink"); ctx.font = "11.5px sans-serif";
      ctx.fillText("🔺 共卖 " + fmt(totalSold) + " 件 = (1/2) × " + sellout + " 天 × " + fmt(p.inventory) + " 件", midX - 30, midY - 22);
      ctx.textAlign = "left";
    }

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
      // 图上直接标注预测覆盖 vs 真实覆盖的差距
      if (progDay > 20) {
        const gap = Math.round(m.coverForecast - m.coverDemand);
        if (Math.abs(gap) >= 1) {
          ctx.fillStyle = cssVar("--purple"); ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
          ctx.fillText((gap < 0 ? "预测覆盖比真实少 " + Math.abs(gap) : "预测覆盖比真实多 " + gap) + " 天", padL + 8, padT + 16);
          ctx.textAlign = "left";
        }
      }
    }

    // 促销起点竖线（第 7 关、且 promo>1）
    if (els.has("promo") && p.promo > 1 && p.promoDay <= progDay) {
      const px = x(p.promoDay);
      ctx.strokeStyle = cssVar("--amber"); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif";
      ctx.fillText("促销开始", px - 16, padT + 12);
      // 节点：促销拐点，标注斜率如何被放大
      drawNodeDot(ctx, px, y(inv[Math.min(p.promoDay, progDay)]), cssVar("--amber"));
      if (progDay > p.promoDay + 5) {
        ctx.fillStyle = cssVar("--amber"); ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
        ctx.fillText("斜率 × " + p.promo + " = 每天少 " + fmt(p.demand * p.promo) + " 件", px + 8, y(inv[Math.min(p.promoDay, progDay)]) + 16);
        ctx.textAlign = "left";
      }
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
        // 节点：库存线与安全线的交点 = 该下单的那一刻
        if (m.orderDay >= 0 && m.orderDay <= progDay) {
          const ox = x(m.orderDay);
          drawNodeDot(ctx, ox, sy, cssVar("--amber"));
          ctx.fillStyle = cssVar("--amber"); ctx.font = "11px sans-serif"; ctx.textAlign = "left";
          ctx.fillText("👉 覆盖到这天=该下单了", ox + 6, sy + 14);
          ctx.textAlign = "left";
        }
      }
    }

    // 补货箭头（补货关起）：Forecast 关起补货量不再是手动滑块，改成按预测自动算出的 suggestedQty
    const replenishQtyForDraw = els.has("forecast") ? m.suggestedQty : p.replenish;
    if (els.has("leadTime") && m.arrivalDay >= 0 && m.arrivalDay <= progDay && replenishQtyForDraw > 0) {
      const ax = x(m.arrivalDay);
      ctx.strokeStyle = cssVar("--green"); ctx.fillStyle = cssVar("--green"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(ax, padT + 4); ctx.lineTo(ax, padT + 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 5, padT + 10); ctx.lineTo(ax, padT + 2); ctx.lineTo(ax + 5, padT + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = cssVar("--green"); ctx.font = "11px sans-serif";
      ctx.fillText("+" + fmt(replenishQtyForDraw), ax - 12, padT + 36);
      if (m.orderDay >= 0) {
        ctx.fillStyle = cssVar("--muted"); ctx.font = "10.5px sans-serif"; ctx.textAlign = "center";
        ctx.fillText("← 提前期 " + p.leadTime + " 天 →", (x(m.orderDay) + ax) / 2, padT + 50);
        ctx.textAlign = "left";
      }
    }

    // 售罄标记（第 3 关起）——位置来自 selloutMoment()，与读数「库存覆盖」共用同一个数
    {
      const moment = selloutMoment(si, m);
      if (els.has("sellout") && moment >= 0 && moment <= progDay) {
        const sx = x(moment);
        ctx.strokeStyle = cssVar("--red"); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + plotH); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cssVar("--red"); ctx.font = "bold 11px sans-serif";
        ctx.fillText("售罄 · " + selloutDayLabel(si, m), sx + 4, padT + 12);
        if (si === stageIndexOf("sellout")) {
          ctx.fillStyle = cssVar("--red"); ctx.font = "10.5px sans-serif";
          ctx.fillText("= " + fmt(p.inventory) + "÷" + fmt(p.demand), sx + 4, padT + 26);
        }
      }
    }

    // 播放头
    if (progDay > 0) {
      const hx = x(progDay);
      ctx.strokeStyle = cssVar("--purple"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + plotH); ctx.stroke();
      ctx.fillStyle = cssVar("--purple");
      ctx.beginPath(); ctx.arc(hx, y(inv[progDay]), 4, 0, Math.PI * 2); ctx.fill();
    }

    renderNodeCard(progDay, si, series);
  }

  /* ---------- 📍 现在图上发生了什么（侧栏节点卡，跟着播放头/参数走） ---------- */
  function computeEvents(si, series) {
    const p = state.current, m = series.metrics;
    const events = [{
      day: 0, headline: "起点：今天有 " + fmt(p.inventory) + " 件货",
      what: "这是你今天手里的全部库存，图上那条线的最左端。",
      why: "一切推演都从这个数开始。",
      action: si === stageIndexOf("axis") ? "拖【期初库存】看横线怎么上下移动。" : "往右看它怎么一天天变少。"
    }];
    if (hasElement(si, "sellout")) {
      const moment = selloutMoment(si, m);
      if (moment >= 0) {
        events.push({
          day: moment,
          headline: "售罄：" + selloutDayLabel(si, m) + " 库存见底",
          what: "库存掉到 0，从这天起没货可卖。",
          why: fmt(p.inventory) + " 件 ÷ 每天 " + fmt(p.demand) + " 件 ≈ " + Math.ceil(moment) + " 天。",
          action: hasElement(si, "leadTime") ? "看下单日是不是早于这一天——早于才来得及。" : "下一关会教你怎么提前下单避开这天。"
        });
      }
    }
    if (hasElement(si, "leadTime") && m.orderDay >= 0) {
      const forecastNote = hasElement(si, "forecast") ? "（按你的预测算的，不是按真实销量）" : "";
      events.push({
        day: m.orderDay,
        headline: "下单：第 " + (m.orderDay + 1) + " 天触发补货" + forecastNote,
        what: "库存覆盖天数掉到「安全天数 + 提前期」，规则判定该下单了。",
        why: "覆盖 ≤ 安全" + p.safetyDays + "天 + 提前期" + p.leadTime + "天 = " + (p.safetyDays + p.leadTime) + " 天时触发。",
        action: "往右看提前期之后到货箭头落在哪一天。"
      });
    }
    if (hasElement(si, "leadTime") && m.arrivalDay >= 0) {
      const qty = hasElement(si, "forecast") ? m.suggestedQty : p.replenish;
      events.push({
        day: m.arrivalDay,
        headline: "到货：第 " + (m.arrivalDay + 1) + " 天补进 " + fmt(qty) + " 件",
        what: "下单后等了 " + p.leadTime + " 天，这批货终于到了，库存被重新抬起来。",
        why: "到货日 = 下单日 + 提前期。",
        action: m.stockoutDays > 0 ? "看看到货前有没有留下一段缺货带——那是没接上的部分。" : "补货接上了，库存没有断过。"
      });
    }
    if (hasElement(si, "promo") && p.promo > 1) {
      events.push({
        day: p.promoDay,
        headline: "促销开始：第 " + (p.promoDay + 1) + " 天起销量放大 " + p.promo + " 倍",
        what: "从这天起斜率变陡，库存掉得更快。",
        why: "促销期日销 = " + fmt(p.demand) + " × " + p.promo + " = " + fmt(p.demand * p.promo) + " 件/天。",
        action: "注意库存会不会在到货前先见底——光打广告不补货就是这么断的。"
      });
    }
    events.sort((a, b) => a.day - b.day);
    return events;
  }

  function currentEvent(events, progDay) {
    let cur = events[0];
    for (const e of events) { if (e.day <= progDay) cur = e; else break; }
    return cur;
  }

  function renderNodeCard(progDay, si, series) {
    const el = $("labNodeCard");
    if (!el) return;
    const events = computeEvents(si, series);
    const ev = currentEvent(events, progDay);
    el.innerHTML =
      `<span class="lab-nodecard-title">📍 现在图上发生了什么 · 第 ${progDay} 天</span>` +
      `<b>${ev.headline}</b><br>${ev.what}<br>🤔 ${ev.why}<br>👉 ${ev.action}`;
  }

  /* ---------- 读数面板（按关显示相关指标）---------- */
  function updateReadout() {
    const el = $("labReadout");
    if (!el) return;
    const si = state.stageIndex;
    const series = computeSeries(si);
    const m = series.metrics;
    const badge = (txt, cls) => `<span class="ro-badge ${cls}">${txt}</span>`;
    const rows = [];
    rows.push(["库存", fmt(state.current.inventory) + " 件"]);
    if (hasElement(si, "demand")) rows.push(["日均销量", fmt(state.current.demand) + " 件/天"]);
    if (hasElement(si, "demand")) rows.push(["库存覆盖", fmt(m.coverDemand) + " 天"]);
    if (hasElement(si, "sellout")) rows.push(["售罄日", selloutMoment(si, m) < 0 ? "不会售罄" : selloutDayLabel(si, m)]);
    if (hasElement(si, "sellout")) rows.push(["缺货情况", m.stockoutDays > 0 ? badge(m.stockoutDays + " 天 · 少卖 " + fmt(m.lostSales) + " 件", "bad") : "0 天"]);
    if (hasElement(si, "leadTime")) rows.push(["下单日 / 到货日", (m.orderDay >= 0 ? "第 " + (m.orderDay + 1) + " 天" : "—") + " / " + (m.arrivalDay >= 0 ? "第 " + (m.arrivalDay + 1) + " 天" : "—")]);
    if (hasElement(si, "forecast")) {
      // 修误导性文案：原来只说「预测覆盖…偏低」，容易被读成「你预测低了」——
      // 现在明确区分预测偏高/偏低各自的后果（对齐 Part1.5）。
      const gap = state.current.forecast - state.current.demand;
      let forecastNote;
      if (Math.abs(gap) < 1) forecastNote = "（预测≈真实，两者一致）";
      else if (gap < 0) forecastNote = "（⚠ 你预测得比真实低 " + fmt(-gap) + " 件/天 → 会断货）";
      else forecastNote = "（⚠ 你预测得比真实高 " + fmt(gap) + " 件/天 → 会压仓）";
      rows.push(["预测覆盖", fmt(m.coverForecast) + " 天 " + forecastNote]);
      rows.push(["预测建议补货量", fmt(m.suggestedQty) + " 件（按预测自动算，不再手动拖）"]);
      rows.push(["少赚金额", m.lostMoney > 0 ? badge("¥" + fmt(m.lostMoney), "bad") : "¥0"]);
      rows.push(["压仓占用", m.overstockMoney > 0 ? badge("¥" + fmt(m.overstockMoney), "bad") : "¥0"]);
    }
    if (hasElement(si, "promo")) rows.push(["促销期日销", fmt(state.current.demand * state.current.promo) + " 件/天"]);
    el.innerHTML = `<div class="ro-grid">` + rows.map(([k, v]) =>
      `<div class="ro-cell"><span class="ro-k">${k}</span><span class="ro-v">${v}</span></div>`).join("") + `</div>`;
    renderLegend(series);
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
        `<div class="lab-field-top"><label>${def.label}${newSet.has(name) ? ' <span class="lab-new">新</span>' : ''}<span class="lab-note-inline">${def.note}</span></label><span class="lab-val" id="labVal_${name}"></span></div>` +
        `<input type="range" id="labIn_${name}" min="${def.min}" max="${def.max}" step="${def.step}">`;
      wrap.appendChild(row);
      const input = row.querySelector("input");
      state.inputs[name] = input;
      input.addEventListener("input", () => {
        // 连续拖动同一个滑块合并成一条撤销记录（400ms 内视为同一次拖动）；
        // 但切到另一个滑块时，即使上一个滑块的 400ms 还没到期，也要立刻算新的一次操作——
        // 否则连续快速拖两个不同参数会被误合并成一步撤销。
        if (!state.dragTimer || state.dragParam !== name) pushHistory();
        state.dragParam = name;
        clearTimeout(state.dragTimer);
        state.dragTimer = setTimeout(() => { state.dragTimer = null; state.dragParam = null; }, 400);
        state.current[name] = Number(input.value);
        const lbl = $("labVal_" + name);
        if (lbl) lbl.textContent = fmt(Number(input.value)) + " " + def.unit;
        setDay(state.currentDay);
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
        const lbl = $("labVal_" + name);
        if (lbl) lbl.textContent = fmt(Number(v)) + " " + PARAMS[name].unit;
        draw(state.currentDay / HORIZON); updateReadout();
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    } else {
      input.value = value; state.current[name] = value;
      const lbl = $("labVal_" + name);
      if (lbl) lbl.textContent = fmt(value) + " " + PARAMS[name].unit;
      draw(state.currentDay / HORIZON); updateReadout();
    }
  }

  /* ---------- 元素进度条：未解锁的关只显示 🔒，不剧透名称 ---------- */
  function renderElements() {
    const el = $("labElements");
    if (!el) return;
    el.innerHTML = STAGES.map((s, i) => {
      if (i > state.stageIndex) {
        return `<span class="lab-chip locked" title="学到这一关就解锁">🔒</span>`;
      }
      const cur = i === state.stageIndex;
      const cls = cur ? "current" : "done";
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
  const LEGEND = [
    {
      icon: "📐", color: "--muted", name: "坐标网格",
      where: "灰色竖线 + 底部「今天 / 60 天后…」+ 左侧「N 件」刻度",
      why: "横轴 = 时间（天，固定 180 天），纵轴 = 库存（件，固定量程）——坐标范围不随日销等参数变化，这样线的陡缓、面积的大小才是真的在变，不是坐标系跟着一起动",
      biz: "看任何经营走势图都先认这两根轴",
      when: () => true
    },
    {
      icon: "━", color: "--green", name: "库存横线（绿）",
      where: "一条水平的绿线，横贯全图",
      why: "还没开始卖 → 库存每天都一样 → 线不上不下 = 横线；高度 = 你有几件",
      biz: "这是你的「家底」：今天手里的全部货",
      when: (p, m, si) => si === stageIndexOf("axis")
    },
    {
      icon: "📉", color: "--green", name: "库存斜线（绿）",
      where: "从左上往右下掉的绿线",
      why: "每过 1 天库存减「日销」件 → 线向右走 1 格就向下掉一点；斜率 = -日销，线越陡卖越快",
      biz: "你的货正在一天天变少",
      when: (p, m, si) => hasElement(si, "demand")
    },
    {
      icon: "▨", color: "--green", name: "绿色填充（有货区）",
      where: "绿线下方到 0 之间的淡绿色三角形区域",
      why: "面积 = (1/2)×天数×库存 = 这批货一共卖出的总件数",
      biz: "填充越大 = 这批货能创造的总销量越多",
      when: (p, m, si) => hasElement(si, "demand")
    },
    {
      icon: "▏", color: "--red", name: "红竖虚线（售罄日）",
      where: "一根从上到下的红色竖虚线 + 「售罄 · 第 N 天」标签",
      why: "竖线能精确标出「那一天」在时间轴的位置——绿线撞到 0 的那天",
      biz: "过了这天你就没货可卖了",
      when: (p, m, si) => hasElement(si, "sellout") && selloutMoment(si, m) >= 0
    },
    {
      icon: "🟥", color: "--red", name: "红色缺货带",
      where: "0 线上方一条窄窄的红色带 + 「缺货 N 天 · 少卖约 M 件」",
      why: "库存已经见底，但需求还在——这段时间你本来卖得掉却没货，不会画成负库存（现实中库存不为负）",
      biz: "少赚的钱 + 断货导致的链接权重下降",
      when: (p, m, si) => hasElement(si, "sellout") && m.stockoutDays > 0
    },
    {
      icon: "╌", color: "--purple", name: "紫虚线（你的预测）",
      where: "一条紫色的虚线，和绿线一起往下走",
      why: "虚线 = 还没发生 = 计划；绿实线 = 真实。两线岔开 = 预测错了——这一关起，下单时机和下单量都改成按这条线算，不再按真实销量算",
      biz: "预测偏低会断货少赚；偏高会压仓占钱",
      when: (p, m, si) => hasElement(si, "forecast")
    },
    {
      icon: "🏚", color: "--muted", name: "灰蓝压仓块",
      where: "最右侧（第 180 天）一块灰蓝色矩形，贴着库存线顶部",
      why: "预测偏高 → 按预测多下了单 → 到最后还剩这么多没卖完",
      biz: "占用资金 = 剩余件数 × 采购成本，这些钱变不成现金",
      when: (p, m, si) => hasElement(si, "forecast") && m.endInv > 0
    },
    {
      icon: "🔻", color: "--green", name: "绿箭头（补货到货）",
      where: "顶部一个绿色向上箭头 + 「+N」件数",
      why: "箭头指向「到货那一刻」在时间轴的位置 = 下单日 + 提前期",
      biz: "货从下单到可售要等提前期，等太久就先断货",
      when: (p, m, si) => hasElement(si, "leadTime") && m.arrivalDay >= 0
    },
    {
      icon: "⚌", color: "--amber", name: "琥珀横虚线（安全线）",
      where: "一条水平的琥珀色虚线 + 「⚠ 安全线 N 件」",
      why: "高度 = 安全天数 × 日销；绿线掉到这条线 = 立刻下单的信号",
      biz: "不等售罄才补货，提前下单躲开缺货带",
      when: (p, m, si) => hasElement(si, "safety") && p.safetyDays > 0
    },
    {
      icon: "▏", color: "--amber", name: "琥珀竖虚线（促销开始）",
      where: "促销开始日位置一根琥珀色竖虚线",
      why: "标出「从这天起斜率切换」——线从这里开始突然变陡",
      biz: "大促开始的那一刻",
      when: (p, m, si) => hasElement(si, "promo") && p.promo > 1
    },
    {
      icon: "🟡", color: "--amber", name: "促销尖峰",
      where: "竖虚线右侧，绿线突然变陡的那一段",
      why: "促销期日销 × 促销系数 → 斜率放大 → 更陡 = 尖峰",
      biz: "光加广告不补货 = 尖峰压垮库存，加速断货",
      when: (p, m, si) => hasElement(si, "promo") && p.promo > 1
    },
    {
      icon: "●", color: "--purple", name: "紫色播放头",
      where: "一键模拟/拖动播放条时的竖线 + 圆点",
      why: "标出「播到第几天」，圆点吸在当天的库存值上；侧栏「现在图上发生了什么」跟着它同步描述当天状态",
      biz: "带你逐天检查库存怎么变",
      when: (p, m, si) => hasElement(si, "demand")
    }
  ];

  function renderLegend(series) {
    const el = $("labLegend");
    if (!el) return;
    const si = state.stageIndex;
    const p = state.current;
    const m = (series || computeSeries(si)).metrics;
    const items = LEGEND.filter((it) => it.when(p, m, si));
    const key = items.map((it) => it.name).join("|");
    if (key === state.lastLegendKey) return; // 图上元素集合没变，跳过 DOM 重建（拖滑块时避免每帧重排）
    state.lastLegendKey = key;
    el.innerHTML =
      `<summary>🧩 图上现在有什么（${items.length} 个元素）</summary>` +
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

  /* ---------- 播放头 / 播放控制条 ---------- */
  function setDay(day) {
    day = clamp(Math.round(day), 0, HORIZON);
    state.currentDay = day;
    const scrub = $("labScrub");
    if (scrub) scrub.value = day;
    const lbl = $("labDayLabel");
    if (lbl) lbl.textContent = day === 0 ? "今天" : "第 " + day + " 天";
    draw(day / HORIZON);
    updateReadout();
  }

  function updatePlayPauseIcon() {
    const b = $("labPlayPause");
    if (!b) return;
    b.textContent = state.playing ? "⏸" : "▶";
    b.title = state.playing ? "暂停" : "继续播放";
  }

  function pausePlayback() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    state.playing = false;
    updatePlayPauseIcon();
  }

  function showDemoBadge(on) {
    const b = $("labDemoBadge");
    if (b) b.hidden = !on;
  }

  // 统一的播放头扫描（一键模拟 / 看演示 / 手动继续播放 都走这条路，暂停按钮才能统一生效）
  function playSweep(fromDay, toDay, dur, onDone) {
    if (state.raf) cancelAnimationFrame(state.raf);
    const t0 = performance.now();
    state.playing = true;
    updatePlayPauseIcon();
    function frame(now) {
      let k = (now - t0) / dur; if (k > 1) k = 1;
      setDay(fromDay + (toDay - fromDay) * k);
      if (k < 1) {
        state.raf = requestAnimationFrame(frame);
      } else {
        state.playing = false; state.raf = null; updatePlayPauseIcon();
        if (onDone) onDone();
      }
    }
    state.raf = requestAnimationFrame(frame);
  }

  function resumePlayback() {
    const startDay = state.currentDay;
    if (startDay >= HORIZON) { setDay(0); playSweep(0, HORIZON, 1800); return; }
    const remainFrac = (HORIZON - startDay) / HORIZON;
    playSweep(startDay, HORIZON, Math.max(150, 1800 * remainFrac));
  }

  /* ---------- 撤销 / 重做 ---------- */
  const MAX_HISTORY = 50;
  function snapshot() {
    return { stageIndex: state.stageIndex, current: Object.assign({}, state.current) };
  }
  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.redoStack = [];
    updateUndoRedoButtons();
  }
  function restoreSnapshot(snap) {
    const stageChanged = snap.stageIndex !== state.stageIndex;
    state.stageIndex = snap.stageIndex;
    state.current = Object.assign({}, snap.current);
    if (stageChanged) {
      renderStageChrome();
    }
    buildSliders();
    syncSliders();
    state.lastLegendKey = null;
    setDay(HORIZON);
    updateNavButtons();
  }
  function undo() {
    if (!state.history.length) return;
    state.redoStack.push(snapshot());
    const snap = state.history.pop();
    restoreSnapshot(snap);
    updateUndoRedoButtons();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.history.push(snapshot());
    const snap = state.redoStack.pop();
    restoreSnapshot(snap);
    updateUndoRedoButtons();
  }
  function updateUndoRedoButtons() {
    const u = $("labUndo"), r = $("labRedo");
    if (u) u.disabled = state.history.length === 0;
    if (r) r.disabled = state.redoStack.length === 0;
  }
  function updateNavButtons() {
    const prev = $("labPrev");
    if (prev) prev.disabled = state.stageIndex === 0;
  }

  /* ---------- 切关 ---------- */
  function renderStageChrome() {
    const S = STAGES[state.stageIndex];
    $("labLogic").textContent = S.logic;
    $("labStep").textContent = (state.stageIndex + 1) + " / " + STAGES.length;
    $("labTitle").textContent = S.title;
    $("labIntro").innerHTML =
      `<span class="lab-intro-badge">🧩 本关图上新增：${S.newLabel}</span>` + S.intro;
    $("labInstruct").innerHTML = S.instruct;
    $("labObserve").innerHTML = S.observe;
    const next = $("labNext");
    if (next) next.textContent = (state.stageIndex === STAGES.length - 1) ? "↺ 回到第 1 关" : "下一步 →";
    renderElements();
    renderDict();
  }

  function applyStage(i) {
    state.stageIndex = (i + STAGES.length) % STAGES.length;
    const S = STAGES[state.stageIndex];
    state.current = Object.assign({}, S.baseline);
    state.lastLegendKey = null;
    buildSliders();
    syncSliders();
    renderStageChrome();
    updateNavButtons();
    setDay(HORIZON);
  }

  function demoStage() {
    const S = STAGES[state.stageIndex];
    if (!S.demoTarget) return;
    const userSnapshot = Object.assign({}, state.current);
    if (state.raf) cancelAnimationFrame(state.raf);
    showDemoBadge(true);
    // 1) 滑块动画滑到 demoTarget（600ms，能看到线跟着参数变）
    Object.keys(S.demoTarget).forEach((k) => setParam(k, S.demoTarget[k], true));
    // 2) 参数到位后，播放头从今天扫到 180 天后
    setTimeout(() => {
      playSweep(0, HORIZON, 1200, () => {
        setTimeout(() => {
          // 3) 演示完恢复「你自己调过的值」，不是恢复成 baseline
          Object.keys(S.demoTarget).forEach((k) => {
            const lbl = $("labVal_" + k);
            if (state.inputs[k] && lbl) {
              state.inputs[k].value = userSnapshot[k];
              lbl.textContent = fmt(userSnapshot[k]) + " " + PARAMS[k].unit;
            }
            state.current[k] = userSnapshot[k];
          });
          showDemoBadge(false);
          setDay(HORIZON);
        }, 800);
      });
    }, 700);
  }

  function nextStage() { pushHistory(); applyStage(state.stageIndex + 1); }
  function prevStage() { if (state.stageIndex <= 0) return; pushHistory(); applyStage(state.stageIndex - 1); }

  /* ---------- 一键模拟：瞬间设到本关关键参数 → 时间扫描 → 恢复你自己的值 ---------- */
  function autoDemo() {
    const S = STAGES[state.stageIndex];
    const userSnapshot = Object.assign({}, state.current);
    if (state.raf) cancelAnimationFrame(state.raf);
    showDemoBadge(true);

    if (S.demoTarget) {
      Object.keys(S.demoTarget).forEach((k) => {
        const v = clamp(S.demoTarget[k], PARAMS[k].min, PARAMS[k].max);
        if (state.inputs[k]) {
          state.inputs[k].value = v;
          const lbl = $("labVal_" + k);
          if (lbl) lbl.textContent = fmt(v) + " " + PARAMS[k].unit;
        }
        state.current[k] = v;
      });
    }
    setDay(HORIZON);

    playSweep(0, HORIZON, 2400, () => {
      // 演示完恢复「用户自己调过的值」，不是 baseline（旧版会把你调过的参数无声改回默认值）
      if (S.demoTarget) {
        Object.keys(S.demoTarget).forEach((k) => {
          if (state.inputs[k]) {
            state.inputs[k].value = userSnapshot[k];
            const lbl = $("labVal_" + k);
            if (lbl) lbl.textContent = fmt(userSnapshot[k]) + " " + PARAMS[k].unit;
          }
          state.current[k] = userSnapshot[k];
        });
      }
      showDemoBadge(false);
      setDay(HORIZON);
    });
  }

  /* ---------- 公开接口 ---------- */
  window.LabCore = {
    onShow() { resizeCanvas(); draw(state.currentDay / HORIZON); updateReadout(); },
    // 仅供 verify_lab.js 等自动化测试使用：暴露内部状态/纯函数，不给 UI 用
    _debug: {
      computeSeries, STAGES, PARAMS, HORIZON,
      getState: () => state,
      applyStage,
      undo, redo,
      historyLength: () => state.history.length,
      redoLength: () => state.redoStack.length
    }
  };

  function init() {
    state.canvas = $("labCanvas");
    if (!state.canvas) return;
    applyStage(0);

    $("labPlay").addEventListener("click", autoDemo);
    $("labReset").addEventListener("click", () => {
      if (typeof confirm === "function" && !confirm("确定要重置本关吗？这一关调过的参数会恢复默认值（可以 Ctrl+Z 撤销这次重置）。")) return;
      pushHistory();
      applyStage(state.stageIndex);
    });
    $("labDemo").addEventListener("click", demoStage);
    $("labNext").addEventListener("click", nextStage);
    $("labPrev").addEventListener("click", prevStage);
    $("labUndo").addEventListener("click", undo);
    $("labRedo").addEventListener("click", redo);
    updateUndoRedoButtons();

    // 播放控制条
    const scrub = $("labScrub");
    if (scrub) scrub.addEventListener("input", (e) => { pausePlayback(); setDay(Number(e.target.value)); });
    const back = $("labStepBack");
    if (back) back.addEventListener("click", () => { pausePlayback(); setDay(state.currentDay - 1); });
    const fwd = $("labStepFwd");
    if (fwd) fwd.addEventListener("click", () => { pausePlayback(); setDay(state.currentDay + 1); });
    const pp = $("labPlayPause");
    if (pp) pp.addEventListener("click", () => { state.playing ? pausePlayback() : resumePlayback(); });

    // 键盘：Ctrl+Z 撤销 / Ctrl+Shift+Z、Ctrl+Y 重做
    document.addEventListener("keydown", (e) => {
      const lab = $("labView");
      if (!lab || lab.hidden) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
    });

    window.addEventListener("resize", () => {
      if ($("labView") && !$("labView").hidden) { resizeCanvas(); draw(state.currentDay / HORIZON); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
