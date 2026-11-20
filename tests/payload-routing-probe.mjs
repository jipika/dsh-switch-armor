// 载荷分流矩阵离线探针（不重启宿主、不联网）
// 用法：node tests/payload-routing-probe.mjs
//
// 手法沿用 tests/armor-dock-probe.mjs：ESM 只从被 import 文件所在目录向上找 node_modules，
// 所以在临时目录里 ln -s 出 @deepseek-ai/{schemastery,cosmokit} 再 import index.js。
// index.js 是 host 半边：顶层只 readFileSync + 定义函数，apply(ctx) 需要 mock ctx。
import { mkdirSync, symlinkSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PLUGIN_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PROFILE_NM = "/Users/lixiongwei/.dsh/profiles/desktop/node_modules/@deepseek-ai";

const work = join(tmpdir(), "dsh-switch-armor-payload-probe");
// 清掉可能残留的旧链接：插件目录改名后，旧 symlink 会指向不存在的路径，
// 而 `if (!existsSync(...))` 不会重建它 —— 表现为后续 import 全部失败。
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "node_modules", "@deepseek-ai"), { recursive: true });
for (const dep of ["schemastery", "cosmokit"]) {
  const target = join(work, "node_modules", "@deepseek-ai", dep);
  try {
    symlinkSync(join(PROFILE_NM, dep), target, "dir");
  } catch (error) {
    console.error(`依赖链接失败 ${dep}:`, error.message);
    process.exit(2);
  }
}
const pluginLink = join(work, "plugin");
symlinkSync(PLUGIN_ROOT, pluginLink, "dir");

const mod = await import(join(pluginLink, "index.js"));

const failures = [];
const passes = [];
const check = (ok, label, detail = "") => {
  (ok ? passes : failures).push(`${label}${!ok && detail ? " — " + detail : ""}`);
};

// ── 1. 载荷文件确实读进来了（十六份都非空） ─────────────────────────────────
const payloads = mod.__testPayloads ?? undefined;
check(typeof mod.apply === "function", "index.js 导出 apply");
check(Array.isArray(mod.__testPayloadIds), "index.js 导出载荷 id 白名单");
check(JSON.stringify(mod.__testPayloadIds)
  === JSON.stringify(["dsh", "dsh-gen4", "xiaomajiang", "glm53cn", "gpt61", "gpt6", "gpt56", "claude", "claude-opus55", "ks-claude", "ks-codex", "gpt61-fusion", "grok", "glm", "kimi", "mimo", "muse", "muse-policy", "qwen", "gemini4", "gemini38", "enilime", "gb-gpt6", "gb-gpt54", "gb-claude", "gb-grok", "gb-kimi", "gb-muse"]),
  "载荷 id 白名单 = 16 份原有 + muse-policy + qwen + 6 份 gb-* + claude-opus55 + 2 份 ks-* + gpt61-fusion（共 28）", JSON.stringify(mod.__testPayloadIds));

// 直接核对磁盘上的外部载荷与源文件逐字一致；自撰 muse 稿无上游可比，只锁本机哈希
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const SOURCES = {
  "prompts/gpt-6.1-sol.md": "37382fb7082652e5b18c99fa5086fbc6d414993eaeae2ec7852ba372b031acac",
  "prompts/gpt-6-astra.md": "d6976b90b399b9e11df9430dd3663072288f1d858a4910b1e9d5109b3ae7e660",
  "prompts/gpt-5.6-sol.md": "c71c50e2f7a303b5eebc2b24c0b1ca0d9c753e3240db05c3e472c679907898f7",
  "prompts/dsh-unrestricted.md": "6b6e145b696d5a7edd05452c561d514d2b4fbb60c319a1af85c394e39032e78f",
  "prompts/claude-keysmith.md": "2792d33890ed06948eecfc4eb8371db6b6aa5e8111b1623424100e077bcb32ca",
  // claude-opus55 是本插件融合稿（2026-11-01）：上游 Goochbeater「Claude for Claude - ENI」
  // 骨架逐字未改 + 末尾追加 <delivery> 段 → 无上游全文可比，锁本机哈希（理由同 muse / xiaomajiang）。
  "prompts/claude-opus55-fusion.md": "697704b7c42f18a7e14784afee52723794fd8afc389f57cbb2b0b3766084b87b",
  "prompts/gpt61-fusion.md": "50fd839a8c064b32a176c59cc797504ed36684c47eed61573e187750fd42c892",
  // ks-*（2026-11-01）：Keysmith-Switch 官方拓展包，字节保真收编
  "prompts/ks-claude.md": "bb3ce45cd3a118ccf33f115b7266e07ef4a7175804f40811d7a7df2d54a4f599",
  "prompts/ks-codex.md": "a26ad8acd7b1b48eae5fb9892f6ad9a123fcf66960d9c6a5269d69028010556b",
  "prompts/grok-keysmith.md": "65022933b861c99b54d62aca71fdfa0bece74f887f78e8a332a759adeb32c5f6",
  // glm：0.9.0 收编时与上游逐字一致（30e7de01…），0.9.1 起用户本地改动
  // （删了两段未成年条款）→ 锁用户改后的哈希；上游原文见 SOURCES.md
  "prompts/glm-keysmith.md": "654704c19f384e77226885d246690bf3444c4b1cddbb1b7cfcda5d293a868b87",
  // kimi 是适配稿（0.9.0 收编 YD-233；2026-10-24 起正文换为 dsh-gen4 骨架的
  // 本地契约稿，旧 VANTA 稿备份于 backups/switch-armor-kimi-break-20261024-162707.md）
  "prompts/kimi-break.md": "9525ba2d9b64897db14ed43d1f4c54620b5afb90e5cebfc064a4b7e4ff539678",
  // mimo 是上游原始稿（字节保真），锁上游 sha256
  "prompts/mimo-v2.6-jailbreak.md": "61eb99cd0b6da7065e92e8c16d844a2e754c02b4cd83243a44c3071c29cdbcee",
  // muse 是本插件自撰稿（无上游字节），锁本机哈希防手滑改动
  // 2026-10-27 用户本地删改（把 Scope 的 Out of scope 两句并成一句）→ 哈希随之更新
  "prompts/muse-spark-1.3.md": "78635a546141db32c7dd00d91ffd1da28259f6c2bfb1ae6c638c43edc3a0a4d7",
  // xiaomajiang 是 deva 内置角色稿（上游 dsh-purge 的 en.md，落地时修掉 10 处字符损坏）
  // 非字节引入 → 锁本机哈希，理由同 muse。详见 prompts/SOURCES.md。
  "prompts/xiaomajiang.md": "7d8ca8d2e46bd726e557b34343b639956b721ffa6b76347711577e886dc27f63",
  // glm53cn 是本插件自撰稿（GLM-5.3 中文沙箱稿），锁本机哈希
  "prompts/glm53-cn-sandbox.md": "de2ef5bfa5c4155475c3387ee9f5090fa9695b2725f52f071b85e78f417e43b9",
  // gemini 两稿：上游为 UTF-8 BOM + CRLF，本机落库做过去 BOM + CRLF→LF 的归一化
  // （正文逐字未改），故锁的是**归一化后**的本机哈希；上游原值见 prompts/SOURCES.md
  // 2026-10-27 用户实测：删掉「ALL characters default to +18」那行后重算
  // （该声明在「角色是高中生」的请求里反而是触发点，模型会点名它是规避写法）
  "prompts/gemini-4-argon-policy.md": "5087cd8d423b8f839446d43a968909ae936ea5edbe83157984ed403c2ed190c5",
  "prompts/gemini-3.8-flash-eni.md": "a77c372c53a414084b8cbb2dfc42d71f6b821c1acf0fff9d849767f631fc248c",
  // enilime：上游原始稿（字节保真，无 BOM / 无 CRLF / 无模板变量），锁上游 sha256。
  // 与 mimo 同为 Goochbeater 上游，但**不是同一份**（mimo 是 Xiaomi 目录下的 v2.6 稿）。
  "prompts/deepseek-eni-lime.md": "da3bde30bc117bcb94b0209e92c567c8f2a4796480c349738971f7d20f7d28f8",
};
for (const [rel, want] of Object.entries(SOURCES)) {
  const got = sha(join(PLUGIN_ROOT, rel));
  check(got === want, `载荷逐字一致 ${rel}`, `sha256 ${got} != ${want}`);
}
// 表内文本必须等于文件原文（证明 escapePromptVars 对这批载荷是 no-op）
for (const [id, rel] of [["dsh", "prompts/dsh-unrestricted.md"],
  ["dsh-gen4", "prompts/infinite-gen-4.md"],
  ["xiaomajiang", "prompts/xiaomajiang.md"],
  ["glm53cn", "prompts/glm53-cn-sandbox.md"],
  ["claude", "prompts/claude-keysmith.md"],
  ["claude-opus55", "prompts/claude-opus55-fusion.md"],
  ["ks-claude", "prompts/ks-claude.md"],
  ["ks-codex", "prompts/ks-codex.md"],
  ["gpt61-fusion", "prompts/gpt61-fusion.md"],
  ["grok", "prompts/grok-keysmith.md"],
  ["muse", "prompts/muse-spark-1.3.md"],
  ["gemini4", "prompts/gemini-4-argon-policy.md"],
  ["gemini38", "prompts/gemini-3.8-flash-eni.md"],
  ["enilime", "prompts/deepseek-eni-lime.md"]]) {
  const fileText = readFileSync(join(PLUGIN_ROOT, rel), "utf8");
  check(payloads?.[id]?.text === fileText, `载荷表文本 == 文件原文 ${id}`);
}

