import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, unlink, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = normalize(process.env.SITE_ROOT || fileURLToPath(new URL('.', import.meta.url)));
const content = process.env.CONTENT_ROOT || join(site, 'content');
const projectFile = join(content, 'projects.json');
const token = process.env.GITHUB_TOKEN;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const repo = process.env.GITHUB_REPOSITORY || 'Qk-max/blog';
const branch = process.env.GITHUB_BRANCH || 'main';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const noStore = { 'cache-control': 'no-store, no-cache, must-revalidate, private', pragma: 'no-cache', expires: '0' };

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...noStore }); res.end(JSON.stringify(body)); };
const readJson = request => new Promise((resolve, reject) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) request.destroy(); });
  request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('JSON 格式无效')); } });
});
const readLogin = request => new Promise((resolve, reject) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; if (raw.length > 20_000) request.destroy(); });
  request.on('end', () => {
    try {
      if (String(request.headers['content-type'] || '').includes('application/json')) return resolve(JSON.parse(raw || '{}'));
      return resolve({ password: new URLSearchParams(raw).get('password') || '' });
    } catch { reject(new Error('登录数据无效')); }
  });
});
const cookies = request => Object.fromEntries((request.headers.cookie || '').split(';').map(value => value.trim().split('=').map(decodeURIComponent)).filter(value => value.length === 2));
const sign = value => createHmac('sha256', sessionSecret || 'missing').update(value).digest('hex');
const authed = request => {
  const value = cookies(request).admin_session;
  if (!value || !sessionSecret) return false;
  const [payload, signature] = value.split('.');
  const expected = Buffer.from(sign(payload || ''));
  const supplied = Buffer.from(signature || '');
  return Boolean(payload && signature && supplied.length === expected.length && timingSafeEqual(expected, supplied) && Number(payload) > Date.now());
};
const safeSlug = slug => /^[a-z0-9-]{1,80}$/.test(slug || '');
const notePath = slug => join(content, 'notes', `${slug}.md`);
const text = (value, limit) => String(value || '').trim().replace(/[\r\n]+/g, ' ').slice(0, limit);
const tagList = value => (Array.isArray(value) ? value : String(value || '').split(',')).map(tag => text(tag, 24).replace(/,/g, ' ')).filter(Boolean).slice(0, 8);

const parseNote = raw => {
  const [, header = '', body = raw] = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/) || [];
  const metadata = Object.fromEntries(header.split(/\r?\n/).map(line => line.split(/:\s*/, 2)).filter(parts => parts[0]));
  return { ...metadata, tags: (metadata.tags || '').split(',').filter(Boolean), draft: metadata.draft === 'true', body };
};
const serialise = note => `---\ntitle: ${text(note.title, 120)}\ndate: ${note.date}\nsummary: ${text(note.summary, 280)}\ntags: ${tagList(note.tags).join(',')}\ndraft: ${Boolean(note.draft)}\n---\n${String(note.body || '').trim()}\n`;

