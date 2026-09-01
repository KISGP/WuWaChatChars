import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const outputFile = path.join(root, 'chars.json');
const optionalAssets = [
  ['prompt', 'prompt.md'],
  ['avatar', 'avatar.png'],
  ['cardBg', 'cardBg.png'],
];

function fail(message) {
  console.error(`generate-chars: ${message}`);
  process.exitCode = 1;
}

function gitUpdateAt(directory) {
  const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', directory], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`无法获取目录 ${directory} 的 Git 最后更新时间`);
  }
  return result.stdout.trim();
}

function isCommittedDirectory(directory) {
  const result = spawnSync('git', ['log', '-1', '--format=%H', 'HEAD', '--', directory], {
    cwd: root,
    encoding: 'utf8',
  });
  return result.status === 0 && Boolean(result.stdout.trim());
}

async function findTtsFile(directory, characterPath) {
  const files = await readdir(characterPath, { withFileTypes: true });
  const wavFiles = files.filter((file) => file.isFile() && file.name.toLowerCase().endsWith('.wav'));
  if (wavFiles.length > 1) {
    throw new Error(`${directory} 包含多个 WAV 文件，无法确定 TTS 资源`);
  }
  return wavFiles[0]?.name;
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

    const character = {
      ...info,
      id: directory,
      updateAt: gitUpdateAt(directory),
    };
    for (const [field, file] of optionalAssets) {
      if (existsSync(path.join(characterPath, file))) {
        character[field] = `${directory}/${file}`;
      }
    }
    const ttsFile = await findTtsFile(directory, characterPath);
    if (ttsFile) character.tts = `${directory}/${ttsFile}`;
    characters.push(character);
  }

  characters.sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'));
  await writeFile(outputFile, `${JSON.stringify(characters, null, 2)}\n`, 'utf8');
  console.log(`generate-chars: generated ${characters.length} characters in chars.json`);
}

main().catch((error) => fail(error.message));
