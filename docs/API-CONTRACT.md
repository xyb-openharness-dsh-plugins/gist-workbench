# API 合同（GIST · 小吉宝）

前缀 `API_PREFIX`（`dsh/index.js` 唯一来源，前端按 `${apiBase}/api/xxx` 调用，`apiBase` 不含 `/api`）。
鉴权由宿主 connection 合同处理，**不因 loopback 跳过**。开发版 `npm start` 下不鉴权，仅限本机。
响应一律 JSON；错误体固定 `{ error, message }`，`error` 是给程序分支的 code，`message` 是可以直接显示的人话。

本表只写**已实现**的接口。`docs/DEV-PLAN.md` 里标 ⬜ 的一律不在这里出现。

## 读

| 方法/路径 | 意图 | 输入 | 成功响应 | 错误码 |
| --- | --- | --- | --- | --- |
| `GET /api/health` | 存活与版本 | 无 | `{ ok, version }` | — |
| `GET /api/bootstrap` | 一次取全：档案 + 指标 + 试验 + 面板参数 | 无 | `{ version, build, profiles:{A,B,C}, trials[16], agent }` | `500 bootstrap_failed` |

`bootstrap` 的形状与 `prototypes/v0.2/demo-data.js` 逐字段一致（`test/store.test.mjs` 的 `deepStrictEqual` 守着）。
读模型细节：变长行尾部 `NULL` 裁掉；空分节整键省略（`profile.surgery` 不存在 ≠ `null`）；
数值指标 `v` 是数字，分类指标 `v` 是原文文本。

## 写（M2 第二段）

五条命令对应「一天里最常记的五件事」。只收 `POST` + JSON，请求体上限 64KB。

| 方法/路径 | 意图 | 必填 | 选填 | 落表 | 幂等键 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/adherence` | 记一天的服药 | `profile` `date` `drug`，且 `planned`/`taken` 至少一项 | `note` | `adherence_rows` | 档案 + 日期 + 药物 |
| `POST /api/side-effects` | 记一条反应 | `profile` `date` `term` | `grade` `action` `note` | `side_effect_rows` | 档案 + 日期 + 症状 |
| `POST /api/metric-points` | 记一次检查结果 | `profile` `date` `metric` `value` | `src` | `metric_points` | 档案 + 指标 + 日期 |
| `POST /api/viewpoints` | 记一条自己的看法 | `profile` `date` `text` | `mood` | `viewpoints` | 档案 + 日期（同文幂等） |
| `POST /api/nutrition` | 记一笔进食 | `profile` `date` `slot`，且 `amount`/`foods` 至少一项 | `symptoms` `note` | `nutrition_rows` | 档案 + 日期 + 餐次 |

成功响应统一 `{ ok: true, status, row | point }`，`status` 三态：

| status | 含义 | 库里的变化 |
| --- | --- | --- |
| `created` | 新建一条 | 插入 `ord = 1` |
| `unchanged` | 同键同内容重复提交 | **不写库** |
| `superseded` | 同键内容改了＝更正 | 追加 `ord + 1`，**旧行保留**（契约② 更正只新增版本） |

### 输入约束

| 字段 | 规则 | 违反时 |
| --- | --- | --- |
| `profile` | 必须是 `subjects` 里已有的档案键 | `PROFILE_REQUIRED` 400 / `PROFILE_NOT_FOUND` 404 |
| `date` | `YYYY-MM-DD`，必须是真实日期，且不晚于今天 | `DATE_INVALID` 400 / `DATE_FUTURE` 400 |
| `metric` | 必须是该档案 `metrics` 里已定义的指标 | `METRIC_NOT_FOUND` 404 |
| `value`（数值指标） | 收数字或数字字符串，落库为 `REAL`；必须 > 0，按 `dec` 取位 | `VALUE_NOT_NUMERIC` 400 / `VALUE_OUT_OF_RANGE` 400 |
| `value`（分类/等级指标） | 收原文文本（如 `2 级`），不枚举、不校验医学语义 | `FIELD_REQUIRED` 400 |
| 文本字段 | 去首尾空格；超长（备注 400–800 字、名称 80 字）拒绝 | `FIELD_TOO_LONG` 400 |
| 请求体 | 非空、合法 JSON、对象、≤ 64KB | `BODY_EMPTY` / `BODY_NOT_JSON` / `BODY_NOT_OBJECT` 400，`BODY_TOO_LARGE` 413 |

### 刻意不做的

| 不做 | 原因 |
| --- | --- |
| 依从率、漏服率、评分、趋势摘要 | 工作台只记事实，不做评价（契约①） |
| 自动补一条"看起来合理"的记录 | 缺字段就报错，不猜 |
| 未定义指标自动建线 | 会让一图秀多出一条没人认识的曲线 |
| `UPDATE` / `DELETE` 旧记录 | 契约② 更正只新增版本 |
| 病理 / 危险度 / 手术 / 线序 / 剂量的随手填 | 这些是医生给的事实，必须走「上传 → 候选 → 逐条核对」，见 `docs/18-MINERU-PARSING.md` |

## 错误码总表

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `BODY_EMPTY` `BODY_NOT_JSON` `BODY_NOT_OBJECT` | 请求体问题 |
| 400 | `DATE_INVALID` `DATE_FUTURE` `FIELD_REQUIRED` `FIELD_TYPE` `FIELD_TOO_LONG` `VALUE_NOT_NUMERIC` `VALUE_OUT_OF_RANGE` | 字段问题 |
| 404 | `PROFILE_NOT_FOUND` `METRIC_NOT_FOUND` `not_found`（未知 `/api/*`） | 对象不存在 |
| 405 | —（响应头 `allow: POST`） | 写命令用了 GET |
| 413 | `BODY_TOO_LARGE` | 请求体超 64KB |
| 500 | `bootstrap_failed` `command_failed` | 库或 SQL 层异常，`message` 带原始原因 |

## 前端如何使用（下一段接线）

1. 写成功后**不要自己拼状态**，重新 `GET /api/bootstrap` 或按返回的 `row` 局部更新；
2. `status === 'superseded'` 时提示「已更正，旧版本保留」——这是契约② 的用户可见面；
3. 网络失败与业务错误分开提示：前者「没连上资料库」，后者直接用 `message`。