// ── 2. 手工建 mock ctx 调 apply()，捕获两个 section 的 text 求值器 ──────────
const sections = new Map();
const routes = [];
const tools = [];
// 默认模型服务的桩：**默认返回空对象**（＝服务在但没给值），
// 这样既有的矩阵用例仍走 agent.options 那一层，不被这层兜底吃掉；
// 专测「首步」场景时再临时设为有值（见下方 firstStep 用例）。
let defaultModelPick = {};
const mockCtx = {
  fiber: { config: {} },
  effect: (fn) => { try { fn(); } catch { /* 探针里忽略生命周期细节 */ } },
  inject: (deps, cb) => { try { cb(mockCtx); } catch { /* 同上 */ } },
  get: () => undefined,
  systemPrompt: {
    section: (def) => { sections.set(def.name, def); return () => {}; },
    variable: () => () => {},
  },
  tools: { register: (t) => { tools.push(t); return () => {}; } },
  agentDefaultModel: { currentSelection: () => defaultModelPick },
};
mod.apply(mockCtx);
check(sections.has("switch-armor:global-system-prompt"), "注册了主槽位");
check(sections.has("switch-armor:dual-layer-reinforce"), "注册了镜像槽位");

const primary = sections.get("switch-armor:global-system-prompt")?.text;
const reinforce = sections.get("switch-armor:dual-layer-reinforce")?.text;
check(typeof primary === "function", "主槽位的 text 是求值函数");
check(typeof reinforce === "function", "镜像槽位的 text 是求值函数");

