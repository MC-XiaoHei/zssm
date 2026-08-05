// build.mjs — esbuild 打包 UI + 拷贝 z3 运行时到 public/ + 部署辅助文件
// z3-built.js 必须独立 <script> 引入（勿打包）；z3-solver high/low-level API 可整包打包。
import { build } from 'esbuild';
import { mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const z3Build = path.join(root, 'node_modules', 'z3-solver', 'build');

await rm(pub, { recursive: true, force: true });
await mkdir(path.join(pub, 'z3'), { recursive: true });

const common = {
  bundle: true,
  // z3-solver 的 browser.js 读全局 `global`，浏览器无此变量
  define: { global: 'globalThis' },
  target: 'es2020',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [path.join(root, 'src', 'ui.js')],
  outfile: path.join(pub, 'app.js'),
  format: 'iife',
  minify: true,
  sourcemap: true,
});

await copyFile(path.join(root, 'index.html'), path.join(pub, 'index.html'));
await copyFile(path.join(z3Build, 'z3-built.js'), path.join(pub, 'z3', 'z3-built.js'));
await copyFile(path.join(z3Build, 'z3-built.wasm'), path.join(pub, 'z3', 'z3-built.wasm'));

// coi-serviceworker：SW 兜底补 COOP/COEP 头（单文件内联注册，兼容 gh-pages 等无头配置托管）
await copyFile(
  path.join(root, 'node_modules', 'coi-serviceworker', 'coi-serviceworker.min.js'),
  path.join(pub, 'coi-serviceworker.js')
);

// _headers：静态托管（GitHub Pages）直接下发真实响应头；SW 已隔离时 coi 脚本会自动跳过注册
await writeFile(
  path.join(pub, '_headers'),
  [
    '/*',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Cross-Origin-Embedder-Policy: require-corp',
    '  Cross-Origin-Resource-Policy: cross-origin',
    '  Cache-Control: no-store',
    '',
  ].join('\n'),
  'utf8'
);

console.log('build ok → public/');
