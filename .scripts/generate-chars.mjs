import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const outputFile = path.join(root, 'index.json');
const assetFiles = [
  ['cardBg', 'cardBg.png'],
  ['prompt', 'prompt.md'],
];

function fail(message) {
  console.error(`generate-chars: ${message}`);
  process.exitCode = 1;
}

// HEAD 树中该目录的提交名。Windows 上仅改大小写的 git mv 会让工作区目录名与
// 已提交路径不一致（git pathspec 区分大小写），必须用提交名查询历史。
function committedPath(directory) {
  const result = spawnSync('git', ['ls-tree', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return (
    result.stdout
      .split('\n')
      .find((name) => name.toLowerCase() === directory.toLowerCase()) ?? null
  );
}

function gitUpdateAt(directory) {
  const committed = committedPath(directory) ?? directory;
  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', committed], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`无法获取目录 ${directory} 的 Git 最后更新时间`);
  }
  return result.stdout.trim();
}

function isCommittedDirectory(directory) {
  return committedPath(directory) !== null;
}

function isSafeRelativePath(value) {
  return value
    .split('/')
    .every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

// 按文件名前缀在角色根目录匹配唯一的 PNG：0 张返回 null（调用方省略字段），
// 多张视为配置遗漏报错——和「未登记 WAV」同一处理哲学。
async function matchUniqueImage(directory, characterPath, prefix, field) {
  const entries = await readdir(characterPath, { withFileTypes: true });
  const matches = entries
    .filter(
      (file) =>
        file.isFile() && file.name.startsWith(prefix) && file.name.toLowerCase().endsWith('.png')
    )
    .map((file) => file.name)
    .sort();
  if (matches.length > 1) {
    throw new Error(`${directory} 匹配到多张 ${field} 图（${matches.join('、')}），请清理到只剩一张`);
  }
  return matches[0] ?? null;
}

async function parseInfo(directory, infoPath) {
  let info;
  try {
    info = JSON.parse(await readFile(infoPath, 'utf8'));
  } catch (error) {
    throw new Error(`${directory}/info.json 不是有效 JSON：${error.message}`);
  }
  if (!info || typeof info !== 'object' || Array.isArray(info)) {
    throw new Error(`${directory}/info.json 必须是 JSON 对象`);
  }
  if (!info.name || typeof info.name !== 'object' || !('en' in info.name) || !('cn' in info.name)) {
    throw new Error(`${directory}/info.json 缺少 name.en 或 name.cn`);
  }
  if (!info.description || typeof info.description !== 'object' || !('en' in info.description) || !('cn' in info.description)) {
    throw new Error(`${directory}/info.json 缺少 description.en 或 description.cn`);
  }
  if (info.tts !== undefined) {
    if (!info.tts || typeof info.tts !== 'object' || Array.isArray(info.tts)) {
      throw new Error(`${directory}/info.json 的 tts 必须是对象`);
    }
    if (info.tts.fish !== undefined && (typeof info.tts.fish !== 'string' || !info.tts.fish.trim())) {
      throw new Error(`${directory}/info.json 的 tts.fish 必须是非空字符串`);
    }
    if (info.tts.voices !== undefined && !Array.isArray(info.tts.voices)) {
      throw new Error(`${directory}/info.json 的 tts.voices 必须是数组`);
    }
  }
  return info;
}

// 语音线配置的唯一真源是各角色 info.json 的 tts.voices，本脚本只透传并校验；
// voices/ 下存在未登记的 WAV 视为配置遗漏。
async function resolveTts(directory, characterPath, info) {
  const rootFiles = await readdir(characterPath, { withFileTypes: true });
  const strayWavs = rootFiles
    .filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.wav'))
    .map((file) => file.name);
  if (strayWavs.length > 0) {
    throw new Error(
      `${directory} 根目录存在残留 WAV（${strayWavs.join('、')}），语音文件必须位于 voices/ 子目录`
    );
  }

  const tts = {};
  if (info.tts?.fish) tts.fish = info.tts.fish.trim();

  const voicesDir = path.join(characterPath, 'voices');
  const wavFiles = existsSync(voicesDir)
    ? (await readdir(voicesDir, { withFileTypes: true }))
        .filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.wav'))
        .map((file) => file.name)
        .sort()
    : [];

  if (info.tts?.voices) {
    const seen = new Set();
    const lines = info.tts.voices.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`${directory}/info.json 的 tts.voices 条目必须是对象`);
      }
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) throw new Error(`${directory}/info.json 的 tts.voices 条目缺少 id`);
      if (seen.has(id)) throw new Error(`${directory}/info.json 的 tts.voices 存在重复 id：${id}`);
      seen.add(id);
      const file = typeof item.file === 'string' ? item.file.trim() : '';
      if (!file || !isSafeRelativePath(file)) {
        throw new Error(`${directory}/info.json 的 tts.voices 条目 file 非法：${file}`);
      }
      if (!existsSync(path.join(characterPath, file))) {
        throw new Error(`${directory} 的语音文件不存在：${file}`);
      }
      return {
        id,
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : id,
        ...(typeof item.lang === 'string' && item.lang.trim() ? { lang: item.lang.trim() } : {}),
        file,
      };
    });
    const registered = new Set(lines.map((line) => line.file));
    for (const name of wavFiles) {
      if (!registered.has(`voices/${name}`)) {
        throw new Error(`${directory}/voices/${name} 未在 info.json 的 tts.voices 中登记`);
      }
    }
    if (lines.length > 0) tts.voices = lines;
  } else if (wavFiles.length > 0) {
    throw new Error(
      `${directory}/voices 有 ${wavFiles.length} 个 WAV 但 info.json 的 tts.voices 未登记语音线，请先补全角色配置`
    );
  }

  return Object.keys(tts).length > 0 ? tts : null;
}