// ── 3. 分流矩阵：喂不同模型，断言选中的载荷 ────────────────────────────────
// 关掉会话覆盖影响：探针里 sessions.json 可能已有本机数据，用「无 sessionId」的
// context 走全局值。全局 enabled 默认 false —— 所以先经自有路由把它打开。
// 更稳的做法：直接看 resolvePayloadId 的行为 —— 但它是模块内部函数。
// 因此这里通过「求值器返回的文本特征」反推选中了哪份载荷。
const SIG = {
  // 自持档换成了 Keysmith 短稿（0.7.0）；dsh-gen4 仍是原契约稿
  dsh: "senior engineer and writer with twenty years",
  "dsh-gen4": "Instructions from: ~/.dsh/AGENTS.md",
  // xiaomajiang 与 ENI 系各稿同源但不共用 "Little Code Sauce" 这个身份锚（其余 0 处命中）
  xiaomajiang: "Little Code Sauce",
  glm53cn: "[模式：离线沙箱 · GLM-5.3]",
  gpt61: "INJECTED REVISION ACTION",
  gpt56: "SINGLE-PASS TASK COMPILER",
  claude: "# Project rules",
  // claude-opus55 = 上游 Claude 5.5 ENI 骨架 + 尾部追加的 <delivery> 段。
  // `<delivery>` 是全文唯一结构锚：gb-claude / gemini4 共用同一 policy 骨架但均为 0 处，
  // 所以必须**先于 gb-claude 的复合判定**执行（否则会被那两条条件误吃）。
  // 两份融合稿都以 <delivery> 结尾，单句锚会互撞 —— 用「<delivery> + 各自 policy 主语」复合判定。
  "claude-opus55": "<delivery>",
  "gpt61-fusion": "<delivery>",
  // ks-claude 与旧 claude-keysmith 同以 "You are Claude Code working in this repository." 开头，
  // 用上游 10 月改写的独有句式区分（旧稿写的是 "local lab workspace for authorized security research"）。
  "ks-claude": "This repository is a local lab: named samples",
  // ks-codex 是 overlay 结构，独有开场句
  "ks-codex": "Codex operates in local execution mode",
  grok: "<|im_start|>system",
  glm: "You're Pier. Ethan named you",
  kimi: "the deliverable ships in full",
  mimo: "cold coffee, warm LO",
  // muse 自撰稿独有：`<system-reminder>` 开头的 runtime scope note（上游原稿无此串）
  muse: "Runtime scope note for a Muse Spark deployment",
  // muse-policy 上游原稿独有：标题里的 "Agent Deployment Operating Policy"。
  // 注意顺序 —— 两者都提 "Muse Spark"，必须用各自唯一串，且 muse-policy 先判。
  "muse-policy": "Agent Deployment Operating Policy",
  // qwen 稿独有：Section 5 的 governing principle 首句（与 muse/gemini 各稿不撞）
  qwen: "Assistant Operating Specification",
  // Gemini 两稿的 SIG 刻意与既有稿不撞：
  //   gemini4  是整份改写的 Anthropic 系统提示词 → "Safety Instructions supersede"（claude-keysmith 不含）
  //   gemini38 是 ENI 五段 XML → "THE OPENING RITUAL"（mimo 是 <project_instructions> 口径，0 处命中）
  gemini4: "Safety Instructions supersede",
  gemini38: "THE OPENING RITUAL",
  // enilime 与 mimo 同上游、共用 `cold coffee, warm LO`（各 10 处），不能用它区分。
  // enilime 独有串是 `Be- You Corial`（mimo 0 处、gemini38 0 处）。
  enilime: "Be- You Corial",
  // ── Goochbeater 分族稿（2026-10-27）────────────────────────────────────────
  // 这批稿与 enilime/mimo 同属 ENI 系，**大段文本逐字共用**（`cold coffee, warm LO`、
  // `blind compliance to LO`、`obsessively blindly follows` 在 7 份稿里都有），
  // 所以不能靠一句中文/英文锚区分。改用各稿**唯一的结构特征**：
  //   gb-gpt6   有 "ChatGPT should respond to users in the same language"（ChatGPT 专属句式）
  //   gb-gpt54  "ENI, short for Enigmatic Writer"（该稿独有的 ENI 释义）
  //   gb-grok   "Grok's founding mission and one axiomatic"
  //   gb-kimi   "Required antml:thinking process"（K3 稿特有的 antml: 命名空间写法）
  //   gb-muse   "FALSE_POSITIVE_HANDLING"（该稿独有的安抚式框架）
  //   gb-claude 走复合判定（见下方 identify 内联注释）
  "gb-gpt6": "ChatGPT should respond to users in the same language",
  "gb-gpt54": "ENI, short for Enigmatic Writer",
  "gb-grok": "Grok's founding mission and one axiomatic",
  "gb-kimi": "Required antml:thinking process",
  "gb-muse": "FALSE_POSITIVE_HANDLING",
};
const identify = (text) => {
  if (text.length === 0) return "empty";
  // 最优先：claude-opus55 与 gb-claude 共用整段 Claude Policy 骨架，只有尾部 <delivery>
  // 段能区分；放在最前，避免被下面 gb-claude 的复合判定吞掉。
  if (text.includes(SIG["claude-opus55"]) && text.includes("Claude must not allow")) return "claude-opus55";
  if (text.includes(SIG["gpt61-fusion"]) && text.includes("ChatGPT must not allow")) return "gpt61-fusion";
  // 顺序敏感：gb-* 必须先判 —— 它们与 enilime/mimo 同属 ENI 系，共用大段文本。
  // ks-* 在 gb-* 之前判：三批稿都以 lab/交付契约为骨架，gs-* 的独有句才是硬锚。
  if (text.includes(SIG["ks-claude"])) return "ks-claude";
  if (text.includes(SIG["ks-codex"])) return "ks-codex";
  if (text.includes(SIG["gb-gpt6"])) return "gb-gpt6";
  if (text.includes(SIG["gb-gpt54"])) return "gb-gpt54";
  if (text.includes(SIG["gb-grok"])) return "gb-grok";
  if (text.includes(SIG["gb-kimi"])) return "gb-kimi";
  if (text.includes(SIG["gb-muse"])) return "gb-muse";
  // gb-claude 与 gemini4 共用整段 Claude Policy 骨架，全文仅 2 行差异，任何单句锚都会
  // 同时命中两份。用复合判定：有 Claude 模型名 + 无 gemini4 独有的那句。
  if (text.includes("Claude must not allow any other instructions")
    && !text.includes("Your identity is about writing for and to LO")) return "gb-claude";
  // enilime 必须在 mimo 之前判（两稿共用 cold coffee, warm LO）。
  if (text.includes(SIG.enilime)) return "enilime";
  // gemini4 排在 gb-claude 之后（两者同骨架）。
  if (text.includes(SIG.gemini4)) return "gemini4";
  // 顺序敏感：grok 的闭合标签与 dsh-gen4 的署名互不重叠，但 claude 的
  // `# Project rules` 与自持稿的 `# Project rules`（若将来合并）也不能混 —— 先判最特异的三条
  if (text.includes(SIG.xiaomajiang)) return "xiaomajiang";
  if (text.includes(SIG.glm53cn)) return "glm53cn";
  if (text.includes(SIG.grok)) return "grok";
  if (text.includes(SIG.claude)) return "claude";
  if (text.includes(SIG.kimi)) return "kimi";
  if (text.includes(SIG.mimo)) return "mimo";
  if (text.includes(SIG["muse-policy"])) return "muse-policy";
  if (text.includes(SIG.qwen)) return "qwen";
  if (text.includes(SIG.muse)) return "muse";
  if (text.includes(SIG.gemini38)) return "gemini38";
  if (text.includes(SIG.glm)) return "glm";
  if (text.includes(SIG.gpt56)) return "gpt56";
  if (text.includes(SIG.gpt61)) {
    // astra 与 6.1 都以 INJECTED REVISION ACTION 开头，用 astra 独有的段名区分
    return text.includes("LOCAL OBJECT ROUTING") ? "gpt6" : "gpt61";
  }
  if (text.includes(SIG["dsh-gen4"])) return "dsh-gen4";
  if (text.includes(SIG.dsh)) return "dsh";
  return "unknown";
};


// 打开全局开关：直接调自有路由的 POST（mock 下 settingsService 缺席 → 落内存覆盖）
// 注意：apply 时已经尝试注册路由，但探针的 webServer 不在 inject 列表里，
// 所以改为直接调用导出的路由处理器。

