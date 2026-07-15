# 508 宿舍网站

508 宿舍成员、旅行、照片与共同回忆的线上空间。

- 线上地址：[https://www.508dorm.top/](https://www.508dorm.top/)
- 当前版本：`2.0.1`
- 运行平台：Cloudflare Workers + D1 + Workers Assets

## 项目定位

网站用于展示宿舍成员、旅行记录和照片，并提供用户注册登录、留言板以及管理员照片和账号管理功能。2.0.1 延续摄影优先、留白克制的 Apple 风格设计：黑白与浅灰表面、单一蓝色交互色、紧凑标题字距和胶囊按钮。

本项目没有使用 React、Vue 或前端构建框架。页面由原生 HTML、CSS 和 JavaScript 构成，后端由 Hono 驱动的 Cloudflare Worker 提供。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | HTML、CSS、原生 JavaScript |
| 后端 | Cloudflare Workers、Hono |
| 数据库 | Cloudflare D1（SQLite） |
| 认证 | JWT、bcryptjs |
| 静态资源 | Cloudflare Workers Assets |
| 测试 | Node.js `node:test`、`node:sqlite` |
| 部署 | Wrangler |

## 目录结构

```text
508dorm/
├─ public/                 # 对外发布的全部静态资源
│  ├─ index.html           # 单页网站入口
│  ├─ css/style.css        # Apple 风格设计系统与响应式样式
│  ├─ js/auth.js           # 登录、注册、管理员认证
│  ├─ js/main.js           # 导航、统计、照片墙、彩蛋、留言板
│  ├─ image/               # 成员照片
│  ├─ PhotoWall/           # 内置照片墙资源
│  └─ travel/              # 旅行图片
├─ src/worker.js           # Worker 入口与全部 API
├─ migrations/             # D1 数据库迁移
├─ test/auth.test.mjs      # 认证、权限、留言和照片测试
├─ wrangler.toml           # Cloudflare Worker、D1 与资源配置
├─ server.js               # 仅用于静态页面预览的旧 Express 入口
├─ package.json
└─ README.md
```

`awesome-design-md-main/` 是本地设计参考资料库，已被 Git 忽略，不属于网站发布内容。

## 本地开发

### 环境要求

- Node.js 22 或更高版本
- npm
- 可通过 `npx` 使用 Wrangler

### 安装依赖

```bash
npm install
```

### 配置本地密钥

在项目根目录新建 `.dev.vars`：

```dotenv
JWT_SECRET=替换为足够长的随机字符串
ADMIN_PASSWORD=替换为管理员密码
```

`.dev.vars` 已加入 `.gitignore`，不要把真实密钥写进源码、README 或提交记录。

### 初始化本地数据库

```bash
npx wrangler d1 migrations apply dorm508-db --local
```

### 启动完整开发环境

```bash
npx wrangler dev
```

使用 Wrangler 才能同时运行静态页面、Worker API 和本地 D1。`npm start` 启动的 Express 服务仅适合预览静态页面，登录、留言和照片接口不会工作。

## 测试

```bash
npm test
```

当前测试覆盖：

- 邮箱规范化、唯一性与两种登录方式
- 旧账号按用户名登录
- 邮箱和用户名输入校验
- 用户只能删除自己的留言
- 管理员二次认证
- 只有管理员可以删除上传照片

修改认证、数据库或权限逻辑后，应先运行测试再部署。

## API 概览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/health` | 健康检查 | 公开 |
| `POST` | `/api/register` | 注册账号 | 公开 |
| `POST` | `/api/login` | 用户名或邮箱登录 | 公开 |
| `GET` | `/api/me` | 获取当前用户 | 用户 JWT |
| `POST` | `/api/admin/login` | 获取管理员权限 | 用户 JWT + 管理员密码 |
| `GET` | `/api/admin/me` | 校验管理员状态 | 管理员 JWT |
| `GET` | `/api/admin/users` | 获取已注册账号 | 管理员 JWT |
| `DELETE` | `/api/admin/users/:id` | 删除账号及其留言、照片 | 管理员 JWT |
| `GET` | `/api/photos` | 获取上传照片列表 | 公开 |
| `GET` | `/api/photos/:id/image` | 获取照片内容 | 公开 |
| `POST` | `/api/photos` | 上传照片 | 管理员 JWT |
| `DELETE` | `/api/photos/:id` | 删除照片 | 管理员 JWT |
| `GET` | `/api/messages` | 获取留言 | 公开 |
| `POST` | `/api/messages` | 发布留言 | 用户 JWT |
| `DELETE` | `/api/messages/:id` | 删除自己的留言 | 留言所有者 |

上传照片支持 JPG、PNG 和 WebP。前端会先压缩图片，Worker 接受的单张图片上限为 1.5 MB，图片数据目前存储在 D1 的 BLOB 字段中。

## 数据库迁移

迁移文件按编号顺序执行：

1. `0001_init.sql`：用户和留言基础表
2. `0002_add_user_email.sql`：用户邮箱与唯一索引
3. `0003_add_message_owner.sql`：留言所有者关联
4. `0004_add_photos.sql`：管理员上传照片

应用本地迁移：

```bash
npx wrangler d1 migrations apply dorm508-db --local
```

应用线上迁移：

```bash
npx wrangler d1 migrations apply dorm508-db --remote
```

新增迁移时不要修改已经在线上执行过的旧文件，应新建下一个编号文件并同步补充测试。

## 部署

首次配置或需要更新线上密钥时：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PASSWORD
```

正式部署：

```bash
npx wrangler deploy
```

部署前确认：

1. `npm test` 全部通过。
2. 数据库迁移已经应用到远端。
3. `public/` 中不存在缓存、源码或设计参考资料。
4. 登录、留言和照片接口的权限模型没有被意外放宽。

## 设计约定

- 交互色统一使用 `#0066cc`，深色表面链接使用 `#2997ff`。
- 页面主要使用白色、`#f5f5f7` 浅灰和近黑色表面。
- 标题采用系统字体栈、600 字重和轻微负字距；正文默认 17px。
- 优先通过留白和表面变化建立层级，不给普通卡片添加重阴影。
- 按钮和主要输入控件采用胶囊形态，触摸区域不小于 44px。
- 首页保持纯文字首屏；旅行区和照片墙承担主要影像展示。
- 保留移动端菜单、键盘焦点、减少动态效果和图片替代文本等无障碍能力。

设计参考文件位于本地：

```text
awesome-design-md-main/design-md/apple/DESIGN.md
```

该规范是第三方分析，不是 Apple 官方设计系统。

## 认证与权限说明

- 普通登录令牌保存在浏览器 `localStorage`。
- 管理员令牌保存在 `sessionStorage`，关闭会话后失效。
- 管理员登录必须先完成普通用户登录，再校验 `ADMIN_PASSWORD`。
- 用户只能删除自己发布的留言。
- 照片上传和删除仅允许管理员执行。
- 所有受保护接口都应在服务端校验 JWT，不能只依赖前端隐藏按钮。

## 版本记录

### 2.0.1

- 新增 `/admin` 管理员账号管理页面
- 支持搜索、查看和刷新全部已注册账号
- 支持删除非当前管理员账号，并同步清理其留言和上传照片
- 在首页管理员状态区域增加后台入口

### 2.0.0

- 全面改为 Apple 风格视觉系统
- 将可发布静态资源集中到 `public/`
- 增加邮箱注册登录、留言所有权和管理员二次认证
- 增加管理员照片上传、压缩与删除
- 增加隐藏成员彩蛋与完整响应式布局

### 1.0.0

- 初始彩色视觉版本
- 成员、旅行、照片墙和基础留言功能

## 后续开发原则

1. 前端资源只放入 `public/`，Worker 和迁移源码不要放入静态资源目录。
2. 新接口统一使用 `/api/` 前缀，并返回包含 `ok` 字段的 JSON。
3. 数据库结构变化必须通过新迁移文件完成。
4. 涉及登录、所有权或管理员能力的变更必须补充自动化测试。
5. 不提交 `.dev.vars`、`.env`、数据库文件、缓存或设计资料库。
6. 发布新版本时同步更新 `package.json`、`package-lock.json` 和本文件的版本记录。
