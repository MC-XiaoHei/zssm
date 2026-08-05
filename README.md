# zssm — 网格哈密顿路径 · 纯前端 SAT 求解器

> ⚠️ **本仓库全部代码由 AI 生成（all AI-generated），仅供参考学习，不保证正确性与可用性。** 使用前请自行审查与验证。

在浏览器内完成 **SAT 编码 → 求解 → 路径绘制** 的纯前端工具：给定 n×m 网格（含障碍），求经过每个空格恰好一次的哈密顿路径，并可**最小化路径转弯数**、多候选对比。

- **内核**：z3 官方 WASM（`z3-solver@5`），多线程（pthread + SharedArrayBuffer）
- **零后端**：静态托管即可部署
- **三态结果**：SAT（有解+路径）/ UNSAT（严格证明无解）/ 超时

## 在线演示

- 主页面：`https://<your-github-org>.github.io/zssm/`
- 浏览器端规格用例：`https://<your-github-org>.github.io/zssm/test/`

## 功能

- 行/列 1~20 网格编辑：点击切换障碍、示例布局、随机占用、清空
- 求解：SAT 编码 + lazy 连通性迭代（`OR(cross)`），端点限边界可选
- 转弯优化：`Optimize.minimize(turn_sum)` 求 T*（已证明最优），并给出探索样本 / 对比解列表，按转弯数升序展示，点击切换查看
- 路径绘制：金色路径线、弯道白点、绿起红终、坐标轴；路径序列一键复制

## 本地运行

```bash
pnpm install
pnpm test        # Node 端规格用例（9×11 87 格、T 形 UNSAT、转弯优化等 18 项）
pnpm build       # 构建 public/（esbuild bundle + z3 wasm 拷贝 + coi-serviceworker）
pnpm serve       # http://localhost:8080（自带 COOP/COEP 响应头）
```

浏览器验证用例：`http://localhost:8080/test/`

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
  solver-core.js       # SAT 编码 + 连通性迭代 + 路径重建 + 转弯优化（纯函数，Node/浏览器共用）
  ui.js                # Canvas 网格编辑、绘制、候选列表
  browser-test.js      # 浏览器端规格用例
test/
  run.js               # Node 端规格用例（18 项断言）
  browser.html         # 浏览器端用例页面
scripts/
  build.mjs            # esbuild bundle + z3 文件拷贝 + _headers
  serve.mjs            # 本地静态服务器（COOP/COEP）
public/                # 构建产物（部署内容，不入库）
```

## 算法说明

- 变量：每条相邻空格对一条边变量 `x_e`
- 约束 A：每格度 ∈ {1,2}（路径并/环的并）
- 约束 B：恰好 2 个端点（排除多路径、纯环）
- 约束 C：端点限边界（默认开）
- 约束 D：连通性 lazy 迭代——对每个孤立分量加 `OR(跨边)`（必须 OR，不能 Implies）
- 转弯数：`turn(v) = (水平边数==1 ∧ 垂直边数==1)`，T* 用 `Optimize.minimize(Σ turn)`
- 随机种子：`global_param_set('sat.random_seed', seed)`，超时换种子重试
