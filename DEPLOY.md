# zssm-web 部署说明

纯前端网格哈密顿路径 SAT 求解器。浏览器内完成 SAT 编码 → z3-wasm 求解 → 路径绘制，无后端。

## 依赖与构建

```bash
pnpm install        # 或 npm install（需放行 postinstall/build scripts）
pnpm build          # 产物输出到 public/
pnpm serve          # 本地预览 http://localhost:8080（已带 COOP/COEP 头）
```

产物结构：

```
public/
├── index.html          # 主页面（网格编辑 + 求解 + 绘制）
├── app.js              # UI + 编码器 + z3 API 层（esbuild 打包）
├── coi-serviceworker.js # 兜底补 COOP/COEP 头（无隔离时自动注册）
└── z3/
    ├── z3-built.js     # emscripten 运行时（独立 <script>，勿打包）
    └── z3-built.wasm   # z3 内核（34.6MB，外置，首次加载有进度条）
```

## 部署到静态托管：必须配置两个响应头

z3-wasm 使用 pthread + SharedArrayBuffer，**缺少响应头时求解会失败**（页面会给出提示）。

| 响应头 | 值 |
|---|---|
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |

nginx 示例：

```nginx
location /zssm/ {
    alias /var/www/zssm/public/;
    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Content-Security-Policy "script-src 'self' 'wasm-unsafe-eval'" always;
}
```

> CSP 说明：z3-wasm 需要 `'wasm-unsafe-eval'`（WebAssembly 编译）与 worker-src 放行 self；若站点已有 CSP 请确认这两项。没有 CSP 则无需处理。

## 不支持 COOP/COEP 的托管平台

（如部分对象存储/CDN 只读场景）可在页面中引入
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
（拷贝其 coi-serviceworker.js 到 public/，并在 `z3-built.js` 之前 `<script src="/coi-serviceworker.js">`），
SW 会自动代理加头，无需平台配置。

## 浏览器直接双击 index.html（file://）不可用

无响应头时 SharedArrayBuffer 不可用。请始终通过 http(s) 访问，推荐 `pnpm serve`。

## 首次加载与缓存

- 首次访问需下载 `z3-built.js`（约 10MB）+ `z3-built.wasm`（34.6MB），页面底部有进度条。
- coi-serviceworker 会把二者写入 Cache API，同一浏览器后续访问秒开（无需重新下载）。
- 清缓存 / 隐身模式会重新下载。

## 验证

- 求解自检：`pnpm serve` 后打开 `http://localhost:8080/`，载入「示例布局」点「求解」，应显示 `SAT 有解 · 最优 33 转（已证明）· 87格`。
