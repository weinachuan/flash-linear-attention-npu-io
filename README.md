# flash-linear-attention-npu IO 控制台

这是一个私有项目管理控制台骨架，用于维护 `flash-linear-attention-npu` 转测计划。

## 能力

- 前端：原生 HTML/CSS/JavaScript，入口 `/io`
- 后端：Python 标准库 HTTP API
- 数据库：SQLite，默认位置 `data/project.sqlite3`
- 数据操作：任务增删改查、筛选、分组、专项、甘特图展示、双击甘特条切分、JSON 导出

## 本地运行

```powershell
python .\backend\app.py
```

浏览器打开：

```text
http://127.0.0.1:8787/io
```

首次启动会自动初始化数据库，并尝试从相邻目录的历史 `project-data.json` 和 `gantt-view.html` 导入当前转测任务。

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

## 创建 GitHub 私有仓库

当前机器没有检测到 GitHub CLI 或 GitHub token。安装并登录 GitHub CLI 后，在本目录执行：

```powershell
gh auth login
gh repo create flash-linear-attention-npu-io --private --source . --remote origin --push
```

如果你已经在 GitHub 网页上手动创建了私有仓库，也可以执行：

```powershell
git remote add origin https://github.com/<your-account>/flash-linear-attention-npu-io.git
git branch -M main
git push -u origin main
```
