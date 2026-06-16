# flash-linear-attention-npu IO 控制台

这是一个私有项目管理控制台骨架，用于维护 `flash-linear-attention-npu` 转测计划。

## 能力

- 前端：原生 HTML/CSS/JavaScript，入口 `/io`
- 后端：Python 标准库 HTTP API
- 数据源：仓库文件 `data/project-state.json`
- 审计日志：仓库文件 `data/audit-log.jsonl`
- 运行缓存：SQLite，仅用于本地服务运行时加速，不作为最终数据源
- 数据操作：任务增删改查、筛选、分组、专项、甘特图展示、双击甘特条切分、JSON 导出
- 每次写操作都会更新数据快照、追加日志，并自动提交推送到 GitHub 私有仓库

## 本地运行

```powershell
python .\backend\app.py
```

浏览器打开：

```text
http://127.0.0.1:8787/io
```

首次启动会优先从 `data/project-state.json` 恢复数据；如果该文件不存在，则从内置 seed 数据初始化。

## GitHub Pages 查看

本仓库使用 `docs/` 作为 GitHub Pages 静态站点目录。

- 本地 `/io` 页面用于编辑数据。
- 每次本地写操作会更新 `data/project-state.json` 和 `data/audit-log.jsonl`。
- 同时会把最新数据镜像到 `docs/project-state.json` 和 `docs/audit-log.jsonl`。
- GitHub Pages 页面只读展示仓库里的最新数据，不运行 Python 后端。
- GitHub Pages 页面也支持编辑模式：输入你自己的 GitHub fine-grained token 后，可以直接在网页上增删改查并写回仓库。

预期访问地址：

```text
https://weinachuan.github.io/flash-linear-attention-npu-io/
```

## 仓库数据文件

- `data/project-state.json`：最新项目数据快照。
- `data/audit-log.jsonl`：追加式操作日志，每行是一条 JSON 记录。
- `data/project.sqlite3`：运行时缓存，已被 `.gitignore` 忽略。

如果 GitHub 访问需要代理，服务会优先读取环境变量 `HTTP_PROXY` / `HTTPS_PROXY`；未设置时会尝试读取 Windows 用户代理配置。

## Pages 编辑模式

公开页面默认只读。需要编辑时点击“启用编辑”，输入 GitHub fine-grained token。

建议 token 设置：

- Repository access：只选择 `weinachuan/flash-linear-attention-npu-io`
- Permissions：`Contents: Read and write`
- Expiration：尽量短，例如 7 天

安全规则：

- 不要把 token 写入仓库。
- 页面只把 token 保存在当前浏览器会话的 `sessionStorage`。
- 退出编辑或关闭浏览器会话后需要重新输入。
- 可以单行保存，也可以连续修改多行后点击“保存全部”，一次 GitHub commit 写回所有待保存任务。
- 每次写回都会更新 `data/` 和 `docs/` 下的数据快照和审计日志。

## API

- `GET /api/health`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/{id}`
- `DELETE /api/tasks/{id}`
- `POST /api/tasks/{id}/split`
- `GET /api/groups`
- `POST /api/groups`
- `PATCH /api/groups/{id}`
- `DELETE /api/groups/{id}`
- `GET /api/specials`
- `POST /api/specials`
- `PATCH /api/specials/{id}`
- `DELETE /api/specials/{id}`
- `GET /api/export`

## 同步说明

本地服务写入数据后会自动执行 `git commit` 和 `git push`。如果网络需要代理，请先保证 Windows 用户代理或 `HTTP_PROXY` / `HTTPS_PROXY` 可用。