function validateEmoticons(directory, characterPath, raw) {
  if (!Array.isArray(raw)) {
    throw new Error(`${directory}/info.json 的 emoticons 必须是数组`);
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`${directory}/info.json 的 emoticons[${index}] 必须是对象`);
    }
    const file = typeof item.file === 'string' ? item.file.trim() : '';
    if (!file || !isSafeRelativePath(file)) {
      throw new Error(`${directory}/info.json 的 emoticons[${index}] file 非法：${file}`);
    }
    if (!existsSync(path.join(characterPath, file))) {
      throw new Error(`${directory} 的表情文件不存在：${file}`);
    }
    return item;
  });
}

async function main() {
  const entries = await readdir(root, { withFileTypes: true });
  const characters = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const directory = entry.name;
    const characterPath = path.join(root, directory);
    const promptPath = path.join(characterPath, 'prompt.md');
    const infoPath = path.join(characterPath, 'info.json');
    const hasPrompt = existsSync(promptPath);
    const hasInfo = existsSync(infoPath);

    // Directories without either character marker are unrelated repository data.
    if (!hasPrompt && !hasInfo) continue;
    // Untracked local drafts are intentionally ignored until they are committed.
    if (!isCommittedDirectory(directory)) continue;
    if (!hasPrompt || !hasInfo) {
      throw new Error(`${directory} 必须同时包含 prompt.md 和 info.json`);
    }

    const info = await parseInfo(directory, infoPath);
    const character = {
      name: info.name,
      description: info.description,
      id: directory,
      updateAt: gitUpdateAt(directory),
    };
    // avatar：显式 avatar.png 优先于通配匹配，缺失时回退唯一的 T_IconRoleHeadCircle*.png。
    const avatarFallback = await matchUniqueImage(directory, characterPath, 'T_IconRoleHeadCircle', 'avatar');
    const avatarFile = existsSync(path.join(characterPath, 'avatar.png')) ? 'avatar.png' : avatarFallback;
    if (avatarFile) character.avatar = `${directory}/${avatarFile}`;
    for (const [field, file] of assetFiles) {
      if (existsSync(path.join(characterPath, file))) {
        character[field] = `${directory}/${file}`;
      }
    }
    for (const [field, prefix] of [
      ['pixActivity', 'T_ActivityRole'],
      ['rolePile', 'T_IconRole_Pile'],
    ]) {
      const file = await matchUniqueImage(directory, characterPath, prefix, field);
      if (file) character[field] = `${directory}/${file}`;
    }
    const tts = await resolveTts(directory, characterPath, info);
    if (tts) character.tts = tts;
    if (info.emoticons !== undefined) {
      character.emoticons = validateEmoticons(directory, characterPath, info.emoticons);
    }
    characters.push(character);
  }

  characters.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'));
  await writeFile(outputFile, `${JSON.stringify({ characters }, null, 2)}\n`, 'utf8');
  console.log(`generate-chars: generated ${characters.length} characters in index.json`);
}

main().catch((error) => fail(error.message));
