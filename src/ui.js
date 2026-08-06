// ui.js — 交互式优化 UI（会话/历史/实时进度/多路径绘制/持久化）
// 求解在 Web Worker 中执行（z3 wasm 不进主线程），主线程只做渲染与状态管理。
import { newSession, preloadWasm, z3ScriptUrl, countTurns } from './solver-core.js';

const $ = (id) => document.getElementById(id);

const STATE_KEY = 'zssm-session-v2';

const state = {
  rows: 9,
  cols: 11,
  grid: [],
  session: null,   // { grid, boundary, timeoutMs, snapshots[], nextId, createdAt }
  selId: null,     // 当前选中的快照 id
  solving: false,
  cancelled: false,
  highlight: null, // 图例高亮的路径下标（null = 全部）
};

// ---------- 求解 Worker ----------
let _worker = null;
let _workerDead = false;
let _pending = new Map();   // reqId -> (res) => void
let _reqId = 0;
let _wasmBlobUrl = null;
let _z3ScriptUrl = '';

const PHASE_DESC = { first: '求解中（求任意解）', paths: '优化路径数', turns: '优化转弯数' };

function onWorkerMessage(ev) {
  const m = ev.data;
  if (m.type === 'progress') {
    setProg(`${PHASE_DESC[m.action] || '求解中'} · 第 ${m.payload.iter} 轮 · ${fmtSecs(m.payload.seconds)}`);
    renderHist();
  } else if (m.type === 'done') {
    const cb = _pending.get(m.id);
    if (cb) {
      _pending.delete(m.id);
      cb(m.res);
    }
  } else if (m.type === 'error' || m.type === 'init-error') {
    setStatus('求解内核异常: ' + m.message);
  }
}

function onWorkerError(e) {
  _workerDead = true;
  _pending.forEach(cb => cb({ status: 'error', message: '求解内核异常终止' }));
  _pending.clear();
  setBusy(null);
  setProg('');
  setStatus('求解内核异常终止（worker 崩溃），请重新点「求解」');
}

function ensureWorker() {
  if (_worker && !_workerDead) return _worker;
  _workerDead = false;
  _worker = new Worker('worker.js');
  _worker.addEventListener('message', onWorkerMessage);
  _worker.addEventListener('error', onWorkerError);
  _worker.postMessage({
    type: 'init',
    z3ScriptUrl: _z3ScriptUrl || z3ScriptUrl(),
    wasmBlobUrl: _wasmBlobUrl,
  });
  return _worker;
}

// 规格书验证用例 1 的布局（用户提供，O=空格 X=障碍，12 障碍 / 87 空格）
const SAMPLE = [
  'OOOOOOOOOOO',
  'OOOOOOOOOOO',
  'OOOXOOOOOOO',
  'OOOXXXXOOOO',
  'OOOOXXXOOOO',
  'OOOOOXXXOOO',
  'OOOOOOOXOOO',
  'OOOOOOOOOOO',
  'OOOOOOOOOOO',
];

function makeGrid(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function loadSample() {
  state.rows = SAMPLE.length;
  state.cols = SAMPLE[0].length;
  state.grid = SAMPLE.map(row => [...row].map(ch => (ch === 'X' ? 1 : 0)));
  $('rows').value = state.rows;
  $('cols').value = state.cols;
}

function resizeGrid(rows, cols) {
  const ng = makeGrid(rows, cols);
  for (let i = 0; i < Math.min(rows, state.rows); i++) {
    for (let j = 0; j < Math.min(cols, state.cols); j++) {
      ng[i][j] = state.grid[i] ? state.grid[i][j] ?? 0 : 0;
    }
  }
  state.rows = rows;
  state.cols = cols;
  state.grid = ng;
}

// ---------- 会话 / 持久化 ----------
function newUiSession(msg) {
  state.session = newSession(state.grid, {
    boundary: $('boundary').checked,
    timeoutMs: 30000,
  });
  state.selId = null;
  state.highlight = null;
  saveSession();
  setPathText('');
  renderHist();
  updateButtons();
  if (msg) setStatus(msg);
  render();
}

function selSnapshot() {
  const s = state.session;
  return s ? s.snapshots.find(x => x.id === state.selId) || null : null;
}

function saveSession() {
  const s = state.session;
  if (!s) return;
  const data = {
    grid: s.grid,
    boundary: s.boundary,
    timeoutMs: s.timeoutMs,
    snapshots: s.snapshots,
    nextId: s.nextId,
    createdAt: s.createdAt,
  };
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(data));
  } catch {
    /* 存储满时静默失败 */
  }
}

