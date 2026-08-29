# WuWa Chat Characters

角色索引 `chars.json` 由 GitHub Actions 自动生成，不需要手动编辑。

## 添加角色

在仓库根目录新建一个角色文件夹，至少包含：

- `prompt.md`
- `info.json`

`info.json` 必须包含 `name.en`、`name.cn`、`description.en` 和 `description.cn`。

完成后提交并推送。Action 会按文件夹名称排序，依据该角色目录最近一次 Git 提交时间生成 `updateAt`，然后自动提交更新后的 `chars.json`。

## 本地预览索引

```bash
node scripts/generate-chars.mjs
```
