/**
 * 系统测试清单 · 可自动化部分（第1/2/5/7关核心）
 * 运行: node _run_checklist.js
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const dir = __dirname;

function loadXlsx() {
  const xlsxPath = path.join(dir, "xlsx.full.min.js");
  const code = fs.readFileSync(xlsxPath, "utf8");
  const m = new Module(xlsxPath);
  m.filename = xlsxPath;
  m.paths = Module._nodeModulePaths(dir);
  m._compile(code, xlsxPath);
  return m.exports;
}

function readSheet(XLSX, file) {
  const buf = fs.readFileSync(path.join(dir, file));
  const wb = XLSX.read(buf, { type: "buffer", raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
}

function scoreHeader(header) {
  const HEADER_HINTS = {
    姓名: ["姓名", "名字", "联系人", "客户", "负责人", "用户名", "寄件人", "收件人", "签收人", "收派员"],
    手机号: ["手机", "电话", "联系方式", "寄件电话", "收件电话"],
    身份证: ["身份证", "证件号", "证件号码", "身份证号"],
    地址: ["地址", "寄件地址", "收件地址"],
    金额: ["金额", "运费", "代收货款"],
    工号: ["工号", "员工工号", "员工编号"],
    运单号: ["运单号", "运单", "快递单号"],
    月结账号: ["月结", "月结账号", "月结卡号"],
    车牌号: ["车牌", "车牌号"],
    网点: ["网点", "所属网点"]
  };
  const h = String(header || "").toLowerCase();
  let best = { type: "普通", score: 0 };
  for (const [type, keys] of Object.entries(HEADER_HINTS)) {
    if (keys.some((k) => h.includes(k.toLowerCase()))) {
      const score = 80;
      if (score > best.score) best = { type, score };
    }
  }
  return best;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? " — " + detail : ""));
}

const XLSX = loadXlsx();

// 第1关：表格读取
const a = readSheet(XLSX, "测试_运单明细.xlsx");
check("1.1 表A 行数=6(含表头)", a.length === 6, "rows=" + a.length);
check("1.2 运单号完整12位", String(a[1][0]) === "401234567801", String(a[1][0]));
check("1.3 无科学计数法", !/e\+/i.test(String(a[1][0])) && !String(a[1][0]).endsWith("000"), String(a[1][0]));

const b = readSheet(XLSX, "测试_员工信息.xlsx");
check("1.4 表B 身份证18位", String(b[1][3]).length === 18, String(b[1][3]));

// 第2关：列识别
const expectA = {
  运单号: "运单号",
  寄件人: "姓名",
  寄件电话: "手机号",
  寄件地址: "地址",
  收件人: "姓名",
  收件电话: "手机号",
  收件地址: "地址",
  "运费(元)": "金额",
  "代收货款(元)": "金额",
  员工工号: "工号",
  月结账号: "月结账号"
};
let colOk = true;
a[0].forEach((h, i) => {
  if (!expectA[h]) return;
  const det = scoreHeader(h);
  const ok = det.type === expectA[h];
  if (!ok) colOk = false;
  check("2.列 " + h + " -> " + expectA[h], ok, "got=" + det.type);
});
check("2.重量不误判为工号/运单", scoreHeader("重量(kg)").type === "普通", scoreHeader("重量(kg)").type);

const expectB = { 工号: "工号", 姓名: "姓名", 手机号: "手机号", 身份证号: "身份证", 车牌号: "车牌号", 所属网点: "网点" };
Object.keys(expectB).forEach((h) => {
  const det = scoreHeader(h);
  check("2B.列 " + h + " -> " + expectB[h], det.type === expectB[h], "got=" + det.type);
});

// 第5/7关：文本扫描（迷你规则引擎）
const cfg = JSON.parse(fs.readFileSync(path.join(dir, "顺丰规则配置.json"), "utf8"));
const text = fs.readFileSync(path.join(dir, "测试_路由轨迹.txt"), "utf8");

function contextBoost(text, start, contextWords) {
  if (!contextWords || !contextWords.length) return 0;
  const prefix = text.slice(Math.max(0, start - 24), start);
  return contextWords.some((w) => prefix.includes(w)) ? 0.35 : 0;
}

function scan(text, rules, denyList, allowValues) {
  const hits = [];
  for (const rule of rules) {
    const re = new RegExp(rule.regex, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      let score = rule.score;
      const val = m[0];
      if (allowValues.some((a) => a === val)) continue;
      const boost = contextBoost(text, m.index, rule.context || []);
      if (boost) score = Math.min(1, Math.max(0.4, score + boost));
      hits.push({ type: rule.type, text: val, score, start: m.index });
    }
  }
  denyList.forEach((word) => {
    let idx = 0;
    while ((idx = text.indexOf(word, idx)) !== -1) {
      hits.push({ type: "网点", text: word, score: 0.9, start: idx });
      idx += word.length;
    }
  });
  return hits.filter((h) => h.score >= 0.5);
}

const rules = [
  { type: "手机号", regex: "(?<!\\d)1[3-9]\\d{9}(?!\\d)", score: 0.6, context: ["电话", "手机"] },
  ...cfg.customRegex
];
const hits = scan(text, rules, cfg.denyList, cfg.allowValues);
const texts = hits.map((h) => h.text);
check("5/7 运单号命中", texts.includes("401234567801"));
check("5/7 工号命中(有上下文)", texts.includes("01023456"), texts.filter((t) => /^\d{8}$/.test(t)).join(","));
check("5/7 手机命中", texts.includes("13800138000"));
check("5/7 中转场命中", texts.includes("深圳宝安中转场") && texts.includes("广州白云中转场"));
check("7 allowValues 顺丰速运不在命中值", !texts.includes("顺丰速运") && !texts.includes("顺丰"));
check("7 日期20250115不被当工号", !texts.includes("20250115") && !hits.some((h) => h.text === "20250115"));

// 孤立8位数字无上下文
const orphan = scan("日期20250115金额10000000", rules, [], []);
check("坑3 无上下文8位不命中", !orphan.some((h) => h.type === "工号" && h.score >= 0.5), JSON.stringify(orphan));

// 身份证校验附录D
function validateId(id) {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const C = "10X98765432";
  const body = id.slice(0, 17);
  let s = 0;
  for (let i = 0; i < 17; i++) s += parseInt(body[i], 10) * W[i];
  return C[s % 11] === id[17].toUpperCase();
}
check("附录D 样例身份证合法", validateId("11010519491231002X"));
check("表B 身份证抽查合法", validateId(String(b[1][3])) || validateId(String(b[3][3])), String(b[1][3]) + " / " + b[3][3]);

const failed = results.filter((r) => !r.ok);
console.log("\n==== 汇总: " + (results.length - failed.length) + "/" + results.length + " 通过 ====");
if (failed.length) {
  console.log("失败项:");
  failed.forEach((f) => console.log(" - " + f.name + " " + f.detail));
  process.exitCode = 1;
} else {
  console.log("可自动化项全部通过。请在浏览器按清单完成拖放/导出/回灌等交互项。");
}