function loadSaved() {
  let data = null;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch { data = null; }
  if (!data || !Array.isArray(data.grid) || !Array.isArray(data.snapshots)) return false;
  state.rows = data.grid.length;
  state.cols = data.grid[0].length;
  state.grid = data.grid;
  state.session = {
    grid: data.grid,
    boundary: !!data.boundary,
    timeoutMs: data.timeoutMs ?? 30000,
    snapshots: data.snapshots,
    nextId: data.nextId ?? data.snapshots.length + 1,
    createdAt: data.createdAt ?? Date.now(),
  };
  $('rows').value = state.rows;
  $('cols').value = state.cols;
  $('boundary').checked = state.session.boundary;
  const last = state.session.snapshots[state.session.snapshots.length - 1];
  state.selId = last ? last.id : null;
  return true;
}

function exportSession() {
  const s = state.session;
  if (!s) return;
  const data = {
    app: 'zssm',
    version: 2,
    savedAt: Date.now(),
    grid: s.grid,
    boundary: s.boundary,
    timeoutMs: s.timeoutMs,
    snapshots: s.snapshots,
    nextId: s.nextId,
    createdAt: s.createdAt,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zssm-session-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('已导出会话 JSON');
}

function importSession(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.grid) || !Array.isArray(data.snapshots)) {
        setStatus('导入失败：不是有效的会话文件');
        return;
      }
      state.rows = data.grid.length;
      state.cols = data.grid[0].length;
      state.grid = data.grid;
      state.session = {
        grid: data.grid,
        boundary: !!data.boundary,
        timeoutMs: data.timeoutMs ?? 30000,
        snapshots: data.snapshots,
        nextId: data.nextId ?? data.snapshots.length + 1,
        createdAt: data.createdAt ?? Date.now(),
      };
      $('rows').value = state.rows;
      $('cols').value = state.cols;
      $('boundary').checked = state.session.boundary;
      const last = state.session.snapshots[state.session.snapshots.length - 1];
      state.selId = last ? last.id : null;
      saveSession();
      renderHist();
      if (state.selId) selectSnapshot(state.selId);
      setStatus(`已导入会话：${data.snapshots.length} 个方案`);
      render();
    } catch {
      setStatus('导入失败：JSON 解析错误');
    }
  };
  reader.readAsText(file);
}

// ---------- Canvas 绘制 ----------
const canvas = $('board');
const ctx = canvas.getContext('2d');
const MARGIN = 22;
let CELL = 30;

function resizeCanvas() {
  const maxDim = Math.max(state.rows, state.cols);
  CELL = Math.max(8, Math.floor((640 - MARGIN) / maxDim));
  canvas.width = MARGIN + state.cols * CELL;
  canvas.height = MARGIN + state.rows * CELL;
}

const cx = (j) => MARGIN + j * CELL + CELL / 2;
const cy = (i) => MARGIN + i * CELL + CELL / 2;

function pathColor(i, n) {
  return `hsl(${Math.round((i * 300) / Math.max(1, n))}, 70%, 62%)`;
}

