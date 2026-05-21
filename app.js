const ASSET_ROOT = "./抽奖素材-1";
const STORAGE_KEY = "dushi-lottery-state-v3";
const CHANNEL_KEY = "dushi-lottery-live-v3";
const POOL_START = "2024-06-06";
const POOL_END = "2026-05-22";
const THIRD_ROUND_START_INDEX = 2;
const SYMBOLIC_ROLL_TICKS = 8;
const ROLL_INTERVAL_MS = 520;
const APP_MODE = document.body.dataset.mode || "control";
const IS_CONTROL = APP_MODE === "control";
const CLIENT_ID = Math.random().toString(36).slice(2);
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_KEY) : null;
const STAGE_SIZE = { width: 2304, height: 1280 };

const STEPS = [
  {
    id: "third-prize",
    round: "第一轮",
    name: "三等奖",
    defaultCount: 40,
    layout: "normal",
    repeatable: false,
  },
  {
    id: "second-prize",
    round: "第二轮",
    name: "二等奖",
    defaultCount: 20,
    layout: "normal",
    repeatable: false,
  },
  {
    id: "first-prize-a",
    round: "第三轮 1/4",
    name: "一等奖 · 第一抽",
    defaultCount: 5,
    layout: "normal",
    repeatable: false,
    introImage: `${ASSET_ROOT}/奖品贴图/third-1.png`,
    introLabel: "一等奖奖品图",
  },
  {
    id: "first-prize-b",
    round: "第三轮 2/4",
    name: "一等奖 · 精选5项",
    defaultCount: 5,
    layout: "normal",
    repeatable: false,
  },
  {
    id: "special-prize",
    round: "第三轮 3/4",
    name: "特等奖",
    defaultCount: 1,
    layout: "special",
    repeatable: true,
    introImage: `${ASSET_ROOT}/奖品贴图/third-3.png`,
    introLabel: "特等奖奖品图",
  },
  {
    id: "super-special-prize",
    round: "第三轮 4/4",
    name: "超级特等奖",
    defaultCount: 1,
    layout: "special",
    repeatable: true,
    introImage: `${ASSET_ROOT}/奖品贴图/third-4.png`,
    introLabel: "超级特等奖奖品图",
  },
];

const CARD_LAYOUTS = {
  normal: {
    width: 118,
    height: 154,
    x: [612, 741, 870, 1001, 1157, 1287, 1445, 1575],
    y: [189, 376, 562, 749, 934],
  },
  special: {
    width: 177,
    height: 231,
    x: [342, 536, 730, 925, 1160, 1355, 1591, 1786],
    y: [524],
  },
};

