// test/run.js — 规格书第 5 节的 6 个验证用例 + 转弯优化（T* 与探索列表）
import { solve, solveOptimize, verify, countTurns } from '../src/solver-core.js';

let pass = 0;
let fail = 0;

function expect(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function caseSAT(name, grid, opts, wantStatus) {
  const r = await solve(grid, opts);
  let ok = r.status === wantStatus;
  if (r.status === 'sat') {
    const chk = verify(r.path, grid, opts.boundary !== false);
    ok = chk === 'OK';
    const V = grid.flat().filter(v => v === 0).length;
    console.log(
      `  ${ok ? '✓' : '✗'} ${name} · ${r.status} · path=${r.path.length}/${V}格 · 迭代${r.iters} · ${r.seconds.toFixed(2)}s · check=${r.check}`
    );
  } else {
    console.log(
      `  ${ok ? '✓' : '✗'} ${name} · ${r.status} · 迭代${r.iters} · ${r.seconds.toFixed(2)}s` +
        (r.message ? ` · ${r.message}` : '')
    );
  }
  if (!ok) fail++;
  else pass++;
  return r;
}

async function main() {
  console.log('== 用例 1：9×11 斜障碍 ==');
  const g1 = [
    'OOOOOOOOOOO',
    'OOOOOOOOOOO',
    'OOOXOOOOOOO',
    'OOOXXXXOOOO',
    'OOOOXXXOOOO',
    'OOOOOXXXOOO',
    'OOOOOOOXOOO',
    'OOOOOOOOOOO',
    'OOOOOOOOOOO',
  ].map(s => [...s].map(c => (c === 'O' ? 0 : 1)));
  const r1 = await caseSAT('9×11 SAT · 87格 · 端点边界', g1, { boundary: true, timeoutMs: 60000 }, 'sat');

  console.log('== 用例 2：T 形（黑1白3）==');
  const g2 = [
    [1, 0, 1],
    [0, 0, 0],
    [1, 1, 1],
  ];
  await caseSAT('T 形 UNSAT', g2, { boundary: true, timeoutMs: 60000 }, 'unsat');

  console.log('== 用例 3：3×3 挖中心 ==');
  const g3 = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ];
  await caseSAT('3×3 挖中心 SAT', g3, { boundary: true, timeoutMs: 60000 }, 'sat');

  console.log('== 用例 4：1×1 单格 ==');
  await caseSAT('1×1 边界内 SAT', [[0]], { boundary: true }, 'sat');
  const g4b = [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ];
  await caseSAT('单格非边界（边界开）UNSAT', g4b, { boundary: true }, 'unsat');
  await caseSAT('单格非边界（边界关）SAT', g4b, { boundary: false }, 'sat');

  console.log('== 用例 5：1×2 ==');
  await caseSAT('1×2 相邻 SAT', [[0, 0]], { boundary: true }, 'sat');

  console.log('== 用例 6：2×2 全空 ==');
  await caseSAT('2×2 全空 SAT', [[0, 0], [0, 0]], { boundary: true }, 'sat');

  console.log('== 用例 7：转弯优化 · 9×11 T* 与探索列表 ==');
  const rc = await solveOptimize(g1, { boundary: true, timeoutMs: 20000 });
  const listTxt = rc.list
    .map(it => `${it.turns}转${it.isBest ? '*' : ''}`)
    .join(' → ');
  console.log(
    `  ${rc.status} · T*=${rc.T_star}${rc.proven ? '(已证明)' : ''} · ${rc.list.length} 个候选 { ${listTxt} } · ${rc.seconds.toFixed(2)}s`
  );
  expect('最优：状态 sat 且 T* 已证明', rc.status === 'sat' && rc.proven === true);
  if (rc.status === 'sat') {
    expect('9×11 T* == 33', rc.T_star === 33, `实际 ${rc.T_star}`);
    expect('候选数 >= 2', rc.list.length >= 2, `实际 ${rc.list.length}`);
    const allOk = rc.list.every(it => it.check === 'OK' && it.path.length === 87 && it.turns >= 33);
    expect('全部候选 87 格且校验 OK 且转弯数 >= T*', allOk);
    const sorted = rc.list.every((it, k) => k === 0 || rc.list[k - 1].turns <= it.turns);
    expect('列表按转弯数升序', sorted);
    const bestFirst = rc.list.find(it => it.isBest);
    expect('最优条目 isBest 且转弯数 == T*', bestFirst !== undefined && bestFirst.turns === 33 && bestFirst.check === 'OK');
  }

  console.log('== 用例 8：转弯优化 · 小网格 ==');
  const rc2 = await solveOptimize(g2, { boundary: true, timeoutMs: 20000 });
  expect('T 形 转弯优化 UNSAT', rc2.status === 'unsat' && rc2.T_star === null && rc2.proven === true);
  const rc3 = await solveOptimize([[0]], { boundary: true });
  expect('1×1 转弯优化 SAT T*=0', rc3.status === 'sat' && rc3.T_star === 0 && rc3.list[0].turns === 0);
  const rc4 = await solveOptimize([[0, 0]], { boundary: true });
  expect('1×2 转弯优化 SAT T*=0', rc4.status === 'sat' && rc4.T_star === 0);
  const rc5 = await solveOptimize([[0, 0], [0, 0]], { boundary: true, timeoutMs: 20000 });
  expect('2×2 转弯优化 SAT T*=2', rc5.status === 'sat' && rc5.T_star === 2, `实际 T*=${rc5.T_star}`);

  console.log('');
  console.log(`结果：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
