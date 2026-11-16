// Small, dependency-free Markdown renderer. Parsing is performed afresh for each call.
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function inline(source, refs = Object.create(null)) {
  // Resolve numeric character references using the same Unicode validity bounds
  // used by HTML, and escape ampersands that do not begin a valid reference.
  source = source.replace(/&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));|&(?!(?:#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]+);)/g, (m, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = Number.parseInt(dec ?? hex, dec === undefined ? 16 : 10);
    return !cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : cp === 38 ? '&amp;' : String.fromCodePoint(cp);
  });
  source = source.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
  source = source.replace(/\\\n/g, '<br>');
  const isPunct = c => !!c && /[\p{P}\p{S}]/u.test(c);
  const isSpace = c => !!c && /\s/u.test(c);
  const starMatch = (s, i) => {
    let n = 1; while (s[i + n] === '*') n++;
    const b = s[i - 1] || '', a = s[i + n] || '';
    const canOpen = !!a && !isSpace(a) && (!isPunct(a) || !b || isSpace(b) || isPunct(b));
    if (!canOpen) return null;
    for (let j = i + n; j < s.length;) {
      // A code span shields its contents from delimiter processing.
      if (s[j] === '`') {
        let ticks = 1; while (s[j + ticks] === '`') ticks++;
        const e = s.indexOf('`'.repeat(ticks), j + ticks);
        if (e >= 0) { j = e + ticks; continue; }
        j += ticks; continue;
      }
      // Skip link destinations and their labels as a unit during pairing.
      if (s[j] === '[' || s[j] === '!' && s[j + 1] === '[') {
        const start = j + (s[j] === '!' ? 2 : 1); let e = start, depth = 0;
        for (; e < s.length; e++) { if (s[e] === '[') depth++; else if (s[e] === ']') { if (!depth) break; depth--; } }
        if (e < s.length && s[e + 1] === '(') {
          let z = e + 2, par = 0;
          for (; z < s.length; z++) { if (s[z] === '(') par++; else if (s[z] === ')') { if (!par) break; par--; } }
          if (z < s.length) { j = z + 1; continue; }
        }
      }
      if (s[j] !== '*') { j++; continue; }
      let m = 1; while (s[j + m] === '*') m++;
      const x = s[j - 1] || '', y = s[j + m] || '';
      const canClose = !!x && !isSpace(x) && (!isPunct(x) || !y || isSpace(y) || isPunct(y));
      const canCloseSide = !!y && !isSpace(y) && (!isPunct(y) || !x || isSpace(x) || isPunct(x));
      const ruleOf3Blocks = ((n + m) % 3 === 0) && canOpen && canCloseSide;
      // A longer run that can also open belongs to a nested delimiter pair.
      if (canClose && canCloseSide && m > n) { j += m; continue; }
      if (canClose && !ruleOf3Blocks) return { end: j, opener: n, closer: m };
      j += m;
    }
    return null;
  };
  const underMatch = (s, i) => {
    let n = 1; while (s[i + n] === '_') n++;
    const b = s[i - 1] || '', a = s[i + n] || '';
    const left = !!a && !isSpace(a) && (!isPunct(a) || !b || isSpace(b) || isPunct(b));
    const right = !!b && !isSpace(b) && (!isPunct(b) || !a || isSpace(a) || isPunct(a));
    const canOpen = left && (!right || isPunct(b));
    if (!canOpen) return null;
    for (let j = i + n; j < s.length;) {
      if (s[j] === '`') {
        let ticks = 1; while (s[j + ticks] === '`') ticks++;
        const e = s.indexOf('`'.repeat(ticks), j + ticks);
        if (e >= 0) { j = e + ticks; continue; }
        j += ticks; continue;
      }
      if (s[j] === '[' || s[j] === '!' && s[j + 1] === '[') {
        const start = j + (s[j] === '!' ? 2 : 1); let e = start, depth = 0;
        for (; e < s.length; e++) { if (s[e] === '[') depth++; else if (s[e] === ']') { if (!depth) break; depth--; } }
        if (e < s.length && s[e + 1] === '(') {
          let z = e + 2, par = 0;
          for (; z < s.length; z++) { if (s[z] === '(') par++; else if (s[z] === ')') { if (!par) break; par--; } }
          if (z < s.length) { j = z + 1; continue; }
        }
      }
      if (s[j] !== '_') { j++; continue; }
      let m = 1; while (s[j + m] === '_') m++;
      const x = s[j - 1] || '', y = s[j + m] || '';
      const closeLeft = !!x && !isSpace(x) && (!isPunct(x) || !y || isSpace(y) || isPunct(y));
      const closeRight = !!y && !isSpace(y) && (!isPunct(y) || !x || isSpace(x) || isPunct(x));
      const canClose = closeLeft && (!closeRight || isPunct(y));
      const ruleOf3Blocks = ((n + m) % 3 === 0) && canOpen && closeRight;
      if (canClose && closeLeft && m > n) { j += m; continue; }
      if (canClose && !ruleOf3Blocks) return { end: j, opener: n, closer: m };
      j += m;
    }
    return null;
  };
  source = source.replace(/<(https?:\/\/[^ <>]+|ftp:\/\/[^ <>]+|www\.[^ <>]+)>/gi, (_m, u) => `<a href="${escapeHtml(/^www\./i.test(u) ? 'http://' + u : u)}">${escapeHtml(u)}</a>`);
  source = source.replace(/<([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>/g, (_m, u) => `<a href="mailto:${escapeHtml(u)}">${escapeHtml(u)}</a>`);
  source = source.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g, (m, lead, url) => {
    const clean = url.replace(/[.,!?;:]+$/, '');
    const suffix = url.slice(clean.length);
    const href = clean.includes('@') && !/^[a-z]+:/i.test(clean) ? `mailto:${clean}` : clean.startsWith('www.') ? `http://${clean}` : clean;
    return `${lead}<a href="${escapeHtml(href)}">${escapeHtml(clean)}</a>${suffix}`;
  });
  let out = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    // Inline links and images, including the common reference forms.
    if (c === '!' && source[i + 1] === '[' || c === '[') {
      const image = c === '!'; const start = i + (image ? 2 : 1);
      let close = start, depth = 0;
      for (; close < source.length; close++) { if (source[close] === '[') depth++; else if (source[close] === ']') { if (!depth) break; depth--; } }
      if (close < source.length) {
        const label = source.slice(start, close); let dest = null, title = '' , end = close + 1;
        if (source[end] === '(') {
          let p = end + 1; while (source[p] === ' ') p++;
          let raw = '', quoted = false, q = '';
          if (source[p] === '<') { const z = source.indexOf('>', p + 1); if (z >= 0) { raw = source.slice(p + 1, z); p = z + 1; } }
          else { const b = p; let par = 0; while (p < source.length && (par || !/[\s)]/.test(source[p]))) { if (source[p] === '(') par++; if (source[p] === ')') par--; p++; } raw = source.slice(b, p); }
          while (source[p] === ' ') p++;
          if (/['"]/.test(source[p])) { q = source[p++]; const z = source.indexOf(q, p); if (z >= 0) { title = source.slice(p, z); p = z + 1; while (source[p] === ' ') p++; } }
          if (source[p] === ')') { dest = raw.replace(/\\([\\()])/g, '$1'); end = p + 1; }
        } else {
          let ref = label, p = end;
          if (source[p] === '[') { const z = source.indexOf(']', p + 1); if (z >= 0) { if (z > p + 1) ref = source.slice(p + 1, z); end = z + 1; } }
          const got = refs[ref.trim().toLowerCase()]; if (got) { dest = got.href; title = got.title || ''; }
        }
        if (dest !== null) { out += image ? `<img src="${escapeHtml(dest)}" alt="${escapeHtml(label)}"${title ? ` title="${escapeHtml(title)}"` : ''}>` : `<a href="${escapeHtml(dest)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inline(label, refs)}</a>`; i = end; continue; }
      }
    }
    if (c === '\\' && i + 1 < source.length) {
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) { out += escapeHtml(source[i + 1]); i += 2; continue; }
    }
    if (c === '`') {
      let n = 1; while (source[i + n] === '`') n++;
      const mark = '`'.repeat(n), end = source.indexOf(mark, i + n);
      if (end >= 0) { let text = source.slice(i + n, end).replace(/\n/g, ' '); if (/^ .* $/.test(text) && /[^ ]/.test(text)) text = text.slice(1, -1); out += '<code>' + escapeHtml(text) + '</code>'; i = end + n; continue; }
    }
    if (c === '*') {
      const pair = starMatch(source, i);
      if (pair) {
        const common = Math.min(pair.opener, pair.closer);
        const n = common % 2 ? 1 : 2, tag = n === 2 ? 'strong' : 'em';
        out += `<${tag}>${inline('*'.repeat(pair.opener - n) + source.slice(i + pair.opener, pair.end) + '*'.repeat(pair.closer - n), refs)}</${tag}>`;
        i = pair.end + pair.closer; continue;
      }
    }
    if (c === '_') {
      const pair = underMatch(source, i);
      if (pair) {
        const common = Math.min(pair.opener, pair.closer);
        const n = common % 2 ? 1 : 2, tag = n === 2 ? 'strong' : 'em';
        out += '_'.repeat(pair.opener - n) + `<${tag}>${inline(source.slice(i + pair.opener, pair.end), refs)}</${tag}>` + '_'.repeat(pair.closer - n);
        i = pair.end + pair.closer; continue;
      }
    }
    if (source.startsWith('**', i) || source.startsWith('~~', i)) {
      const mark = source.slice(i, i + 2);
      const end = source.indexOf(mark, i + mark.length);
      if (end > i + mark.length) { const tag = mark === '~~' ? 'del' : 'strong'; out += `<${tag}>${inline(source.slice(i + mark.length, end), refs)}</${tag}>`; i = end + mark.length; continue; }
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

function renderBlocks(markdown, refs = Object.create(null)) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  const blank = s => /^[ ]*$/.test(s);
  const htmlBlock = line => {
    const s = line.replace(/^ {0,3}/, '');
    let m;
    if ((m = s.match(/^<(pre|script|style|textarea)(?:\s|>|\/)/i))) return { type: 1, tag: m[1] };
    if (/^<!--/.test(s)) return { type: 2 };
    if (/^<\?/.test(s)) return { type: 3 };
    if (/^<!\[CDATA\[/.test(s)) return { type: 5 };
    if (/^<![A-Za-z]/.test(s)) return { type: 4 };
    if (/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>)/i.test(s)) return { type: 6 };
    if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>$/.test(s)) return { type: 7 };
    return null;
  };
  while (i < lines.length) {
    if (blank(lines[i])) { i++; continue; }
    let m;
    // GFM tables: a pipe header followed by a delimiter row.
    if (i + 1 < lines.length && lines[i].includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const split = row => { row = row.trim().replace(/^\|/, '').replace(/\|$/, ''); return row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
      const heads = split(lines[i]), aligns = split(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const row = (cells, tag) => `<tr>\n${heads.map((_, n) => { const a = aligns[n]; return `<${tag}${a ? ` align="${a}"` : ''}>${inline(cells[n] || '', refs)}</${tag}>\n`; }).join('')}</tr>\n`;
      let html = '<table>\n<thead>\n' + row(heads, 'th') + '</thead>\n'; i += 2;
      if (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) { html += '<tbody>'; while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) html += row(split(lines[i++]), 'td'); html += '</tbody>'; }
      out.push(html + '</table>\n'); continue;
    }
    // Block HTML is passed through verbatim by marked; its contents are not parsed.
    if (htmlBlock(lines[i]) && htmlBlock(lines[i]).type !== 7) {
      const start = i; const html = htmlBlock(lines[i]);
      if (html.type <= 5) {
        const end = html.type === 1 ? new RegExp(`<\\/${html.tag}\\s*>`, 'i') : html.type === 2 ? /-->/ : html.type === 3 ? /\?>/ : html.type === 4 ? />/ : /\]\]>/;
        while (i < lines.length && !end.test(lines[i++])) {}
      } else { while (i < lines.length && !blank(lines[i])) i++; }
      out.push(lines.slice(start, i).join('\n') + (i < lines.length || src.endsWith('\n') ? '\n' : '')); continue;
    }
    // Indented code blocks are recognized before other block constructs.
    if (/^(?: {4,}|\t)/.test(lines[i])) {
      const code = [];
      while (i < lines.length) {
        if (/^(?: {4,}|\t)/.test(lines[i])) {
          const lead = lines[i].match(/^ */)[0].length;
          code.push(lines[i].startsWith('\t') ? lines[i].slice(1) : lines[i].slice(4)); i++;
        } else if (blank(lines[i])) {
          let k = i; while (k < lines.length && blank(lines[k])) k++;
          if (k < lines.length && /^(?: {4,}|\t)/.test(lines[k])) { while (i < k) { code.push(''); i++; } }
          else break;
        } else break;
      }
      while (code.length && code[code.length - 1] === '') code.pop();
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}${code.length ? '\n' : ''}</code></pre>\n`); continue;
    }
    if ((m = lines[i].match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*$/))) { const d = m[1].length; let body = m[2].trim(); body = body.replace(/[ \t]+#+[ \t]*$/, ''); out.push(`<h${d}>${inline(body, refs)}</h${d}>\n`); i++; continue; }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(lines[i])) { out.push('<hr>\n'); i++; continue; }
    if ((m = lines[i].match(/^( {0,3})(`{3,}|~{3,})/))) {
      const indent = m[1].length, fence = m[2], lang = lines[i].slice(m[0].length).trim().split(/[ \t]/)[0]; let j = i + 1;
      while (j < lines.length && !new RegExp('^ {0,' + indent + '}' + fence[0] + '{' + fence.length + ',}[ \\t]*$').test(lines[j])) j++;
      const body = lines.slice(i + 1, j).map(line => line.replace(new RegExp('^ {0,' + indent + '}'), '')).join('\n');
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body)}${j > i + 1 && (body !== '' || lines[i + 1] === '') ? '\n' : ''}</code></pre>\n`); i = Math.min(j + 1, lines.length); continue;
    }
    if ((m = lines[i].match(/^ {0,3}> ?(.*)$/))) {
      const q = []; while (i < lines.length && (m = lines[i].match(/^ {0,3}> ?(.*)$/))) { q.push(m[1]); i++; }
      out.push(`<blockquote>\n${renderBlocks(q.join('\n'), refs)}</blockquote>\n`); continue;
    }
    if ((m = lines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/))) {
      const ordered = /^\d/.test(m[1]), tag = ordered ? 'ol' : 'ul';
      const marker = m[1], markerIndent = lines[i].match(/^ */)[0].length;
      const markerWidth = marker.length + (lines[i].slice(markerIndent + marker.length).match(/^[ \t]+/)?.[0].length || 1);
      const contentIndent = markerIndent + Math.min(markerWidth, 4);
      const startNumber = ordered ? Number.parseInt(marker, 10) : 1;
      const items = []; let loose = false;
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered || (ordered && itemMatch[1].slice(-1) !== marker.slice(-1))) break;
        const itemIndent = lines[i].match(/^ */)[0].length;
        const width = itemMatch[1].length + (lines[i].slice(itemIndent + itemMatch[1].length).match(/^[ \t]+/)?.[0].length || 1);
        const indent = itemIndent + Math.min(width, 4);
        const body = [itemMatch[2]]; i++;
        while (i < lines.length) {
          const next = lines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+/);
          if (next && /^\d/.test(next[1]) === ordered && (!ordered || next[1].slice(-1) === marker.slice(-1))) break;
          if (blank(lines[i])) {
            let k = i; while (k < lines.length && blank(lines[k])) k++;
            if (k >= lines.length) { i = k; break; }
            if (lines[k].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+/) || lines[k].match(/^ {0,3}>/)) { body.push(''); i++; loose = true; continue; }
            if (lines[k].match(/^ */)[0].length >= indent) { body.push(''); i++; loose = true; continue; }
            break;
          }
          const lead = lines[i].match(/^ */)[0].length;
          if (lead >= indent) body.push(lines[i].slice(indent));
          else if (/^ {0,3}(?:>|#{1,6}[ \t]|```|~~~)/.test(lines[i])) body.push(lines[i].replace(/^ {0,3}/, ''));
          else break;
          i++;
        }
        items.push(body);
      }
      const htmlItems = items.map(linesInItem => {
        const task = linesInItem[0]?.match(/^\[([ xX])\][ \t]+(.*)$/);
        if (task) linesInItem[0] = task[2];
        const rendered = renderBlocks(linesInItem.join('\n'), refs).replace(/\n$/, '');
        const checkbox = task ? `<input ${task[1] === ' ' ? 'disabled=""' : 'checked="" disabled=""'} type="checkbox"> ` : '';
        if (!loose && /^<p>[\s\S]*<\/p>$/.test(rendered)) return `<li>${checkbox}${rendered.slice(3, -4)}</li>\n`;
        return `<li>${checkbox}${rendered ? '\n' + rendered + '\n' : ''}</li>\n`;
      }).join('');
      out.push(`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>\n${htmlItems}</${tag}>\n`); continue;
    }
    if (i + 1 < lines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[i + 1])) { const d = lines[i + 1].trim()[0] === '=' ? 1 : 2; out.push(`<h${d}>${inline(lines[i].trim(), refs)}</h${d}>\n`); i += 2; continue; }
    let j = i + 1;
    while (j < lines.length && !blank(lines[j]) && !(htmlBlock(lines[j]) && htmlBlock(lines[j]).type <= 6) && !/^ {0,3}(?:#{1,6}(?:\s|$)|>|```|~~~|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(lines[j])) j++;
    out.push(`<p>${inline(lines.slice(i, j).join('\n'), refs)}</p>\n`); i = j;
  }
  return out.join('');
}

/** Render a Markdown string into HTML. */
export function parse(markdown) {
  let source = String(markdown);
  const refs = Object.create(null);
  source = source.replace(/^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/gm, (_m, label, angled, plain, dq, sq, paren) => {
    refs[label.trim().toLowerCase()] = { href: (angled ?? plain).replace(/\\([\\()[\]])/g, '$1'), title: dq ?? sq ?? paren ?? '' }; return '';
  });
  return renderBlocks(source, refs);
}
