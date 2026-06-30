const $ = id => document.getElementById(id);
const request = (url, options = {}) => fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options }).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || '请求失败');
  return data;
});
const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const today = () => new Date().toISOString().slice(0, 10);
const tags = items => (items || []).map(tag => `<span>${escape(tag)}</span>`).join('');
const state = { projects: [], notes: [], projectId: '', noteSlug: '' };

function notify(message, type = 'success') {
  const toast = $('status');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}
function setBusy(button, busy) { button.disabled = busy; button.dataset.label ||= button.innerHTML; if (busy) button.textContent = '正在保存…'; else button.innerHTML = button.dataset.label; }
function renderProjects() {
  $('project-count').textContent = `${state.projects.length} 个项目`;
  $('project-cards').innerHTML = state.projects.map(project => `<button class="item-card project-card ${project.id === state.projectId ? 'selected' : ''}" type="button" data-project-id="${escape(project.id)}"><span class="card-symbol">↗</span><span class="card-copy"><strong>${escape(project.title)}</strong><small>${escape(project.summary)}</small><span class="tag-row">${tags(project.tags)}</span></span></button>`).join('') || '<p class="empty-state">还没有项目。点击“新建项目”创建第一张卡片。</p>';
  document.querySelectorAll('[data-project-id]').forEach(card => card.addEventListener('click', () => selectProject(card.dataset.projectId)));
}
function renderNotes() {
  $('note-count').textContent = `${state.notes.length} 篇笔记`;
  $('note-cards').innerHTML = state.notes.map(note => `<button class="item-card note-card ${note.slug === state.noteSlug ? 'selected' : ''}" type="button" data-note-slug="${escape(note.slug)}"><span class="card-date">${escape(note.date)}</span><span class="card-copy"><strong>${escape(note.title)}</strong><small>${escape(note.summary)}</small><span class="tag-row">${tags(note.tags)}</span></span><i>${note.draft ? '草稿' : '已发布'}</i></button>`).join('') || '<p class="empty-state">还没有笔记。点击“新建笔记”开始记录。</p>';
  document.querySelectorAll('[data-note-slug]').forEach(card => card.addEventListener('click', () => selectNote(card.dataset.noteSlug)));
}
function newProject() {
  state.projectId = '';
  $('project-form').reset();
  $('project-form-mode').textContent = '新建项目';
  $('delete-project').hidden = true;
  renderProjects();
}
function selectProject(id) {
  const project = state.projects.find(item => item.id === id);
  if (!project) return newProject();
  state.projectId = project.id;
  $('project-title').value = project.title || '';
  $('project-url').value = project.url || '';
  $('project-summary').value = project.summary || '';
  $('project-tags').value = (project.tags || []).join(', ');
  $('project-form-mode').textContent = '编辑项目';
  $('delete-project').hidden = false;
  renderProjects();
}
function newNote() {
  state.noteSlug = '';
  $('note-form').reset();
  $('note-date').value = today();
  $('note-slug').disabled = false;
  $('note-form-mode').textContent = '新建笔记';
  $('note-status').textContent = '草稿';
  $('delete-note').hidden = true;
  renderNotes();
}
function selectNote(slug) {
  const note = state.notes.find(item => item.slug === slug);
  if (!note) return newNote();
  state.noteSlug = note.slug;
  $('note-slug').value = note.slug;
  $('note-slug').disabled = true;
  $('note-title').value = note.title || '';
  $('note-date').value = note.date || '';
  $('note-summary').value = note.summary || '';
  $('note-tags').value = (note.tags || []).join(', ');
  $('note-body').value = note.body || '';
  $('note-draft').checked = Boolean(note.draft);
  $('note-form-mode').textContent = '编辑笔记';
  $('note-status').textContent = note.draft ? '草稿' : '已发布';
  $('delete-note').hidden = false;
  renderNotes();
}
async function loadState() {
  const data = await request('/api/admin/state');
  state.projects = data.projects || [];
  state.notes = data.notes || [];
  renderProjects();
  renderNotes();
}
async function saveProject(event) {
  event.preventDefault();
  const button = $('save-project');
  setBusy(button, true);
  try {
    const payload = { title: $('project-title').value, url: $('project-url').value, summary: $('project-summary').value, tags: $('project-tags').value.split(',').map(value => value.trim()).filter(Boolean) };
    const project = await request(state.projectId ? `/api/admin/projects/${encodeURIComponent(state.projectId)}` : '/api/admin/projects', { method: state.projectId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    state.projectId = project.id;
    await loadState();
    selectProject(project.id);
    notify('项目已保存，并同步到 GitHub。');
  } catch (error) { notify(error.message, 'error'); } finally { setBusy(button, false); }
}
async function saveNote(event) {
  event.preventDefault();
  const button = $('save-note');
  setBusy(button, true);
  try {
    const slug = state.noteSlug || $('note-slug').value.trim();
    const payload = { title: $('note-title').value, date: $('note-date').value, summary: $('note-summary').value, tags: $('note-tags').value.split(',').map(value => value.trim()).filter(Boolean), draft: $('note-draft').checked, body: $('note-body').value };
    const note = await request(`/api/admin/notes/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) });
    state.noteSlug = note.slug;
    await loadState();
    selectNote(note.slug);
    notify(note.draft ? '笔记已保存为草稿。' : '笔记已发布，并同步到 GitHub。');
  } catch (error) { notify(error.message, 'error'); } finally { setBusy(button, false); }
}
async function removeProject() {
  if (!state.projectId || !confirm('确定删除这个项目吗？此操作不可撤销。')) return;
  try { await request(`/api/admin/projects/${encodeURIComponent(state.projectId)}`, { method: 'DELETE' }); await loadState(); newProject(); notify('项目已删除，并同步到 GitHub。'); } catch (error) { notify(error.message, 'error'); }
}
async function removeNote() {
  if (!state.noteSlug || !confirm('确定删除这篇笔记吗？对应 Markdown 文件也会删除。')) return;
  try { await request(`/api/admin/notes/${encodeURIComponent(state.noteSlug)}`, { method: 'DELETE' }); await loadState(); newNote(); notify('笔记已删除，并同步到 GitHub。'); } catch (error) { notify(error.message, 'error'); }
}

if ($('project-form')) {
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.tab, .panel').forEach(element => element.classList.remove('active')); tab.classList.add('active'); $(tab.dataset.panel).classList.add('active'); }));
  $('new-project').addEventListener('click', newProject);
  $('new-note').addEventListener('click', newNote);
  $('project-form').addEventListener('submit', saveProject);
  $('note-form').addEventListener('submit', saveNote);
  $('delete-project').addEventListener('click', removeProject);
  $('delete-note').addEventListener('click', removeNote);
  $('note-draft').addEventListener('change', event => { $('note-status').textContent = event.target.checked ? '草稿' : '已发布'; });

  (async () => {
    try {
      const session = await request('/api/admin/session');
      if (!session.authenticated) return location.replace('/admin.html');
      await loadState();
      newNote();
      newProject();
    } catch { location.replace('/admin.html'); }
  })();
}

if ($('login')) {
  const loginForm = $('login');
  const message = $('login-status');
  const loginError = new URLSearchParams(location.search).get('error');
  if (loginError === 'password') message.textContent = '密码不正确，请重新输入。';
  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    message.textContent = '正在验证…';
    try {
      await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: loginForm.password.value }) });
      message.textContent = '验证成功，正在进入后台…';
      location.replace('/dashboard.html');
    } catch (error) {
      message.textContent = error.message || '验证失败，请稍后重试。';
    } finally { button.disabled = false; }
  });
  request('/api/admin/session').then(session => { if (session.authenticated) location.replace('/dashboard.html'); }).catch(() => {});
}
