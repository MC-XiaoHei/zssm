# zssm — 网格哈密顿路径 · 纯前端 SAT 求解器

> ⚠️ **本仓库全部代码由 AI 生成（all AI-generated），仅供参考学习，不保证正确性与可用性。** 使用前请自行审查与验证。

在浏览器内完成 **SAT 编码 → 求解 → 路径绘制** 的纯前端工具：给定 n×m 网格（含障碍），求覆盖每个空格恰好一次的多条路径，并可**交互式分步优化**。

- **内核**：z3 官方 WASM（`z3-solver@5`），多线程（pthread + SharedArrayBuffer）
- **零后端**：静态托管即可部署
- **三态结果**：SAT（有解+路径）/ UNSAT（严格证明无解）/ 超时

## 在线演示

- 主页面：https://mc-xiaohei.github.io/zssm/

## 功能

- 行/列 1~20 网格编辑：点击切换障碍、示例布局、随机占用、清空
- **交互式优化**：先求「任意解」（可能多条路径）→ 点「优化路径数」收敛到最少（UNSAT 严格证明）→ 点「优化转弯数」在锁定路径数下求最少转弯（已证明最优）
- **方案历史**：每个阶段产物（含探索途中的中间解）自动存入历史，点击任意方案可查看 / 从该点继续优化；自动保存到 localStorage，刷新不丢，支持导出/导入 JSON
- **实时进度**：求解放入 Web Worker，主线程不冻结；每轮迭代实时显示「第 N 轮 · 当前最优 N路径/M弯」
- 多路径绘制：每条路径独立配色、图例点击高亮；路径序列一键复制
- 端点限边界可选；首次加载 wasm（约 35MB）有进度条，之后由 Service Worker 缓存秒开

## 本地运行

```bash
pnpm install
pnpm build       # 构建 public/（esbuild bundle + z3 wasm 拷贝 + coi-serviceworker）
pnpm serve       # http://localhost:8080（自带 COOP/COEP 响应头）
```

## 部署（GitHub Pages）

Actions 已配置：push 到 `main` 自动构建并部署（`public/` → Pages）。首次需在仓库 Settings → Pages 选择 **GitHub Actions** 为来源。

### 隔离要求（重要）

z3 多线程需要跨源隔离（SharedArrayBuffer），两种方式：

1. **COOP/COEP 响应头**（推荐，页面 `_headers` 已随构建产出）：
   ```
   COOP: same-origin
   COEP: require-corp
   ```
2. **coi-serviceworker 兜底**：`coi-serviceworker.js` 已内置并在无隔离时自动注册，通过 Service Worker 为请求补头。

> `file://` 直接双击打开**不可用**；静态托管即可（如 GitHub Pages、nginx、netlify）。nginx 配置示例见 `DEPLOY.md`。

## 目录结构

```
index.html             # UI 源文件
src/
  solver-core.js       # SAT 编码 + 连通性迭代 + 路径重建 + 优化（纯函数，Node/浏览器共用）
  worker.js            # 求解 Worker（z3 在此运行，主线程不阻塞）
  ui.js                # Canvas 网格编辑、绘制、方案历史、实时进度
scripts/
  build.mjs            # esbuild bundle（app.js + worker.js）+ z3 文件拷贝 + _headers
  serve.mjs            # 本地静态服务器（COOP/COEP）
public/                # 构建产物（部署内容，不入库）
```

## 算法说明

- 变量：每条相邻空格对一条边变量 `x_e`；模式分「单路径」（约束 B：恰 2 端点）与「多路径」（`minimize(Σ端点)` 求最少路径数）
- 约束 A：每格度 ∈ {1,2}（路径并/环的并）
- 约束 C：端点限边界（可选）
- 约束 D：连通性 lazy 迭代——对每个孤立分量加 `OR(跨边)`（必须 OR，不能 Implies）；纯环分量无跨边时加"不全选分量内边"拆环
- 转弯数：`turn(v) = (水平边数==1 ∧ 垂直边数==1)`，转弯优化用 `Optimize.minimize(Σ turn)`（锁定当前路径数）
- 方案快照 = 约束日志（base + OR(cross) + 锁路径数）+ 解数据，可从任意方案断点续算（replay）
- 随机种子：`global_param_set('sat.random_seed', seed)`，超时换种子重试
