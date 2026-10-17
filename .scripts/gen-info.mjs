import { readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

// 根目录下除点开头的工具目录（.git、.github、.scripts、.tmp 等）外均为角色文件夹。
// 文件夹名为纯可打印 ASCII（如 Brant）填 name.en；含中文（如 心、秋水）填 name.cn。
function nameFromFolder(name) {
  const isAscii = /^[\x20-\x7E]+$/.test(name);
  return isAscii ? { en: name, cn: '' } : { en: '', cn: name };
}

// voices/ 有 WAV 但 info.json 未登记会被生成器报错，因此有 WAV 就按契约登记：
// 默认音色=第一条（id "default"），多余条目以文件名作 id/label；保留 wav 原文件名。
async function voicesFromFolder(directory) {
  const voicesDir = path.join(directory, 'voices');
  if (!existsSync(voicesDir)) return [];
  const wavs = (await readdir(voicesDir, { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.wav'))
    .map((file) => file.name)
    .sort();
  return wavs.map((name, index) => {
    const stem = name.replace(/\.wav$/i, '');
    return index === 0
      ? { id: 'default', label: '默认音色', lang: 'zh', file: `voices/${name}` }
      : { id: stem, label: stem, lang: 'zh', file: `voices/${name}` };
  });
}

const entries = await readdir(root, { withFileTypes: true });
const missing = entries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort()
  .filter((name) => !existsSync(path.join(root, name, 'info.json')));

if (missing.length === 0) {
  console.log('gen-info: 全部角色文件夹均已有 info.json');
} else {
  for (const name of missing) {
    const info = {
      name: nameFromFolder(name),
      description: { en: '', cn: '' },
    };
    const voices = await voicesFromFolder(path.join(root, name));
    if (voices.length > 0) info.tts = { voices };
    await writeFile(
      path.join(root, name, 'info.json'),
      `${JSON.stringify(info, null, 2)}\n`,
      'utf8',
    );
    const ttsNote = voices.length > 0 ? `，已登记 ${voices.length} 条语音线` : '';
    console.log(`gen-info: 已生成 ${name}/info.json 模板（name/description 待人工补全${ttsNote}）`);
  }
  console.log(`gen-info: 共生成 ${missing.length} 个模板`);
}
