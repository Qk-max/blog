---
title: # Node.js 小白入门：用个人网站理解 JavaScript 后端
date: 2026-07-31
summary: Node.js部署实践心得
tags: Node.js
draft: false
---
## 目录

1. [Node.js 是什么](#nodejs-是什么)
2. [JavaScript 为什么能运行在服务器](#javascript-为什么能运行在服务器)
3. [事件循环和异步 I/O](#事件循环和异步-io)
4. [我的项目结构](#我的项目结构)
5. [最小 HTTP 服务](#最小-http-服务)
6. [网站 API 如何工作](#网站-api-如何工作)
7. [Markdown、JSON 和 GitHub 同步](#markdownjson-和-github-同步)
8. [认证与安全](#认证与安全)
9. [运行、调试和扩展](#运行调试和扩展)

## Node.js 是什么

Node.js 不是一种新的编程语言，而是让 JavaScript 能在服务器运行的运行时环境。

```text
JavaScript 代码
      ↓
Node.js 运行时
      ↓
服务器进程、文件、网络和 API
```

浏览器中的 JavaScript 主要操作页面；Node.js 中的 JavaScript 可以创建 HTTP 服务、读写文件、访问数据库、发起网络请求和读取环境变量。

本项目使用 JavaScript 的 ES Modules：

```javascript
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
```

## JavaScript 为什么能运行在服务器

Node.js 使用 V8 JavaScript 引擎执行代码，并在 V8 之上增加服务器模块：

- `node:http`：创建 HTTP 服务。
- `node:fs/promises`：异步读取和写入文件。
- `node:crypto`：HMAC 签名和随机 ID。
- `fetch`：调用 GitHub API。

前端代码不能直接读取服务器密码文件；Node.js 后端可以读取环境变量，但不会把它返回给浏览器。

## 事件循环和异步 I/O

Node.js 的关键特点是事件循环和非阻塞 I/O。读取 Markdown 时，它不会一直占用线程等待磁盘完成，而是让事件循环继续处理其他请求，读取完成后再继续当前任务。

```text
请求到达
  ↓
发起异步读取
  ↓
事件循环处理其他请求
  ↓
读取完成
  ↓
继续执行并返回响应
```

这适合个人网站，因为主要工作是等待 I/O：读取 JSON、读取 Markdown、调用 GitHub API 和发送响应。

Node.js 不适合所有任务。视频编码、复杂图像处理等 CPU 密集型工作会阻塞事件循环，应拆分到工作进程或独立服务。

## 我的项目结构

```text
portfolio/
├── server.mjs       # HTTP 服务、路由、认证和 GitHub API
├── index.html       # 首页
├── projects.html    # 项目页
├── notes.html       # 笔记列表
├── note.html        # 单篇笔记页
├── content.js       # 前台 API 调用和卡片渲染
├── note.js          # Markdown 渲染
├── admin.js         # 后台交互
├── content/
│   ├── projects.json
│   └── notes/*.md
└── Dockerfile
```

页面是静态 HTML 外壳，内容通过 Node.js API 动态加载。修改项目或笔记时不需要手动重写每个页面。

## 最小 HTTP 服务

```javascript
import { createServer } from 'node:http';

const server = createServer((request, response) => {
  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8'
  });
  response.end('Hello Node.js');
});

server.listen(3000, () => {
  console.log('server listening on 3000');
});
```

运行：

```bash
node server.mjs
```

浏览器访问 `http://localhost:3000` 就会收到响应。我的服务在此基础上增加了路径判断、文件读取、JSON 响应、Cookie 验证和错误处理。

## 网站 API 如何工作

前端请求项目：

```javascript
const response = await fetch('/api/projects');
const projects = await response.json();
```

Node.js 根据方法和路径路由：

```javascript
if (request.method === 'GET' && url.pathname === '/api/projects') {
  return json(response, 200, await readProjects());
}
```

笔记接口的流程：

1. 从 URL 取得 slug，例如 `linux`。
2. 拼出 `content/notes/linux.md`。
3. 读取 Markdown 文件。
4. 解析 Front Matter 元数据。
5. 返回标题、日期、标签和正文 JSON。
6. 浏览器的 Markdown 渲染器生成文章页面。

返回 JSON 可以让页面结构和内容数据分离，后台保存后前台不需要重新写死 HTML。

## Markdown、JSON 和 GitHub 同步

项目资料适合 JSON，笔记正文适合 Markdown：

- JSON 结构固定，适合标题、链接、简介和标签。
- Markdown 适合长文本，便于阅读和 Git diff。
- 两者都是纯文本，易迁移、易备份。

后台保存笔记时，流程是：

```text
浏览器提交表单
      ↓
Node.js 验证登录和字段
      ↓
生成 Markdown
      ↓
调用 GitHub Contents API
      ↓
GitHub 创建内容提交
      ↓
写入服务器本地 content 目录
```

Token 只从服务端环境变量读取：

```javascript
const token = process.env.GITHUB_TOKEN;
```

它不能出现在前端 JS、HTML 或浏览器 Local Storage 中。本地学习时可以不配置 Token，仅使用本地内容读写。

## 认证与安全

登录成功后，服务端生成带过期时间的会话值，并使用 HMAC-SHA256 签名，再放入 Cookie。后续请求会检查 Cookie 是否存在、签名是否正确以及是否过期。

项目中的基础措施：

- 密码只从环境变量读取。
- GitHub Token 不发送给前端。
- Cookie 使用 `HttpOnly` 和 `SameSite=Strict`。
- 项目链接限制为 `http://` 或 `https://`。
- slug 只允许小写字母、数字和连字符。
- 输出标题、摘要和标签前进行 HTML 转义。
- API 对字段长度进行限制。

继续生产化时，还可以增加登录限流、CSRF Token、操作审计、多管理员账号和完整 Markdown 解析库。

## 运行、调试和扩展

本地启动：

```bash
node portfolio/server.mjs
```

检查 API：

```bash
curl http://localhost:3000/api/projects
curl http://localhost:3000/api/notes
```

Docker 中查看日志：

```bash
docker logs --tail 100 jinyu-portfolio
```

建议的排查顺序：

1. 看 Node.js 进程是否启动。
2. 看服务端日志是否有异常。
3. 直接请求 API，判断问题在后端还是前端。
4. 查看浏览器 Network 面板中的状态码和响应。
5. 最后检查 Caddy、DNS 和 HTTPS。
