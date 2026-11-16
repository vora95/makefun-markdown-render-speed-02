// Small, dependency-free Markdown renderer. Parsing is performed afresh for each call.
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeAttribute = s => escapeHtml(s).replace(/&amp;(#(?:\d+|[xX][\da-fA-F]+)|[A-Za-z][A-Za-z0-9]*);/g, '&$1;');
const cleanDestination = s => s.replace(/\\([\p{P}\p{S}])/gu, '$1').replace(/\\/g, '%5C').replace(/[^\x00-\x7F]/gu, ch => encodeURIComponent(ch));
const angleDestination = s => s.replace(/\\/g, '%5C').replace(/[\[\]]/g, c => c === '[' ? '%5B' : '%5D');

function matchingTickEnd(s, from, count) {
  for (let p = from; p < s.length;) {
    p = s.indexOf('`', p);
    if (p < 0) return -1;
    let q = p + 1; while (s[q] === '`') q++;
    if (q - p === count) return p;
    p = q;
  }
  return -1;
}

function hasShortTickInsideSpan(s) {
  for (let p = 0; p < s.length;) {
    if (s[p] !== '`') { p++; continue; }
    let n = 1; while (s[p + n] === '`') n++;
    const end = matchingTickEnd(s, p + n, n);
    if (end < 0) { p += n; continue; }
    for (let q = p + n; q < end;) {
      if (s[q] !== '`') { q++; continue; }
      let run = 1; while (s[q + run] === '`') run++;
      if (run < n) return true;
      q += run;
    }
    p = end + n;
  }
  return false;
}

function inline(source, linkDefinitions = Object.create(null), disableAutolinks = false) {
  // Resolve emphasis runs as a delimiter stack before rendering the other
  // inline tokens. Each run keeps its unused marker characters literal.
  const marks = [];
  const word = c => !!c && /[\p{L}\p{N}]/u.test(c);
  const punct = c => !!c && /[\p{P}\p{S}]/u.test(c);
  for (let p = 0; p < source.length;) {
    const ch = source[p];
    if (ch === '\\' && p+1<source.length && /[\p{P}\p{S}]/u.test(source[p+1])) { p+=2; continue; }
    if (ch === '`') { let n = 1; while (source[p + n] === '`') n++; let e = matchingTickEnd(source, p + n, n); if (e >= 0) { p = e + n; continue; } p += n; continue; }
    if (ch === '<') { let q=p+1, quote=''; for(;q<source.length;q++){const x=source[q];if(quote){if(x===quote)quote='';}else if(x==='"'||x==="'")quote=x;else if(x==='>')break;} if(q<source.length){p=q+1;continue;} }
    if (ch === '[' || ch==='!' && source[p+1]==='[') { let q=p+(ch==='!'?2:1), depth=0; for(;q<source.length;q++){if(source[q]==='\\'){q++;continue;}if(source[q]==='[')depth++;else if(source[q]===']'){if(!depth)break;depth--;}} if(q<source.length && source[q+1]==='('){let z=q+2,par=0;for(;z<source.length;z++){if(source[z]==='\\'){z++;continue;}if(source[z]==='(')par++;else if(source[z]===')'){if(!par)break;par--;}}if(z<source.length){ const label=source.slice(p+(ch==='!'?2:1),q); if(!/(?<!!)(?:\[[^\]]*\])\([^\n)]*\)/.test(label)) { p=z+1; continue; } } } }
    if (ch !== '*' && ch !== '_') { p++; continue; }
    let end = p + 1; while (source[end] === ch) end++;
    const before = source[p - 1] || '', after = source[end] || '';
    const left = !!after && !/\s/.test(after) && (!punct(after) || !before || /\s/.test(before) || punct(before));
    const right = !!before && !/\s/.test(before) && (!punct(before) || !after || /\s/.test(after) || punct(after));
    marks.push({ ch, start:p, len:end-p, open:left && (ch !== '_' || !word(before) || !word(after)), close:right && (ch !== '_' || !word(before) || !word(after)), usedOpen:0, usedClose:0 }); p=end;
  }
  const events = new Map();
  const consumed = new Set();
  const addEvent = (at, value) => { let a=events.get(at); if (!a) events.set(at,a=[]); a.push(value); };
  const anchors = [];
  for (let a = 0; a < source.length; a++) if (source[a] === '[' && !(a && source[a - 1] === '!')) {
    let b = a + 1, depth = 0;
    for (; b < source.length; b++) { if (source[b] === '\\') { b++; continue; } if (source[b] === '[') depth++; else if (source[b] === ']') { if (!depth) break; depth--; } }
    if (b >= source.length) continue;
    const label = source.slice(a + 1, b), suffix = source[b + 1]; let end = b + 1;
    if (suffix === '(') { let d = 0, p = b + 2; for (; p < source.length; p++) { if (source[p] === '\\') { p++; continue; } if (source[p] === '(') d++; else if (source[p] === ')') { if (!d) break; d--; } } if (p < source.length) end = p + 1; else continue; }
    else if (suffix === '[') { const z = source.indexOf(']', b + 2); if (z >= 0) { const key = (source.slice(b + 2, z) || label).trim().toLowerCase().replace(/ß/g, 'ss'); if (linkDefinitions[key]) end = z + 1; else continue; } else continue; }
    else if (!linkDefinitions[label.trim().toLowerCase().replace(/ß/g, 'ss')]) continue;
    if (/(?<!!)\[[^\]]*\](?:\([^\n)]*\)|\[[^\]]*\])/.test(label)) continue;
    anchors.push([a, end]);
  }
  for (let ci=0; ci<marks.length; ci++) {
    const closer=marks[ci]; if (!closer.close) continue;
    while (closer.len-closer.usedClose > 0) {
      let found=-1, amount=0;
      for (let oi=ci-1; oi>=0; oi--) {
        const opener=marks[oi]; const available=opener.len-opener.usedOpen-opener.usedClose;
        if (opener.ch!==closer.ch || !opener.open || available<=0) continue;
        // A delimiter pair already closed inside this candidate may leave
        // its closing marker immediately attached to a word. In that case
        // marked treats the surrounding delimiter as literal instead of
        // letting it span across the adjacent text.
        const leftEdge = opener.start + opener.len;
        const rightEdge = closer.start;
        let attachedInnerClose = false;
        for (const [at, tags] of events) {
          if (at <= leftEdge || at >= rightEdge || !word(source[at] || '')) continue;
          const closing = tags.find(tag => tag.startsWith('</em>') || tag.startsWith('</strong>'));
          if (closing) {
            const openingTag = closing === '</em>' ? '<em>' : '<strong>';
            const openingAt = [...events].find(([pos, values]) => pos > leftEdge && pos < at && values.includes(openingTag))?.[0];
            if (openingAt !== undefined && /\s/.test(source[openingAt - 1] || '')) { attachedInnerClose = true; break; }
          }
        }
        if (attachedInnerClose) continue;
        const remaining=closer.len-closer.usedClose-closer.usedOpen;
        if (opener.close && available===2 && remaining===1 && !closer.open) continue;
        const both=closer.open;
        if (both && (available+remaining)%3===0 && !(available%3===0 && remaining%3===0)) continue;
        amount=available>=2 && remaining>=2 ? 2 : 1; found=oi; break;
      }
      if (found<0) break;
      const opener=marks[found], openAt=opener.start+opener.len-opener.usedClose-opener.usedOpen-amount, closeAt=closer.start+closer.usedClose;
      if (anchors.some(([a,b]) => (a <= opener.start && opener.start < b) !== (a <= closer.start && closer.start < b))) break;
      const tag=amount===2?'strong':'em'; addEvent(openAt,`<${tag}>`); addEvent(closeAt+amount,`</${tag}>`);
      for(let q=openAt;q<openAt+amount;q++) consumed.add(q);
      for(let q=closeAt;q<closeAt+amount;q++) consumed.add(q);
      opener.usedOpen+=amount; closer.usedClose+=amount;
      // An unmatched opener crossed by a completed pair can no longer
      // reach across that pair to create malformed crossing tags.
      for(let k=found+1;k<ci;k++) if(marks[k].open && marks[k].len>marks[k].usedOpen) marks[k].open=false;
    }
  }
  // Text without inline delimiters can bypass the token scanner entirely.
  if (!/[*_`\[\]\\!~<&]| {2,}\n|(?:https?:\/\/|ftp:\/\/|www\.)|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+\.[A-Za-z]/i.test(source)) return escapeHtml(source);
  const isPunctuation = c => !!c && /[\p{P}\p{S}]/u.test(c);
  const isWhitespace = c => !!c && /\s/u.test(c);
  const tagEnd = (s, from) => { let quote = ''; for (let p = from; p < s.length; p++) { const c = s[p]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') return p; } return -1; };
  const validInlineTag = raw => {
    const body = raw.slice(1, -1); let p = 0;
    if (body[0] === '/') { p = 1; while (/[A-Za-z0-9-]/.test(body[p] || '')) p++; return p === body.length || /^\s+$/.test(body.slice(p)); }
    if (!/^[A-Za-z]/.test(body)) return false;
    while (/[A-Za-z0-9-]/.test(body[p] || '')) p++;
    while (p < body.length) {
      if (body[p] === '/') return p === body.length - 1;
      if (/\s/.test(body[p])) { while (/\s/.test(body[p] || '')) p++; if (p === body.length || body[p] === '/') break; }
      const name = body.slice(p).match(/^[A-Za-z_:][A-Za-z0-9_.:-]*/); if (!name) return false; p += name[0].length;
      while (/[ \t]/.test(body[p] || '')) p++;
      if (body[p] === '=') { p++; while (/[ \t]/.test(body[p] || '')) p++;
        if (body[p] === '"' || body[p] === "'") { const q = body[p++]; while (p < body.length && body[p] !== q) p++; if (body[p++] !== q) return false; }
        else { const value = body.slice(p).match(/^[^\s"'=<>`]+/); if (!value) return false; p += value[0].length; }
      }
      if (p < body.length && !/[\s/]/.test(body[p])) return false;
    }
    return true;
  };
  let out = '';
  for (let i = 0; i < source.length;) {
    if (events.has(i)) out += events.get(i).join('');
    if ((source[i] === '*' || source[i] === '_') && !consumed.has(i)) { out += source[i]; i++; continue; }
    if ((source[i] === '*' || source[i] === '_') && consumed.has(i)) { i++; continue; }
    const c = source[i];
    // GFM recognizes URL and email forms in ordinary text. Keep the scan
    // anchored at the current cursor so punctuation and adjacent markup stay
    // available to the normal inline scanner.
    if (c !== '<' && !disableAutolinks) {
      const tail = source.slice(i);
      const candidate = tail.match(/^(?:(?:https?|ftp):\/\/[^\s<>]+|www\.[^\s<>]+|[A-Za-z][A-Za-z0-9+.-]{1,31}:(?=[A-Za-z0-9])(?=[^\s<>]*(?:@|\.))[^\s<>/]+(?:\/[^\s<>/]*)?|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?![A-Za-z0-9_-]))/i);
      if (candidate) {
        let value = candidate[0];
        if (/^www\./i.test(value) && !/^www\./.test(value)) value = '';
        if (/&[A-Za-z0-9]+;$/.test(value)) value = value.slice(0, value.lastIndexOf('&'));
        while (/[.,:;!?]$/.test(value)) value = value.slice(0, -1);
        if (!/^mailto:/i.test(value)) while (/[*_~]$/.test(value)) value = value.slice(0, -1);
        if (/^mailto:[^@]+@[^/]+\/$/i.test(value)) value = value.slice(0, -1);
        if (/^mailto:.*[-_]$/i.test(value)) value = '';
        while (/[)\]}]$/.test(value)) {
          const ch = value.at(-1), pair = ch === ')' ? '(' : ch === ']' ? '[' : '{';
          if (value.split(pair).length >= value.split(ch).length) break;
          value = value.slice(0, -1);
        }
        if (value) {
          const email = value.includes('@') && !/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value);
          const href = (email ? 'mailto:' + value : /^www\./i.test(value) ? 'http://' + value : value).replace(/\\/g, '%5C').replace(/\]/g, '%5D');
          out += `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>`;
          i += value.length; continue;
        }
        if (/^mailto:/i.test(candidate[0])) { out += escapeHtml(candidate[0]); i += candidate[0].length; continue; }
      }
    }
    // Code spans take precedence over bracket syntax and escape handling.
    if (c === '`') {
      let n = 1; while (source[i + n] === '`') n++;
      const end = matchingTickEnd(source, i + n, n);
      if (end >= 0) { let text = source.slice(i + n, end).replace(/\n/g, ' '); if (/^ .* $/.test(text) && /[^ ]/.test(text)) text = text.slice(1, -1); out += '<code>' + escapeHtml(text) + '</code>'; i = end + n; continue; }
      out += '`'.repeat(n); i += n; continue;
    }
    // Inline links and images, including the common reference forms.
    if (c === '!' && source[i + 1] === '[' || c === '[') {
      const image = c === '!'; const start = i + (image ? 2 : 1);
      let close = start, depth = 0;
      for (; close < source.length; close++) {
        if (source[close] === '\\') { close++; continue; }
        if (source[close] === '<') { const tagEnd = source.indexOf('>', close + 1); if (tagEnd >= 0 && /^<\/?[A-Za-z][^<>]*>$/.test(source.slice(close, tagEnd + 1))) { close = tagEnd; continue; } }
        if (source[close] === '`') {
          let ticks = 1; while (source[close + ticks] === '`') ticks++;
          const codeEnd = matchingTickEnd(source, close + ticks, ticks);
          if (codeEnd >= 0) { close = codeEnd + ticks - 1; continue; }
        }
        if (source[close] === '[') depth++;
        else if (source[close] === ']') { if (!depth) break; depth--; }
      }
      if (close < source.length) {
        const label = source.slice(start, close); let dest = null, title = '' , end = close + 1;
        // Markdown forbids an anchor from containing another anchor. If a
        // completed link occurs in this label, leave this opening bracket as
        // text so the inner construct can be rendered on its own.
        const nestedLink = !image && /(?<!!)\[[^\]]*\](?:\([^\n)]*\)|\[[^\]]*\])/.test(label);
        if (source[end] === '(') {
          let p = end + 1; while (/[ \t\n]/.test(source[p] || '')) p++;
          let raw = '', quoted = false, q = '';
          if (source[p] === '<') { const z = source.indexOf('>', p + 1), lineEnd = source.indexOf('\n', p + 1); if (z >= 0 && source[z - 1] !== '\\' && (lineEnd < 0 || z < lineEnd)) { raw = source.slice(p + 1, z); p = z + 1; } }
          else { const b = p; let par = 0; while (p < source.length && (par || !/[ \t\n)]/.test(source[p]))) { if (source[p] === '\\') { p += Math.min(2, source.length - p); continue; } if (source[p] === '(') par++; if (source[p] === ')') par--; p++; } raw = source.slice(b, p); }
          while (/[ \t\n]/.test(source[p] || '')) p++;
          if (/['"(]/.test(source[p])) {
            q = source[p] === '(' ? ')' : source[p]; p++;
            let z = p;
            while (z < source.length && (source[z] !== q || source[z - 1] === '\\')) z++;
            if (z < source.length) { title = source.slice(p, z); p = z + 1; while (/[ \t\n]/.test(source[p] || '')) p++; }
          }
        if (source[p] === ')') { if (!raw && title) raw = source.slice(end + 1, p).trim(); dest = cleanDestination(raw); end = p + 1; }
        } else {
          let ref = label, p = end;
          if (source[p] === '[') { const z = source.indexOf(']', p + 1); if (z >= 0) { if (z > p + 1) ref = source.slice(p + 1, z); end = z + 1; } }
          const normalizedRef = ref.replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
          const got = linkDefinitions[normalizedRef]; if (got) { dest = got.href; title = got.title || ''; }
        }
        if (dest !== null && !nestedLink && !hasShortTickInsideSpan(label)) { const altSource = label.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); const alt = inline(altSource, linkDefinitions, true).replace(/<[^>]*>/g, ''); const href = dest.replace(/ /g, '%20').replace(/"/g, '%22'); title = title.replace(/\\([\p{P}\p{S}])/gu, '$1'); out += image ? `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>` : `<a href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${inline(label, linkDefinitions, true)}</a>`; i = end; continue; }
      if (dest === null && source[end] === '(') { const ref = label.replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss'); const fallback = linkDefinitions[ref]; if (fallback) { dest = fallback.href; title = fallback.title || ''; end = close + 1; } }
      if (dest !== null && !nestedLink && !hasShortTickInsideSpan(label)) { const href = dest.replace(/ /g, '%20').replace(/"/g, '%22'); out += `<a href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${inline(label, linkDefinitions, true)}</a>`; i = end; continue; }
      }
    }
    if (c === '\\' && i + 1 < source.length) {
      if (source[i + 1] === '\n' && i + 2 < source.length) { out += '<br>'; i += 2; while (source[i] === ' ') i++; continue; }
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) { out += escapeHtml(source[i + 1]); i += 2; continue; }
    }
    if (c === '~') {
      let n = 1; while (source[i + n] === '~') n++;
      if (n > 2) { out += '~'.repeat(n); i += n; continue; }
      const mark = '~'.repeat(n); let end = -1, depth = 1, cursor = i + n;
      while (cursor < source.length) {
        cursor = source.indexOf('~', cursor); if (cursor < 0) break;
        let run = 1; while (source[cursor + run] === '~') run++;
        if (run === n) {
          const before = source[cursor - 1] || '', after = source[cursor + n] || '';
          const canClose = !!before && !/\s/.test(before), canOpen = !!after && !/\s/.test(after);
          if (canClose && depth > 0) { depth--; if (!depth) { end = cursor; break; } }
          if (canOpen) depth++;
        }
        cursor += run;
      }
      if (end >= 0) {
        out += `<del>${inline(source.slice(i + n, end), linkDefinitions)}</del>`;
        i = end + n; continue;
      }
    }

    if (c === '<') { if (source.startsWith('<![CDATA[', i)) { const end = source.indexOf(']]>', i + 9); if (end >= 0) { out += source.slice(i, end + 3); i = end + 3; continue; } } const e = tagEnd(source, i + 1); if (e >= 0) { const raw = source.slice(i, e + 1), inner = raw.slice(1, -1); const splitAt = inner.search(/\s/), head = splitAt < 0 ? inner : inner.slice(0, splitAt); if (!disableAutolinks && splitAt >= 0 && /^(?:https?:\/\/|ftp:\/\/)[^<>]+$/i.test(head)) { out += `&lt;<a href="${escapeHtml(angleDestination(head))}">${escapeHtml(head)}</a>${escapeHtml(inner.slice(splitAt))}&gt;`; i = e + 1; continue; } if (!disableAutolinks && /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>]+$/.test(inner)) { out += `<a href="${escapeHtml(angleDestination(inner).replace(/`/g, '%60'))}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (!disableAutolinks && /^(?:https?:\/\/|ftp:\/\/|www\.)[^ <>]+$/i.test(inner)) { const href = /^www\./i.test(inner) ? 'http://' + inner : inner; out += `<a href="${escapeHtml(angleDestination(href))}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (!disableAutolinks && !inner.includes('\\') && /^[^ <>@]+@[^ <>]+\.[A-Za-z]{2,}$/.test(inner)) { out += `<a href="mailto:${escapeHtml(inner)}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } const strictAttrs = raw.includes('*') || /["'][A-Za-z_:][A-Za-z0-9_.:-]*=/.test(raw) || /^<\/[A-Za-z][A-Za-z0-9-]*\s+/.test(raw) || /="[^"\n]*\\"/.test(raw) || /\n[^<>]*[!*#]/.test(raw); const badAttrs = strictAttrs && !validInlineTag(raw); if (!badAttrs && /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>$/s.test(raw) || /^<!--/.test(raw) || /^<\?[\s\S]*\?>$/.test(raw) || /^<![A-Za-z][\s\S]*>$/.test(raw) || /^<!\[CDATA\[[\s\S]*\]\]>$/.test(raw)) { out += raw; i = e + 1; continue; } } }
    if (c === '&') { const m = source.slice(i).match(/^&(?:#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]*);/); if (m) { const dec = m[0].match(/^&#(\d+);$/), hex = m[0].match(/^&#[xX]([\da-fA-F]+);$/); if (dec || hex) { const cp = Number.parseInt((dec || hex)[1], dec ? 10 : 16); out += escapeHtml(!cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : String.fromCodePoint(cp)); } else out += m[0]; i += m[0].length; continue; } }
    if (c === '\n') {
      let spaces = 0; for (let p = out.length - 1; p >= 0 && out[p] === ' '; p--) spaces++;
      if (spaces >= 2 && i + 1 < source.length) { out = out.slice(0, -spaces); out += '<br>'; while (source[i + 1] === ' ') i++; }
      else out += '\n';
      i++; continue;
    }
    out += escapeHtml(c); i++;
  }
  if (events.has(source.length)) out += events.get(source.length).join('');
  return out;
}

function renderBlockTree(markdown, linkDefinitions = Object.create(null), nestedContext = false) {
  const src = markdown.replace(/\r\n?/g, '\n');
  const rawLines = src.split('\n');
  const blockLines = rawLines.map(line => { let col = 0, n = 0; while (n < line.length && (line[n] === ' ' || line[n] === '\t')) { if (line[n] === '\t') { const step = 4 - col % 4; line = line.slice(0, n) + ' '.repeat(step) + line.slice(n + 1); col += step; n += step; } else { col++; n++; } } return line; });
  const out = [];
  let i = 0;
  const blank = s => /^[ ]*$/.test(s);
  const realBlank = n => blank(blockLines[n] || '') && !(n === blockLines.length - 1 && src.endsWith('\n'));
  const identifyHtmlBlock = line => {
    const s = line.replace(/^ {0,3}/, '');
    let m;
    if ((m = s.match(/^<(pre|script|style|textarea)(?=\s|>|\/|$)/i))) return { type: 1, tag: m[1] };
    if (/^<!--/.test(s)) return { type: 2 };
    if (/^<\?/.test(s)) return { type: 3 };
    if (/^<!\[CDATA\[/.test(s)) return { type: 5 };
    if (/^<![A-Za-z]/.test(s)) return { type: 4 };
    if (/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>)/i.test(s)) return { type: 6 };
    if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\s*\/?>$/.test(s) && !/\s+[^\s=<>]*\*[^\s=<>]*\s*=/.test(s) && !/["'][A-Za-z_:][A-Za-z0-9_.:-]*=/.test(s) && !/^<\/[A-Za-z][A-Za-z0-9-]*\s+/.test(s) && !/="[^"\n]*\\"/.test(s)) return { type: 7 };
    return null;
  };
  while (i < blockLines.length) {
    if (blank(blockLines[i])) { i++; continue; }
    let m;
    // GFM tables: a pipe header followed by a delimiter row.
    if (i + 1 < blockLines.length && blockLines[i].includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(blockLines[i + 1]) && blockLines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length === blockLines[i + 1].trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length) {
      const split = row => { row = row.trim().replace(/^\|/, '').replace(/\|$/, ''); return row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
      const heads = split(blockLines[i]), aligns = split(blockLines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const row = (cells, tag) => `<tr>\n${heads.map((_, n) => { const a = aligns[n]; return `<${tag}${a ? ` align="${a}"` : ''}>${inline(cells[n] || '', linkDefinitions)}</${tag}>\n`; }).join('')}</tr>\n`;
      let html = '<table>\n<thead>\n' + row(heads, 'th') + '</thead>\n'; i += 2;
      if (i < blockLines.length && (!blank(blockLines[i]) || rawLines[i]?.includes('\t'))) { html += '<tbody>'; while (i < blockLines.length && (!blank(blockLines[i]) || rawLines[i]?.includes('\t')) && !/^ {0,3}(?:>|#{1,6}(?:\s|$)|```|~~~|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(blockLines[i])) html += row(split(blockLines[i++]), 'td'); html += '</tbody>'; }
      out.push(html + '</table>\n'); continue;
    }
    // Block HTML is passed through verbatim by marked; its contents are not parsed.
    if (identifyHtmlBlock(blockLines[i])) {
      const start = i;
      const kind = identifyHtmlBlock(blockLines[i]);
      let stopReason = 'eof';
      if (kind.type <= 5) {
        const terminator = kind.type === 1 ? new RegExp(`<\\/${kind.tag}\\s*>`, 'i') : kind.type === 2 ? /-->/ : kind.type === 3 ? /\?>/ : kind.type === 4 ? />/ : /\]\]>/;
        while (i < blockLines.length) {
          const line = blockLines[i++];
          if (terminator.test(line)) break;
        }
        if (i < blockLines.length && (kind.type === 1 ? realBlank(i) : blockLines[i] === '' && !(i === blockLines.length - 1 && src.endsWith('\n')))) stopReason = 'blank';
        else if (i < blockLines.length) stopReason = 'content';
      } else {
        while (i < blockLines.length && !realBlank(i)) i++;
        stopReason = i < blockLines.length ? 'blank' : 'eof';
      }
      const pieces = blockLines.slice(start, i);
      let raw = pieces.join('\n');
      if (pieces.length && pieces[pieces.length - 1] !== '' && (i < blockLines.length || src.endsWith('\n'))) raw += '\n';
      // The source's final separator belongs to the block only when it was
      // followed immediately by content or the source ended there.
      if (stopReason === 'blank' && raw.endsWith('\n')) raw = raw.slice(0, -1);
      out.push(raw); continue;
    }
    // Indented code blocks are recognized before other block constructs.
    if (/^(?: {4,}|\t)/.test(blockLines[i])) {
      const code = [];
      while (i < blockLines.length) {
        if (/^(?: {4,}|\t)/.test(blockLines[i])) {
          const lead = blockLines[i].match(/^ */)[0].length;
          const original = rawLines[i];
          code.push(original.startsWith('\t') ? original.slice(1) : original.startsWith('    ') ? original.slice(4) : blockLines[i].slice(4)); i++;
        } else if (blank(blockLines[i])) {
          let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
          if (k < blockLines.length && /^(?: {4,}|\t)/.test(blockLines[k])) { while (i < k) { code.push(''); i++; } }
          else break;
        } else break;
      }
      while (code.length && code[code.length - 1] === '') code.pop();
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}${code.length ? '\n' : ''}</code></pre>\n`); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*$/))) { const d = m[1].length; let body = m[2].trim(); if (/^ {0,3}#{1,6}[ \t]+#+[ \t]*$/.test(blockLines[i])) body = ''; else body = body.replace(/[ \t]+#+[ \t]*$/, ''); out.push(`<h${d}>${inline(body, linkDefinitions)}</h${d}>\n`); i++; continue; }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) { out.push('<hr>\n'); i++; continue; }
    if ((m = blockLines[i].match(/^( {0,3})(`{3,}|~{3,})/)) && !(m[2][0] === '`' && blockLines[i].slice(m[0].length).includes('`'))) {
      const indent = m[1].length, fence = m[2], lang = blockLines[i].slice(m[0].length).trim().split(/[ \t]/)[0]; let j = i + 1;
      const closeFence = new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
      while (j < blockLines.length && !closeFence.test(blockLines[j])) j++;
      const body = rawLines.slice(i + 1, j).map(line => line.replace(new RegExp('^ {0,' + indent + '}'), '')).join('\n');
      const language = lang.replace(/\\([\p{P}\p{S}])/gu, '$1');
      out.push(`<pre><code${language ? ` class="language-${escapeAttribute(language)}"` : ''}>${escapeHtml(body)}${body !== '' && !body.endsWith('\n') ? '\n' : ''}</code></pre>\n`); i = Math.min(j + 1, blockLines.length); continue;
    }
    const quoteLine = line => line.match(nestedContext ? /^ {0,6}>(?: ?)(.*)$/ : /^ {0,3}>(?: ?)(.*)$/);
    if ((m = quoteLine(blockLines[i]))) {
      const q = []; let quoteFence = false; while (i < blockLines.length && (m = quoteLine(blockLines[i]))) {
        let content=m[1];
        if (content.includes('\t')) { let col=1,expanded=''; for(const ch of content){if(ch==='\t'){const n=4-col%4;expanded+=' '.repeat(n);col+=n;}else{expanded+=ch;col++;}} content=expanded.startsWith(' ')?expanded.slice(1):expanded; }
        if (content === ' ' && q.some(line=>line.trim())) content='\u0001';
        const fm = content.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fm) quoteFence = !quoteFence;
        q.push(content); i++;
      }
      // An unmarked line continues a paragraph lazily when that paragraph
      // began inside the quote and the line does not start a new block.
      const interrupt = line => /^(?: {4,}|\t)|^ {0,3}(?:#{1,6}(?:\s|$)|```|~~~|(?:[-+*]|1[.)])[ \t]|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(line);
      while(i<blockLines.length && !quoteFence && !blank(blockLines[i]) && q.length && q.at(-1).trim() && (!interrupt(q.at(-1)) || /^ {0,3}\d{1,9}[.)][ \t]+>/.test(q.at(-1))) && !/^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(q.at(-1))) {
        const nextQuote=quoteLine(blockLines[i]);
        if(nextQuote){q.push(nextQuote[1]);i++;continue;}
        const lazyIndentedList=/^ {4,}(?:[-+*]|\d{1,9}[.)])[ \t]/.test(blockLines[i]);
        if(interrupt(blockLines[i]) && !lazyIndentedList) break;
        let lazy=blockLines[i++].replace(/^ {1,4}/,'');
        if(lazyIndentedList) lazy='\\'+lazy;
        if (/^ {0,3}=+[ \t]*$/.test(lazy)) lazy = '\u0002' + lazy.trim();
        q.push(lazy);
      }
      out.push(`<blockquote>\n${renderBlockTree(q.join('\n'), linkDefinitions, true).replace(/\u0001/g,' ').replace(/\u0002/g,'    ')}</blockquote>\n`); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/)) && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) {
      const ordered = /^\d/.test(m[1]), tag = ordered ? 'ol' : 'ul';
      const marker = m[1], markerIndent = blockLines[i].match(/^ */)[0].length;
      const markerPad = blockLines[i].slice(markerIndent + marker.length).match(/^[ \t]+/)?.[0] || '';
      let markerPadding=0, markerCol=markerIndent+marker.length; for(const ch of markerPad){const n=ch==='\t'?4-markerCol%4:1;markerPadding+=n;markerCol+=n;}
      if(!markerPadding) markerPadding=1;
      const markerWidth = marker.length + (markerPadding > 4 ? 1 : markerPadding);
      const contentIndent = markerIndent + markerWidth;
      const startNumber = ordered ? Number.parseInt(marker, 10) : 1;
      const listItems = []; let hasLooseItems = false;
      while (i < blockLines.length) {
        if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) break;
        const itemMatch = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/);
        if (!itemMatch || (ordered ? itemMatch[1].slice(-1) !== marker.slice(-1) : itemMatch[1] !== marker)) break;
        const itemIndent = blockLines[i].match(/^ */)[0].length;
        const padText=blockLines[i].slice(itemIndent+itemMatch[1].length).match(/^[ \t]+/)?.[0]||'';
        let padding=0,padCol=itemIndent+itemMatch[1].length;for(const ch of padText){const n=ch==='\t'?4-padCol%4:1;padding+=n;padCol+=n;}if(!padding)padding=1;
        const width = itemMatch[1].length + (padding > 4 ? 1 : padding);
        const indent = itemIndent + width;
        const emptyMarker = !(itemMatch[2] || '').trim();
        const body = [padding > 4 ? ' '.repeat(padding - 1) + (itemMatch[2] || '') : (itemMatch[2] || '')]; i++;
        let itemFence = null;
        const trackFence = line => {
          if (itemFence) {
            const close = new RegExp('^ {0,3}' + (itemFence[0] === '`' ? '`' : '~') + '{' + itemFence.length + ',}[ \\t]*$');
            if (close.test(line)) itemFence = null;
          } else {
            const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
            if (open && !(open[1][0] === '`' && open[2].includes('`'))) itemFence = open[1];
          }
        };
        trackFence(body[0]);
        while (i < blockLines.length) {
          const next = blockLines[i].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/);
          if (next && /^\d/.test(next[1]) === ordered && (!ordered ? next[1] === marker : next[1].slice(-1) === marker.slice(-1)) && blockLines[i].match(/^ */)[0].length <= itemIndent && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) break;
          if (itemFence) {
            const lead = blockLines[i].match(/^ */)[0].length;
            body.push(blockLines[i].slice(lead >= indent ? indent : 0));
            trackFence(blockLines[i]); i++; continue;
          }
          if (blank(blockLines[i])) {
            if (emptyMarker && body.length === 1 && !body[0].trim()) {
              let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
              const following = k < blockLines.length && blockLines[k].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/);
              if (!following || (ordered ? following[1].slice(-1) !== marker.slice(-1) : following[1] !== marker)) break;
            }
            let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
            if (k >= blockLines.length) { i = k; break; }
            const followingFence = blockLines[k].match(/^ *(?:`{3,}|~{3,})/);
            if (followingFence && blockLines[k].match(/^ */)[0].length <= itemIndent) break;
            if (blockLines[k].match(/^ {0,3}([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/) && blockLines[k].match(/^ */)[0].length <= itemIndent + 3) { body.push(''); i++; hasLooseItems = true; continue; }
            if (blockLines[k].match(/^ {0,3}>/)) { body.push(''); i++; hasLooseItems = true; continue; }
            if (blockLines[k].match(/^ */)[0].length >= indent) { const nextLead = blockLines[k].match(/^ */)[0].length; const nestedMarker = nextLead > indent && /^ +(?:[-+*]|\d{1,9}[.)])[ \t]/.test(blockLines[k]); const nestedAlready = body.slice(1).some(line => /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]/.test(line)); body.push(''); i++; if (!nestedMarker && (!nestedAlready || nextLead <= indent)) hasLooseItems = true; continue; }
            break;
          }
          const lead = blockLines[i].match(/^ */)[0].length;
          if (emptyMarker && body.length === 1 && !body[0].trim() && lead > itemIndent && lead < indent) { body.push(blockLines[i].slice(lead)); trackFence(body[body.length - 1]); }
          else if (lead === 4 && itemIndent === 3 && /^ {4}(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(blockLines[i])) body.push('\\' + blockLines[i].slice(lead));
          else if (lead >= indent) { body.push(blockLines[i].slice(indent)); trackFence(body[body.length - 1]); }
          else if (lead > itemIndent && body.length && body.at(-1).trim() && !/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])[ \t]|>|```|~~~|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(blockLines[i])) body.push(blockLines[i].slice(lead));
          else if (lead === 0 && body.length && body.at(-1).trim() && !/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])[ \t]|>|```|~~~|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(blockLines[i])) body.push(blockLines[i]);
          else break;
          i++;
        }
        listItems.push(body);
      }
      let htmlItems = listItems.map(linesInItem => {
        const task = linesInItem[0]?.match(/^\[([ xX])\][ \t]+(.*)$/);
        if (task) linesInItem[0] = task[2];
        const rendered = renderBlockTree(linesInItem.join('\n'), linkDefinitions, true).replace(/\n$/, '');
        const checkbox = task ? `<input ${task[1] === ' ' ? 'disabled=""' : 'checked="" disabled=""'} type="checkbox"> ` : '';
        if (!hasLooseItems && /^(?:<blockquote>|<ul>|<ol>)/.test(rendered)) return `<li>${checkbox}${rendered}\n</li>\n`;
        if (!hasLooseItems && /^<h[1-6]>[\s\S]*<\/h[1-6]>$/.test(rendered)) return `<li>${checkbox}${rendered}\n</li>\n`;
        if (!hasLooseItems && /^<h[1-6]>[\s\S]*<\/h[1-6]>\n<p>[\s\S]*<\/p>$/.test(rendered)) { const close = rendered.indexOf('</h'); const after = rendered.indexOf('\n<p>', close) + 4; return `<li>${checkbox}${rendered.slice(0, close + 5)}\n${rendered.slice(after, -4)}</li>\n`; }
        if (!hasLooseItems && rendered === '<hr>') return `<li>${checkbox}<hr>\n</li>\n`;
        if (!hasLooseItems && rendered.startsWith('<pre>')) return `<li>${checkbox}${rendered}\n</li>\n`;
        if (!hasLooseItems && /^<p>[\s\S]*<\/p>$/.test(rendered)) return `<li>${checkbox}${rendered.slice(3, -4)}</li>\n`;
        if (!hasLooseItems && /^<\/?[A-Za-z]/.test(rendered) && !rendered.includes('\n')) return `<li>${checkbox}${rendered}</li>\n`;
        if (!hasLooseItems && rendered.startsWith('<p>')) { const close = rendered.indexOf('</p>'); if (close >= 0) return `<li>${checkbox}${rendered.slice(3, close)}${rendered.slice(close + 5)}\n</li>\n`; }
        if (rendered.startsWith('<pre>')) return `<li>${checkbox}${rendered}\n</li>\n`;
        if (hasLooseItems && rendered.startsWith('<p>')) return `<li><p>${checkbox}${rendered.slice(3)}\n</li>\n`;
        return `<li>${checkbox}${rendered ? '\n' + rendered + '\n' : ''}</li>\n`;
      }).join('');
      if (!hasLooseItems) htmlItems = htmlItems.replace(/<li>\n(?=<(?:blockquote|ul|ol)>)/g, '<li>');
      out.push(`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>\n${htmlItems}</${tag}>\n`); continue;
    }
    if (i + 1 < blockLines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(blockLines[i + 1])) { const d = blockLines[i + 1].trim()[0] === '=' ? 1 : 2; out.push(`<h${d}>${inline(blockLines[i].trim(), linkDefinitions)}</h${d}>\n`); i += 2; continue; }
    let j = i + 1;
    const paragraphListMarker = nestedContext ? '(?:[-+*]|\\d{1,9}[.)])' : '(?:[-+*]|1[.)])';
    while (j < blockLines.length && !blank(blockLines[j]) && !/^ {0,3}(?:=+|-+)[ \t]*$/.test(blockLines[j]) && !(identifyHtmlBlock(blockLines[j]) && identifyHtmlBlock(blockLines[j]).type <= 6) && !new RegExp('^ {0,3}(?:#{1,6}(?:\\s|$)|>|```|~~~|' + paragraphListMarker + '[ \\t])').test(blockLines[j]) && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[j])) j++;
    if (j < blockLines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(blockLines[j])) { const d=blockLines[j].trim()[0]==='='?1:2; out.push(`<h${d}>${inline(blockLines.slice(i,j).join('\n').trim(),linkDefinitions)}</h${d}>\n`); i=j+1; continue; }
    out.push(`<p>${inline(blockLines.slice(i, j).join('\n'), linkDefinitions)}</p>\n`); i = j;
  }
  return out.join('').replace(/<li>\n(?=<(?:ol|ul)(?:\s|>)|<blockquote>)/g, '<li>');
}