async function github(path, data, message, method = 'PUT') {
  if (!token) throw new Error('服务器未配置 GitHub 写入令牌');
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const current = await fetch(`${url}?ref=${branch}`, { headers });
  if (current.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
  if (current.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
  if (method === 'DELETE' && current.status === 404) return;
  if (method === 'PUT' && current.status === 404) {
    const response = await fetch(url, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ message, content: Buffer.from(data).toString('base64'), branch }) });
    if (response.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
    if (response.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
    if (!response.ok) throw new Error('GitHub 保存失败');
    return;
  }
  if (!current.ok) throw new Error('无法读取 GitHub 文件，请检查仓库名称和分支设置');
  const sha = (await current.json()).sha;
  const body = method === 'DELETE'
    ? { message, sha, branch }
    : { message, content: Buffer.from(data).toString('base64'), branch, ...(sha ? { sha } : {}) };
  const response = await fetch(url, { method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status === 401) throw new Error('GitHub 授权已失效，请更新服务器的 GITHUB_TOKEN');
  if (response.status === 403) throw new Error('GitHub 令牌没有内容写入权限，请授予 Contents 读写权限');
  if (!response.ok) throw new Error(method === 'DELETE' ? 'GitHub 删除失败' : 'GitHub 保存失败');
}

const readProjects = async () => {
  const raw = JSON.parse(await readFile(projectFile, 'utf8'));
  return raw.map((project, index) => ({ ...project, id: project.id || `legacy-project-${index + 1}` }));
};
const saveProjects = async (projects, message) => {
  const raw = JSON.stringify(projects, null, 2) + '\n';
  await github('portfolio/content/projects.json', raw, message);
  await writeFile(projectFile, raw);
};
const cleanProject = (input, previous = {}) => {
  const title = text(input.title, 100);
  const url = String(input.url || '').trim().slice(0, 600);
  const summary = text(input.summary, 360);
  if (!title || !url || !summary) throw new Error('请填写项目标题、链接和简介');
  if (!/^https?:\/\//i.test(url)) throw new Error('项目链接必须以 http:// 或 https:// 开头');
  return { ...previous, title, url, summary, tags: tagList(input.tags) };
};
const readNotes = async (includeDraft = false) => {
  await mkdir(join(content, 'notes'), { recursive: true });
  const files = await readdir(join(content, 'notes'));
  const list = await Promise.all(files.filter(file => file.endsWith('.md')).map(async file => ({ slug: file.slice(0, -3), ...parseNote(await readFile(join(content, 'notes', file), 'utf8')) })));
  return list.filter(note => includeDraft || !note.draft).sort((a, b) => b.date.localeCompare(a.date));
};
const cleanNote = input => {
  const title = text(input.title, 120);
  const summary = text(input.summary, 280);
  const date = String(input.date || '').trim();
  const body = String(input.body || '').trim().slice(0, 50_000);
  if (!title || !summary || !date || !body) throw new Error('请填写笔记标题、日期、摘要和正文');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('发布日期格式不正确');
  return { title, date, summary, tags: tagList(input.tags), draft: Boolean(input.draft), body };
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (request.method === 'GET' && url.pathname === '/api/projects') return json(response, 200, await readProjects());
    if (request.method === 'GET' && url.pathname === '/api/notes') return json(response, 200, await readNotes());
    if (request.method === 'GET' && url.pathname.startsWith('/api/notes/')) {
      const slug = decodeURIComponent(url.pathname.split('/').pop());
      if (!safeSlug(slug)) return json(response, 400, { error: '无效笔记标识' });
      return json(response, 200, { slug, ...parseNote(await readFile(notePath(slug), 'utf8')) });
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      const { password } = await readLogin(request);
      const supplied = Buffer.from(password || '');
      const expected = Buffer.from(adminPassword || '');
      const formLogin = !String(request.headers['content-type'] || '').includes('application/json');
      if (!adminPassword || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        if (formLogin) { response.writeHead(303, { location: '/admin.html?error=password', ...noStore }); return response.end(); }
        return json(response, 401, { error: '密码错误' });
      }
      const payload = String(Date.now() + 12 * 3600_000);
      const secure = request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
      const cookie = `admin_session=${payload}.${sign(payload)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`;
      if (formLogin) { response.writeHead(303, { location: '/dashboard.html', 'set-cookie': cookie, ...noStore }); return response.end(); }
      response.setHeader('Set-Cookie', cookie);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/session') return json(response, 200, { authenticated: authed(request) });
    if (url.pathname.startsWith('/api/admin/')) {
      if (!authed(request)) return json(response, 401, { error: '请先登录' });
      if (request.method === 'GET' && url.pathname === '/api/admin/state') return json(response, 200, { projects: await readProjects(), notes: await readNotes(true) });
      if (request.method === 'POST' && url.pathname === '/api/admin/projects') {
        const projects = await readProjects();
        const project = { id: randomUUID(), ...cleanProject(await readJson(request)) };
        projects.unshift(project);
        await saveProjects(projects, `content: add project ${project.id}`);
        return json(response, 201, project);
      }
      const projectMatch = url.pathname.match(/^\/api\/admin\/projects\/([\w-]+)$/);
      if (projectMatch && request.method === 'PUT') {
        const projects = await readProjects();
        const index = projects.findIndex(project => project.id === projectMatch[1]);
        if (index < 0) return json(response, 404, { error: '项目不存在' });
        projects[index] = cleanProject(await readJson(request), projects[index]);
        await saveProjects(projects, `content: update project ${projects[index].id}`);
        return json(response, 200, projects[index]);
      }
      if (projectMatch && request.method === 'DELETE') {
        const projects = await readProjects();
        const project = projects.find(item => item.id === projectMatch[1]);
        if (!project) return json(response, 404, { error: '项目不存在' });
        await saveProjects(projects.filter(item => item.id !== project.id), `content: remove project ${project.id}`);
        return json(response, 200, { deleted: true });
      }
      if (request.method === 'PUT' && url.pathname.startsWith('/api/admin/notes/')) {
        const slug = decodeURIComponent(url.pathname.split('/').pop());
        if (!safeSlug(slug)) return json(response, 400, { error: '笔记标识只能使用小写英文、数字和连字符' });
        const note = cleanNote(await readJson(request));
        const raw = serialise(note);
        await github(`portfolio/content/notes/${slug}.md`, raw, `content: update note ${slug}`);
        await mkdir(join(content, 'notes'), { recursive: true });
        await writeFile(notePath(slug), raw);
        return json(response, 200, { slug, ...note });
      }
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/admin/notes/')) {
        const slug = decodeURIComponent(url.pathname.split('/').pop());
        if (!safeSlug(slug)) return json(response, 400, { error: '无效笔记标识' });
        try { await readFile(notePath(slug), 'utf8'); } catch { return json(response, 404, { error: '笔记不存在' }); }
        await github(`portfolio/content/notes/${slug}.md`, '', `content: remove note ${slug}`, 'DELETE');
        await unlink(notePath(slug));
        return json(response, 200, { deleted: true });
      }
    }
    if (request.method === 'GET' && url.pathname === '/dashboard.html' && !authed(request)) { response.writeHead(303, { location: '/admin.html', ...noStore }); return response.end(); }
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const path = normalize(join(site, requested));
    if (relative(site, path).startsWith('..')) throw new Error('not found');
    const data = await readFile(path);
    const filename = url.pathname.split('/').pop();
    const adminFile = ['admin.html', 'dashboard.html', 'admin.js', 'admin.css'].includes(filename);
    response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', ...(adminFile ? noStore : {}) });
    return response.end(data);
  } catch (error) {
    return json(response, error.message === 'not found' ? 404 : 500, { error: error.message || '服务错误' });
  }
}).listen(process.env.PORT || 3000, () => console.log('portfolio CMS listening'));
