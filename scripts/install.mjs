#!/usr/bin/env node
/**
 * Switch Armor 跨平台安装器（v0.12.0）
 *
 * 只动 profile 的 package.json（依赖 + bundles），不手工建软链、不碰宿主文件：
 * 依赖写成 `link:`，由 pnpm install 在各平台自行创建链接（Windows 上是 junction，
 * 不需要管理员权限/开发者模式）。
 *
 * 用法：
 *   node scripts/install.mjs                 # 看状态（默认）
 *   node scripts/install.mjs --apply         # 写入依赖与 bundle，并尝试 pnpm install
 *   node scripts/install.mjs --apply --no-install   # 只改配置，不跑 pnpm
 *   node scripts/install.mjs --revert        # 移除依赖与 bundle
 *   node scripts/install.mjs --profile desktop      # 指定 profile（默认 desktop / $DSH_PROFILE）
 *
 * 所有写入都会留 `<file>.bak-switcharmor-<时间戳>` 备份；重复执行幂等。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PLUGIN_ID = "dsh-switch-armor";
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DSH_HOME = resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));

const OK = "  ✓";
const NO = "  ✗";
const DIM = "  -";

function profileDir(name) {
  return join(DSH_HOME, "profiles", name);
}

function paths(profile) {
  const base = profileDir(profile);
  return {
    base,
    package: join(base, "package.json"),
    patch: join(base, "cordis.patch.yml"),
    modules: join(base, "node_modules", PLUGIN_ID),
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function backup(path) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const target = `${path}.bak-switcharmor-${stamp}`;
  copyFileSync(path, target);
  return target;
}

/** `link:` 依赖值：统一用 `/` 分隔，Windows 盘符也原样保留（pnpm 接受）。 */
function linkSpec(fromProfile, pluginDir) {
  const rel = relative(fromProfile, pluginDir);
  return `link:${(rel || pluginDir).split(sep).join("/")}`;
}

function bundleList(pkg) {
  const profile = pkg.dsh && pkg.dsh.profile;
  return profile && Array.isArray(profile.bundles) ? profile.bundles : undefined;
}

/** 只统计 `- insert:` 块里的手工 insert —— 正常 entry 的 `- id: ...` config 段不算。 */
function hasManualInsert(text, id) {
  let inInsert = false;
  const pattern = new RegExp(`^\\s+- id:\\s*${id}\\s*$`);
  for (const line of text.split(/\r?\n/)) {
    if (/^-\s*insert:\s*$/.test(line)) { inInsert = true; continue; }
    if (/^- /.test(line)) { inInsert = false; continue; }
    if (inInsert && pattern.test(line)) return true;
  }
  return false;
}

function status(profile) {
  const p = paths(profile);
  console.log(`DSH_HOME   ${DSH_HOME}`);
  console.log(`plugin     ${PLUGIN_DIR}`);
  console.log(`profile    ${p.base}`);
  if (!existsSync(p.package)) {
    console.log(`${NO} profile/package.json 不存在`);
    return 1;
  }
  let good = 0;
  const total = 3;
  const pkg = readJson(p.package);
  const dep = pkg.dependencies?.[PLUGIN_ID];
  const expected = linkSpec(p.base, PLUGIN_DIR);
  if (dep === expected || (typeof dep === "string" && dep.startsWith("link:"))) {
    console.log(`${OK} package.json 依赖行（${dep}）`);
    good += 1;
  } else {
    console.log(`${NO} package.json 依赖行（现值: ${dep === undefined ? "缺失" : dep}，期望 ${expected}）`);
  }
  if (existsSync(p.modules)) {
    console.log(`${OK} node_modules/${PLUGIN_ID}`);
    good += 1;
  } else {
    console.log(`${NO} node_modules/${PLUGIN_ID}（执行 pnpm install 生成）`);
  }
  const bundles = bundleList(pkg);
  if (bundles !== undefined && bundles.includes(PLUGIN_ID)) {
    console.log(`${OK} dsh.profile.bundles 含 ${PLUGIN_ID}`);
    good += 1;
  } else if (bundles === undefined) {
    console.log(`${NO} package.json 缺 dsh.profile.bundles`);
  } else {
    console.log(`${NO} dsh.profile.bundles 不含 ${PLUGIN_ID}`);
  }
  if (existsSync(p.patch)) {
    const text = readFileSync(p.patch, "utf8");
    if (hasManualInsert(text, PLUGIN_ID)) {
      console.log(`${DIM} 警告：cordis.patch.yml 里有 id: ${PLUGIN_ID} 手工 insert —— 包自带 patch 已声明 insert，两处会撞 duplicate loader entry id，请删掉手工那段。`);
    }
  }
  console.log(`\n状态: ${good}/${total} ` + (good === total ? "— 已安装" : "— 未完成，运行 --apply"));
  return good === total ? 0 : 1;
}

