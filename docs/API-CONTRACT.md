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

## 文件进出（M2 第三段）

原件与导出物都落在**用户选定的资料目录**下，`imports/` 与 `exports/` 两个子目录，不写别处、不写系统临时目录。

### 导入原件

`POST /api/import?profile=A&name=病理报告.pdf&type=病理报告`

- **请求体是原始字节**（`content-type: application/octet-stream`），不套 base64——大文件不额外膨胀 33%；
- 元信息走查询参数（文件名里带 `&` `/` 会破坏 body 的边界判定）；
- 上限 40 MB，超了服务端 `req.destroy()` 并回 413；
- 文件名只保留基名：`../../../etc/passwd` → `passwd`，控制字符与 `<>:"|?*` 一并剥掉，限长 120；
- 落盘 `imports/<id>-<name>`，其中 `id = "f" + sha256前12位`；
- 同一份内容（sha256 相同）再导入 → `unchanged`，**不重复写文件、不重置解析状态**；原件是复制，不改动用户原来那个文件。

| 响应 | 含义 |
| --- | --- |
| `{ ok, status:'created', id, name, path, size }` | 首次导入，已复制进 `imports/` |
| `{ ok, status:'unchanged', id, name, path, size }` | 内容此前已导入过，本次什么都没写 |

导入同时落一条 `documents` 行（`status = '待核对'`、`ord = MAX+1`），所以资料库列表里会立刻出现——但**解析出来的字段只是候选**，不进事实表。

### 导出 Markdown

`POST /api/export`，JSON：`{ kind?, text }`

- `kind` 缺省 `复诊准备`；只留中英文数字与 `-`，限长 40；
- 落 `exports/<本地日期>-<kind>.md`，**同名覆盖**——导出物可随时重生成，不是事实（契约② 只约束事实记录）；
- `text` 上限 512 KB，空内容拒绝。

### 候选核对

`POST /api/candidates`，JSON：`{ profile, id, value, status }`

- `status ∈ {待核对, accepted, rejected}`；
- **只 `UPDATE candidate_fields` 的 `value` / `status`，不动任何事实表**——契约② 约束的是事实记录（更正只新增版本），审核流转本身可以原地改状态；
- 回应 `{ ok, status:'updated'|'unchanged', row }`；
- 未知 `id` → 404 `CANDIDATE_NOT_FOUND`。

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `FILE_EMPTY` `EXPORT_EMPTY` `STATUS_INVALID` | 空文件 / 空导出内容 / 核对结果不在三态内 |
| 413 | `FILE_TOO_LARGE` `EXPORT_TOO_LARGE` | 超 40 MB / 超 512 KB |
| 404 | `CANDIDATE_NOT_FOUND` | 候选 id 不存在于该档案 |
| 500 | `FILE_WRITE_FAILED` | 资料目录不可写（磁盘满 / 权限） |

## 云端解析（MinerU）

原件**不会因为你导入就上传**——出本机这一步必须由用户点「解析」，代码里没有任何自动触发路径。

### 能力自检

`GET /api/mineru` → `{ configured, source, masked }`

- `source` 是 Token 的来源（`explicit` / `env:MINERU_TOKEN` / `.secrets/mineru.json`），`masked` 只露前 4 后 2；
- **不回传 Token 本身**，也不在错误消息里出现整串；
- 没配置时 `configured=false` 并带 `hint`，界面据此显示「解析不可用」，而不是假装能用。

注意优先级是 **显式传入 > 环境变量 > 密钥文件**。机器上若残留一个旧的 `MINERU_TOKEN`，它会盖住 `.secrets/mineru.json` 里的新 key；设置页那行「来源：」就是用来发现这种情况的。

### 解析一份材料

`POST /api/parse`，JSON：`{ profile, id }`

状态机（`documents.status`）：

| 从 | 到 | 触发 |
| --- | --- | --- |
| `待解析` | `待核对` | 解析成功且抽到 ≥1 条候选 |
| `待解析` / `解析失败` | `解析失败` | 云端失败 / 正文为空 / 一条字段都没认出 |
| — | 「解析中」**不入库** | 由前端内存态表示；写进库会留下永远转圈的僵尸状态 |

成功响应：`{ ok, status:'parsed', docId, candidates, pages, modelVersion }`。

三条硬规则：

1. **失败不产候选**：候选写入与状态翻转在同一个事务里，任一步失败整批回滚；
2. **不静默降级**：云端失败不会退回本地正则凑一份——两套口径的数据没法比较；
3. **候选永远只是候选**：只写 `candidate_fields`，不碰 `pathology_rows` / `metric_points`。

非 PDF / 图片 / Office 直接拒绝（`NOT_PARSEABLE`），不白花一次额度——文本文件走本机手工补录。

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `NOT_PARSEABLE` `PROFILE_REQUIRED` | 格式不对 / 缺档案 |
| 401 | `MINERU_UNAUTHORIZED` | Token 无效或过期 |
| 404 | `DOC_NOT_FOUND` `DOC_FILE_MISSING` | 没有这份材料 / 原件不在 `imports/` |
| 422 | `NO_CANDIDATE` | 解析完成但没认出任何可抄写的字段 |
| 502 | `MINERU_*` `EMPTY_MARKDOWN` `PARSE_FAILED` | 上游失败；原件保留，可重试 |
| 500 | `PARSE_WRITE_FAILED` | 候选写库失败（已回滚） |

## 错误码总表

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `BODY_EMPTY` `BODY_NOT_JSON` `BODY_NOT_OBJECT` | 请求体问题 |
| 400 | `DATE_INVALID` `DATE_FUTURE` `FIELD_REQUIRED` `FIELD_TYPE` `FIELD_TOO_LONG` `VALUE_NOT_NUMERIC` `VALUE_OUT_OF_RANGE` | 字段问题 |
| 404 | `PROFILE_NOT_FOUND` `METRIC_NOT_FOUND` `not_found`（未知 `/api/*`） | 对象不存在 |
| 405 | —（响应头 `allow: POST`） | 写命令用了 GET |
| 413 | `BODY_TOO_LARGE` | 请求体超 64KB |
| 500 | `bootstrap_failed` `command_failed` | 库或 SQL 层异常，`message` 带原始原因 |

## 前端如何使用（已接线）

1. 写成功后**不要自己拼状态**，重新 `GET /api/bootstrap`（`public/app.js` 的 `afterWrite` 就是这么做的）；
2. `status === 'superseded'` 时提示「已更新为最新一条，旧版本保留」——这是契约② 的用户可见面；
3. 网络失败与业务错误分开提示：前者「没连上资料库」，后者直接用 `message`；
4. 导入用 `fetch(..., { body: file })` 直传 `File` 对象（浏览器自动按流发），别读成 base64 再拼 JSON。