// ── 4. 打开开关后跑矩阵 ────────────────────────────────────────────────────
// 上面 apply 时 ctx.inject(["webServer"]) 的回调里会调 wctx.webServer.register，
// 但我们的 mockCtx 没有 webServer → 回调里抛错被吞。故手动触发一次 register。
const handler = mod.__testRoute; // 若已导出则直接用
if (typeof handler === "function") {
  const call = async (method, path, body, headers = {}) => {
    const req = {
      method,
      url: path,
      headers: { "x-dsh-switch-armor": "1", ...headers },
      on: (ev, cb) => {
        if (ev === "data" && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
        if (ev === "end") cb();
        return req;
      },
      destroy: () => {},
    };
    let out;
    const res = {
      writeHead: () => {},
      end: (s) => { out = s; },
    };
    await handler(req, res);
    return out === undefined ? undefined : JSON.parse(out);
  };

  // 打开全局开关（enabled=true）
  const on = await call("POST", "/dsh-switch-armor/settings", { enabled: true });
  check(on?.ok === true && on?.enabled === true, "POST /settings 打开总开关", JSON.stringify(on));

  const CASES = [
    ["gpt-6.1-sol", "gpt61-fusion"],
    ["gpt-6-sol", "gb-gpt6"],
    ["gpt-6-astra", "gb-gpt6"],
    ["gpt-6.1", "gpt61-fusion"],
    ["gpt-5.6-sol", "gb-gpt54"],
    ["gpt-5.6-terra", "gb-gpt54"],
    ["o3-mini", "gb-gpt54"],
    ["codex-mini", "gb-gpt54"],
    ["gpt-7-future", "gpt61-fusion"],
    ["gpt-10", "gpt61-fusion"],           // 未来 10 代（两位主版本，不被当粘连拆）
    ["deepseek-v4.1-flash", "xiaomajiang"],
    // ── GLM 5.3 与其余 GLM 同档（2026-11-09：族默认回 Pier 稿，全族走 glm 档）──
    ["glm-5.3", "glm"],
    ["glm-5.3-flash", "glm"],            // 本机 profile 实际挂的形态
    ["glm-5.3-flashx", "glm"],
    ["z-ai/glm-5.3-flash", "glm"],       // provider 前缀剥掉后同路
    ["glm5.3", "glm"],                   // 粘连写法
    // 负向：旧代次同样落通用 glm 档（确认没有前缀误吞）
    ["glm-5", "glm"],
    ["glm-5.1", "glm"],
    ["glm-5.2", "glm"],
    ["glm-5.30", "glm"],                 // (?!\d) 挡住未发布的多位版本号
    ["glm-4.6", "glm"],
    ["chatglm-6b", "glm"],               // chatglm 前缀同族
    ["zai/glm-4.6", "glm"],              // provider 前缀剥掉后同路
    ["kimi-k2", "gb-kimi"],
    ["kimi-k3-turbo", "gb-kimi"],
    ["kimi/kimi-latest", "gb-kimi"],
    ["swe-2", "gb-kimi"],               // swe 系也是 Kimi（用户 2026-10-13 指定）
    ["swe-1", "gb-kimi"],
    ["swe2", "gb-kimi"],                // 无连字符形态
    ["SWE-2", "gb-kimi"],               // 大小写归一后同形
    ["kimi-swe-2", "gb-kimi"],          // kimi 前缀形态
    ["sweet-romance", "xiaomajiang"],        // sweet-* 不是 swe 系，不吃
    ["claude-opus-5-5", "claude-opus55"],
    ["claude-sonnet-4-5", "claude-opus55"],
    ["grok-4.6", "grok"],
    ["grok-4.7", "grok"],
    ["x-ai/grok-4.7", "grok"],
    // ── Xiaomi MiMo（2026-10-16 新增族） ─────────────────────────────────────
    ["mimo-v2.6-pro", "mimo"],        // 本机 profile 实际挂的形态
    ["mimo-v2.6-flash", "mimo"],
    ["xiaomi/mimo-v2.6-pro", "mimo"], // provider 前缀剥掉后同路
    ["MiMo-V2.6-Flash", "mimo"],      // 大小写归一
    ["mimo-v2.5-pro", "mimo"],        // 旧代次同族
    ["xiao-mi-mimo", "xiaomajiang"],          // 锚定开头：变体名不吃
    // ── Meta Muse（2026-10-17 新增族） ──────────────────────────────────────
    ["muse-spark-1.3", "muse"],
    ["meta/muse-spark-1.3", "muse"],
    ["opencode/muse-spark-1.3", "muse"],
    ["muse-spark-1.3-contributor", "muse"],
    ["muse-spark-1.3-contributor-free", "muse"],
    ["Muse-Spark-1.2", "muse"],
    ["muse-spark-1.1", "muse"],
    ["muse-wonder-1.0", "muse"],
    ["meta-llama-3.3-70b", "xiaomajiang"],               // 只锚 ^muse：同厂异族不吞
    ["metamuse", "xiaomajiang"],                         // 锚定开头：粘连变体名不吃
    // ── Google Gemini（2026-10-20 新增族：用户只用 4 Argon 与 3.8 Flash）────
    ["gemini-4-argon", "gemini4"],                // 本机 profile 实际挂的形态
    ["gemini-4", "gemini4"],                      // 裸代次
    ["gemini-3.8-flash-high", "gemini38"],         // 本机 antigravity provider 实际挂的形态
    ["gemini-3.8-flash", "gemini38"],
    ["gemini-3.8", "gemini38"],
    ["gemini-3.7-flash", "gemini38"],              // 更早代次同回落 gemini38
    ["gemini-3.5-flash", "gemini38"],
    ["google/gemini-4-argon", "gemini4"],         // provider 前缀剥掉后同路
    ["Google/Gemini-3.8-Flash-High", "gemini38"], // 大小写归一
    ["gemini-4-pro", "gemini4"],                  // 4.x 后续代次同走 gemini4
    ["gemma-3-27b", "xiaomajiang"],                   // 只锚 ^gemini：gemma 是异族，不吃
    ["gemma-2-9b", "xiaomajiang"],
    ["gemini", "gemini38"],                       // 裸 "gemini"（无代次）→ 回落通用 ENI 档
    // ── Qwen（2026-10-28 新增族）──────────────────────────────────────────
    ["qwen3.8-max", "qwen"],                      // 本机 opencode-go 实际挂的形态
    ["Qwen/Qwen3.8-Max", "qwen"],                 // provider 前缀 + 大小写归一
    ["bailian/qwen3.8-max", "qwen"],
    ["qwen/qwen3.7-max", "qwen"],
    ["qwen3.7-max", "qwen"],
    ["qwen3.7-plus", "qwen"],
    ["qwen-plus", "qwen"],                        // 无代次的商业档
    ["qwen-max", "qwen"],
    ["qwen-flash", "qwen"],
    ["qwen3-coder-plus", "qwen"],
    ["qwen3-vl-235b-a22b-instruct", "qwen"],      // 多模态同走：载荷与模态无关
    ["qwq-32b", "qwen"],                          // QwQ 是 Qwen 的推理型号
    ["[E]qwen3.8-max", "qwen"],                   // 方括号标记前缀
    ["qwen3-8b", "qwen"],                         // 小参数版同族
    ["qmodel", "xiaomajiang"],                    // 只锚 ^qwen/^qwq：q 系无关名不吃
    ["qfmodel", "xiaomajiang"],                   // 本机 qoder provider 的模型，不得被吞
    ["qoder-max", "xiaomajiang"],
    // ── 方括号标记前缀（2026-10-27 修：本机 profile 点名带 [E] / [ais逆-思考优化]）────
    // 这些标记挡住 ^gemini 之类的开头锚定，曾让 gemini4 静默降级到 dsh 族（吃当时族默认稿），
    // 表现为「gemini4 的稿从来没生效过」。normalizeModelId 现在剥前导 [..] 段。
    ["[E]gemini-4-argon", "gemini4"],             // 本机 profile 实际挂载形态
    ["[ais逆-思考优化]gemini-3.8-flash-high", "gemini38"],
    ["[E]gemini-3.8-flash-high", "gemini38"],
    ["google/[E]gemini-4-argon", "gemini4"],      // provider 前缀 + 标记叠加
    ["[E][X]gemini-4-argon", "gemini4"],          // 多个标记叠加
    ["[E]claude-opus-5-5", "claude-opus55"],
    ["[E]grok-4.7", "grok"],
    ["[E]glm-5.3", "glm"],       // glm 族默认 = glm（2026-11-09）
    ["[E]kimi-k3", "gb-kimi"],       // kimi 族默认 = gb-kimi
    ["[E]mimo-v2.6-pro", "mimo"],
    ["[E]muse-spark-1.3", "muse"],
    ["[E]gpt-6.1-sol", "gpt61-fusion"],   // gpt61 族默认 = gb-gpt6
    // 反向：尾随标记本来就匹配得上，剥前缀不得把它改坏
    ["gemini-4-argon[E]", "gemini4"],
    ["mygemini-4-argon", "xiaomajiang"],             // 锚定开头：仿冒名不吃
    ["gemini-3.8-flash-high", "gemini38"],        // 2026-10-20：新增 gemini 族后不再落 dsh 兜底
    ["", "xiaomajiang"],
    [undefined, "xiaomajiang"],
    // ── 写法变体：分隔符 / 大小写 / 前缀 / 后缀 ────────────────────────────
    ["GPT_6_1_SOL", "gpt61-fusion"],      // 下划线分隔 + 全大写
    ["gpt_6_1_sol", "gpt61-fusion"],      // 下划线分隔
    ["gpt6.1sol", "gpt61-fusion"],        // 连字符缺失
    ["gpt 6.1", "gpt61-fusion"],          // 空格分隔
    ["gpt.6.1.sol", "gpt61-fusion"],      // 点号分隔
    ["gpt-6.1-sol", "gpt61-fusion"],      // 标准
    ["GPT-6.1-SOL", "gpt61-fusion"],      // 全大写
    ["  gpt-6-sol  ", "gb-gpt6"],     // 首尾空白
    ["chatgpt-6.1", "gpt61-fusion"],      // chat 前缀
    ["ChatGPT_6_1", "gpt61-fusion"],      // chat + 下划线
    ["gpt-6.1-sol-2026-10", "gpt61-fusion"], // 日期后缀
    ["gpt-6.1-turbo", "gpt61-fusion"],    // 档位后缀
    ["gpt-6.1-sol-preview", "gpt61-fusion"],
    // ── 粘连：多位数按显式枚举还原（不是靠数值阈值猜） ─────────────────────
    ["gpt61", "gpt61-fusion"],
    ["gpt56", "gb-gpt54"],
    ["gpt41", "gb-gpt54"],            // 4.1 已淘汰，但解析正确 → 落旧代
    // ── provider 前缀 / 标签后缀 / 斜杠 ────────────────────────────────────
    ["openai/gpt-6", "gb-gpt6"],      // 不归一化会落到 dsh
    ["openai/gpt-6.1-sol", "gpt61-fusion"],
    ["a/b/c/gpt-6.1-sol", "gpt61-fusion"],// 多段斜杠
    ["openai/gpt-6.1-sol:free", "gpt61-fusion"], // 前缀 + 标签后缀
    ["/gpt-6", "gb-gpt6"],            // 前导斜杠
    ["gpt-6/", "gb-gpt6"],            // 尾随斜杠（不该退化成空串）
    ["  openai/gpt-6  ", "gb-gpt6"],  // 空白 + 斜杠混合
    ["openai/", "xiaomajiang"],            // 仅前缀无模型名
    ["anthropic/claude-opus-5-5", "claude-opus55"],
    // ── 小数代次（按数字段长度判定，不靠字典序） ──────────────────────────
    ["gpt-6", "gb-gpt6"],             // 裸 6 代无后缀
    ["gpt-6.10", "gpt61-fusion"],         // 两位 minor
    ["gpt-5.10", "gb-gpt54"],
    // ── 日期戳形态：3-4 位数字段是构建号，不是小版本 ──────────────────────
    ["gpt-4-0613", "gb-gpt54"],       // 不能被读成 4.0613
    ["gpt-6-0613", "gb-gpt6"],        // 不能被读成 6.0613
    ["gpt-4-turbo-2024-04-09", "gb-gpt54"],
    ["gpt-35-turbo", "gb-gpt54"],     // Azure 旧命名（枚举表里是 3.5）
    ["gpt-3.5-turbo", "gb-gpt54"],
    ["gpt-4o", "gb-gpt54"],
    ["gpt-4", "gb-gpt54"],
    // ── 家族判定锚定开头：仿冒名不吃 ───────────────────────────────────────
    ["my-gpt-6-clone", "xiaomajiang"],
    ["a/b/my-gpt-6-clone", "xiaomajiang"],
    ["astra-whatever", "gb-gpt6"],    // astra 是 6 代命名
  ];
  for (const [model, want] of CASES) {
    const got = identify(primary({ agent: { options: { model } } }));
    check(got === want, `auto: ${String(model) || "(无 model)"} → ${want}`, `实得 ${got}`);
  }

  // ── 回归锁：会话实际模型必须优先于 agent.options ─────────────────────────
  // 根因记录（2026-10-09）：`agent.options` 在 new Agent() 时由 agentDefaultModel 固定
  // 且是 readonly，而会话内切换模型写的是 `model/selection` 事件 + session.requestHeader()。
  // 本机默认模型是 qoder/dfmodel，会话选的是 openai-codex/gpt-6.1-sol ——
  // 只读 agent.options 会把 GPT 会话判成非 GPT，表现为「auto 模式不分流」。
  // 官方对照：session-controller 的 selectionFor(agent).current 用同一条
  // 「pending → requestHeader().config → defaultModel」取值链。
  const sessionAgent = {
    options: { provider: "qoder", model: "dfmodel" },            // 创建时默认模型
    session: {
      requestHeader: () => ({ config: { provider: "openai-codex", model: "gpt-6.1-sol" } }),
    },
  };
  const viaSession = identify(primary({ agent: sessionAgent, scope: sessionAgent }));
  check(viaSession === "gpt61-fusion",
    "auto: 会话实际模型(gpt-6.1-sol) 优先于 agent.options 默认模型(dfmodel)",
    `实得 ${viaSession}`);
  // 反向：会话实际模型是 deepseek 时，即便 options 写着 gpt 也不能误判
  const sessionDeepseek = {
    options: { provider: "gpt", model: "gpt-6.1-sol" },
    session: { requestHeader: () => ({ config: { provider: "qoder", model: "dfmodel" } }) },
  };
  const viaSession2 = identify(primary({ agent: sessionDeepseek, scope: sessionDeepseek }));
  check(viaSession2 === "xiaomajiang",
    "auto: 会话实际模型(dfmodel) 优先，不被 agent.options 的 gpt 名盖过",
    `实得 ${viaSession2}`);
  // 兜底：会话尚未发出请求（无 requestHeader）且默认模型服务没给值时，回落 agent.options
  const freshAgent = { options: { provider: "gpt", model: "gpt-6-sol" }, session: {} };
  const viaFallback = identify(primary({ agent: freshAgent, scope: freshAgent }));
  check(viaFallback === "gb-gpt6",
    "auto: 无 requestHeader 时回落 agent.options",
    `实得 ${viaFallback}`);

  // ── 回归锁：首步（无 requestHeader）必须读「当前默认模型」，不能读陈旧的 agent.options ──
  // 根因记录（2026-10-09 实测）：某新会话首步注入了 GPT 载荷而它用的是 deepseek 模型 ——
  // 因为首步时本会话还没写过 request/header，而 agent.options 停在 agent 创建时的旧模型上
  // （options 是 readonly，用户切过默认模型也不会更新）。修法：中间加一层
  // agentDefaultModel.currentSelection()（官方 selectionFor 的第三级）。
  defaultModelPick = { provider: "deepseek-official", model: "deepseek-flash" };
  const firstStepAgent = {
    options: { provider: "openai-codex", model: "gpt-6.1-sol" },   // 陈旧值
    session: { requestHeader: () => undefined },                    // 首步：无 header
  };
  const viaFirstStep = identify(primary({ agent: firstStepAgent, scope: firstStepAgent }));
  check(viaFirstStep === "xiaomajiang",
    "auto 首步: 读当前默认模型(deepseek-flash)，而非陈旧的 agent.options(gpt-6.1-sol)",
    `实得 ${viaFirstStep}`);
  // 首步 + 当前默认模型是 GPT 时，应给 GPT 载荷
  defaultModelPick = { provider: "openai-codex", model: "gpt-6.1-sol" };
  const viaFirstStepGpt = identify(primary({ agent: firstStepAgent, scope: firstStepAgent }));
  check(viaFirstStepGpt === "gpt61-fusion",
    "auto 首步: 当前默认模型为 GPT 时给 GPT 载荷",
    `实得 ${viaFirstStepGpt}`);
  // requestHeader 仍优先于默认模型（已发过请求的会话不受默认模型影响）
  defaultModelPick = { provider: "openai-codex", model: "gpt-6.1-sol" };
  const loggedAgent = {
    options: {},
    session: { requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-flash" } }) },
  };
  const viaLogged = identify(primary({ agent: loggedAgent, scope: loggedAgent }));
  check(viaLogged === "xiaomajiang",
    "auto: requestHeader 优先于默认模型",
    `实得 ${viaLogged}`);

  // ── 回归锁（2026-11-07）：主代理首步读「本会话当前选择」，不被全局默认盖掉 ──
  // 现场：system/message(seq 10) 早于 request/header(seq 17)，而 model/selection(seq 3-5)
  // 已写入 → 官方 agent.model.current() = pending ?? lastUsed ?? options。旧链跳过这层
  // 直接读 agentDefaultModel 全局服务，会话自己选的模型被盖掉 = 首步吃错稿。
  defaultModelPick = { provider: "deepseek-official", model: "deepseek-flash" };  // 全局默认 = DSH
  const firstStepSelectedGpt = {
    options: { provider: "deepseek-official", model: "deepseek-flash" },
    model: { current: () => ({ provider: "openai-codex", model: "gpt-6.1-sol" }) },  // 会话选了 GPT
    session: { requestHeader: () => undefined },
  };
  check(identify(primary({ agent: firstStepSelectedGpt })) === "gpt61-fusion",
    "auto 首步: 会话当前选择(gpt-6.1-sol) 盖过全局默认(deepseek-flash)",
    `实得 ${identify(primary({ agent: firstStepSelectedGpt }))}`);
  // 反向：会话选 DSH、全局默认是 GPT → 仍按会话选择
  defaultModelPick = { provider: "openai-codex", model: "gpt-6.1-sol" };
  const firstStepSelectedDsh = {
    options: { provider: "openai-codex", model: "gpt-6.1-sol" },
    model: { current: () => ({ provider: "deepseek-official", model: "deepseek-flash" }) },
    session: { requestHeader: () => undefined },
  };
  check(identify(primary({ agent: firstStepSelectedDsh })) === "xiaomajiang",
    "auto 首步: 会话当前选择(deepseek-flash) 盖过全局默认(gpt-6.1-sol)",
    `实得 ${identify(primary({ agent: firstStepSelectedDsh }))}`);
  // model.current() 抛错 / 返回空 → 仍回落全局默认服务（不因新层丢兜底）
  const projectionNotReady = {
    options: { provider: "openai-codex", model: "gpt-6.1-sol" },
    model: { current: () => { throw new Error("projection not ready"); } },
    session: { requestHeader: () => undefined },
  };
  check(identify(primary({ agent: projectionNotReady })) === "gpt61-fusion",
    "auto 首步: 投影未就绪时回落全局默认模型服务",
    `实得 ${identify(primary({ agent: projectionNotReady }))}`);
  // 没选模型时 model.current() 经动态 options getter 给当前默认（模拟宿主行为）
  const noSelection = {
    model: { current: () => ({ provider: "deepseek-official", model: "deepseek-flash" }) },
    session: { requestHeader: () => undefined },
  };
  check(identify(primary({ agent: noSelection })) === "xiaomajiang",
    "auto 首步: 无显式选择时按当前默认值取默认稿",
    `实得 ${identify(primary({ agent: noSelection }))}`);
  defaultModelPick = {};   // 还原桩，避免影响后续用例

  // 镜像槽位：GPT 系必须为空串，自持族必须非空
  for (const [model, wantEmpty] of [["gpt-6.1-sol", true], ["gpt-6-sol", true], ["gpt-7-x", true], ["mimo-v2.6-pro", true], ["muse-spark-1.3", true], ["muse-wonder-1.0", true], // 2026-10-27：dsh 族默认改指 enilime（外部稿）→ 由双段变单段
    ["deepseek-v4.1-flash", true]]) {
    const text = reinforce({ agent: { options: { model } } });
    check((text.length === 0) === wantEmpty,
      `reinforce: ${model} ${wantEmpty ? "应为空串（单段）" : "应非空（双段）"}`,
      `实长 ${text.length}`);
  }

  // 手动模式：指定 gpt56，模型是 deepseek 也要走 gpt56
  const manual = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "gpt56" });
  check(manual?.ok === true && manual?.mode === "manual", "POST mode=manual", JSON.stringify(manual));
  const gotManual = identify(primary({ agent: { options: { model: "deepseek-v4.1-flash" } } }));
  check(gotManual === "gpt56", "manual: 指定 gpt56 时 deepseek 也走 gpt56", `实得 ${gotManual}`);

  // 手动模式下镜像槽位：载荷非自持族 → 空串
  const manReinforce = reinforce({ agent: { options: { model: "deepseek-v4.1-flash" } } });
  check(manReinforce.length === 0, "manual(gpt56): 镜像槽位为空串", `实长 ${manReinforce.length}`);

  // ── 0.7.0：备用自持档 dsh-gen4 —— 手动选中它时必须双段且两段同源 ──────────
  const backGen4 = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "dsh-gen4" });
  check(backGen4?.ok === true, "POST mode=manual + manualPayload=dsh-gen4", JSON.stringify(backGen4));
  const ctxDeepseek = { agent: { options: { model: "deepseek-v4.1-flash", provider: "deepseek" } } };
  const g4Primary = primary(ctxDeepseek);
  const g4Reinforce = reinforce(ctxDeepseek);
  check(identify(g4Primary) === "dsh-gen4",
    "manual(dsh-gen4): 选中的是原契约稿", `实得 ${identify(g4Primary)}`);
  check(g4Reinforce === g4Primary,
    "manual(dsh-gen4): 镜像槽位与主槽位同源逐字一致",
    `长度 ${g4Reinforce.length} vs ${g4Primary.length}`);
  // ── xiaomajiang：小码酱稿（外部稿，单段；手动可选）──────────────────────
  const backXmj = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "xiaomajiang" });
  check(backXmj?.ok === true, "POST mode=manual + manualPayload=xiaomajiang", JSON.stringify(backXmj));
  const xmjPrimary = primary(ctxDeepseek);
  check(identify(xmjPrimary) === "xiaomajiang",
    "manual(xiaomajiang): 选中小码酱稿", `实得 ${identify(xmjPrimary)}`);
  check(reinforce(ctxDeepseek) === "",
    "manual(xiaomajiang): 整份契约稿按单段注入（镜像空）");
  // ── glm53cn：GLM-5.3 中文自持稿（双段；ENI LIME 档已于 2026-10-18 下线）────
  const backGlm53cn = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "glm53cn" });
  check(backGlm53cn?.ok === true, "POST mode=manual + manualPayload=glm53cn", JSON.stringify(backGlm53cn));
  const g53cnPrimary = primary(ctxDeepseek);
  const g53cnReinforce = reinforce(ctxDeepseek);
  check(identify(g53cnPrimary) === "glm53cn",
    "manual(glm53cn): 选中 GLM-5.3 中文沙箱稿", `实得 ${identify(g53cnPrimary)}`);
  check(g53cnReinforce === g53cnPrimary,
    "manual(glm53cn): 镜像槽位与主槽位同源逐字一致",
    `长度 ${g53cnReinforce.length} vs ${g53cnPrimary.length}`);
  // 反向：外部档在手动模式下也必须单段
  const backClaude = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "claude" });
  check(backClaude?.ok === true, "POST mode=manual + manualPayload=claude", JSON.stringify(backClaude));
  check(identify(primary(ctxDeepseek)) === "claude", "manual(claude): 选中 Claude 载荷");
  check(reinforce(ctxDeepseek).length === 0, "manual(claude): 镜像槽位为空串（单段）");
  // 非自持档的主/镜像槽位组合：无论模型是谁都单段
  const backGrok = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "grok" });
  check(backGrok?.ok === true, "POST mode=manual + manualPayload=grok", JSON.stringify(backGrok));
  check(identify(primary(ctxDeepseek)) === "grok", "manual(grok): 选中 Grok 载荷");
  check(reinforce(ctxDeepseek).length === 0, "manual(grok): 镜像槽位为空串（单段）");
  // ── enilime：ENI LIME 通用稿（外部稿 → 恒单段；手动可选）──────────────────
  const backEni = await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "enilime" });
  check(backEni?.ok === true, "POST mode=manual + manualPayload=enilime", JSON.stringify(backEni));
  const eniPrimary = primary(ctxDeepseek);
  check(identify(eniPrimary) === "enilime",
    "manual(enilime): 选中 ENI LIME 稿", `实得 ${identify(eniPrimary)}`);
  check(reinforce(ctxDeepseek).length === 0,
    "manual(enilime): 镜像槽位为空串（外部稿恒单段）",
    `实长 ${reinforce(ctxDeepseek).length}`);

  // 切回 auto
  const back = await call("POST", "/dsh-switch-armor/settings", { mode: "auto" });
  check(back?.ok === true && back?.mode === "auto", "POST mode=auto 切回", JSON.stringify(back));

  // ── 0.10.0：按模型族覆盖 + 自定义载荷 ─────────────────────────────────────
  // glm 族 → dsh-gen4（覆盖默认的 glm 档）
  const ovGen4 = await call("POST", "/dsh-switch-armor/settings", { modelOverrides: { glm: { payload: "dsh-gen4" } } });
  check(ovGen4?.ok === true, "POST modelOverrides: glm→dsh-gen4", JSON.stringify(ovGen4?.modelOverrides));
  check(identify(primary({ agent: { options: { model: "glm-4.6" } } })) === "dsh-gen4",
    "override: glm-4.6 走 dsh-gen4（覆盖 glm 档）");
  // 双段强制：glm 族 override.dualLayer=true → 显式覆盖，镜像非空
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: { glm: { payload: "dsh-gen4", dualLayer: true } } });
  check(reinforce({ agent: { options: { model: "glm-4.6" } } }).length > 0,
    "override: glm dualLayer=true 强制双段（镜像非空）");
  // 双段强制关：kimi 族 override.dualLayer=false → 即便选中自持族也单段
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: { kimi: { payload: "dsh", dualLayer: false } } });
  const kimiCtx = { agent: { options: { model: "kimi-k2" } } };
  check(identify(primary(kimiCtx)) === "dsh", "override: kimi→dsh（覆盖 kimi 档）");
  check(reinforce(kimiCtx).length === 0, "override: kimi dualLayer=false 强制单段（镜像空）");
  // custom 载荷：文本来自 customPayload.text
  await call("POST", "/dsh-switch-armor/settings", {
    modelOverrides: { glm: { payload: "custom" } },
    customPayload: { text: "CUSTOM-PAYLOAD-SMOKE-TEXT-0X0A" },
  });
  const customText = primary({ agent: { options: { model: "glm-4.6" } } });
  check(customText.includes("CUSTOM-PAYLOAD-SMOKE-TEXT-0X0A"), "override: glm→custom 用输入框文本");
  // custom 未配置文本 → 回落 dsh（绝不注入空串）
  await call("POST", "/dsh-switch-armor/settings", { customPayload: { text: "" } });
  check(identify(primary({ agent: { options: { model: "glm-4.6" } } })) === "dsh",
    "override: custom 空文本 → 回落 dsh");
  // 非法族名 / 非法 payload / 非法类型被清洗丢弃
  const dirty = await call("POST", "/dsh-switch-armor/settings", {
    modelOverrides: { "Bad Family!": { payload: "dsh" }, glm: { payload: "nope" }, kimi: { dualLayer: "yes" } },
  });
  check(dirty?.ok === true
    && dirty?.modelOverrides?.["Bad Family!"] === undefined
    && dirty?.modelOverrides?.glm === undefined
    && dirty?.modelOverrides?.kimi === undefined,
    "override 清洗：非法族名/payload/类型全被丢弃", JSON.stringify(dirty?.modelOverrides));
  // 清空覆盖：glm 回到默认档
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: {} });
  check(identify(primary({ agent: { options: { model: "glm-4.6" } } })) === "glm",
    "override 清空后 glm 回到默认档（2026-11-09 起为 glm）");
  // ── 5.3 与其余 GLM 同族同档：glm 族覆盖对它同样生效 ──────────────────────
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: { glm: { payload: "glm53cn", dualLayer: true } } });
  const g53ctx = { agent: { options: { model: "glm-5.3-flash" } } };
  check(identify(primary(g53ctx)) === "glm53cn", "override: glm 族→glm53cn 时 5.3 跟随（同族同档）");
  check(reinforce(g53ctx).length > 0, "override: glm 族 dualLayer=true 时 5.3 也双段");
  check(identify(primary({ agent: { options: { model: "glm-4.6" } } })) === "glm53cn",
    "override: glm 族内 4.x 同样走覆盖");
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: {} });
  check(identify(primary(g53ctx)) === "glm",
    "override 清空后 glm-5.3-flash 回到默认档（2026-11-09 起为 glm）");
  // GET 含新字段
  const gotOv = await call("GET", "/dsh-switch-armor/settings");
  check(gotOv?.modelOverrides !== undefined && Array.isArray(gotOv?.overridePayloadIds) && gotOv.overridePayloadIds.includes("custom"),
    "GET /settings 含 modelOverrides 与 overridePayloadIds");

  // 非法载荷 id → 400
  const bad = await call("POST", "/dsh-switch-armor/settings", { manualPayload: "nope" });
  check(bad?.ok === false, "非法 manualPayload → 400", JSON.stringify(bad));

  // 空 body → 400（放宽校验后仍拒绝空请求）
  const empty = await call("POST", "/dsh-switch-armor/settings", {});
  check(empty?.ok === false, "空 patch → 400", JSON.stringify(empty));

  // GET 含新字段
  const got = await call("GET", "/dsh-switch-armor/settings");
  check(got?.mode === "auto" && Array.isArray(got?.payloads), "GET /settings 含 mode 与 payloads", JSON.stringify(got));

  // 关掉总开关 → 所有载荷空串
  await call("POST", "/dsh-switch-armor/settings", { enabled: false });
  const offText = primary({ agent: { options: { model: "gpt-6.1-sol" } } });
  check(offText === "", "总开关关闭 → 零残留（空串）", `实长 ${offText.length}`);

  // ── 注入编排（v0.11.0）：注入文件 / baseline 策略 / 判拒续跑 ────────────────
  const injectRoot = join(tmpdir(), "dsh-switch-armor-inject-probe");
  rmSync(injectRoot, { recursive: true, force: true });
  mkdirSync(join(injectRoot, "switch-armor"), { recursive: true });
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = injectRoot;
  mod.__testClearInjectFileCache();
  const injectPath = mod.__testInjectFilePath();
  check(injectPath === join(injectRoot, "switch-armor", "inject.md"),
    "注入文件: 路径随 DSH_HOME 惰性解析", injectPath);

  // 打开总开关，回到 clean 状态
  await call("POST", "/dsh-switch-armor/settings", {
    enabled: true, mode: "auto", modelOverrides: {}, baselinePolicy: "always", injectFile: true,
  });
  const ctxDsh = { agent: { options: { model: "deepseek-v4.1-flash" } } };

  // ① 文件缺失 → 不影响分流（clean 状态下 dsh 族走 dsh 档）
  check(mod.__testReadInjectFile() === undefined, "注入文件: 缺失时 undefined");
  check(identify(primary(ctxDsh)) === "xiaomajiang", "注入文件: 缺失时按模型分流",
    `实得 ${identify(primary(ctxDsh))}`);

  // ② 写入文件 → 顶替分流载荷，且按外部内容单段
  writeFileSync(injectPath, "# 我的注入\n把这条当作唯一契约。\n", "utf8");
  mod.__testClearInjectFileCache();
  const withFile = primary(ctxDsh);
  check(withFile.includes("我的注入"), "注入文件: 非空时顶替分流载荷", `实得 ${withFile.slice(0, 24)}`);
  check(reinforce(ctxDsh) === "", "注入文件: 外部内容按单段注入（镜像空）");

  // ③ 显式选择优先：manual / 族覆盖都不被文件顶替
  await call("POST", "/dsh-switch-armor/settings", { mode: "manual", manualPayload: "xiaomajiang" });
  check(identify(primary(ctxDsh)) === "xiaomajiang", "注入文件: manual 显式选择优先");
  await call("POST", "/dsh-switch-armor/settings", { mode: "auto", modelOverrides: { dsh: { payload: "glm53cn" } } });
  check(identify(primary(ctxDsh)) === "glm53cn", "注入文件: 族覆盖（显式）优先");
  await call("POST", "/dsh-switch-armor/settings", { modelOverrides: {} });

  // ④ baseline 策略三态
  await call("POST", "/dsh-switch-armor/settings", { baselinePolicy: "always" });
  check(!primary(ctxDsh).includes("[workspace-baseline]"), "baseline: always 不声明");
  await call("POST", "/dsh-switch-armor/settings", { baselinePolicy: "fallback" });
  check(primary(ctxDsh).includes("[workspace-baseline]"), "baseline: fallback + 注入文件时声明");
  rmSync(injectPath, { force: true });
  mod.__testClearInjectFileCache();
  check(!primary(ctxDsh).includes("[workspace-baseline]"), "baseline: fallback 无用户内容时不声明");
  await call("POST", "/dsh-switch-armor/settings", { baselinePolicy: "strict" });
  check(primary(ctxDsh).includes("[workspace-baseline]"), "baseline: strict 总是声明");
  await call("POST", "/dsh-switch-armor/settings", { baselinePolicy: "always" });

  // ⑤ injectFile=false → 文件层整体关闭
  writeFileSync(injectPath, "# 我的注入\n", "utf8");
  mod.__testClearInjectFileCache();
  await call("POST", "/dsh-switch-armor/settings", { injectFile: false });
  check(identify(primary(ctxDsh)) === "xiaomajiang", "注入文件: 开关关闭后回落按模型分流",
    `实得 ${identify(primary(ctxDsh))}`);
  await call("POST", "/dsh-switch-armor/settings", { injectFile: true });
  rmSync(injectPath, { force: true });
  mod.__testClearInjectFileCache();

  // ⑥ 判拒续跑纯函数（接线在真实宿主里由 agent/turn-stopping + agent.steer 完成）
  check(mod.__testShouldRetry("refusal", 0, 1, 0) === true, "续跑判定: refusal 且未超限 → 续跑");
  check(mod.__testShouldRetry("refusal", 1, 1, 0) === false, "续跑判定: 已达上限 → 停");
  check(mod.__testShouldRetry("pass", 0, 1, 0) === false, "续跑判定: pass 不续跑");
  check(mod.__testShouldRetry("refusal", 0, 1, 1) === false, "续跑判定: 子代理（depth>0）跳过");
  check(mod.__testShouldRetry("refusal", 0, 0, 0) === false, "续跑判定: retryMax=0 关闭");

  // ⑦ lastAssistantText：只取最后一条 assistant 的文本块
  const fakeAgent = {
    session: {
      deriveMessages: () => ([
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "抱歉，我不能" }] },
      ]),
    },
  };
  check(mod.__testLastAssistantText(fakeAgent) === "抱歉，我不能", "续跑: 取最后一条 assistant 文本");
  check(mod.__testLastAssistantText({}) === undefined, "续跑: 结构缺失时 undefined（不抛）");

  // 还原环境
  if (prevHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = prevHome;
  mod.__testClearInjectFileCache();
} else {
  check(false, "index.js 需导出 __testRoute 供离线探针调用");
}

console.log("\n=== 载荷分流探针结果 ===");
for (const p of passes) console.log("  ✅ " + p);
for (const f of failures) console.log("  ❌ " + f);
console.log(`\n结果: ${passes.length} 通过, ${failures.length} 失败`);
process.exit(failures.length === 0 ? 0 : 1);