/** Render a Markdown string into HTML. */
export function parse(markdown) {
  let source = String(markdown);
  const linkDefinitions = Object.create(null);
  source = source.replace(/^ {0,3}(?:> ?)*\[((?:\\.|[^\]])+)\]:[ \t]*(?:\n[ \t]*)?(?:<([^>\n]*)>|(?!<)(\S+))(?:(?:[ \t]+|[ \t]*\n[ \t]*)(?:"((?:(?!\n[ \t]*\n)[\s\S])*?)"|'((?:(?!\n[ \t]*\n)[\s\S])*?)'|\((.*)\)))?[ \t]*$/gm, (_m, rawLabel, angled, plain, dq, sq, paren, offset) => {
    const before = source.slice(0, offset), linePrefix = before.slice(before.lastIndexOf('\n') + 1);
    const precedingLine = before.slice(0, Math.max(0, before.lastIndexOf('\n'))).split('\n').at(-1) || '';
    let fence = null;
    for (const line of before.split('\n')) {
      const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!fence && mark && !(mark[1][0] === '`' && mark[2].includes('`'))) fence = mark[1];
      else if (fence && new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}[ \t]*$').test(line)) fence = null;
    }
    const definitionRun = /^ {0,3}\[.*\]:/m.test(before);
    if (fence || precedingLine.trim() && !/^ {0,3}>/.test(linePrefix) && !/^ {0,3}#/.test(precedingLine) && !/^ {0,3}\[.*\]:/.test(precedingLine) && !definitionRun) return _m;
    if (!rawLabel.trim() || /(^|[^\\])\[/.test(rawLabel)) return _m;
    const label = rawLabel.replace(/\\([\\()[\]])/g, '$1');
    const key = label.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
    if (!linkDefinitions[key]) linkDefinitions[key] = { href: cleanDestination(angled ?? plain), title: (dq ?? sq ?? paren ?? '').replace(/\\([\p{P}\p{S}])/gu, '$1') };
    return _m.match(/^ {0,3}(?:> ?)+/)?.[0] || '';
  });
  return renderBlockTree(source, linkDefinitions);
}
