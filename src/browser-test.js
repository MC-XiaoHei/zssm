// browser-test.js — 浏览器端跑规格书 6 用例 + 转弯优化（打包为 public/test/test.js）
import { solve, solveOptimize } from './solver-core.js';

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

const sampleGrid = () => SAMPLE.map(row => [...row].map(ch => (ch === 'X' ? 1 : 0)));

const CASES = [
  ['9×11 斜障碍', sampleGrid(), true, r => r.status === 'sat' && r.path.length === 87 && r.check === 'OK'],
  ['T 形（黑白差>1）', [[1, 0, 1], [0, 0, 0], [1, 1, 1]], true, r => r.status === 'unsat'],
  ['3×3 挖中心', [[0, 0, 0], [0, 1, 0], [0, 0, 0]], true, r => r.status === 'sat' && r.path.length === 8],
  ['1×1 单格', [[0]], true, r => r.status === 'sat' && r.path.length === 1],
  ['单格非边界（边界开）', [[1, 1, 1], [1, 0, 1], [1, 1, 1]], true, r => r.status === 'unsat'],
  ['单格非边界（边界关）', [[1, 1, 1], [1, 0, 1], [1, 1, 1]], false, r => r.status === 'sat' && r.path.length === 1],
  ['1×2 相邻', [[0, 0]], true, r => r.status === 'sat' && r.path.length === 2],
  ['2×2 全空', [[0, 0], [0, 0]], true, r => r.status === 'sat' && r.path.length === 4],
];

async function run() {
  const rows = [];
  let allOk = true;
  for (const [name, grid, boundary, ok] of CASES) {
    const t0 = performance.now();
    let res;
    try {
      res = await solve(grid, { boundary, timeoutMs: 60000 });
    } catch (e) {
      res = { status: 'error', message: String(e) };
    }
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    const pass = ok(res);
    if (!pass) allOk = false;
    rows.push(
      `<tr class="${pass ? 'ok' : 'fail'}"><td>${name}</td><td>${res.status}</td>` +
      `<td>${res.iters ?? '-'}</td><td>${dt}s</td><td>${res.check ?? (res.message ?? '-')}</td>` +
      `<td>${pass ? 'PASS' : 'FAIL'}</td></tr>`
    );
  }

  // 转弯优化：9×11 T* + 探索列表
  const to = performance.now();
  let opt;
  try {
    opt = await solveOptimize(sampleGrid(), { boundary: true, timeoutMs: 20000 });
  } catch (e) {
    opt = { status: 'error', message: String(e) };
  }
  const optDt = ((performance.now() - to) / 1000).toFixed(2);
  let optOk =
    opt.status === 'sat' && opt.proven === true && opt.T_star === 33 &&
    opt.list.length >= 2 &&
    opt.list.every(it => it.check === 'OK' && it.path.length === 87 && it.turns >= 33) &&
    opt.list.find(it => it.isBest).turns === 33;
  if (!optOk) allOk = false;
  rows.push(
    `<tr class="${optOk ? 'ok' : 'fail'}"><td>转弯优化 T*=33 + 列表</td><td>${opt.status}${opt.proven ? '(已证明)' : ''}</td>` +
    `<td>${opt.list ? opt.list.map(it => it.turns).join('→') : '-'}</td><td>${optDt}s</td>` +
    `<td>T*=${opt.T_star} · ${opt.list ? opt.list.length : 0} 候选</td>` +
    `<td>${optOk ? 'PASS' : 'FAIL'}</td></tr>`
  );

  // 转弯优化：T 形 UNSAT
  const t1 = performance.now();
  let opt2;
  try {
    opt2 = await solveOptimize([[1, 0, 1], [0, 0, 0], [1, 1, 1]], { boundary: true, timeoutMs: 20000 });
  } catch (e) {
    opt2 = { status: 'error', message: String(e) };
  }
  const opt2Ok = opt2.status === 'unsat' && opt2.proven === true;
  if (!opt2Ok) allOk = false;
  rows.push(
    `<tr class="${opt2Ok ? 'ok' : 'fail'}"><td>转弯优化 T 形 UNSAT</td><td>${opt2.status}</td>` +
    `<td>-</td><td>${((performance.now() - t1) / 1000).toFixed(2)}s</td><td>严格证明无解</td>` +
    `<td>${opt2Ok ? 'PASS' : 'FAIL'}</td></tr>`
  );

  document.getElementById('tbl').insertAdjacentHTML('beforeend', rows.join(''));
  document.getElementById('note').textContent =
    allOk ? '全部用例通过' : '存在失败用例，详见上表';
  document.title = 'zssm-browser-test ' + (allOk ? 'ALL PASS' : 'FAIL');
}

window.addEventListener('error', e => console.log('PAGE-ERROR', e.message, e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => console.log('UNHANDLED-REJECTION', String(e.reason && e.reason.stack || e.reason)));

run();
