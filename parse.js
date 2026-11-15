// Small, dependency-free Markdown renderer. Parsing is performed afresh for each call.
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function inline(source) {
  // Resolve numeric character references using the same Unicode validity bounds
  // used by HTML, and escape ampersands that do not begin a valid reference.
  source = source.replace(/&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));|&(?!(?:#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]+);)/g, (m, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = Number.parseInt(dec ?? hex, dec === undefined ? 16 : 10);
    return !cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : cp === 38 ? '&amp;' : String.fromCodePoint(cp);
  });
  source = source.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
  source = source.replace(/\\\n/g, '<br>');
  source = source.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g, (m, lead, url) => {
    const clean = url.replace(/[.,!?;:]+$/, '');
    const suffix = url.slice(clean.length);
    const href = clean.includes('@') && !/^[a-z]+:/i.test(clean) ? `mailto:${clean}` : clean.startsWith('www.') ? `http://${clean}` : clean;
    return `${lead}<a href="${escapeHtml(href)}">${escapeHtml(clean)}</a>${suffix}`;
  });
  let out = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === '\\' && i + 1 < source.length) {
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) { out += escapeHtml(source[i + 1]); i += 2; continue; }
    }
    if (c === '`') {
      let n = 1; while (source[i + n] === '`') n++;
      const mark = '`'.repeat(n), end = source.indexOf(mark, i + n);
      if (end >= 0) { let text = source.slice(i + n, end).replace(/\n/g, ' '); if (/^ .* $/.test(text) && /[^ ]/.test(text)) text = text.slice(1, -1); out += '<code>' + escapeHtml(text) + '</code>'; i = end + n; continue; }
    }
    if (source.startsWith('**', i) || source.startsWith('__', i) || source.startsWith('~~', i) || c === '*' || c === '_') {
      const mark = source.startsWith('**', i) || source.startsWith('__', i) || source.startsWith('~~', i) ? source.slice(i, i + 2) : c;
      const end = source.indexOf(mark, i + mark.length);
      if (end > i + mark.length) { const tag = mark.length === 2 ? (mark === '~~' ? 'del' : 'strong') : 'em'; out += `<${tag}>${inline(source.slice(i + mark.length, end))}</${tag}>`; i = end + mark.length; continue; }
    }
    if (c === '<') { const e = source.indexOf('>', i + 1); if (e >= 0) { const raw = source.slice(i, e + 1); if (/^<\/?[A-Za-z][^>]*>$/.test(raw) || /^<!--/.test(raw) || /^<https?:\/\/[^ >]+>$/.test(raw) || /^<[^ <>@]+@[^ <>]+>$/.test(raw)) { out += raw; i = e + 1; continue; } } }
    if (c === '&') { const m = source.slice(i).match(/^&(?:#\d{1,7}|#x[\da-f]{1,6}|[A-Za-z][A-Za-z\d]+);/i); if (m) { out += m[0]; i += m[0].length; continue; } }
    if (c === '\n') {
      let spaces = 0; for (let p = out.length - 1; p >= 0 && out[p] === ' '; p--) spaces++;
      if (spaces >= 2) { out = out.slice(0, -spaces); out += '<br>'; }
      out += '\n'; i++; continue;
    }
    out += escapeHtml(c); i++;
  }
  return out;
}

function renderBlocks(markdown) {
  const src = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  const blank = s => /^[ ]*$/.test(s);
  while (i < lines.length) {
    if (blank(lines[i])) { i++; continue; }
    let m;
    if ((m = lines[i].match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*#*\s*$/))) { const d = m[1].length; out.push(`<h${d}>${inline(m[2].trim())}</h${d}>\n`); i++; continue; }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(lines[i])) { out.push('<hr>\n'); i++; continue; }
    if ((m = lines[i].match(/^ {0,3}(?:```+|~~~+)/))) {
      const fence = m[0].trim(), lang = lines[i].slice(m[0].length).trim().split(/[ \t]/)[0]; let j = i + 1;
      while (j < lines.length && !new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$').test(lines[j])) j++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(lines.slice(i + 1, j).join('\n'))}${j > i + 1 ? '\n' : ''}</code></pre>\n`); i = Math.min(j + 1, lines.length); continue;
    }
    if ((m = lines[i].match(/^ {0,3}> ?(.*)$/))) {
      const q = []; while (i < lines.length && (m = lines[i].match(/^ {0,3}> ?(.*)$/))) { q.push(m[1]); i++; }
      out.push(`<blockquote>\n${renderBlocks(q.join('\n'))}</blockquote>\n`); continue;
    }
    if ((m = lines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/))) {
      const ordered = /^\d/.test(m[1]), tag = ordered ? 'ol' : 'ul', items = [];
      while (i < lines.length && (m = lines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/)) && /^\d/.test(m[1]) === ordered) { items.push(m[2]); i++; }
      out.push(`<${tag}>\n${items.map(x => `<li>${inline(x)}</li>\n`).join('')}</${tag}>\n`); continue;
    }
    if (i + 1 < lines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[i + 1])) { const d = lines[i + 1].trim()[0] === '=' ? 1 : 2; out.push(`<h${d}>${inline(lines[i].trim())}</h${d}>\n`); i += 2; continue; }
    let j = i + 1;
    while (j < lines.length && !blank(lines[j]) && !/^ {0,3}(?:#{1,6}(?:\s|$)|>|```|~~~|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(lines[j])) j++;
    out.push(`<p>${inline(lines.slice(i, j).join('\n'))}</p>\n`); i = j;
  }
  return out.join('');
}

/** Render a Markdown string into HTML. */
export function parse(markdown) {
  return renderBlocks(String(markdown));
}
