#!/usr/bin/env node
/**
 * CFnew 多阶段混淆构建脚本
 *
 * 阶段 1: terser 压缩（ES module，保留 cloudflare:sockets import）
 * 阶段 2: javascript-obfuscator 强化混淆
 *          - 开启 controlFlowFlattening / deadCodeInjection
 *          - 关闭 selfDefending / debugProtection（Cloudflare Workers 运行时兼容）
 * 阶段 3: terser 二次压缩，输出单行 _worker 可部署代码
 *
 * 用法: node build-obfuscate.js [控制流阈值] [死代码阈值]
 * 默认: node build-obfuscate.js 0.5 0.2
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = __dirname;
const SOURCE_FILE = '明文源吗';
const OUTPUT_FILE = '少年你相信光吗';
const SOURCE_PATH = path.join(ROOT, SOURCE_FILE);
const OUTPUT_PATH = path.join(ROOT, OUTPUT_FILE);

const controlFlowThreshold = Number(process.argv[2] || 0.5);
const deadCodeThreshold = Number(process.argv[3] || 0.2);

function logSize(label, code) {
  const bytes = Buffer.byteLength(code, 'utf8');
  const kb = (bytes / 1024).toFixed(1);
  const lines = code.split('\n').length;
  console.log(`${label}: ${bytes} bytes (${kb} KiB), ${lines} 行`);
  return bytes;
}

(async () => {
  const startedAt = Date.now();

  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`未找到源文件: ${SOURCE_PATH}`);
  }
  const original = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (!original || original.trim().length === 0) {
    throw new Error(`源文件 ${SOURCE_FILE} 为空`);
  }

  // ---- 阶段 1: 压缩 ----
  const stage1 = await minify({ [`${SOURCE_FILE}.js`]: original }, {
    module: true, // Workers 是 ES module，需要保留 import/export
    ecma: 2022,
    compress: {
      passes: 2,
      drop_console: false
    },
    mangle: {
      toplevel: false
    },
    format: {
      comments: false,
      ecma: 2022
    }
  });
  if (!stage1 || !stage1.code) {
    throw new Error('阶段 1 (terser) 失败');
  }
  logSize('阶段 1 terser 压缩后', stage1.code);

  // ---- 阶段 2: 强化混淆 ----
  const obfuscated = JavaScriptObfuscator.obfuscate(stage1.code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: controlFlowThreshold,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: deadCodeThreshold,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 1.0,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: false,
    stringArrayWrappersParametersMaxCount: 3,
    renameGlobals: true,
    identifierNamesGenerator: 'hexadecimal',
    renameProperties: false,
    renamePropertiesMode: 'safe',
    ignoreImports: false,
    target: 'browser',
    numbersToExpressions: false,
    simplify: false,
    splitStrings: true,
    splitStringsChunkLength: 3,
    transformObjectKeys: false,
    unicodeEscapeSequence: true,
    selfDefending: false, // Workers 运行时下保持关闭
    debugProtection: false, // Workers 运行时下保持关闭
    debugProtectionInterval: 0,
    disableConsoleOutput: false,
    domainLock: []
  }).getObfuscatedCode();
  logSize('阶段 2 obfuscator 混淆后', obfuscated);

  // ---- 阶段 3: 二次压缩 ----
  const stage2 = await minify({ [`${OUTPUT_FILE}.js`]: obfuscated }, {
    module: true,
    ecma: 2022,
    compress: {
      passes: 2,
      drop_console: false
    },
    mangle: true,
    format: {
      comments: false,
      ascii_only: true,
      ecma: 2022
    }
  });
  if (!stage2 || !stage2.code) {
    throw new Error('阶段 3 (terser) 失败');
  }
  const finalBytes = logSize('阶段 3 terser 二次压缩后', stage2.code);

  fs.writeFileSync(OUTPUT_PATH, stage2.code, 'utf8');
  console.log(`输出文件: ${OUTPUT_PATH}`);
  console.log(`总耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  // Cloudflare Workers 免费计划脚本体积上限约为 3 MiB（原始代码）
  if (finalBytes > 3 * 1024 * 1024) {
    console.warn('警告: 产物超过 3 MiB，可能超出 Workers 免费计划脚本体积上限。');
    console.warn(`建议调低阈值重试: node build-obfuscate.js 0.3 0.1`);
  }
})().catch((error) => {
  console.error('构建失败:', error && error.message ? error.message : error);
  process.exit(1);
});
