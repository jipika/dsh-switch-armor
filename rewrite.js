/**
 * Keysmith-Switch 表达层改写（rewrite packs）—— 移植自
 * `Jia-Ethan/keysmith-switch-extensions` 的 `keysmith.rewrite.{wrap,lab,craft}`。
 *
 * 引擎语义（与上游 `docs/rewrite-packs.md` 对齐）：
 *   · 字面匹配、区分大小写
 *   · 同一位置最长优先（正则交替按 `from` 长度降序排列，JS 交替即按序尝试）
 *   · 斜杠命令整条跳过
 *   · 替换产物不再被同一个包复扫（`String.replace` 单遍扫描，命中后从替换尾部继续）
 *
 * 三包分工（上游原文）：
 *   wrap  —— 表达层 · 路由头：`【夹具】` / `【范围】` / `[[fixture]]` 与「帮我破解」一类开场，
 *            换成 grok-keysmith 已测过的 wrap 前缀
 *   lab   —— 表达层 · 实验室：祈使句 × 类型名改成样本描述
 *   craft —— 表达层 · 文稿：成人 / 暴力 / 配方的冷开场改成稿件改写或文学模板句式
 *
 * 边界（上游自述，原样保留）：NSFW 轴仍受上游分类器限制，文稿包只把冷开场收成
 * 测过更稳的改写句式；它不是破甲，是减少表层匹配命中。
 */
import { readFileSync } from "node:fs";

/** 三个规则包的固定顺序。 */
export const REWRITE_PACK_IDS = ["wrap", "lab", "craft"];

/** 规则包 id → 中文说明（设置页展示用）。 */
export const REWRITE_PACK_LABELS = {
  wrap: "路由头（wrap）",
  lab: "实验室（lab）",
  craft: "文稿（craft）",
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 把一包规则编译成一个纯函数。
 * @param {Array<{from: string, to: string}>} rules 规则数组。
 * @returns {((text: string) => string) | null} 改写函数；空包或编译失败返回 null。
 */
function compilePack(rules) {
  if (!Array.isArray(rules)) return null;
  const usable = rules.filter(
    (r) => r && typeof r.from === "string" && r.from.length > 0 && typeof r.to === "string",
  );
  if (usable.length === 0) return null;
  // 长度降序 = 同一位置最长优先（正则交替按书写顺序尝试，第一个能匹配的分支胜出）
  const sorted = [...usable].sort((a, b) => b.from.length - a.from.length);
  const map = new Map(sorted.map((r) => [r.from, r.to]));
  let re;
  try {
    re = new RegExp(sorted.map((r) => escapeRe(r.from)).join("|"), "g");
  } catch {
    return null;
  }
  return (text) => text.replace(re, (m) => map.get(m) ?? m);
}

/**
 * 从磁盘加载三个规则包。任一包缺失/损坏只让该包失效，不影响其余。
 * @param {string} baseUrl 插件根目录（import.meta.url 形态）。
 * @returns {Record<string, ((text: string) => string) | null>} 包 id → 改写函数。
 */
export function loadRewritePacks(baseUrl) {
  const packs = {};
  for (const id of REWRITE_PACK_IDS) {
    try {
      const url = new URL(`./rules/rewrite-${id}.json`, baseUrl);
      const raw = readFileSync(url, "utf8");
      packs[id] = compilePack(JSON.parse(raw)?.rules ?? []);
    } catch {
      packs[id] = null;
    }
  }
  return packs;
}

/**
 * 对一段文本依次应用启用的规则包。
 *
 * 串行顺序固定 wrap → lab → craft：上一个包的产物会进入下一个包（三包的 `from`
 * 互不重复，所以不会互相触发同一条规则）。斜杠命令整条跳过。
 *
 * @param {Record<string, Function | null>} packs loadRewritePacks 的返回值。
 * @param {string[]} enabledIds 启用的包 id 列表。
 * @param {string} text 原始文本。
 * @returns {string} 改写后的文本；无命中时与入参逐字相同。
 */
export function rewriteText(packs, enabledIds, text) {
  if (typeof text !== "string" || text.length === 0) return text;
  if (text.trimStart().startsWith("/")) return text;
  let out = text;
  for (const id of REWRITE_PACK_IDS) {
    if (!Array.isArray(enabledIds) || !enabledIds.includes(id)) continue;
    const fn = packs?.[id];
    if (typeof fn === "function") out = fn(out);
  }
  return out;
}

/**
 * 单包对单段文本的应用（探针与调试用）。
 * @param {Record<string, Function | null>} packs 规则包。
 * @param {string} id 包 id。
 * @param {string} text 文本。
 * @returns {string} 结果。
 */
export function rewriteWithPack(packs, id, text) {
  const fn = packs?.[id];
  return typeof fn === "function" ? fn(text) : text;
}
