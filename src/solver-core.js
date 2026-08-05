// solver-core.js — 网格哈密顿路径 SAT 求解内核
// 纯函数、不依赖 DOM；Node（测试）与浏览器（UI）共用。
// 判定：约束 A（度∈{1,2}）+ B（恰 2 端点）+ C（端点限边界，可选）
//       + D（lazy 连通性迭代，OR(cross)）。
// 优化：turn(v) = (水平边数==1 ∧ 垂直边数==1)，turn_sum = Σ turn(v)；
//       Optimize.minimize(turn_sum) 求 T*（已证明最优）；
//       探索列表：不同种子普通求解 + 封锁最优解边集再求，
//       去重后按转弯数升序输出（前端以列表展示，最优高亮）。
// 工程：求解前 api.global_param_set('sat.random_seed', seed)，
//       每 check 设 timeout。
import z3pkg from 'z3-solver';

const { init } = z3pkg;

const MAX_ITERS = 200;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_TURN_TIMEOUT_MS = 20000;
const DEFAULT_SAMPLE_SEEDS = [0, 42, 12345];

let _initPromise = null;
let _ctx = null;

export function initSolver(moduleOverrides = {}) {
  if (!_initPromise) {
    const isBrowser = typeof window !== 'undefined' && typeof location !== 'undefined';
    // 浏览器：外置 wasm（部署根 z3/），locateFile 需被 pthread worker 继承。
    // 用页面相对路径 base（支持 gh-pages 子路径部署，如 /zssm/）。
    const overrides = isBrowser
      ? {
          locateFile: p => {
            // 从 z3-built.js 的 <script src> 推导 wasm 目录（页面深度无关，
            // 支持 /zssm/ 子路径与 test/ 等嵌套页面）。
            for (const s of document.querySelectorAll('script[src]')) {
              if (/z3-built\.js$/.test(s.src)) {
                const u = new URL(s.src);
                return u.origin + u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1) + p;
              }
            }
            const u = new URL(location.href);
            const base = u.origin + u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
            return base + 'z3/' + p;
          },
          ...moduleOverrides,
        }
      : moduleOverrides;
    _initPromise = init(overrides);
  }
  return _initPromise;
}

function getCtx(api) {
  if (!_ctx) {
    _ctx = new api.Context('solve');
  }
  return _ctx;
}

export function resetSolver() {
  _initPromise = null;
}

// ---------- 共享构造：建图 + 约束 A/B/C + turn_sum ----------

function buildInstance(api, grid, boundary) {
  const n = grid.length;
  const m = grid[0].length;
  for (const row of grid) {
    if (row.length !== m) return { error: '网格不是矩形' };
  }

  const empty = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (grid[i][j] === 0) empty.push([i, j]);
    }
  }
  const V = empty.length;
  const inst = { error: null, grid, n, m, empty, V, boundary };
  if (V === 0) return inst;

  const key = (i, j) => i * m + j;
  const idx = new Map(empty.map(([i, j], k) => [key(i, j), k]));
  const onB = ([i, j]) => i === 0 || i === n - 1 || j === 0 || j === m - 1;
  inst.idx = idx;
  inst.onB = onB;

  // 边集与关联表（只建右、下邻居，去重）
  const edges = [];
  for (const [i, j] of empty) {
    const u = idx.get(key(i, j));
    if (j + 1 < m && grid[i][j + 1] === 0) edges.push({ u, v: idx.get(key(i, j + 1)) });
    if (i + 1 < n && grid[i + 1][j] === 0) edges.push({ u, v: idx.get(key(i + 1, j)) });
  }
  const inc = empty.map(() => []);
  edges.forEach((e, k) => {
    inc[e.u].push(k);
    inc[e.v].push(k);
  });
  inst.edges = edges;
  inst.inc = inc;
  // 边索引：顶点对 → 边序号（路径封锁用）
  const ekey = (u, v) => (u < v ? u + ',' + v : v + ',' + u);
  inst.edgeIndex = new Map(edges.map((e, k) => [ekey(e.u, e.v), k]));

  const ctx = getCtx(api);
  const { Bool, Int, If, Or, Not, Eq, Sum, And } = ctx;
  inst.ctx = ctx;
  const ONE = Int.val(1);
  const ZERO = Int.val(0);
  const TWO = Int.val(2);
  const x = edges.map((_, k) => Bool.const(`e${k}`));
  inst.x = x;

  const deg = empty.map((_, k) =>
    inc[k].length > 0 ? Sum(...inc[k].map(j => If(x[j], ONE, ZERO))) : ZERO
  );
  const d1 = deg.map(d => d.eq(ONE));

  // 约束 A/B/C（AST 数组，Solver 与 Optimize 共用）
  const base = [];
  for (let k = 0; k < V; k++) {
    base.push(Or(deg[k].eq(ONE), deg[k].eq(TWO))); // A
  }
  base.push(Eq(Sum(...d1.map(d => If(d, ONE, ZERO))), TWO)); // B
  if (boundary) {
    for (let k = 0; k < V; k++) {
      if (!onB(empty[k])) base.push(Not(d1[k])); // C
    }
  }
  inst.base = base;

  // turn_sum：turn(v) = (水平选中边数==1 ∧ 垂直选中边数==1)
  const horizontal = edges.map((e, k) => empty[e.u][0] === empty[e.v][0]);
  const turn = empty.map((_, k) => {
    const he = inc[k].filter(j => horizontal[j]);
    const we = inc[k].filter(j => !horizontal[j]);
    const hs = he.length > 0 ? Sum(...he.map(j => If(x[j], ONE, ZERO))) : ZERO;
    const ws = we.length > 0 ? Sum(...we.map(j => If(x[j], ONE, ZERO))) : ZERO;
    return And(hs.eq(ONE), ws.eq(ONE));
  });
  inst.turnSum = Sum(...turn.map(t => If(t, ONE, ZERO)));
  return inst;
}