function render() {
  const { rows, cols, grid } = state;
  resizeCanvas();
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 棋盘底色
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#171c22' : '#1d232b';
      ctx.fillRect(MARGIN + j * CELL, MARGIN + i * CELL, CELL, CELL);
    }
  }

  // 障碍（红叉）
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = Math.max(2, CELL * 0.08);
  ctx.lineCap = 'round';
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (!grid[i][j]) continue;
      const x = MARGIN + j * CELL;
      const y = MARGIN + i * CELL;
      const p = CELL * 0.22;
      ctx.beginPath();
      ctx.moveTo(x + p, y + p);
      ctx.lineTo(x + CELL - p, y + CELL - p);
      ctx.moveTo(x + CELL - p, y + p);
      ctx.lineTo(x + p, y + CELL - p);
      ctx.stroke();
    }
  }

  // 网格线
  ctx.strokeStyle = '#2c3540';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let j = 0; j <= cols; j++) {
    ctx.moveTo(MARGIN + j * CELL, MARGIN);
    ctx.lineTo(MARGIN + j * CELL, MARGIN + rows * CELL);
  }
  for (let i = 0; i <= rows; i++) {
    ctx.moveTo(MARGIN, MARGIN + i * CELL);
    ctx.lineTo(MARGIN + cols * CELL, MARGIN + i * CELL);
  }
  ctx.stroke();

  // 坐标轴
  ctx.fillStyle = '#8b98a5';
  ctx.font = `${Math.max(9, Math.min(11, CELL * 0.38))}px Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let j = 0; j < cols; j++) ctx.fillText(String(j), cx(j), MARGIN / 2);
  for (let i = 0; i < rows; i++) ctx.fillText(String(i), MARGIN / 2, cy(i));

  const snap = selSnapshot();
  if (snap && snap.paths && snap.paths.length) drawPaths(snap.paths);
}

function drawPaths(paths) {
  const n = paths.length;
  for (let p = 0; p < n; p++) {
    const path = paths[p];
    if (path.length === 1) {
      // 单点路径（V==1 特判）
      const x = cx(path[0][1]);
      const y = cy(path[0][0]);
      ctx.globalAlpha = state.highlight === null || state.highlight === p ? 1 : 0.15;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, CELL * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = pathColor(p, n);
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    const dim = state.highlight !== null && state.highlight !== p;
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.strokeStyle = pathColor(p, n);
    ctx.lineWidth = Math.max(3, CELL * 0.22);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    path.forEach(([i, j], k) => {
      const x = cx(j);
      const y = cy(i);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 弯道白点
    ctx.fillStyle = '#e8eef4';
    for (let k = 1; k < path.length - 1; k++) {
      const [i0, j0] = path[k - 1];
      const [i1, j1] = path[k];
      const [i2, j2] = path[k + 1];
      const turn = (i1 - i0) * (j2 - j1) - (j1 - j0) * (i2 - i1);
      if (turn !== 0) {
        ctx.beginPath();
        ctx.arc(cx(j1), cy(i1), Math.max(2, CELL * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 端点：绿起红终
    const s = path[0];
    const e = path[path.length - 1];
    for (const [i, j, color] of [[s[0], s[1], '#2fb344'], [e[0], e[1], '#e5484d']]) {
      ctx.beginPath();
      ctx.arc(cx(j), cy(i), Math.max(3, CELL * 0.18), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#101418';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function renderLegend(snap) {
  const box = $('legend');
  if (!snap || !snap.paths || snap.paths.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '';
  snap.paths.forEach((p, i) => {
    const el = document.createElement('button');
    el.className = 'legend-item' + (state.highlight === i ? ' active' : '');
    el.innerHTML =
      `<span class="swatch" style="background:${pathColor(i, snap.paths.length)}"></span>` +
      `路径 ${i + 1} · 长度${p.length} · 弯${countTurns(p)}`;
    el.addEventListener('click', () => {
      state.highlight = state.highlight === i ? null : i;
      renderLegend(snap);
      render();
    });
    box.appendChild(el);
  });
}

// ---------- 历史列表 ----------
function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function setPathText(text) {
  $('pathout').textContent = text;
}

function setProg(text) {
  const el = $('prog');
  if (text) {
    el.textContent = text;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function fmtSecs(s) {
  return s !== undefined ? s.toFixed(2) + 's' : '-';
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function renderHist() {
  const box = $('hist');
  const s = state.session;
  if (!s || s.snapshots.length === 0) {
    box.innerHTML = '<div class="clist-empty">（暂无方案，点「求解」开始）</div>';
    return;
  }
  box.innerHTML = '';
  const snaps = [...s.snapshots].sort((a, b) => b.id - a.id); // 新的在前
  snaps.forEach(snap => {
    const btn = document.createElement('button');
    btn.className = 'clist-item' + (snap.id === state.selId ? ' selected' : '');
    const badges = [];
    if (snap.provenPaths) badges.push('<span class="badge">路径最优</span>');
    if (snap.provenTurns) badges.push('<span class="badge">转弯最优</span>');
    btn.innerHTML =
      `<span class="id">#${snap.id}</span>` +
      `<span class="label">${snap.label}</span>` +
      badges.join('') +
      `<span class="counts">${snap.pathCount ?? '-'}路径 / ${snap.turnSum ?? '-'}弯</span>` +
      `<span class="meta">${fmtSecs(snap.elapsedMs / 1000)} · ${fmtTime(snap.createdAt)}${snap.check && snap.check !== 'OK' ? ' · ⚠' + snap.check : ''}</span>`;
    btn.addEventListener('click', () => selectSnapshot(snap.id));
    box.appendChild(btn);
  });
}

