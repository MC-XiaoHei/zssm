// ui.js — 网格编辑 + 求解 + Canvas 绘制（DOM 层，依赖 solver-core）
import { solveOptimize, initSolver } from './solver-core.js';

const $ = (id) => document.getElementById(id);

const state = {
  rows: 9,
  cols: 11,
  grid: [],
  path: null,
  res: null,
  list: [],
  sel: 0,
  solving: false,
};

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
  state.path = null;
  state.res = null;
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
  state.path = null;
  state.res = null;
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

function render() {
  const { rows, cols, grid, path } = state;
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

  if (path && path.length) drawPath(path);
}

function drawPath(path) {
  // 金色路径线
  ctx.strokeStyle = '#f0b429';
  ctx.lineWidth = Math.max(3, CELL * 0.26);
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

  // 弯道白点
  ctx.fillStyle = '#e8eef4';
  for (let k = 1; k < path.length - 1; k++) {
    const [i0, j0] = path[k - 1];
    const [i1, j1] = path[k];
    const [i2, j2] = path[k + 1];
    const turn = (i1 - i0) * (j2 - j1) - (j1 - j0) * (i2 - i1);
    if (turn !== 0) {
      ctx.beginPath();
      ctx.arc(cx(j1), cy(i1), Math.max(2, CELL * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 起点绿 / 终点红
  const s = path[0];
  const e = path[path.length - 1];
  for (const [i, j, color, label] of [
    [s[0], s[1], '#2fb344', '起'],
    [e[0], e[1], '#e5484d', '终'],
  ]) {
    ctx.beginPath();
    ctx.arc(cx(j), cy(i), Math.max(3, CELL * 0.2), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#101418';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (CELL >= 18) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, Math.floor(CELL * 0.32))}px sans-serif`;
      ctx.fillText(label, cx(j), cy(i));
    }
  }
}

// ---------- 交互 ----------
function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

function setPathText(text) {
  $('pathout').textContent = text;
}

const KIND_LABEL = { best: '★ 最优', sample: '探索样本', variety: '对比' };

function clearList() {
  state.list = [];
  state.sel = 0;
  $('clist').innerHTML = '';
}

function renderList() {
  const box = $('clist');
  if (state.list.length === 0) {
    box.innerHTML = '<div class="clist-empty">（无候选解）</div>';
    return;
  }
  box.innerHTML = '';
  state.list.forEach((it, i) => {
    const btn = document.createElement('button');
    btn.className = 'clist-item' + (i === state.sel ? ' selected' : '');
    btn.innerHTML =
      `<span class="tag ${it.kind}">${KIND_LABEL[it.kind] || it.kind}</span>` +
      `<span class="turns">${it.turns} 转</span>` +
      `<span class="meta">${fmtSecs(it.seconds)} · 校验${it.check}</span>`;
    btn.addEventListener('click', () => selectItem(i));
    box.appendChild(btn);
  });
}

function selectItem(i) {
  const it = state.list[i];
  if (!it || !it.path) return;
  state.sel = i;
  state.path = it.path;
  state.res = { ...state.res, path: it.path };
  setPathText(`(${it.path.map(([i, j]) => `${i},${j}`).join(')→(')})`);
  const V = state.grid.flat().filter(v => v === 0).length;
  const turnDesc =
    it.isBest && state.res && state.res.proven
      ? `${it.turns} 转（已证明最优）`
      : `${it.turns} 转`;
  setStatus(
    `候选 ${i + 1}/${state.list.length} · ${turnDesc} · ${V}格 · 迭代${it.iters} · ${fmtSecs(it.seconds)} · 校验${it.check}`,
    'sat'
  );
  renderList();
  render();
}

function fmtSecs(s) {
  return s !== undefined ? s.toFixed(2) + 's' : '-';
}

canvas.addEventListener('click', (e) => {
  if (state.solving) return;
  const rect = canvas.getBoundingClientRect();
  const j = Math.floor((e.clientX - rect.left - MARGIN) / CELL);
  const i = Math.floor((e.clientY - rect.top - MARGIN) / CELL);
  if (i < 0 || j < 0 || i >= state.rows || j >= state.cols) return;
  state.grid[i][j] = state.grid[i][j] ? 0 : 1;
  state.path = null;
  state.res = null;
  clearList();
  setPathText('');
  render();
  setStatus('已编辑 · 点「求解」');
});

$('rebuild').addEventListener('click', () => {
  const rows = Math.min(20, Math.max(1, parseInt($('rows').value, 10) || 9));
  const cols = Math.min(20, Math.max(1, parseInt($('cols').value, 10) || 11));
  $('rows').value = rows;
  $('cols').value = cols;
  resizeGrid(rows, cols);
  clearList();
  setPathText('');
  render();
  setStatus('就绪');
});

$('example').addEventListener('click', () => {
  loadSample();
  clearList();
  setPathText('');
  render();
  setStatus('已载入 9×11 示例布局（87 空格 / 12 障碍）');
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
  state.path = null;
  state.res = null;
  clearList();
  setPathText('');
  render();
  setStatus('已随机占用 15% · 点「求解」');
});

$('clear').addEventListener('click', () => {
  state.grid = makeGrid(state.rows, state.cols);
  state.path = null;
  state.res = null;
  clearList();
  setPathText('');
  render();
  setStatus('已清空');
});

$('solve').addEventListener('click', async () => {
  if (state.solving) return;
  state.solving = true;
  $('solve').disabled = true;
  _t0 = Date.now();
  state.path = null;
  state.res = null;
  clearList();
  setPathText('');
  render();
  setStatus('求解中…（首次加载 z3-wasm 需数秒）');
  try {
    const res = await solveOptimize(state.grid, {
      boundary: $('boundary').checked,
      timeoutMs: 30000,
      onProgress: ({ phase, found }) => {
        const msg = {
          optimize: '优化中…（求最小转弯数 T*）',
          samples: `探索采样中… 已找到 ${found} 个候选`,
          variety: '求对比解中…（封锁最优边集）',
        }[phase] || '求解中…';
        setStatus(`${msg} · ${fmtSecs(elapsed())}`);
      },
    });
    handleResult(res);
  } catch (err) {
    setStatus('意外错误: ' + (err && err.message ? err.message : String(err)));
  } finally {
    state.solving = false;
    $('solve').disabled = false;
  }
});

let _t0 = 0;
function elapsed() {
  return (Date.now() - _t0) / 1000;
}

function handleResult(res) {
  state.res = res;
  if (res.status === 'sat') {
    state.list = res.list || [];
    if (state.list.length === 0) {
      // 兜底：列表为空但 sat（不应发生）
      setStatus(`SAT 有解 · ${res.T_star} 转 · 校验${res.check}`, 'sat');
      renderList();
      return;
    }
    const best = state.list.find(it => it.isBest) || state.list[0];
    state.sel = state.list.indexOf(best);
    state.path = best.path;
    const V = state.grid.flat().filter(v => v === 0).length;
    setStatus(
      `SAT 有解 · 最优 ${res.T_star} 转（已证明）· ${V}格 · ${state.list.length} 个候选 · ${fmtSecs(res.seconds)}`,
      'sat'
    );
    setPathText(`(${best.path.map(([i, j]) => `${i},${j}`).join(')→(')})`);
    renderList();
  } else if (res.status === 'unsat') {
    state.list = [];
    setStatus(
      `UNSAT 严格证明无解 · ${fmtSecs(res.seconds)}`,
      'unsat'
    );
    renderList();
  } else if (res.status === 'unknown') {
    state.list = res.list || [];
    state.sel = 0;
    if (state.list.length > 0) {
      state.path = state.list[0].path;
      setStatus(
        `超时 · 最优未证明 · 已得 ${state.list.length} 个候选 · 最好 ${res.T_star} 转 · ${fmtSecs(res.seconds)}`
      );
      setPathText(`(${state.list[0].path.map(([i, j]) => `${i},${j}`).join(')→(')})`);
      renderList();
    } else {
      setStatus(`超时/未知 · ${fmtSecs(res.seconds)}（${30000}ms 内无法判定）`);
      renderList();
    }
  } else if (res.status === 'empty') {
    setStatus('EMPTY · 网格没有空格，无需求解');
  } else {
    const hint = /SharedArrayBuffer|COOP|COEP/i.test(res.message)
      ? ' — 缺少 COOP/COEP 响应头，请用「pnpm serve」启动或按 DEPLOY.md 配置部署头。'
      : '';
    setStatus('求解失败: ' + res.message + hint);
  }
  render();
}

$('copy').addEventListener('click', async () => {
  const p = state.path;
  if (!p || p.length === 0) return;
  const text = p.map(([i, j]) => `(${i},${j})`).join('→');
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制 ${p.length} 步路径`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus(`已复制 ${p.length} 步路径（降级方式）`);
  }
});

// ---------- 启动 ----------
// 预加载 wasm（带进度条）：首次访问需下载 ~35MB；之后由 coi-serviceworker 缓存，秒开。
initSolver({}, frac => {
  const bar = $('wasmbar');
  if (!bar) return;
  bar.hidden = false;
  const fill = $('wasmbar-fill');
  const label = $('wasmbar-label');
  if (frac < 0) {
    // chunked 响应（无 content-length）：显示不确定进度
    fill.style.width = '35%';
    label.textContent = '加载 WASM 求解内核…';
  } else {
    fill.style.width = (frac * 100).toFixed(1) + '%';
    label.textContent = '加载 WASM 求解内核 ' + (frac * 100).toFixed(0) + '%';
  }
})
  .then(() => {
    $('wasmbar').hidden = true;
  })
  .catch(() => {
    $('wasmbar').hidden = true;
  });
loadSample();
render();