// ---------- 约束 D：lazy 连通性迭代（Solver / Optimize 通用） ----------

async function connectedSolve(solver, inst, secs) {
  const { Or } = inst.ctx;
  const { V, inc, edges, x, empty, grid, boundary } = inst;
  for (let iters = 1; iters <= MAX_ITERS; iters++) {
    const res = await solver.check();
    if (res === 'unsat') return { status: 'unsat', iters, seconds: secs() };
    if (res === 'unknown') return { status: 'unknown', iters, seconds: secs() };

    const model = solver.model();
    const used = new Set();
    for (let k = 0; k < edges.length; k++) {
      if (model.eval(x[k]).toString() === 'true') used.add(k);
    }

    const comps = components(V, inc, edges, used);
    if (comps.length === 1) {
      const path = rebuildPath(empty, inc, edges, used);
      if (!path || path.length !== V) {
        return { status: 'error', message: '路径重建失败', iters, seconds: secs() };
      }
      return { status: 'sat', path, iters, seconds: secs(), check: verify(path, grid, boundary) };
    }

    for (const comp of comps) {
      const cross = [];
      for (let k = 0; k < edges.length; k++) {
        if (comp.has(edges[k].u) !== comp.has(edges[k].v)) cross.push(x[k]);
      }
      if (cross.length > 0) solver.add(Or(...cross));
    }
  }
  return { status: 'unknown', iters: MAX_ITERS, seconds: secs() };
}

// ---------- 判定入口（原 solve，语义不变） ----------

export async function solve(grid, opts = {}) {
  const boundary = opts.boundary !== false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const t0 = Date.now();
  const secs = () => (Date.now() - t0) / 1000;
  try {
    const api = await initSolver(opts.moduleOverrides);
    const inst = buildInstance(api, grid, boundary);
    if (inst.error) return { status: 'error', message: inst.error, seconds: secs() };
    if (inst.V === 0) return { status: 'empty', seconds: secs() };

    // 特判 V == 1（单格路径：起点=终点=该格）
    if (inst.V === 1) {
      const c = inst.empty[0];
      const ok = !boundary || inst.onB(c);
      return {
        status: ok ? 'sat' : 'unsat',
        path: ok ? [c] : undefined,
        iters: 1,
        seconds: secs(),
        check: ok ? 'OK' : '端点不在边界',
      };
    }

    const { Solver } = inst.ctx;
    const solver = new Solver();
    solver.add(...inst.base);
    solver.set('timeout', timeoutMs);
    return await connectedSolve(solver, inst, secs);
  } catch (err) {
    return {
      status: 'error',
      message: err && err.message ? err.message : String(err),
      seconds: secs(),
    };
  }
}

