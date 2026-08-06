// worker.js — 求解 Web Worker：z3 wasm 运行于此处，主线程不阻塞。
// 无状态设计：每次 solve 消息携带 grid/boundary/from 快照，重建会话；
// 主线程是方案历史的权威存储，worker 只回传结果快照。
import { newSession, solveFirst, optimizePaths, optimizeTurns, initSolver } from './solver-core.js';

let _ensurePromise = null;
let _cancelled = false;

function ensureZ3(cfg) {
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      try {
        if (typeof self.initZ3 !== 'function') {
          importScripts(cfg.z3ScriptUrl);
        }
        const dir = cfg.z3ScriptUrl.replace(/z3-built\.js$/, '');
        return initSolver({
          // emscripten 的 pthreadMainJs 优先取 mainScriptUrlOrBlob：
          // worker 内 _scriptName 无法从 importScripts 推导（=undefined），
          // 必须显式指定，否则 pthread worker 加载失败
          mainScriptUrlOrBlob: cfg.z3ScriptUrl,
          locateFile: p =>
            /\.wasm$/.test(p) && cfg.wasmBlobUrl ? cfg.wasmBlobUrl : dir + p,
        });
      } catch (err) {
        _ensurePromise = null;
        throw err;
      }
    })();
  }
  return _ensurePromise;
}

self.addEventListener('message', async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await ensureZ3(msg);
      self.postMessage({ type: 'init-ok' });
      return;
    }
    if (msg.type === 'cancel') {
      _cancelled = true;
      return;
    }
    if (msg.type === 'solve') {
      _cancelled = false;
      await ensureZ3(msg);
      const session = newSession(msg.grid, { boundary: msg.boundary, timeoutMs: msg.timeoutMs });
      const from = msg.from;
      if (from) {
        session.snapshots.push({
          id: from.id,
          log: from.log ?? [],
          paths: from.paths,
          pathCount: from.pathCount,
        });
      }
      const onProg = (p) =>
        self.postMessage({ type: 'progress', action: msg.action, payload: p });
      const opts = { isCancelled: () => _cancelled, seed: msg.seed ?? 0 };
      let res;
      if (msg.action === 'first') {
        res = await solveFirst(session, opts, onProg);
      } else if (msg.action === 'paths') {
        res = await optimizePaths(session, from.id, opts, onProg);
      } else if (msg.action === 'turns') {
        res = await optimizeTurns(session, from.id, opts, onProg);
      } else {
        res = { status: 'error', message: '未知操作 ' + msg.action };
      }
      // inst 内含函数（onB/locateFile 等），不能跨线程克隆，剥离后再回传
      if (res && res.inst) delete res.inst;
      self.postMessage({ type: 'done', id: msg.id, action: msg.action, res });
    }
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    if (msg && msg.type === 'solve') {
      self.postMessage({
        type: 'done',
        id: msg.id,
        action: msg.action,
        res: { status: 'error', message: detail },
      });
    } else {
      self.postMessage({ type: 'error', message: detail });
    }
  }
});
