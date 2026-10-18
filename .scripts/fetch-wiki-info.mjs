import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

const CATALOGUE_ID = '1105'; // 「角色」目录：共鸣者
const PAGE_API = 'https://api.kurobbs.com/wiki/core/catalogue/item/getPage';
const DETAIL_API = 'https://api.kurobbs.com/wiki/core/catalogue/item/getEntryDetail';
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  wiki_type: '9',
};

// 抓取脚本只负责补新字段，不动已有内容：既保留各文件原有缩进（2 或 4 空格）
// 与末尾换行，也避免把人工修订当成脏数据。
function detectIndent(raw) {
  const match = raw.match(/^\{\r?\n([ \t]+)"/);
  return match ? match[1] : 2;
}

async function post(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  const json = await response.json();
  if (json.code !== 200) throw new Error(`${url} 返回业务错误 ${json.code}：${json.msg}`);
  return json.data;
}

async function catalogueRecords() {
  const data = await post(PAGE_API, { catalogueId: CATALOGUE_ID, page: 1, limit: 1000 });
  return data.results.records;
}

// 详情页的 roleDescription / roleDescriptionTitle 挂在第一个含 role 的组件上，
// 位置随组件结构变动，因此按字段探测而非写死下标。
function findRole(entry) {
  for (const module of entry?.content?.modules ?? []) {
    for (const component of module.components ?? []) {
      if (component?.role?.roleDescriptionTitle || component?.role?.roleDescription) {
        return component.role;
      }
    }
  }
  return null;
}

async function fetchRole(linkId) {
  const data = await post(DETAIL_API, { id: linkId });
  const role = findRole(data);
  if (!role) throw new Error(`角色 ${linkId} 的详情中没有 role 组件`);
  return {
    cn: (role.title ?? '').trim(),
    en: (role.subtitle ?? '').trim(),
    power: (role.roleDescriptionTitle ?? '').trim().replace(/^共鸣能力[：:]\s*/, ''),
    information: (role.roleDescription ?? '').trim(),
  };
}

const records = await catalogueRecords();

// 本地 name.cn → wiki 条目；取不到中文名时回退到 name.en。
function normalise(value) {
  return (value ?? '').trim().toLowerCase().replace(/[\s·・．.\-_'’]/g, '');
}

const wikiByName = new Map();
for (const record of records) {
  const linkId = record.content?.linkId;
  if (!linkId) continue;
  const role = await fetchRole(linkId).catch((error) => {
    console.warn(`fetch-wiki-info: 跳过 ${record.name}：${error.message}`);
    return null;
  });
  if (!role) continue;
  for (const key of [role.cn, role.en]) {
    const name = normalise(key);
    if (name && !wikiByName.has(name)) wikiByName.set(name, role);
  }
  process.stderr.write('.');
}
process.stderr.write('\n');

const directories = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

const updated = [];
const skipped = [];
const missing = [];

for (const directory of directories) {
  const infoPath = path.join(root, directory, 'info.json');
  if (!existsSync(infoPath)) continue;
  const raw = await readFile(infoPath, 'utf8');
  const info = JSON.parse(raw);
  const role =
    wikiByName.get(normalise(info.name?.cn)) ?? wikiByName.get(normalise(info.name?.en));
  if (!role) {
    missing.push(directory);
    continue;
  }

  // en 留空：wiki 只有中文正文，subtitle 只是角色英文名而非译名。
  const fields = {};
  const absent = [];
  if (info.information === undefined) {
    fields.information = { en: '', cn: role.information };
    absent.push('information');
  }
  if (info.resonancePower === undefined) {
    fields.resonancePower = { en: '', cn: role.power };
    absent.push('resonancePower');
  }
  if (absent.length === 0) {
    skipped.push(directory);
    continue;
  }

  await writeFile(
    infoPath,
    `${JSON.stringify({ ...info, ...fields }, null, detectIndent(raw))}${raw.endsWith('\n') ? '\n' : ''}`,
    'utf8',
  );
  updated.push(`${directory}（补 ${absent.join('、')}）`);
}

for (const line of updated) console.log(`fetch-wiki-info: ${line}`);
if (skipped.length > 0) {
  console.log(`fetch-wiki-info: ${skipped.length} 个角色字段齐全，跳过：${skipped.join('、')}`);
}
if (missing.length > 0) {
  console.log(`fetch-wiki-info: ${missing.length} 个目录在 wiki 中找不到对应角色：${missing.join('、')}`);
}
console.log(`fetch-wiki-info: 更新 ${updated.length} 个，跳过 ${skipped.length} 个，未匹配 ${missing.length} 个`);