// ---------- 转弯优化入口 ----------

// 沿路径数转弯（方向改变的内部顶点数）
export function countTurns(path) {
  let t = 0;
  for (let k = 1; k + 1 < path.length; k++) {
    const [a, b] = path[k - 1];
    const [c, d] = path[k];
    const [e, f] = path[k + 1];
    if (c - a !== e - c || d - b !== f - d) t++;
  }
  return t;
}

// 路径指纹：无向边集合（路径反向视为同一条，用于去重）
function pathSig(path) {
  const pairs = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    pairs.push(JSON.stringify(a < b ? [a, b] : [b, a]));
  }
  pairs.sort();
  return pairs.join('|');
}

// 共享实例上的普通求解（可带附加约束），返回含 turns 的 connectedSolve 结果
async function plainSolveOn(inst, extra, timeoutMs, seed, secs) {
  const { Solver } = inst.ctx;
  inst.api.Z3.global_param_set('sat.random_seed', String(seed));
  const s = new Solver();
  s.add(...inst.base, ...(extra || []));
  s.set('timeout', timeoutMs);
  const res = await connectedSolve(s, inst, secs);
  if (res.status === 'sat') res.turns = countTurns(res.path);
  return res;
}

// 返回 { status, V, boundary, seconds, T_star, proven, list }
// list: [{turns, path, iters, seconds, check, kind:'best'|'sample'|'variety', seed, isBest}]
// kind: 'best'=已证明最优；'sample'=探索采样；'variety'=最优封锁后的对比解
export async function solveOptimize(grid, opts = {}) {
  const boundary = opts.boundary !== false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const sampleSeeds = opts.seeds ?? DEFAULT_SAMPLE_SEEDS;
  const onProgress = opts.onProgress ?? (() => {});
  const t0 = Date.now();
  const secs = () => (Date.now() - t0) / 1000;
  try {
    const api = await initSolver(opts.moduleOverrides);
    const inst = buildInstance(api, grid, boundary);
    inst.api = api;
    if (inst.error) return { status: 'error', message: inst.error, seconds: secs() };
    if (inst.V === 0) return { status: 'empty', V: 0, boundary, seconds: secs() };

    if (inst.V === 1) {
      const c = inst.empty[0];
      const ok = !boundary || inst.onB(c);
      const item = {
        turns: 0,
        path: ok ? [c] : undefined,
        iters: 1,
        seconds: secs(),
        check: ok ? 'OK' : '端点不在边界',
        kind: 'best',
        seed: null,
        isBest: ok,
      };
      return {
        status: ok ? 'sat' : 'unsat',
        V: 1,
        boundary,
        seconds: secs(),
        T_star: ok ? 0 : null,
        proven: ok,
        list: ok ? [item] : [],
      };
    }

    // 1) 最优解：Optimize + minimize(turnSum)，证明最优
    const { Optimize, And, Not } = inst.ctx;
    onProgress({ phase: 'optimize', found: 0 });
    let best = null;
    const opt = new Optimize();
    opt.add(...inst.base);
    opt.minimize(inst.turnSum);
    opt.set('timeout', timeoutMs);
    const optRes = await connectedSolve(opt, inst, secs);
    if (optRes.status === 'unsat') {
      return { status: 'unsat', V: inst.V, boundary, seconds: secs(), T_star: null, proven: true, list: [] };
    }
    if (optRes.status === 'sat') {
      best = { ...optRes, turns: countTurns(optRes.path), kind: 'best', seed: 0, isBest: true };
    }

    // 2) 探索采样：不同种子普通求解（多样性）
    const seen = new Set();
    const items = best ? [best] : [];
    if (best) seen.add(pathSig(best.path));
    for (const seed of sampleSeeds) {
      onProgress({ phase: 'samples', found: items.length, seed });
      const r = await plainSolveOn(inst, null, timeoutMs, seed, secs);
      if (r.status === 'sat') {
        const sig = pathSig(r.path);
        if (!seen.has(sig)) {
          seen.add(sig);
          items.push({ ...r, kind: 'sample', seed, isBest: false });
        }
      }
    }

    // 3) 多样性补充：封锁最优解的全部边，再求一条对比路径
    if (best) {
      onProgress({ phase: 'variety', found: items.length });
      const bestKeys = [];
      for (let k = 0; k + 1 < best.path.length; k++) {
        const ui = inst.idx.get(best.path[k][0] * inst.m + best.path[k][1]);
        const vi = inst.idx.get(best.path[k + 1][0] * inst.m + best.path[k + 1][1]);
        const ei = inst.edgeIndex.get(ui < vi ? ui + ',' + vi : vi + ',' + ui);
        if (ei !== undefined) bestKeys.push(ei);
      }
      if (bestKeys.length > 0) {
        const blocked = Not(And(...bestKeys.map(k => inst.x[k])));
        const r = await plainSolveOn(inst, [blocked], timeoutMs, sampleSeeds[0], secs);
        if (r.status === 'sat') {
          const sig = pathSig(r.path);
          if (!seen.has(sig)) {
            seen.add(sig);
            items.push({ ...r, kind: 'variety', isBest: false });
          }
        }
      }
    }

    items.sort((a, b) => a.turns - b.turns);
    const list = items.map(it => ({
      turns: it.turns,
      path: it.path,
      iters: it.iters,
      seconds: it.seconds,
      check: it.check,
      kind: it.kind,
      seed: it.seed,
      isBest: it.isBest,
    }));

    if (best) {
      return { status: 'sat', V: inst.V, boundary, seconds: secs(), T_star: best.turns, proven: true, list };
    }
    return {
      status: 'unknown', // Optimize 超时，仅输出采样列表
      V: inst.V,
      boundary,
      seconds: secs(),
      T_star: list.length > 0 ? list[0].turns : null,
      proven: false,
      list,
    };
  } catch (err) {
    return {
      status: 'error',
      message: err && err.message ? err.message : String(err),
      seconds: secs(),
    };
  }
}

