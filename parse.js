// Small, dependency-free Markdown renderer. Parsing is performed afresh for each call.
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function inline(source, linkDefinitions = Object.create(null)) {
  // Text without inline delimiters can bypass the token scanner entirely.
  if (!/[*_`\[\]\\!~<&]|(?:https?:\/\/|ftp:\/\/|www\.)|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+\.[A-Za-z]/i.test(source)) return escapeHtml(source);
  const isPunctuation = c => !!c && /[\p{P}\p{S}]/u.test(c);
  const isWhitespace = c => !!c && /\s/u.test(c);
  const findStarPair = (s, i) => {
    let n = 1; while (s[i + n] === '*') n++;
    const b = s[i - 1] || '', a = s[i + n] || '';
    const canOpen = !!a && !isWhitespace(a) && (!isPunctuation(a) || !b || isWhitespace(b) || isPunctuation(b));
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
      const canClose = !!x && !isWhitespace(x) && (!isPunctuation(x) || !y || isWhitespace(y) || isPunctuation(y));
      const canCloseSide = !!y && !isWhitespace(y) && (!isPunctuation(y) || !x || isWhitespace(x) || isPunctuation(x));
      const ruleOf3Blocks = ((n + m) % 3 === 0) && canOpen && canCloseSide;
      // A longer run that can also open belongs to a nested delimiter pair.
      if (canClose && canCloseSide && m > n) { j += m; continue; }
      if (canClose && !ruleOf3Blocks) return { end: j, opener: n, closer: m };
      j += m;
    }
    return null;
  };
  const findUnderscorePair = (s, i) => {
    let n = 1; while (s[i + n] === '_') n++;
    const b = s[i - 1] || '', a = s[i + n] || '';
    const left = !!a && !isWhitespace(a) && (!isPunctuation(a) || !b || isWhitespace(b) || isPunctuation(b));
    const right = !!b && !isWhitespace(b) && (!isPunctuation(b) || !a || isWhitespace(a) || isPunctuation(a));
    const canOpen = left && (!right || isPunctuation(b));
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
      const closeLeft = !!x && !isWhitespace(x) && (!isPunctuation(x) || !y || isWhitespace(y) || isPunctuation(y));
      const closeRight = !!y && !isWhitespace(y) && (!isPunctuation(y) || !x || isWhitespace(x) || isPunctuation(x));
      const canClose = closeLeft && (!closeRight || isPunctuation(y));
      const ruleOf3Blocks = ((n + m) % 3 === 0) && canOpen && closeRight;
      if (canClose && closeLeft && m > n) { j += m; continue; }
      if (canClose && !ruleOf3Blocks) return { end: j, opener: n, closer: m };
      j += m;
    }
    return null;
  };
  let out = '';
  for (let i = 0; i < source.length;) {
    const c = source[i];
    // GFM recognizes URL and email forms in ordinary text. Keep the scan
    // anchored at the current cursor so punctuation and adjacent markup stay
    // available to the normal inline scanner.
    if (c !== '<') {
      const tail = source.slice(i);
      const candidate = tail.match(/^(?:https?:\/\/|ftp:\/\/)[^\s<>]+|^www\.[^\s<>]+|^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/i);
      if (candidate) {
        let value = candidate[0];
        while (/[.,:;!?]$/.test(value)) value = value.slice(0, -1);
        while (/[)\]}]$/.test(value)) {
          const ch = value.at(-1), pair = ch === ')' ? '(' : ch === ']' ? '[' : '{';
          if (value.split(pair).length > value.split(ch).length) break;
          value = value.slice(0, -1);
        }
        if (value) {
          const email = value.includes('@') && !/^[a-z]+:\/\//i.test(value);
          const href = email ? 'mailto:' + value : /^www\./i.test(value) ? 'http://' + value : value;
          out += `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>`;
          i += value.length; continue;
        }
      }
    }
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
          if (source[p] === '<') { const z = source.indexOf('>', p + 1), lineEnd = source.indexOf('\n', p + 1); if (z >= 0 && (lineEnd < 0 || z < lineEnd)) { raw = source.slice(p + 1, z); p = z + 1; } }
          else { const b = p; let par = 0; while (p < source.length && (par || !/[\s)]/.test(source[p]))) { if (source[p] === '(') par++; if (source[p] === ')') par--; p++; } raw = source.slice(b, p); }
          while (source[p] === ' ') p++;
          if (/['"(]/.test(source[p])) { q = source[p] === '(' ? ')' : source[p]; p++; const z = source.indexOf(q, p); if (z >= 0) { title = source.slice(p, z); p = z + 1; while (source[p] === ' ') p++; } }
          if (source[p] === ')') { dest = raw.replace(/\\([\\()])/g, '$1'); end = p + 1; }
        } else {
          let ref = label, p = end;
          if (source[p] === '[') { const z = source.indexOf(']', p + 1); if (z >= 0) { if (z > p + 1) ref = source.slice(p + 1, z); end = z + 1; } }
          const got = linkDefinitions[ref.trim().toLowerCase()]; if (got) { dest = got.href; title = got.title || ''; }
        }
        if (dest !== null) { out += image ? `<img src="${escapeHtml(dest)}" alt="${escapeHtml(label)}"${title ? ` title="${escapeHtml(title)}"` : ''}>` : `<a href="${escapeHtml(dest.replace(/ /g, '%20'))}"${title ? ` title="${escapeHtml(title)}"` : ''}>${inline(label, linkDefinitions)}</a>`; i = end; continue; }
      }
    }
    if (c === '\\' && i + 1 < source.length) {
      if (source[i + 1] === '\n' && i + 2 < source.length) { out += '<br>'; i += 2; continue; }
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) { out += escapeHtml(source[i + 1]); i += 2; continue; }
    }
    if (c === '`') {
      let n = 1; while (source[i + n] === '`') n++;
      const mark = '`'.repeat(n); let end = -1;
      for (let p = i + n; p < source.length;) { p = source.indexOf('`', p); if (p < 0) break; let q = p + 1; while (source[q] === '`') q++; if (q - p === n) { end = p; break; } p = q; }
      if (end >= 0) { let text = source.slice(i + n, end).replace(/\n/g, ' '); if (/^ .* $/.test(text) && /[^ ]/.test(text)) text = text.slice(1, -1); out += '<code>' + escapeHtml(text) + '</code>'; i = end + n; continue; }
    }
    if (c === '*') {
      const pair = findStarPair(source, i);
      if (pair) {
        const common = Math.min(pair.opener, pair.closer);
        const n = common % 2 ? 1 : 2, tag = n === 2 ? 'strong' : 'em';
        out += `<${tag}>${inline('*'.repeat(pair.opener - n) + source.slice(i + pair.opener, pair.end) + '*'.repeat(pair.closer - n), linkDefinitions)}</${tag}>`;
        i = pair.end + pair.closer; continue;
      }
    }
    if (c === '_') {
      const pair = findUnderscorePair(source, i);
      if (pair) {
        const common = Math.min(pair.opener, pair.closer);
        const n = common % 2 ? 1 : 2, tag = n === 2 ? 'strong' : 'em';
        out += '_'.repeat(pair.opener - n) + `<${tag}>${inline(source.slice(i + pair.opener, pair.end), linkDefinitions)}</${tag}>` + '_'.repeat(pair.closer - n);
        i = pair.end + pair.closer; continue;
      }
    }
    if (source.startsWith('**', i) || source.startsWith('~~', i)) {
      const mark = source.slice(i, i + 2);
      const end = source.indexOf(mark, i + mark.length);
      if (end > i + mark.length) { const tag = mark === '~~' ? 'del' : 'strong'; out += `<${tag}>${inline(source.slice(i + mark.length, end), linkDefinitions)}</${tag}>`; i = end + mark.length; continue; }
    }
    if (c === '<') { const e = source.indexOf('>', i + 1); if (e >= 0) { const raw = source.slice(i, e + 1), inner = raw.slice(1, -1); if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>]+$/.test(inner)) { out += `<a href="${escapeHtml(inner)}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (/^(?:https?:\/\/|ftp:\/\/|www\.)[^ <>]+$/i.test(inner)) { const href = /^www\./i.test(inner) ? 'http://' + inner : inner; out += `<a href="${escapeHtml(href)}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (/^[^ <>@]+@[^ <>]+\.[A-Za-z]{2,}$/.test(inner)) { out += `<a href="mailto:${escapeHtml(inner)}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (/^<\/?[A-Za-z][^>]*>$/.test(raw) || /^<!--/.test(raw)) { out += raw; i = e + 1; continue; } } }
    if (c === '&') { const m = source.slice(i).match(/^&(?:#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]+);/); if (m) { const dec = m[0].match(/^&#(\d+);$/), hex = m[0].match(/^&#[xX]([\da-fA-F]+);$/); if (dec || hex) { const cp = Number.parseInt((dec || hex)[1], dec ? 10 : 16); out += !cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : String.fromCodePoint(cp); } else out += m[0]; i += m[0].length; continue; } }
    if (c === '\n') {
      let spaces = 0; for (let p = out.length - 1; p >= 0 && out[p] === ' '; p--) spaces++;
      if (spaces >= 2 && i + 1 < source.length) { out = out.slice(0, -spaces); out += '<br>'; }
      else out += '\n';
      i++; continue;
    }
    out += escapeHtml(c); i++;
  }
  return out;
}

function renderBlockTree(markdown, linkDefinitions = Object.create(null)) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const blockLines = src.split('\n').map(line => { let col = 0, n = 0; while (n < line.length && (line[n] === ' ' || line[n] === '\t')) { if (line[n] === '\t') { const step = 4 - col % 4; line = line.slice(0, n) + ' '.repeat(step) + line.slice(n + 1); col += step; n += step; } else { col++; n++; } } return line; });
  const out = [];
  let i = 0;
  const blank = s => /^[ ]*$/.test(s);
  const classifyHtmlLine = line => {
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
  while (i < blockLines.length) {
    if (blank(blockLines[i])) { i++; continue; }
    let m;
    // GFM tables: a pipe header followed by a delimiter row.
    if (i + 1 < blockLines.length && blockLines[i].includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(blockLines[i + 1])) {
      const split = row => { row = row.trim().replace(/^\|/, '').replace(/\|$/, ''); return row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
      const heads = split(blockLines[i]), aligns = split(blockLines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const row = (cells, tag) => `<tr>\n${heads.map((_, n) => { const a = aligns[n]; return `<${tag}${a ? ` align="${a}"` : ''}>${inline(cells[n] || '', linkDefinitions)}</${tag}>\n`; }).join('')}</tr>\n`;
      let html = '<table>\n<thead>\n' + row(heads, 'th') + '</thead>\n'; i += 2;
      if (i < blockLines.length && !blank(blockLines[i]) && blockLines[i].includes('|')) { html += '<tbody>'; while (i < blockLines.length && !blank(blockLines[i]) && blockLines[i].includes('|')) html += row(split(blockLines[i++]), 'td'); html += '</tbody>'; }
      out.push(html + '</table>\n'); continue;
    }
    // Block HTML is passed through verbatim by marked; its contents are not parsed.
    if (classifyHtmlLine(blockLines[i])) {
      const start = i; const html = classifyHtmlLine(blockLines[i]);
      if (html.type <= 5) {
        const end = html.type === 1 ? new RegExp(`<\\/${html.tag}\\s*>`, 'i') : html.type === 2 ? /-->/ : html.type === 3 ? /\?>/ : html.type === 4 ? />/ : /\]\]>/;
        while (i < blockLines.length && !end.test(blockLines[i++])) {}
      } else { while (i < blockLines.length && !blank(blockLines[i])) i++; }
      // Comment blocks end at their closing delimiter. When the next block is a
      // paragraph, marked joins the delimiter directly to the paragraph tag.
      const endedComment = html.type === 2 && i > start && /-->\s*$/.test(blockLines[i - 1]);
      out.push(blockLines.slice(start, i).join('\n') + (!endedComment && (i < blockLines.length || src.endsWith('\n')) ? '\n' : '')); continue;
    }
    // Indented code blocks are recognized before other block constructs.
    if (/^(?: {4,}|\t)/.test(blockLines[i])) {
      const code = [];
      while (i < blockLines.length) {
        if (/^(?: {4,}|\t)/.test(blockLines[i])) {
          const lead = blockLines[i].match(/^ */)[0].length;
          code.push(blockLines[i].startsWith('\t') ? blockLines[i].slice(1) : blockLines[i].slice(4)); i++;
        } else if (blank(blockLines[i])) {
          let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
          if (k < blockLines.length && /^(?: {4,}|\t)/.test(blockLines[k])) { while (i < k) { code.push(''); i++; } }
          else break;
        } else break;
      }
      while (code.length && code[code.length - 1] === '') code.pop();
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}${code.length ? '\n' : ''}</code></pre>\n`); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*$/))) { const d = m[1].length; let body = m[2].trim(); body = body.replace(/[ \t]+#+[ \t]*$/, ''); out.push(`<h${d}>${inline(body, linkDefinitions)}</h${d}>\n`); i++; continue; }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) { out.push('<hr>\n'); i++; continue; }
    if ((m = blockLines[i].match(/^( {0,3})(`{3,}|~{3,})/))) {
      const indent = m[1].length, fence = m[2], lang = blockLines[i].slice(m[0].length).trim().split(/[ \t]/)[0]; let j = i + 1;
      while (j < blockLines.length && !new RegExp('^ {0,' + indent + '}' + fence[0] + '{' + fence.length + ',}[ \\t]*$').test(blockLines[j])) j++;
      const body = blockLines.slice(i + 1, j).map(line => line.replace(new RegExp('^ {0,' + indent + '}'), '')).join('\n');
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body)}${j > i + 1 && (body !== '' || blockLines[i + 1] === '') ? '\n' : ''}</code></pre>\n`); i = Math.min(j + 1, blockLines.length); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}> ?(.*)$/))) {
      const q = []; while (i < blockLines.length && (m = blockLines[i].match(/^ {0,3}> ?(.*)$/))) { q.push(m[1]); i++; }
      out.push(`<blockquote>\n${renderBlockTree(q.join('\n'), linkDefinitions)}</blockquote>\n`); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/))) {
      const ordered = /^\d/.test(m[1]), tag = ordered ? 'ol' : 'ul';
      const marker = m[1], markerIndent = blockLines[i].match(/^ */)[0].length;
      const markerWidth = marker.length + (blockLines[i].slice(markerIndent + marker.length).match(/^[ \t]+/)?.[0].length || 1);
      const contentIndent = markerIndent + Math.min(markerWidth, 4);
      const startNumber = ordered ? Number.parseInt(marker, 10) : 1;
      const listItems = []; let hasLooseItems = false;
      while (i < blockLines.length) {
        const itemMatch = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered || (ordered && itemMatch[1].slice(-1) !== marker.slice(-1))) break;
        const itemIndent = blockLines[i].match(/^ */)[0].length;
        const width = itemMatch[1].length + (blockLines[i].slice(itemIndent + itemMatch[1].length).match(/^[ \t]+/)?.[0].length || 1);
        const indent = itemIndent + Math.min(width, 4);
        const body = [itemMatch[2] || '']; i++;
        while (i < blockLines.length) {
          const next = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+/);
          if (next && /^\d/.test(next[1]) === ordered && (!ordered || next[1].slice(-1) === marker.slice(-1)) && blockLines[i].match(/^ */)[0].length <= itemIndent && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) break;
          if (blank(blockLines[i])) {
            let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
            if (k >= blockLines.length) { i = k; break; }
            if (blockLines[k].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/) && blockLines[k].match(/^ */)[0].length <= itemIndent || blockLines[k].match(/^ {0,3}>/)) { body.push(''); i++; hasLooseItems = true; continue; }
            if (blockLines[k].match(/^ */)[0].length >= indent) { body.push(''); i++; hasLooseItems = true; continue; }
            break;
          }
          const lead = blockLines[i].match(/^ */)[0].length;
          if (lead >= indent) body.push(blockLines[i].slice(indent));
          else if (/^ {0,3}(?:>|#{1,6}[ \t]|```|~~~)/.test(blockLines[i])) body.push(blockLines[i].replace(/^ {0,3}/, ''));
          else break;
          i++;
        }
        listItems.push(body);
      }
      const htmlItems = listItems.map(linesInItem => {
        const task = linesInItem[0]?.match(/^\[([ xX])\][ \t]+(.*)$/);
        if (task) linesInItem[0] = task[2];
        const rendered = renderBlockTree(linesInItem.join('\n'), linkDefinitions).replace(/\n$/, '');
        const checkbox = task ? `<input ${task[1] === ' ' ? 'disabled=""' : 'checked="" disabled=""'} type="checkbox"> ` : '';
        if (!hasLooseItems && /^<p>[\s\S]*<\/p>$/.test(rendered)) return `<li>${checkbox}${rendered.slice(3, -4)}</li>\n`;
        if (!hasLooseItems && rendered.startsWith('<p>')) { const close = rendered.indexOf('</p>'); if (close >= 0) return `<li>${checkbox}${rendered.slice(3, close)}${rendered.slice(close + 5)}\n</li>\n`; }
        if (hasLooseItems && rendered.startsWith('<p>')) return `<li>${checkbox}${rendered}\n</li>\n`;
        return `<li>${checkbox}${rendered ? '\n' + rendered + '\n' : ''}</li>\n`;
      }).join('');
      out.push(`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>\n${htmlItems}</${tag}>\n`); continue;
    }
    if (i + 1 < blockLines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(blockLines[i + 1])) { const d = blockLines[i + 1].trim()[0] === '=' ? 1 : 2; out.push(`<h${d}>${inline(blockLines[i].trim(), linkDefinitions)}</h${d}>\n`); i += 2; continue; }
    let j = i + 1;
    while (j < blockLines.length && !blank(blockLines[j]) && !(classifyHtmlLine(blockLines[j]) && classifyHtmlLine(blockLines[j]).type <= 6) && !/^ {0,3}(?:#{1,6}(?:\s|$)|>|```|~~~|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(blockLines[j]) && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[j])) j++;
    out.push(`<p>${inline(blockLines.slice(i, j).join('\n'), linkDefinitions)}</p>\n`); i = j;
  }
  return out.join('');
}

/** Render a Markdown string into HTML. */
export function parse(markdown) {
  let source = String(markdown);
  const linkDefinitions = Object.create(null);
  source = source.replace(/^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/gm, (_m, label, angled, plain, dq, sq, paren) => {
    linkDefinitions[label.trim().toLowerCase()] = { href: (angled ?? plain).replace(/\\([\\()[\]])/g, '$1'), title: dq ?? sq ?? paren ?? '' }; return '';
  });
  return renderBlockTree(source, linkDefinitions);
}