function selectSnapshot(id, prefix = '') {
  const s = state.session;
  if (!s) return;
  const snap = s.snapshots.find(x => x.id === id);
  if (!snap) return;
  state.selId = id;
  state.highlight = null;
  if (snap.paths && snap.paths.length) {
    setPathText(pathsText(snap.paths));
  } else {
    setPathText('');
  }
  renderLegend(snap);
  const proven = [
    snap.provenPaths ? '路径数已证最优' : '',
    snap.provenTurns ? '转弯数已证最优' : '',
  ].filter(Boolean).join(' · ');
  setStatus(
    `${prefix}${snap.label} · ${snap.pathCount}路径 / ${snap.turnSum}弯 · 迭代${snap.iters} · ` +
      `${fmtSecs(snap.elapsedMs / 1000)} · 校验${snap.check}${proven ? ' · ' + proven : ''}`,
    'sat'
  );
  renderHist();
  updateButtons();
  saveSession();
  render();
}

function pathsText(paths) {
  return paths
    .map((p, i) => `#${i + 1}: ` + p.map(([i, j]) => `(${i},${j})`).join('→'))
    .join('\n');
}

// ---------- 求解流程 ----------
function updateButtons() {
  const snap = selSnapshot();
  const solving = state.solving;
  $('solve').disabled = solving;
  $('cancel').disabled = !solving;
  $('copy').disabled = solving || !snap;
  $('optPaths').disabled = solving || !snap || snap.provenPaths;
  $('optTurns').disabled = solving || !snap || snap.provenTurns;
  $('optAll').disabled = solving || !snap || (snap.provenPaths && snap.provenTurns);
}

function setBusy(text) {
  state.solving = !!text;
  if (text) setProg(text);
  updateButtons();
}

async function runAction(action) {
  const s = state.session;
  const from = selSnapshot();
  if (!s || state.solving) return false;
  if (action.needsFrom !== false && !from) return false;
  state.cancelled = false;
  setBusy(`${action.desc}…`);
  const id = ++_reqId;
  return new Promise((resolve) => {
    _pending.set(id, (res) => {
      handleResult(res);
      setBusy(null);
      setProg('');
      resolve(true);
    });
    ensureWorker().postMessage({
      type: 'solve',
      id,
      action: action.action,
      grid: s.grid,
      boundary: s.boundary,
      timeoutMs: s.timeoutMs,
      from: from
        ? { id: from.id, log: from.log, paths: from.paths, pathCount: from.pathCount }
        : null,
      seed: 0,
    });
  });
}

function handleResult(res) {
  if (res.status === 'sat' && res.snapshot) {
    const snap = res.snapshot;
    // worker 内是临时会话，快照需入主线程会话历史
    state.session.snapshots.push(snap);
    state.selId = snap.id;
    const proven = [
      snap.provenPaths ? '路径数已证最优' : '',
      snap.provenTurns ? '转弯数已证最优' : '',
    ].filter(Boolean).join(' · ');
    setStatus(
      `SAT 有解 · ${snap.pathCount}路径 / ${snap.turnSum}弯 · 迭代${snap.iters} · ` +
        `${fmtSecs(snap.elapsedMs / 1000)} · 校验${snap.check}${proven ? ' · ' + proven : ''}`,
      'sat'
    );
  } else if (res.status === 'unsat') {
    setStatus(`UNSAT 严格证明无解 · 该网格在此约束下无法用路径覆盖所有空格`, 'unsat');
  } else if (res.status === 'timeout') {
    setStatus(`超时 · 30s 内未完成（可点「取消」停止，或换布局）`);
  } else if (res.status === 'cancelled') {
    setStatus('已取消');
  } else if (res.status === 'empty') {
    setStatus('EMPTY · 网格没有空格，无需求解');
  } else if (res.status === 'error') {
    const hint = /SharedArrayBuffer|COOP|COEP/i.test(res.message)
      ? ' — 缺少 COOP/COEP 响应头，请用「pnpm serve」启动或按 DEPLOY.md 配置部署头。'
      : '';
    setStatus('求解失败: ' + res.message + hint);
  }
  saveSession();
  renderHist();
  if (state.selId) {
    const snap = selSnapshot();
    if (snap && snap.paths) {
      setPathText(pathsText(snap.paths));
      renderLegend(snap);
    }
  }
  updateButtons();
  render();
}

// ---------- 事件绑定 ----------
function onGridEdited(msg) {
  if (state.solving) return;
  newUiSession(msg);
  render();
}

canvas.addEventListener('click', (e) => {
  if (state.solving) return;
  const rect = canvas.getBoundingClientRect();
  const j = Math.floor((e.clientX - rect.left - MARGIN) / CELL);
  const i = Math.floor((e.clientY - rect.top - MARGIN) / CELL);
  if (i < 0 || j < 0 || i >= state.rows || j >= state.cols) return;
  state.grid[i][j] = state.grid[i][j] ? 0 : 1;
  onGridEdited('已编辑 · 点「求解（任意解）」');
});