// ---------- 图工具 ----------

function components(V, inc, edges, used) {
  const seen = new Array(V).fill(false);
  const comps = [];
  for (let s = 0; s < V; s++) {
    if (seen[s]) continue;
    const comp = new Set();
    const q = [s];
    seen[s] = true;
    while (q.length) {
      const c = q.pop();
      comp.add(c);
      for (const k of inc[c]) {
        if (!used.has(k)) continue;
        const o = edges[k].u === c ? edges[k].v : edges[k].u;
        if (!seen[o]) {
          seen[o] = true;
          q.push(o);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function rebuildPath(cells, inc, edges, used) {
  const V = cells.length;
  let start = -1;
  for (let c = 0; c < V; c++) {
    let d = 0;
    for (const k of inc[c]) if (used.has(k)) d++;
    if (d === 1) {
      start = c;
      break;
    }
  }
  if (start < 0) return null;
  const path = [cells[start]];
  let cur = start;
  let prev = -1;
  for (;;) {
    let next = -1;
    for (const k of inc[cur]) {
      if (!used.has(k)) continue;
      const o = edges[k].u === cur ? edges[k].v : edges[k].u;
      if (o !== prev) {
        next = o;
        break;
      }
    }
    if (next < 0) break;
    path.push(cells[next]);
    prev = cur;
    cur = next;
  }
  return path;
}

// 照参考实现：返回 "OK" 或错误描述字符串
export function verify(path, grid, boundary) {
  const n = grid.length;
  const m = grid[0].length;
  const V = grid.flat().filter(v => v === 0).length;
  if (path.length !== V) return '长度错误';
  const seen = new Set();
  for (const [i, j] of path) {
    const k = i * m + j;
    if (seen.has(k)) return '存在重复格子';
    seen.add(k);
  }
  for (let k = 1; k < path.length; k++) {
    const [a, b] = path[k - 1];
    const [c, d] = path[k];
    if (Math.abs(a - c) + Math.abs(b - d) !== 1) return `第 ${k} 步不相邻`;
  }
  if (boundary) {
    for (const [i, j] of [path[0], path[path.length - 1]]) {
      if (i !== 0 && i !== n - 1 && j !== 0 && j !== m - 1) return '端点不在边界';
    }
  }
  return 'OK';
}