function apply(profile, runInstall) {
  const p = paths(profile);
  if (!existsSync(p.package)) {
    console.log(`${NO} profile/package.json 不存在: ${p.package}`);
    return 1;
  }
  const pkg = readJson(p.package);
  let changed = false;

  const expected = linkSpec(p.base, PLUGIN_DIR);
  if (pkg.dependencies?.[PLUGIN_ID] !== expected) {
    const bak = backup(p.package);
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies[PLUGIN_ID] = expected;
    writeJson(p.package, pkg);
    console.log(`${OK} 依赖行写入 ${expected}（备份 ${bak.split(/[\\/]/).pop()}）`);
    changed = true;
  } else {
    console.log(`${OK} 依赖行已存在，跳过`);
  }

  const bundles = bundleList(pkg);
  if (bundles === undefined) {
    const bak = backup(p.package);
    pkg.dsh = pkg.dsh ?? {};
    pkg.dsh.profile = pkg.dsh.profile ?? {};
    pkg.dsh.profile.bundles = [PLUGIN_ID];
    writeJson(p.package, pkg);
    console.log(`${OK} 新建 dsh.profile.bundles = [${PLUGIN_ID}]（备份 ${bak.split(/[\\/]/).pop()}）`);
    changed = true;
  } else if (!bundles.includes(PLUGIN_ID)) {
    const bak = backup(p.package);
    bundles.push(PLUGIN_ID);
    writeJson(p.package, pkg);
    console.log(`${OK} bundle 列表追加 ${PLUGIN_ID}（备份 ${bak.split(/[\\/]/).pop()}）`);
    changed = true;
  } else {
    console.log(`${OK} bundle 列表已含，跳过`);
  }

  if (runInstall) {
    console.log("\n运行 pnpm install（由 pnpm 创建各平台的链接）...");
    const result = spawnSync("pnpm", ["install"], {
      cwd: p.base,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.error || result.status !== 0) {
      console.log(`${NO} pnpm install 未成功（${result.error?.message ?? `exit ${result.status}`}）。`);
      console.log("  请手动在 profile 目录执行 pnpm install，或改用桌面端的 dsh:// 一键安装。");
      return 1;
    }
  } else {
    console.log(`${DIM} 已跳过 pnpm install（--no-install）；请自行在 profile 目录执行。`);
  }

  console.log("\n完成。**完全重启宿主后生效**（index.js 是 host 半，改动必须重启才加载）。");
  return 0;
}

function revert(profile) {
  const p = paths(profile);
  if (!existsSync(p.package)) {
    console.log(`${NO} profile/package.json 不存在: ${p.package}`);
    return 1;
  }
  const pkg = readJson(p.package);
  let changed = false;
  if (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, PLUGIN_ID)) {
    const bak = backup(p.package);
    delete pkg.dependencies[PLUGIN_ID];
    writeJson(p.package, pkg);
    console.log(`${OK} 移除依赖行（备份 ${bak.split(/[\\/]/).pop()}）`);
    changed = true;
  } else {
    console.log(`${DIM} 依赖行不存在，跳过`);
  }
  const bundles = bundleList(pkg);
  if (bundles !== undefined && bundles.includes(PLUGIN_ID)) {
    const bak = backup(p.package);
    pkg.dsh.profile.bundles = bundles.filter((id) => id !== PLUGIN_ID);
    writeJson(p.package, pkg);
    console.log(`${OK} 从 bundle 列表移除（备份 ${bak.split(/[\\/]/).pop()}）`);
    changed = true;
  } else {
    console.log(`${DIM} bundle 列表不含 ${PLUGIN_ID}，跳过`);
  }
  console.log("\n完成。如需清掉 node_modules 里的副本，请在 profile 目录执行 pnpm install。");
  return changed ? 0 : 0;
}

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : undefined;
};
const profile = valueOf("--profile") || process.env.DSH_PROFILE || "desktop";

if (has("--help") || has("-h")) {
  console.log("用法: node scripts/install.mjs [--apply|--revert|--status] [--profile <name>] [--no-install]");
  process.exit(0);
}
if (!existsSync(join(PLUGIN_DIR, "index.js"))) {
  console.log(`${NO} 插件本体缺失: ${join(PLUGIN_DIR, "index.js")}`);
  process.exit(1);
}
if (has("--apply")) process.exit(apply(profile, !has("--no-install")));
if (has("--revert")) process.exit(revert(profile));
process.exit(status(profile));