$('rebuild').addEventListener('click', () => {
  const rows = Math.min(20, Math.max(1, parseInt($('rows').value, 10) || 9));
  const cols = Math.min(20, Math.max(1, parseInt($('cols').value, 10) || 11));
  $('rows').value = rows;
  $('cols').value = cols;
  resizeGrid(rows, cols);
  onGridEdited('就绪');
});

$('example').addEventListener('click', () => {
  loadSample();
  onGridEdited('已载入 9×11 示例布局（87 空格 / 12 障碍）');
});

$('random').addEventListener('click', () => {
  const g = makeGrid(state.rows, state.cols);
  for (let i = 0; i < state.rows; i++) {
    for (let j = 0; j < state.cols; j++) {
      g[i][j] = Math.random() < 0.15 ? 1 : 0;
    }
  }
  if (g.flat().every(v => v === 1)) g[0][0] = 0;
  state.grid = g;
  onGridEdited('已随机占用 15% · 点「求解（任意解）」');
});

$('clear').addEventListener('click', () => {
  state.grid = makeGrid(state.rows, state.cols);
  onGridEdited('已清空');
});

$('boundary').addEventListener('change', () => {
  if (state.solving) return;
  onGridEdited('端点限边界已更改 · 已开始新会话');
});

$('solve').addEventListener('click', () => {
  onGridEdited('已开始新求解会话');
  runAction({ needsFrom: false, action: 'first', desc: '求解中（求任意解）' });
});

$('optPaths').addEventListener('click', () => {
  runAction({ needsFrom: true, action: 'paths', desc: '优化路径数' });
});

$('optTurns').addEventListener('click', () => {
  runAction({ needsFrom: true, action: 'turns', desc: '优化转弯数' });
});

$('optAll').addEventListener('click', async () => {
  let snap = selSnapshot();
  if (!snap || state.solving) return;
  if (!snap.provenPaths) {
    await runAction({ needsFrom: true, action: 'paths', desc: '优化路径数' });
    snap = selSnapshot();
  }
  if (state.solving || !snap) return;
  if (!snap.provenTurns) {
    await runAction({ needsFrom: true, action: 'turns', desc: '优化转弯数' });
  }
});

$('cancel').addEventListener('click', () => {
  state.cancelled = true;
  setProg('正在停止…（等待当前轮结束）');
  $('cancel').disabled = true;
  ensureWorker().postMessage({ type: 'cancel' });
});

$('copy').addEventListener('click', async () => {
  const snap = selSnapshot();
  if (!snap || !snap.paths) return;
  const text = pathsText(snap.paths);
  const n = snap.paths.length;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制 ${n} 条路径`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus(`已复制 ${n} 条路径（降级方式）`);
  }
});

$('exportBtn').addEventListener('click', exportSession);

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) importSession(e.target.files[0]);
  e.target.value = '';
});

$('clearSess').addEventListener('click', () => {
  if (!state.session || state.session.snapshots.length === 0) {
    setStatus('没有可清除的会话');
    return;
  }
  try {
    localStorage.removeItem(STATE_KEY);
  } catch { /* ignore */ }
  newUiSession('已清除会话历史');
});

// ---------- 启动 ----------
// 主线程预载 wasm（带进度条），完成后交给求解 worker 使用；
// 主线程自身不加载 z3，UI 全程不被求解阻塞。
preloadWasm(frac => {
  const bar = $('wasmbar');
  if (!bar) return;
  bar.hidden = false;
  const fill = $('wasmbar-fill');
  const label = $('wasmbar-label');
  if (frac < 0) {
    fill.style.width = '35%';
    label.textContent = '加载 WASM 求解内核…';
  } else {
    fill.style.width = (frac * 100).toFixed(1) + '%';
    label.textContent = '加载 WASM 求解内核 ' + (frac * 100).toFixed(0) + '%';
  }
})
  .then(({ blobUrl, scriptUrl }) => {
    _wasmBlobUrl = blobUrl;
    _z3ScriptUrl = scriptUrl;
    $('wasmbar').hidden = true;
    ensureWorker();
  })
  .catch(() => {
    // 预载失败（离线等）：worker 初始化时自行加载（降级）
    $('wasmbar').hidden = true;
    ensureWorker();
  });

if (loadSaved()) {
  const n = state.session.snapshots.length;
  renderHist();
  if (state.selId) selectSnapshot(state.selId, `已恢复上次会话（${n} 个方案）· `);
} else {
  loadSample();
  newUiSession('就绪 · 点击格子切换障碍（红叉），点「求解（任意解）」');
}
render();
