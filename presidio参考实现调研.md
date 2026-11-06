# Presidio（microsoft/presidio，main 分支）参考实现调研

> 调研时间：本次会话。注意：仓库已迁移到 `data-privacy-stack/presidio`，`microsoft/presidio` 的 URL 会自动 301 重定向，raw 链接仍可用。
> 重要事实修正：**官方 main 分支（及 2.2.356 等旧 tag）没有内置任何中国识别器**——`predefined_recognizers/` 下按 `country_specific/`（18 国：au/ca/fi/de/in/it/kr/ng/ph/pl/sg/za/es/se/th/tr/uk/us）+ `generic/` 组织，**没有 cn/zh 目录**。中文手机号/身份证识别器属于社区实现（本文引用 jerryluo.com 的实战实现，其机制与 presidio 扩展点完全一致）。

---

## A. 直接可抄的正则/代码片段

### A1. 中文手机号（社区实现，官方无内置）
```python
Pattern(name="中国大陆手机号", regex=r"(?<!\d)1[3-9]\d{9}(?!\d)", score=0.6)
context=["手机", "电话", "联系方式", "号码", "手机号"]
```
**关键坑**：中文里 `\b` 失效（汉字属于 `\w`，"手机13800138000" 中 `机1` 之间无边界），必须用 `(?<!\d)`/`(?!\d)` 环视替代——照抄英文教程的正则会静默失效。

### A2. 身份证号（GB 11643-1999，18 位，社区实现）
```python
# 6 地址码 + 8 出生日期 + 3 顺序码 + 1 校验位
regex = r"(?<![0-9Xx])\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![0-9Xx])"
# 弱正则先给 0.1 分，靠校验位与上下文词提分

WEIGHTS    = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
CHECK_CODES = "10X98765432"
def validate(text):  # validate_result 的语义
    if len(text) != 18: return False
    body, check = text[:17], text[17].upper()
    if not body.isdigit(): return False
    return CHECK_CODES[sum(int(d)*w for d, w in zip(body, WEIGHTS)) % 11] == check
```
`validate_result` 三态语义（presidio 通用机制）：
| 返回 | 含义 | 分数变化 |
|---|---|---|
| `True` | 校验通过 | 提到 `MAX_SCORE`(1.0) |
| `False` | 校验失败 | 降到 `MIN_SCORE`(0)，结果被丢弃 |
| `None` | 无法判断 | 保持正则原始分 |

校验位是「杀误报利器」：18 位订单号形状对了但校验算不对，直接丢。

