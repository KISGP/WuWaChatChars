# WuWa Chat Characters

角色索引 `index.json` 由 GitHub Actions 自动生成，不需要手动编辑。

## 添加角色

在仓库根目录新建一个角色文件夹，至少包含：

- `prompt.md`
- `info.json`

`info.json` 必须包含 `name.en`、`name.cn`、`description.en` 和 `description.cn`。

可选资源与字段：

- `avatar.png` / `cardBg.png`：存在即自动登记。
- `emoticons/`：在 `info.json` 的 `emoticons[]` 中登记，`file` 为角色目录内相对路径。
- `voices/`：放置参考音频（WAV），并在 `info.json` 的 `tts.voices[]` 中逐条登记语音线（`id`/`label`/`lang`/`file`，`file` 为角色目录内相对路径，如 `voices/default.wav`）。`voices/` 中未登记的 WAV 视为配置遗漏，会导致索引生成报错。
- `tts.fish`：Fish Audio 托管音色 ID，写在 `info.json` 的 `"tts": { "fish": "…" }`，与参考音频相互独立。

完成后提交并推送。Action 会按文件夹名称排序，依据该角色目录最近一次 Git 提交时间生成 `updateAt`，然后自动提交更新后的 `index.json`。

## 本地预览索引

```bash
node .scripts/generate-chars.mjs
```
