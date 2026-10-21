/* 抽取层：只抄写、不判断。
   重点守住两条最要紧的取舍：
   1) 表格按位置对齐，数量对不上就整行放弃（不能把 8 个指标写成同一个数）；
   2) 不等式原样保留（`<0.5` 不折成 0.5），参考区间不当结果。 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractCandidates, alignTableRow, readValue, normalizeUnit, findDate, normalizeMarkdown, htmlTablesToPipes } from '../dsh/gistparse.js';

const byName = (list) => Object.fromEntries(list.map((c) => [c.name, c.value]));

test('① 病理报告：部位 / 大小 / 核分裂 / 切缘 / 破裂 / 分子五项都认得', () => {
  const md = `
# 病理诊断报告

报告日期：2026-09-18
发生部位：胃体
肿瘤最大径 6.8 cm
核分裂象 12 个 / 50 HPF
切缘：R0
肿瘤破裂：无
CD117（+）
DOG1 阳性
KIT 基因：外显子 11 缺失
PDGFRA 基因：外显子 18 突变
SDHB 阳性
危险度（NIH 2008）：高危
`;
  const got = byName(extractCandidates(md, { source: '病理报告' }));
  assert.equal(got['肿瘤部位'], '胃体');
  assert.equal(got['肿瘤大小'], '6.8 cm');
  assert.equal(got['核分裂象'], '12 个 / 50 HPF');
  assert.equal(got['切缘'], 'R0');
  assert.equal(got['肿瘤破裂'], '无');
  assert.equal(got['CD117'], '（+）');
  assert.equal(got['DOG1'], '阳性');
  assert.match(got['KIT 基因'], /外显子 11 缺失/);
  assert.match(got['PDGFRA 基因'], /外显子 18 突变/);
  assert.equal(got['SDHB'], '阳性');
  assert.equal(got['危险度'], '高危');
  assert.equal(got['报告日期'], '2026-09-18');
});

test('② 表格按位置对齐：数量不一致整行放弃', () => {
  // 横表：第一行是指标名，第二行是值 —— 按位置一一配
  assert.deepEqual(alignTableRow('| 血红蛋白 | 白细胞 |', '| 104 | 4.2 |'), [
    ['血红蛋白', '104'],
    ['白细胞', '4.2'],
  ]);

  // 3 个名字配 2 个值 → 一个都不给，宁可漏
  assert.deepEqual(alignTableRow('| 血红蛋白 | 白细胞 | 血小板 |', '| 104 | 4.2 |'), []);
});

test('③ 化验表：整表被塞进一个单元格时按位置配，不会全写成同一个数', () => {
  const md = `
| 项目 | 结果 | 单位 |
| --- | --- | --- |
| 血红蛋白 | 104 | g/L |
| 白细胞 | 4.2 | 10^9/L |
| 血小板 | 210 | 10^9/L |
| 中性粒细胞 | 2.4 | 10^9/L |
`;
  const got = byName(extractCandidates(md));
  assert.equal(got['血红蛋白'], '104 g/L');
  assert.equal(got['白细胞'], '4.2 10⁹/L');
  assert.equal(got['血小板'], '210 10⁹/L');
  assert.equal(got['中性粒细胞'], '2.4 10⁹/L');
  assert.notEqual(got['白细胞'], got['血红蛋白']);
});

test('④ 不等式原样保留，不折成数字', () => {
  // 符号与数字原样保留，后面跟着的单位也留着（原文明明写了单位，不能替用户丢掉）
  assert.deepEqual(readValue('<0.5 mg/L'), { text: '<0.5 mg/L', numeric: null });
  assert.deepEqual(readValue('≤3'), { text: '≤3', numeric: null });
  const got = byName(extractCandidates('伊马替尼谷浓度 < 0.5 ng/mL'));
  assert.equal(got['伊马替尼谷浓度'], '<0.5 ng/mL');
});

test('⑤ 参考区间不是结果；拉丁名要词边界', () => {
  const md = '白细胞 4.2 10^9/L 参考范围 3.5-9.5 10^9/L\nCRP 2.1 mg/L\n肌酐 68 μmol/L';
  const got = byName(extractCandidates(md));
  assert.equal(got['白细胞'], '4.2 10⁹/L', '参考区间不能被当成结果');
  assert.equal(got['肌酐'], '68 μmol/L');
  assert.equal(got['白细胞'] && got['白细胞'].includes('3.5'), false);
});

test('⑥ 单位归一：只统一写法，认不出就留原文', () => {
  assert.equal(normalizeUnit('10^9/L'), '10⁹/L');
  assert.equal(normalizeUnit('umol/L'), 'μmol/L');
  assert.equal(normalizeUnit('g/L'), 'g/L');
  assert.equal(normalizeUnit('个/HPF'), '个/HPF');
});

test('⑦ 日期：不认 2026-02-31 这种不存在的日期', () => {
  assert.equal(findDate('报告日期：2026-02-31'), null);
  assert.equal(findDate('采样日期：2026-03-01'), '2026-03-01');
  assert.equal(findDate('某某医院\n2026年7月5日\n血常规'), '2026-07-05');
});

test('⑧ 抽不到就返回空数组，不编一条看起来合理的', () => {
  const md = '这是一份与病理无关的门诊须知，讲的是停车和挂号时间。';
  assert.deepEqual(extractCandidates(md), []);
});

test('⑨ 去重：同名只留第一条，值来自报告原文', () => {
  const md = '肿瘤最大径 6.8 cm\n肿瘤最大径 7.1 cm';
  const out = extractCandidates(md);
  assert.equal(out.filter((c) => c.name === '肿瘤大小').length, 1);
  assert.equal(out.find((c) => c.name === '肿瘤大小').value, '6.8 cm');
});

test('⑩ markdown 清洗：图片与行内 HTML 不干扰抽取', () => {
  const md = '![](images/a.jpg)\n<b>核分裂象</b> 3 个 / 50 HPF';
  assert.equal(normalizeMarkdown(md).includes('images'), false);
  assert.equal(byName(extractCandidates(md))['核分裂象'], '3 个 / 50 HPF');
});

test('⑪ 真实 MinerU 输出（HTML 表格 + colspan）：13 个字段全部抄对', () => {
  const md = readFileSync(fileURLToPath(new URL('./fixtures/mineru-pathology-html.md', import.meta.url)), 'utf8');
  const got = byName(extractCandidates(md, { source: '病理报告.pdf' }));

  assert.equal(got['肿瘤部位'], '胃体', '部位不能把后面几项一起吞进来');
  assert.equal(got['肿瘤大小'], '6.8 cm');
  assert.equal(got['核分裂象'], '12 个 / 50 HPF');
  assert.equal(got['切缘'], 'R0');
  assert.equal(got['肿瘤破裂'], '无');
  assert.equal(got['CD117'], '阳性 (+)');
  assert.equal(got['DOG1'], '阳性');
  assert.equal(got['KIT 基因'], '外显子 11 缺失突变');
  assert.equal(got['血红蛋白'], '104 g/L');
  assert.equal(got['白细胞'], '4.2 10⁹/L', '值不能被拼成 4.210 ^9/L');
  assert.equal(got['血小板'], '210 10⁹/L');
  assert.equal(got['白蛋白'], '38.6 g/L');
  assert.equal(got['报告日期'], '2026-09-18');
});

test('⑫ HTML 表格转竖线：colspan 补空位而不是复制内容', () => {
  const html = '<table><tr><td>项目</td><td>结果</td><td>单位</td></tr><tr><td>发生部位</td><td colspan="2">胃体</td></tr></table>';
  const out = htmlTablesToPipes(html);
  assert.match(out, /\| 项目 \| 结果 \| 单位 \|/);
  assert.match(out, /\| --- \| --- \| --- \|/, '要补一条分隔行，后面统一按表头 + 分隔行 + 数据行解析');
  assert.match(out, /\| 发生部位 \| 胃体 \|\s*\|/, 'colspan 的位置留空，不能把「胃体」写两遍');
});