### A3. 邮箱（官方 `generic/email_recognizer.py`，0.5 分）
```python
r"\b((([!#$%&'*+\-/=?^_`{|}~\w])|([!#$%&'*+\-/=?^_`{|}~\w][!#$%&'*+\-/=?^_`{|}~\.\w]{0,}[!#$%&'*+\-/=?^_`{|}~\w]))[@]\w+(?:-+\w+)*(?:\.\w+(?:-+\w+)*)+)\b"
```
配套校验：`tldextract.extract(pattern_text).fqdn != ""`（域名必须可提取出 FQDN）。

### A4. 银行卡 Luhn（官方 `generic/credit_card_recognizer.py`，弱正则 0.3 分）
```python
r"\b(?!1\d{12}(?!\d))((4\d{3})|(5[0-5]\d{2})|(6\d{3})|(1\d{3})|(3\d{3}))[- ]?(\d{3,4})[- ]?(\d{3,4})[- ]?(\d{3,5})\b"

@staticmethod
def __luhn_checksum(sanitized_value: str) -> bool:
    def digits_of(n): return [int(dig) for dig in str(n)]
    digits = digits_of(sanitized_value)
    odd_digits = digits[-1::-2]; even_digits = digits[-2::-2]
    checksum = sum(odd_digits)
    for d in even_digits: checksum += sum(digits_of(str(d * 2)))
    return checksum % 10 == 0
```
匹配前先 `sanitize_value(text, [("-",""), (" ","")])` 去掉分隔符再算校验。

### A5. IBAN（官方 `generic/iban_recognizer.py`，0.5 分）
通用形状（3 个捕获组实现「从长到短回退校验」，避免尾部假阳性）：
```python
r"(?<![A-Z0-9])([A-Z]{2}[0-9]{2}(?:[ -]?[A-Z0-9]{4}){2,6})((?:[ -]?[A-Z0-9]{4})?)((?:[ -]?[A-Z0-9]{1,3})?)(?![A-Z0-9])"
```
校验位算法（MOD-97）：
```python
LETTERS = {ord(d): str(i) for i, d in enumerate(string.digits + string.ascii_uppercase)}
def __number_iban(iban, letters): return (iban[4:] + iban[:4]).translate(letters)
def __generate_iban_check_digits(iban, letters):
    transformed = (iban[:2] + "00" + iban[4:]).upper()
    return f"{98 - (int(__number_iban(transformed, letters)) % 97):0>2}"
# 有效条件：算出的校验位 == pattern_text[2:4]，且国家码在 iban_patterns.regex_per_country（80+ 国家格式表）中
```

### A6. 金额
**官方没有任何金额/货币识别器**（generic 下只有 credit_card/crypto/date/email/iban/ip/mac/phone/url/uuid）。需自写，建议模式（自拟，非 presidio）：
```python
Pattern("金额", r"(?<![0-9.])(?:¥|￥|CNY\s?)?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?![0-9.])", 0.3)
context=["金额","元","￥","¥","合计","费用"]
```
中文场景同样用环视而非 `\b`。

### A7. 官方通用电话（非正则，用 python-phonenumbers 库）
`PhoneRecognizer`（SCORE=0.4）：`phonenumbers.PhoneNumberMatcher(text, region, leniency=1)`，默认区域 `("US","GB","DE","FR","IL","IN","CA","BR")`，leniency 0-3（0 最宽松）。CONTEXT=`["phone","number","telephone","cell","cellphone","mobile","call"]`。→ 我们单文件工具无第三方库，建议用正则版（A1）。

---

## B. 上下文词增强机制

文件：`context_aware_enhancers/lemma_context_aware_enhancer.py`（默认与 `PhraseContextAwareEnhancer` 组成 Composite 一起用）。

**默认参数**：`context_similarity_factor=0.35`、`min_score_with_context_similarity=0.4`、`context_prefix_count=5`（实体前取 5 词）、`context_suffix_count=0`（实体后不取）、`context_matching_mode="substring"`（可选 "whole_word"）。

**流程**：
1. 用 spaCy 分词+词形还原（lemma），按匹配的 start 定位 token，取其前 5 个词的 lemma；
2. 与识别器声明的 `context` 词表做子串/全词匹配（小写化）；
3. 命中：`score += 0.35`，再 `score = max(score, 0.4)`，封顶 1.0；
4. 结果里打 `recognition_metadata["is_score_enhanced_by_context"]=True`，防止 recognizer 层与 enhancer 层重复加分；
5. `analysis_explanation.set_supportive_context_word(...)` 记录命中的词（可解释性）。

**官方词表示例**：
```python
# phone:  ["phone","number","telephone","cell","cellphone","mobile","call"]
# credit_card: ["credit","card","visa","mastercard","cc ","amex","discover","jcb","diners","maestro","instapayment"]
# email:  ["email"]
# iban:   ["iban","bank","transaction"]
# 中文（社区建议）: 手机 ["手机","电话","联系方式","号码","手机号"]；身份证 ["身份证","证件号","身份证号","证件号码","身份证件"]
```
另有 `PhraseContextAwareEnhancer` 支持多词短语上下文（如 "driving licence" 匹配 "driving-licence"），中文词组（"身份证号"）也会经它匹配。词表就是普通字符串列表，可放 YAML（`context:` 字段）。

---

## C. 识别结果结构与打分流程

**结果结构**（`recognizer_result.py`）：
```python
RecognizerResult(entity_type, start, end, score, analysis_explanation, recognition_metadata)
# recognition_metadata 键：recognizer_name / recognizer_identifier / is_score_enhanced_by_context
```
**Pattern**（`pattern.py`）：`Pattern(name, regex, score)`，score ∈ [0,1]，构造时编译校验正则合法性。**EntityRecognizer** 定义 `MIN_SCORE=0 / MAX_SCORE=1.0`。

**AnalyzerEngine.analyze() 决策流水线**（`analyzer_engine.py`）：
1. `registry.get_recognizers(language, entities, all_fields, ad_hoc_recognizers)` 按「实体+语言」筛选识别器（支持请求级 ad_hoc）；
2. 文本归一化（可选 text_normalizer，如全角→半角）→ 跑 NLP → 各识别器 `analyze()`；
3. `_enhance_using_context()`：先识别器自定义 `enhance_using_context`，再跑默认上下文增强器；
4. `__remove_low_scores()`：阈值优先级 = 请求 `score_threshold` > 实体级阈值 > 识别器 default 阈值 > 引擎 `default_score_threshold`(默认 0)；
5. `EntityRecognizer.remove_duplicates()`：去重、去 0 分、**同类型中「被包含且分数不更高」的结果丢弃**，最后按 score 降序；
6. `allow_list` 过滤（见 G）；
7. `return_decision_process=False` 时剥掉 analysis_explanation。

**打分三来源**：正则/模式基础分 → `validate_result` 三段式（True→1.0 / False→0 / None→原分）→ 上下文词 +0.35（下限 0.4）。

---

## D. 匿名化算子设计

`OperatorConfig("operator_name", params)`，JSON 形态 `{"type": "mask", "masking_char": "*", ...}`；按 entity_type 查配置，缺省走 `"DEFAULT"`；**引擎默认 DEFAULT = replace**（未配置任何 operators 时）。

| 算子 | 参数 | 默认/行为 |
|---|---|---|
| `mask` | `masking_char`(单字符) / `chars_to_mask`(int) / `from_end`(bool) | 默认从**头**开始掩 `chars_to_mask` 位（`from_end=False`）；`chars_to_mask` 超长时取 `min(len(text), n)` |
| `replace` | `new_value`(str) | 整体替换为 `new_value`；未给时输出 `<ENTITY_TYPE>` 占位 |
| `hash` | `hash_type`("sha256"/"sha512") / `salt` | sha256 默认；salt 缺省时每实体随机 32 字节（不可复现），显式提供须 ≥16 字节（可复现、可防彩虹表） |
| `encrypt` | `key`(str/bytes，128/192/256 bit) | AES-CBC + PKCS7，随机 IV，输出 urlsafe base64（详见 E） |
| `custom` | `lambda`(callable: str→str) | 对每个 PII 文本执行用户函数；返回值必须是 str |
| `keep` | 无 | 原样保留（用于「保留但追踪」） |
| `redact` | 无 | 彻底删除 |

**AnonymizerEngine.anonymize() 流程**：拷贝结果 → 按 (start,end) 排序 → 冲突消解（`MERGE_SIMILAR_OR_CONTAINED`：同类型相交合并为并集取最高分、被包含的丢弃；或 `REMOVE_INTERSECTIONS`：裁剪重叠区间）→ `merge_entities_with_spaces=True` 时同类实体仅隔空格则合并 → 补 DEFAULT 算子 → `_operate()`。

**核心替换逻辑**（`core/engine_base.py`）：结果按位置**倒序**逐个替换（`TextReplaceBuilder` 始终按原始文本坐标取值），保证替换后文本变长/变短不影响前面实体的 start/end；每次替换后归一化输出 item 坐标。返回 `EngineResult(text=脱敏文本, items=[OperatorResult(start, end, entity_type, text, operator, score)...])` —— 这个 items 就是现成的「脱敏坐标清单」，可做回灌。

---

## E. deanonymize 可逆机制（重点）

main 分支已内置 **`DeanonymizeEngine`**（`presidio_anonymizer/deanonymize_engine.py`）+ 两个 Deanonymize 型算子：`decrypt`、`deanonymize_keep`（工厂 `DEANONYMIZERS=[Decrypt, DeanonymizeKeep]`，与 ANONYMIZERS 分离注册）。

**encrypt 算子的确定性可逆机制**（`operators/encrypt.py` + `aes_cipher.py`）：
```python
# AESCipher.encrypt(key: bytes, text: str) -> str
encoded = text.encode("utf-8")
padded  = PKCS7(AES.block_size).padder()(encoded)        # PKCS7 填充
iv      = os.urandom(16)                                  # 随机 IV
ct      = AES(key).CBC(iv).encrypt(padded)
return base64.urlsafe_b64encode(iv + ct).decode()         # IV 直接拼在密文头部一起编码！

# AESCipher.decrypt(key, text):
raw  = base64.urlsafe_b64decode(text)
iv, ct = raw[:16], raw[16:]                               # 前 16 字节即 IV
plain = PKCS7.unpad(AES(key).CBC(iv).decrypt(ct)).decode("utf-8")
```
要点：
1. **key 由调用方传入并自行保管**（str 或 bytes，必须是 128/192/256 bit），presidio 自己不存 key、不存映射表；
2. **IV 内嵌于密文**（`base64(iv + ciphertext)`），所以密文是自描述的：只要持有同一 key，任意进程/任意时刻都能还原——确定性可逆、零状态；
3. `encrypt` 每次调用随机 IV → 同一原文两次加密密文不同（语义安全），但都能解密回同一原文；
4. **还原流程**：`DeanonymizeEngine().deanonymize(text=脱敏文本, entities=[OperatorResult(...)], operators={"entity": OperatorConfig("decrypt", {"key": key})})` —— 与 anonymize 共用同一 `EngineBase._operate` 倒序替换管线，只是从 ANONYMIZERS 换到 DEANONYMIZERS 工厂取算子。

**与我们方案「映射表还原 / AI 结果回灌」的对应**：
- presidio 的模型 = **对称密钥密码学可逆**（不存映射，跨进程可还原）；我们方案 = **映射表（token↔原文）还原**。两种都支持，presidio 官方甚至预留了映射表模式：`custom` 算子的 `validate()` 注释明确提到「stateful lambdas（例如累加 token→原文映射表用于 de-anonymization）」是合法用法（见 issue #2024），即用带状态的 lambda 一边替换一边攒映射表，之后用 `DeanonymizeKeep`/自定义回灌算子按映射还原；
- 回灌坐标：`EngineResult.items`（start/end/entity_type/text/operator）已按最终文本归一化，AI 处理完脱敏文本后，按 items 的 start/end 把原文/新值写回即可——我们的「AI 结果回灌」可直接复用这一结构（按坐标逆序替换，避免位移）。

---

## G. allow_list / deny_list 机制

- **allow_list**（analyze 请求级）：`analyze(..., allow_list=["李雷","梅梅"], allow_list_match="exact")`；`allow_list_match="regex"` 时把列表拼成 `"|".join()` 编译搜索（带 `REGEX_TIMEOUT_SECONDS` 超时）。命中的结果从 PII 结果中**移除**（视为合法保留）。exact 模式会先对 allow_list 项做与正文相同的文本归一化再比较。
- **deny_list**（识别器级，黑名单 = 更易误报的词表）：`PatternRecognizer(deny_list=["Mr.","Mrs."])`，YAML 里 `deny_list:` 字段（见 `conf/example_recognizers.yaml` 的 Titles 示例）。deny_list 命中即产生结果，多用于名字/头衔等难以正则的实体。
- **识别器配置化**：`RecognizerRegistry.add_recognizers_from_yaml(path)` / `add_pattern_recognizer_from_dict(dict)`，YAML 结构：`name / supported_language / supported_entity / patterns[name,regex,score] / context / deny_list / score_thresholds`；另支持 `supported_countries` 顶层过滤（`EntityRecognizer.COUNTRY_CODE` 类属性 + `country_code=` 构造参数）。
- 正则全局安全阀：`REGEX_TIMEOUT_SECONDS`（环境变量，默认 60s）——防 ReDoS 的硬超时，我们单文件工具建议照抄。

---

## F. 可借鉴点清单（借鉴点 → 我们方案里怎么用）

1. **`Pattern(name, regex, score)` 三元组 + `validate_result` 三态（True→1.0 / False→0 丢弃 / None→原分）** → 我们的规则表每条规则自带「正则 + 校验函数」，身份证/银行卡/IBAN 用校验位直接杀误报，而不是只调阈值。
2. **上下文词加分：命中 `+0.35`、下限 0.4、封顶 1.0，`is_score_enhanced_by_context` 防重复加分** → 中文词表直接照搬（"手机/电话/联系方式/号码"、"身份证/证件号"），实现一个纯 token 级（无 spaCy）版本：在实体前 N 字符窗口内搜词表即可。
3. **`remove_duplicates`：同类型被包含且分数不更高则丢弃，按分数降序** → 结果合并阶段照抄这个排序键 `(start, -length, -score)`，一行逻辑省掉大量重叠 bug。
4. **三级阈值：请求级 > 实体级 > 识别器 default > 引擎 default** → 我们的「场景化阈值」（日志脱敏宁错杀 / 展示脱敏宁漏）直接做成配置项。
5. **allow_list（exact/regex）+ 文本归一化后比较** → 用户提供的「不要脱敏」词表；注意先归一化（全角/半角）再比较。
6. **deny_list + YAML 识别器配置（name/patterns/context/deny_list/score_thresholds）** → 我们的「单文件工具」可以把所有规则做成内置 YAML/JSON 表，不写死代码。
7. **算子表设计：mask/replace/hash/encrypt/custom/keep/redact + `OperatorConfig(type, params)` + DEFAULT 兜底** → 我们的脱敏策略配置直接采用同构结构，`DEFAULT=replace` 兜底保证不落原文。
8. **从后往前按坐标替换（TextReplaceBuilder + 倒序迭代）** → 单文件工具实现脱敏/回灌的核心技巧，替换后坐标不变，且天然支持「替换变长文本」。
9. **`EngineResult.items`（start/end/entity_type/text/operator，已归一化坐标）** → 我们「AI 结果回灌」的载体：AI 改完脱敏文本后按 items 坐标逆序写回。
10. **encrypt 的「IV 内嵌密文 + 调用方持 key」零状态可逆模式** → 若需要跨进程还原而不维护映射库，直接用 AES-CBC+PKCS7+urlsafe_b64(iv+ct)；key 不落盘。
11. **custom 算子的「带状态 lambda 攒 token→原文映射表」官方认可模式（issue #2024 注释）** → 这正是我们「映射表还原」的 presidio 等价物；我们可再配合 Deanonymize 型自定义算子按映射回灌。
12. **`sanitize_value(replacement_pairs)` 去分隔符再校验** → 手机号/银行卡/身份证先剥离 `- 空格 括号` 再算校验位，提高召回。
13. **`COUNTRY_CODE` + `supported_countries` 国家过滤** → 我们的规则集按国家/地区标签组织，未来支持多语言时按地区裁剪。
14. **正则超时 `REGEX_TIMEOUT_SECONDS`** → 所有用户可编辑的正则必须带超时，防 ReDoS。
15. **中文 `\b` 失效坑（汉字是 `\w`）** → 中文正则一律用 `(?<!\d)`/`(?!\d)` 环视，测试用例里加一条 "手机13800138000" 防静默失效。

## 一句话总结

Presidio 最值得抄的不是某条正则，而是「**弱正则 + 校验函数三态裁决 + 上下文词加分 + 按坐标倒序替换 + 算子可逆（IV 内嵌 AES / 带状态映射表）**」这套分层管线——官方没有中文识别器，但它的扩展点（PatternRecognizer 三态 validate、context 词表、OperatorConfig、DeanonymizeEngine）正好能 1:1 装下我们「映射表还原 / AI 结果回灌」的需求。
