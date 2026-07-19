const root = document.querySelector('#note');
const escapeHTML = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slugify = value => String(value || '').trim().toLowerCase().replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '') || 'section';

function inline(markdown) {
  let value = escapeHTML(markdown);
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return value.replace(/\[([^\]]+)\]\(((?:https?:\/\/|#)[^\s)]+)\)/g, (_, label, href) => href.startsWith('#') ? `<a href="${href}">${label}</a>` : `<a href="${href}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`);
}
function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}
function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
function isBlockStart(line, next) {
  return !line || /^#{1,6}\s/.test(line) || /^```/.test(line) || /^>\s?/.test(line) || /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^---+$/.test(line) || (line.includes('|') && isTableDivider(next || ''));
}
function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const output = [];
  const usedIds = new Map();
  const headingId = text => {
    const base = slugify(text);
    const count = usedIds.get(base) || 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^```([^\s]*)/);
    if (fence) {
      const language = fence[1] || 'text';
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(`<pre class="markdown-code ${language === 'mermaid' ? 'is-mermaid' : ''}"><code data-language="${escapeHTML(language)}">${escapeHTML(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      output.push(`<h${level} id="${headingId(title)}">${inline(title)}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith('>')) quote.push(lines[index++].replace(/^>\s?/, ''));
      const label = quote[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
      if (label) quote.shift();
      const type = label ? label[1].toLowerCase() : 'note';
      output.push(`<aside class="markdown-callout ${type}"><b>${label ? label[1] : 'NOTE'}</b><p>${inline(quote.join(' '))}</p></aside>`);
      continue;
    }
    if (line.includes('|') && isTableDivider(lines[index + 1] || '')) {
      const header = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      output.push(`<div class="markdown-table-wrap"><table><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*+]\s+/, ''));
      output.push(`<ul>${items.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\d+\.\s+/, ''));
      output.push(`<ol>${items.map(item => `<li>${inline(item)}</li>`).join('')}</ol>`);
      continue;
    }
    if (/^---+$/.test(line)) { output.push('<hr />'); index += 1; continue; }
    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines[index], lines[index + 1])) paragraph.push(lines[index++].trim());
    if (paragraph.length) output.push(`<p>${inline(paragraph.join(' '))}</p>`);
    else index += 1;
  }
  return output.join('\n');
}
function withoutDuplicateTitle(body, title) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  if (lines[0]?.replace(/^#\s+/, '').trim() === String(title || '').trim()) lines.shift();
  return lines.join('\n');
}
async function loadNote() {
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) throw new Error('没有指定笔记。');
  const response = await fetch(`/api/notes/${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error('笔记不存在或暂未发布。');
  const note = await response.json();
  document.title = `${note.title} · 金羽`;
  root.innerHTML = `<header class="note-hero"><a class="note-back" href="notes.html">← 返回笔记</a><p class="eyebrow">${escapeHTML(note.date)}</p><h1>${escapeHTML(note.title)}</h1><p class="note-summary">${escapeHTML(note.summary)}</p><div class="note-tags">${(note.tags || []).map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}</div></header><section class="markdown-body">${renderMarkdown(withoutDuplicateTitle(note.body, note.title))}</section>`;
}
loadNote().catch(error => { root.innerHTML = `<section class="note-error"><p class="eyebrow">NOTE ERROR</p><h1>这篇笔记暂时无法打开。</h1><p>${escapeHTML(error.message)}</p><a class="button button-primary" href="notes.html">返回笔记列表 <span>←</span></a></section>`; });