const els = {
  roundEyebrow: document.querySelector("#roundEyebrow"),
  stageTitle: document.querySelector("#stageTitle"),
  poolCount: document.querySelector("#poolCount"),
  drawSummary: document.querySelector("#drawSummary"),
  lotteryStage: document.querySelector("#lotteryStage"),
  assetLayer: document.querySelector("#assetLayer"),
  stageState: document.querySelector("#stageState"),
  prevGroup: document.querySelector("#prevGroup"),
  nextGroup: document.querySelector("#nextGroup"),
  groupReadout: document.querySelector("#groupReadout"),
  stepProgress: document.querySelector("#stepProgress"),
  stepList: document.querySelector("#stepList"),
  currentMode: document.querySelector("#currentMode"),
  drawCount: document.querySelector("#drawCount"),
  prevStep: document.querySelector("#prevStep"),
  nextStep: document.querySelector("#nextStep"),
  drawButton: document.querySelector("#drawButton"),
  confirmButton: document.querySelector("#confirmButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  screenButton: document.querySelector("#screenButton"),
  exportButton: document.querySelector("#exportButton"),
  resetButton: document.querySelector("#resetButton"),
  resultCount: document.querySelector("#resultCount"),
  resultList: document.querySelector("#resultList"),
};

const DATE_POOL = createDatePool(POOL_START, POOL_END);

let state = loadState();
let rolling = false;
let rollingMode = null;
let rollingStepIndex = null;
let rollingTimer = null;
let latestLiveFrame = null;
let lastRenderedDigits = new Map();

function createDatePool(startText, endText) {
  const start = parseISODate(startText);
  const end = parseISODate(endText);
  const dates = [];

  for (let stamp = start; stamp <= end; stamp += 24 * 60 * 60 * 1000) {
    const d = new Date(stamp);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${year}${month}${day}`);
  }

  return dates;
}

function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function defaultState() {
  return {
    stepIndex: 0,
    groupIndex: 0,
    customCounts: {},
    results: {},
    pending: {},
  };
}

function normalizeState(nextState) {
  const fallback = defaultState();
  return {
    ...fallback,
    ...(nextState ?? {}),
    customCounts: nextState?.customCounts ?? {},
    results: nextState?.results ?? {},
    pending: nextState?.pending ?? {},
  };
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(stored);
  } catch {
    return defaultState();
  }
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

function publish(message) {
  channel?.postMessage({
    ...message,
    source: CLIENT_ID,
  });
}

function saveState(options = {}) {
  const { broadcast = true } = options;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // BroadcastChannel still keeps open pages in sync when storage is unavailable.
  }

  if (broadcast) {
    publishState();
  }
}

function publishState() {
  publish({
    type: "state",
    state: cloneState(),
  });
}

function activeStep() {
  return STEPS[state.stepIndex] ?? STEPS[0];
}

function setText(el, text) {
  if (el) el.textContent = text;
}

function setDisabled(el, disabled) {
  if (el) el.disabled = disabled;
}

function getStepCount(step) {
  if (step.repeatable) return step.defaultCount;

  const custom = Number(state.customCounts[step.id]);
  return Number.isFinite(custom) && custom > 0 ? custom : step.defaultCount;
}

function getVisibleWinners(step) {
  const pending = state.pending[step.id];
  if (step.repeatable && pending?.length) return pending;
  return state.results[step.id] ?? [];
}

function getFinalWinners(step) {
  return state.results[step.id] ?? [];
}

function isManualStopStep(index = state.stepIndex) {
  return index >= THIRD_ROUND_START_INDEX;
}

function resolveLayout(step, winners) {
  const count = Array.isArray(winners) ? winners.length : getStepCount(step);
  if (step.layout === "special" && count <= 1) return "special";
  return "normal";
}

function clampGroupIndex(step, winners = getVisibleWinners(step)) {
  const layout = resolveLayout(step, winners);
  const groupCount = getGroupCount(winners, layout);
  state.groupIndex = Math.min(Math.max(state.groupIndex, 0), Math.max(groupCount - 1, 0));
}

function getGroupCount(winners, layout) {
  if (!winners.length) return 0;
  return layout === "special" ? 1 : Math.ceil(winners.length / 5);
}

function currentGroup(winners, layout) {
  if (!winners.length) return [];
  if (layout === "special") return winners.slice(0, 1);

  const start = state.groupIndex * 5;
  return winners.slice(start, start + 5);
}

function setStep(index) {
  state.stepIndex = Math.min(Math.max(index, 0), STEPS.length - 1);
  state.groupIndex = 0;
  saveState();
  render(true);
}

function sampleDates(count) {
  const total = Math.max(1, Math.min(Number(count) || 1, 999));
  if (total > DATE_POOL.length) {
    return Array.from({ length: total }, () => pickOne(DATE_POOL));
  }

  const shuffled = [...DATE_POOL];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, total);
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function displayDate(value) {
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function digitParts(value) {
  return [
    { file: "1-0", digit: value[0] },
    { file: "1-0", digit: value[1] },
    { file: "1-0", digit: value[2] },
    { file: `1-${value[3]}`, digit: value[3] },
    { file: `2-${value[4]}`, digit: value[4] },
    { file: `3-${value[5]}`, digit: value[5] },
    { file: `4-${value[6]}`, digit: value[6] },
    { file: `5-${value[7]}`, digit: value[7] },
  ];
}

function assetPath(layout, slot, file) {
  const folder = layout === "special" ? "特等奖" : `位置${slot}`;
  return `${ASSET_ROOT}/${folder}/${file}.png`;
}

function digitRect(layout, slot, digitIndex) {
  const config = CARD_LAYOUTS[layout];
  return {
    x: config.x[digitIndex],
    y: config.y[layout === "special" ? 0 : slot - 1],
    width: config.width,
    height: config.height,
  };
}

function render(animateStage = false) {
  const step = activeStep();
  const winners = getVisibleWinners(step);
  clampGroupIndex(step, winners);
  const layout = resolveLayout(step, winners);
  const groupCount = getGroupCount(winners, layout);

  setText(els.roundEyebrow, step.round);
  setText(els.stageTitle, step.name);
  setText(els.poolCount, `${DATE_POOL.length} 个号码`);
  setText(els.stepProgress, `${state.stepIndex + 1} / ${STEPS.length}`);
  if (els.drawCount) els.drawCount.value = getStepCount(step);
  setText(
    els.currentMode,
    isManualStopStep() ? (step.repeatable ? "喊停可重抽" : "喊停") : "短滚动",
  );

  const finalCount = getFinalWinners(step).length;
  const pendingCount = state.pending[step.id]?.length ?? 0;
  if (winners.length) {
    const shownGroup = groupCount ? `第 ${state.groupIndex + 1} / ${groupCount} 组` : "第 0 / 0 组";
    setText(els.drawSummary, `${winners.length} 位 · ${shownGroup}`);
    setText(els.stageState, step.repeatable && pendingCount && !finalCount ? "PENDING" : "DRAWN");
  } else {
    setText(els.drawSummary, "待抽取");
    setText(els.stageState, "READY");
  }

  setText(els.groupReadout, groupCount ? `第 ${state.groupIndex + 1} / ${groupCount} 组` : "第 0 / 0 组");
  setDisabled(els.prevGroup, rolling || groupCount <= 1 || state.groupIndex <= 0);
  setDisabled(els.nextGroup, rolling || groupCount <= 1 || state.groupIndex >= groupCount - 1);
  setDisabled(els.prevStep, state.stepIndex <= 0 || rolling);
  setDisabled(els.nextStep, state.stepIndex >= STEPS.length - 1 || rolling);
  setDisabled(els.drawCount, rolling || step.repeatable);
  setDisabled(els.drawButton, rolling && rollingMode !== "manual");
  setDisabled(els.confirmButton, rolling || !step.repeatable || !pendingCount);

  if (els.drawButton) {
    if (rolling && rollingMode === "manual") {
      els.drawButton.textContent = "停止抽取";
    } else if (rolling) {
      els.drawButton.textContent = "滚动中...";
    } else if (step.repeatable && pendingCount && !finalCount) {
      els.drawButton.textContent = "继续滚动";
    } else if (finalCount) {
      els.drawButton.textContent = isManualStopStep() ? "再次滚动" : "重新抽取";
    } else {
      els.drawButton.textContent = isManualStopStep() ? "开始滚动" : "开始抽取";
    }
  }

  if (IS_CONTROL) renderStepList();
  renderStage(step, winners, layout, animateStage);
  if (IS_CONTROL) renderResults();
}

function renderStepList() {
  els.stepList.innerHTML = "";

  STEPS.forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step-button";
    button.disabled = rolling;
    if (index === state.stepIndex) button.classList.add("is-active");
    if (getFinalWinners(step).length) button.classList.add("is-done");
    button.addEventListener("click", () => {
      if (!rolling) setStep(index);
    });

    const indexEl = document.createElement("span");
    indexEl.className = "step-index";
    indexEl.textContent = step.round;

    const nameWrap = document.createElement("span");
    const nameEl = document.createElement("span");
    nameEl.className = "step-name";
    nameEl.textContent = step.name;
    const countEl = document.createElement("span");
    countEl.className = "step-count";
    countEl.textContent = `${getStepCount(step)} 位`;
    nameWrap.append(nameEl, countEl);

    const statusEl = document.createElement("span");
    statusEl.className = "step-count";
    statusEl.textContent = getFinalWinners(step).length ? "已抽" : state.pending[step.id]?.length ? "待确认" : "未抽";

    button.append(indexEl, nameWrap, statusEl);
    els.stepList.append(button);
  });
}

function renderStage(step, winners, layout, animateStage) {
  const fragment = document.createDocumentFragment();
  const group = currentGroup(winners, layout);
  const nextRenderedDigits = new Map();

  group.forEach((dateValue, index) => {
    const slot = layout === "special" ? 1 : index + 1;
    digitParts(dateValue).forEach((part, digitIndex) => {
      const key = `${layout}-${slot}-${digitIndex}`;
      const previousPart = lastRenderedDigits.get(key);
      fragment.append(createDigitCard(layout, slot, digitIndex, part, previousPart, index, animateStage));
      nextRenderedDigits.set(key, part);
    });
  });

  if (!els.assetLayer) return;
  els.assetLayer.innerHTML = "";
  if (!group.length && step.introImage) {
    fragment.append(createPrizeIntro(step));
  }
  els.assetLayer.setAttribute(
    "aria-label",
    group.length ? group.map(displayDate).join("、") : step.introLabel ?? "",
  );
  els.assetLayer.append(fragment);
  lastRenderedDigits = nextRenderedDigits;
}

function createPrizeIntro(step) {
  const img = document.createElement("img");
  img.className = "prize-intro";
  img.src = step.introImage;
  img.alt = step.introLabel ?? "";
  img.draggable = false;
  return img;
}

function createDigitCard(layout, slot, digitIndex, part, previousPart, rowIndex, animateStage) {
  const rect = digitRect(layout, slot, digitIndex);
  const card = document.createElement("div");
  card.className = "calendar-card";
  card.dataset.digit = part.digit;
  if (animateStage) card.classList.add("flip-active");
  card.style.left = `${(rect.x / STAGE_SIZE.width) * 100}%`;
  card.style.top = `${(rect.y / STAGE_SIZE.height) * 100}%`;
  card.style.width = `${(rect.width / STAGE_SIZE.width) * 100}%`;
  card.style.height = `${(rect.height / STAGE_SIZE.height) * 100}%`;
  card.style.animationDelay = `${rowIndex * 90 + digitIndex * 32}ms`;

  const source = assetPath(layout, slot, part.file);
  const top = createDigitSlice(source, rect, "top");
  const bottom = createDigitSlice(source, rect, "bottom");
  card.append(top, bottom);

  if (animateStage) {
    const previousSource = previousPart ? assetPath(layout, slot, previousPart.file) : source;
    const flip = createFlipPanel(previousSource, source, rect);
    flip.style.animationDelay = `${rowIndex * 90 + digitIndex * 32}ms`;
    card.append(flip);
  }

  return card;
}

function createDigitSlice(source, rect, className) {
  const slice = document.createElement("div");
  slice.className = className === "digit-flip" ? className : `digit-slice ${className}`;

  const img = document.createElement("img");
  img.className = "digit-source";
  img.src = source;
  img.alt = "";
  img.draggable = false;
  img.style.width = `${(STAGE_SIZE.width / rect.width) * 100}%`;
  img.style.height = `${(STAGE_SIZE.height / rect.height) * 100}%`;
  img.style.left = `${-(rect.x / rect.width) * 100}%`;
  img.style.top = `${-(rect.y / rect.height) * 100}%`;

  slice.append(img);
  return slice;
}

function createFlipPanel(previousSource, nextSource, rect) {
  const panel = document.createElement("div");
  panel.className = "digit-flip-panel";

  const front = document.createElement("div");
  front.className = "digit-flip-face front";
  front.append(createDigitImage(previousSource, rect, "bottom"));

  const back = document.createElement("div");
  back.className = "digit-flip-face back";
  back.append(createDigitImage(nextSource, rect, "top"));

  panel.append(front, back);
  return panel;
}

function createDigitImage(source, rect, half) {
  const img = document.createElement("img");
  img.className = "digit-source";
  img.src = source;
  img.alt = "";
  img.draggable = false;
  img.style.width = `${(STAGE_SIZE.width / rect.width) * 100}%`;
  img.style.height = `${(STAGE_SIZE.height / rect.height) * 200}%`;
  img.style.left = `${-(rect.x / rect.width) * 100}%`;
  img.style.top = half === "bottom" ? `${-(rect.y / rect.height) * 200 - 100}%` : `${-(rect.y / rect.height) * 200}%`;
  return img;
}

function createPreviewFrame(step) {
  const count = getStepCount(step);
  const previewCount = resolveLayout(step, Array.from({ length: count })) === "special" ? 1 : Math.min(5, count);
  const winners = sampleDates(previewCount);
  const layout = resolveLayout(step, winners);

  return { winners, layout };
}

function renderPreview(step, frame = createPreviewFrame(step)) {
  renderStage(step, frame.winners, frame.layout, true);
  return frame;
}

function renderAndPublishPreview(step, stepIndex = state.stepIndex) {
  const frame = renderPreview(step);
  latestLiveFrame = {
    type: "preview",
    stepIndex,
    state: cloneState(),
    winners: frame.winners,
    layout: frame.layout,
  };
  publish(latestLiveFrame);
  return frame;
}

function renderLiveFrame(message) {
  const step = STEPS[message.stepIndex] ?? activeStep();
  const winners = message.winners ?? [];
  const layout = message.layout ?? resolveLayout(step, winners);
  const plannedLayout = resolveLayout(step, Array.from({ length: getStepCount(step) }));
  const groupCount = plannedLayout === "special" ? 1 : Math.ceil(getStepCount(step) / 5);

  setText(els.roundEyebrow, step.round);
  setText(els.stageTitle, step.name);
  setText(els.poolCount, `${DATE_POOL.length} 个号码`);
  setText(els.drawSummary, groupCount ? `抽取中 · 第 1 / ${groupCount} 组` : "抽取中");
  setText(els.stageState, "ROLLING");
  setText(els.groupReadout, groupCount ? `第 1 / ${groupCount} 组` : "第 0 / 0 组");
  els.lotteryStage?.classList.add("is-rolling");
  renderStage(step, winners, layout, true);
}

function renderResults() {
  els.resultList.innerHTML = "";

  const resultEntries = STEPS.flatMap((step) => {
    const winners = getFinalWinners(step);
    return winners.length ? [{ step, winners }] : [];
  });

  const total = resultEntries.reduce((sum, entry) => sum + entry.winners.length, 0);
  els.resultCount.textContent = String(total);

  if (!resultEntries.length) {
    const empty = document.createElement("div");
    empty.className = "result-empty";
    empty.textContent = "暂无结果";
    els.resultList.append(empty);
    return;
  }

  resultEntries.forEach(({ step, winners }) => {
    const item = document.createElement("article");
    item.className = "result-item";

    const title = document.createElement("div");
    title.className = "result-title";
    const name = document.createElement("span");
    name.textContent = `${step.round} · ${step.name}`;
    const count = document.createElement("span");
    count.textContent = `${winners.length} 位`;
    title.append(name, count);

    const numbers = document.createElement("div");
    numbers.className = "result-numbers";
    winners.forEach((dateValue) => {
      const pill = document.createElement("span");
      pill.className = "number-pill";
      pill.textContent = displayDate(dateValue);
      numbers.append(pill);
    });

    item.append(title, numbers);
    els.resultList.append(item);
  });
}

function runDraw() {
  if (rolling) {
    if (rollingMode === "manual") stopManualDraw();
    return;
  }

  const step = activeStep();
  const count = step.repeatable
    ? step.defaultCount
    : Math.max(1, Math.min(Number(els.drawCount.value) || step.defaultCount, DATE_POOL.length));
  state.customCounts[step.id] = count;

  if (isManualStopStep()) {
    startManualDraw(step);
    return;
  }

  runSymbolicDraw(step, count);
}

async function runSymbolicDraw(step, count) {
  rolling = true;
  rollingMode = "timed";
  rollingStepIndex = state.stepIndex;
  els.lotteryStage?.classList.add("is-rolling");
  render();
  setText(els.drawSummary, "抽取中");
  setText(els.stageState, "ROLLING");

  for (let i = 0; i < SYMBOLIC_ROLL_TICKS; i += 1) {
    renderAndPublishPreview(step, rollingStepIndex);
    await delay(ROLL_INTERVAL_MS);
  }

  finishDraw(step, count);
}

function startManualDraw(step) {
  rolling = true;
  rollingMode = "manual";
  rollingStepIndex = state.stepIndex;
  els.lotteryStage?.classList.add("is-rolling");
  render();
  setText(els.drawSummary, "滚动中 · 等待喊停");
  setText(els.stageState, "ROLLING");

  const spin = () => {
    if (!rolling || rollingMode !== "manual") return;
    renderAndPublishPreview(step, rollingStepIndex);
    rollingTimer = window.setTimeout(spin, ROLL_INTERVAL_MS);
  };

  spin();
}

function stopManualDraw() {
  const step = STEPS[rollingStepIndex] ?? activeStep();
  const count = getStepCount(step);
  finishDraw(step, count);
}

function finishDraw(step, count) {
  clearRollingTimer();
  const winners = sampleDates(count);
  if (step.repeatable) {
    state.pending[step.id] = winners.slice(0, 1);
    delete state.results[step.id];
  } else {
    state.results[step.id] = winners;
    delete state.pending[step.id];
  }
  state.groupIndex = 0;

  rolling = false;
  rollingMode = null;
  rollingStepIndex = null;
  latestLiveFrame = null;
  els.lotteryStage?.classList.remove("is-rolling");
  saveState();
  render(true);
}

function clearRollingTimer() {
  if (rollingTimer) {
    window.clearTimeout(rollingTimer);
    rollingTimer = null;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function confirmCurrent() {
  const step = activeStep();
  const pending = state.pending[step.id];
  if (!step.repeatable || !pending?.length) return;

  state.results[step.id] = pending;
  delete state.pending[step.id];
  saveState();
  render(true);
}

function exportResults() {
  const rows = [["轮次", "奖项", "序号", "号码", "日期"]];

  STEPS.forEach((step) => {
    getFinalWinners(step).forEach((dateValue, index) => {
      rows.push([step.round, step.name, String(index + 1), dateValue, displayDate(dateValue)]);
    });
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "笃实抽奖结果.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetAll() {
  if (!window.confirm("确认清空所有抽奖结果？")) return;
  clearRollingTimer();
  rolling = false;
  rollingMode = null;
  rollingStepIndex = null;
  latestLiveFrame = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the in-memory state is still cleared below.
  }
  state = loadState();
  saveState();
  render(true);
}

function bindEvents() {
  if (!IS_CONTROL) return;

  els.prevGroup?.addEventListener("click", () => {
    if (rolling) return;
    state.groupIndex -= 1;
    saveState();
    render(true);
  });

  els.nextGroup?.addEventListener("click", () => {
    if (rolling) return;
    state.groupIndex += 1;
    saveState();
    render(true);
  });

  els.prevStep?.addEventListener("click", () => setStep(state.stepIndex - 1));
  els.nextStep?.addEventListener("click", () => setStep(state.stepIndex + 1));
  els.drawButton?.addEventListener("click", runDraw);
  els.confirmButton?.addEventListener("click", confirmCurrent);
  els.exportButton?.addEventListener("click", exportResults);
  els.resetButton?.addEventListener("click", resetAll);
  els.screenButton?.addEventListener("click", () => {
    const screenUrl = new URL("./screen.html", window.location.href).href;
    window.open(screenUrl, "dushi-lottery-screen")?.focus();
  });

  els.drawCount?.addEventListener("change", () => {
    const step = activeStep();
    if (step.repeatable) {
      state.customCounts[step.id] = step.defaultCount;
      saveState();
      render();
      return;
    }

    const next = Math.max(1, Math.min(Number(els.drawCount.value) || step.defaultCount, DATE_POOL.length));
    state.customCounts[step.id] = next;
    saveState();
    render();
  });

  els.fullscreenButton?.addEventListener("click", () => {
    const target = els.lotteryStage;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else if (target) {
      target.requestFullscreen?.();
    }
  });
}

function setupSync() {
  channel?.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source === CLIENT_ID) return;

    if (message.type === "sync-request" && IS_CONTROL) {
      if (rolling && latestLiveFrame) {
        publish(latestLiveFrame);
      } else {
        publishState();
      }
      return;
    }

    if (message.type === "preview") {
      state = normalizeState(message.state);
      rolling = true;
      renderLiveFrame(message);
      return;
    }

    if (message.type === "state") {
      state = normalizeState(message.state);
      rolling = false;
      els.lotteryStage?.classList.remove("is-rolling");
      render(true);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;

    try {
      state = normalizeState(JSON.parse(event.newValue));
      rolling = false;
      els.lotteryStage?.classList.remove("is-rolling");
      render(true);
    } catch {
      // Ignore malformed storage from outside this app.
    }
  });

  if (!IS_CONTROL) {
    window.setTimeout(() => {
      publish({ type: "sync-request" });
    }, 120);
  } else {
    window.setTimeout(publishState, 120);
  }
}

setupSync();
bindEvents();
render(true);
