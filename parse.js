// Shared per-parse flag: a raw <a ...> tag (marked's startATag: `<a`
// followed by a space) seen by the inline lexer leaves marked in
// "inside a link" state, which suppresses bare-URL and email autolinks
// for the rest of the document until a raw </a> (endATag, exact) is
// seen. A self-closing <a/> or bare <a> does NOT set it. It is stored
// on the per-parse link-definitions object so it survives the recursive
// inline calls but is reset for every fresh parse.
const IN_LINK = Symbol('inLink');

// Small, dependency-free Markdown renderer. Parsing is performed afresh for each call.
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeAttribute = s => escapeHtml(s).replace(/&amp;(#(?:\d+|[xX][\da-fA-F]+)|[A-Za-z][A-Za-z0-9]*);/g, '&$1;');
const cleanDestination = s => s.replace(/\\([\p{P}\p{S}])/gu, '$1').replace(/\\/g, '%5C').replace(/[^\x00-\x7F]/gu, ch => encodeURIComponent(ch));
const angleDestination = s => s.replace(/\\/g, '%5C').replace(/[\[\]]/g, c => c === '[' ? '%5B' : '%5D');

// Sticky (lastIndex-anchored) autolink scan: identical to matching the old
// ^-anchored pattern against source.slice(i), but without allocating a
// tail substring at every cursor position. The ^ is dropped because the
// sticky flag already anchors the match at lastIndex.
const autolinkRe = /(?:(?:https?|ftp):\/\/[^\s<>]+|www\.[^\s<>]+|[A-Za-z][A-Za-z0-9+.-]{1,31}:(?=[A-Za-z0-9])(?=[^\s<>]*(?:@|\.))[^\s<>/]+(?:\/[^\s<>/]*)?|[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*[A-Za-z0-9])+)/iy;
// First character of any autolink alternative (scheme letter, www, or an
// email local-part character). Positions starting with anything else can
// never match, so the regex is not even attempted there.
const autolinkStartChar = c => { const k = c.charCodeAt(0); return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122) || '.!#$%&\'*+/=?^_`{|}~-'.includes(c); };
// Next markup character in the inline render loop: *, _, `, [, \, !, ~,
// <, &, or a newline. A literal run ends at the first of these.
const plainRunRe = /[*_`\[\\!~<&`\n]/g;
// marked's GFM autolink backpedal: repeatedly keep only the prefix this
// matches. It drops trailing punctuation, trims an unmatched '(' (and
// everything after it), keeps a balanced (group), and keeps a ']' or '}'
// that a naive trailing-strip would remove.
const autolinkBackpedal = /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
// attribute syntax: names of [A-Za-z_:][A-Za-z0-9_.:-]*, optionally
// =value (quoted, or unquoted without whitespace or " ' = < > `). A tag
// like <foo *bar* baz> or <foo https://x.com> is not a tag at all, so the
// angle brackets stay literal text. Shared by the inline lexer and the
// block HTML (type 7) check.
const validInlineTag = raw => {
  if (!raw.startsWith('<') || !raw.endsWith('>')) return false;
  const body = raw.slice(1, -1); let p = 0;
  if (body[0] === '/') { p = 1; while (/[A-Za-z0-9-]/.test(body[p] || '')) p++; return p === body.length || /^\s+$/.test(body.slice(p)); }
  if (!/^[A-Za-z]/.test(body)) return false;
  while (/[A-Za-z0-9-]/.test(body[p] || '')) p++;
  while (p < body.length) {
    if (body[p] === '/') return p === body.length - 1;
    // Each attribute must be separated from the tag name and from the
    // previous attribute by whitespace: <m:abc> is not a tag.
    if (!/\s/.test(body[p])) return false;
    while (/\s/.test(body[p] || '')) p++;
    if (p === body.length || body[p] === '/') break;
    const name = body.slice(p).match(/^[A-Za-z_:][A-Za-z0-9_.:-]*/); if (!name) return false; p += name[0].length;
    // An optional =value may follow, with optional whitespace around =.
    // A bare attribute leaves its trailing whitespace for the loop top.
    let q = p;
    while (/[ \t]/.test(body[q] || '')) q++;
    if (body[q] === '=') {
      p = q + 1;
      while (/[ \t]/.test(body[p] || '')) p++;
      if (body[p] === '"' || body[p] === "'") { const qq = body[p++]; while (p < body.length && body[p] !== qq) p++; if (body[p++] !== qq) return false; }
      else { const value = body.slice(p).match(/^[^\s"'=<>`]+/); if (!value) return false; p += value[0].length; }
    }
    // After an attribute (bare or valued) only whitespace, / or the end
    // may follow.
    if (p < body.length && !/[\s/]/.test(body[p])) return false;
  }
  return true;
};

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

// ASCII fast paths, hoisted out of inline() (were re-allocated as closures
// on every call): ASCII letters/digits are \p{L}/\p{N}, ASCII punctuation
// is \p{P}/\p{S}.
const word = c => { if (!c) return false; const k = c.charCodeAt(0); if (k < 128) return (k >= 48 && k <= 57) || (k >= 65 && k <= 90) || (k >= 97 && k <= 122); return /[\p{L}\p{N}]/u.test(c); };
const punct = c => { if (!c) return false; const k = c.charCodeAt(0); if (k < 128) return '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.includes(c); return /[\p{P}\p{S}]/u.test(c); };
const tagEnd = (s, from) => { let quote = ''; for (let p = from; p < s.length; p++) { const c = s[p]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') return p; } return -1; };
const unclosedTickCount = (s) => { for (let i = 0; i < s.length;) { if (s[i] === '`') { let n = 1; while (s[i + n] === '`') n++; const e = matchingTickEnd(s, i + n, n); if (e < 0) return n; i = e + n; } else i++; } return 0; };
const labelUnclosedInSource = (label, labelStart, source) => { for (let i = 0; i < label.length;) { if (label[i] === '`') { let n = 1; while (label[i + n] === '`') n++; if (n === 1) { const e = matchingTickEnd(source, labelStart + i + n, n); if (e < 0) return true; i = e - labelStart + n; } else { const e = matchingTickEnd(source, labelStart + i + n, n); i = e >= 0 ? e - labelStart + n : i + n; } } else i++; } return false; };
const labelHasDefinedRef = (label, linkDefinitions) => { for (let i = 0; i < label.length;) { if (label[i] === '`') { let n = 1; while (label[i + n] === '`') n++; const e = matchingTickEnd(label, i + n, n); i = e >= 0 ? e + n : i + n; continue; } if (label[i] === '[' && label[i - 1] !== '!') { let cb = i + 1; while (cb < label.length && label[cb] !== ']') { if (label[cb] === '\\') cb++; cb++; } if (cb < label.length && label[cb + 1] === '[') { let cb2 = cb + 2; while (cb2 < label.length && label[cb2] !== ']') { if (label[cb2] === '\\') cb2++; cb2++; } if (cb2 < label.length) { const refText = label.slice(cb + 2, cb2); const key = (refText || label.slice(i + 1, cb)).replace(/\\([\\()[\\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss'); if (key && linkDefinitions[key]) return true; i = cb2 + 1; continue; } } if (cb < label.length && label[cb + 1] !== '(' && label[cb + 1] !== '[') { const key = label.slice(i + 1, cb).replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss'); if (key && linkDefinitions[key]) return true; } } i++; } return false; };

function inline(source, linkDefinitions = Object.create(null), disableAutolinks = false) {
  // Plain prose can be escaped in one pass without building delimiter and
  // link state. Keep URL and email starters in the guard because GFM scans
  // those even when the punctuation trigger set is absent.
  // Plain-prose gate, split from the single combined regex: the old regex
  // re-tried its email alternative at every word start, so a long plain
  // paragraph paid a full scan with per-word backtracking. The split keeps
  // the exact same fast-path condition, only cheaper: a markup char class
  // (one C++ scan), a hard break (`  \n` is exactly ` {2,}\n`), a URL
  // (`://` covers every scheme case-insensitively; `www.` via one regex),
  // and an email SUPERSET (`@` with a `.` after it — a necessary condition
  // for the email alternative, so a false positive only costs a full-path
  // run, never a wrong fast path).
  const atPos = source.indexOf('@');
  if (!/[*_`\[\]\\!~<&]/.test(source) && !source.includes('  \n') && !source.includes('://') && !/www\./i.test(source) && !(atPos > 0 && source.indexOf('.', atPos) > atPos)) return escapeHtml(source);
  // The pre-pass only produces emphasis marks and <...> tag spans (the
  // spans matter only to the `~` branch). With no *, _ or ~ in the source
  // it can produce nothing the render loop needs, so skip its full scan.
  const hasEmphChars = source.includes('*') || source.includes('_') || source.includes('~');
  // Resolve emphasis runs as a delimiter stack before rendering the other
  // inline tokens. Each run keeps its unused marker characters literal.
  const marks = [];
  // Spans of <...> the pre-pass skips for emphasis marks; tilde
  // strikethrough is suppressed inside them too (marked swallows the
  // whole span as text, so no inline construct forms there).
  const tagSpans = [];
  // A link whose label holds an unclosed backtick run leaves marked inside
  // a code span: emphasis marks after the link up to the next backtick
  // run are suppressed (the link itself still forms).
  let suppressMarksUntil = -1;
  // True when a backtick run inside a link label has no matching closer
  // anywhere later in the source: such a label never closes, so the
  // bracket is literal and its _/* marks must still be collected.
  // A collapsed [text][] or full [text][ref] inside a link label blocks the
  // outer link when its key is defined, and so does a defined shortcut
  // [text] (same rule as the main render). The pre-pass must not skip such
  // a label's marks, or emphasis inside it can never form once the link
  // is blocked and the label is literal text.
  for (let p = 0; hasEmphChars && p < source.length;) {
    const ch = source[p];
    if (ch === '\\' && p+1<source.length && /[\p{P}\p{S}]/u.test(source[p+1])) { p+=2; continue; }
    if (ch === '`') { let n = 1; while (source[p + n] === '`') n++; let e = matchingTickEnd(source, p + n, n); if (e >= 0) { p = e + n; continue; } p += n; continue; }
    if (ch === '<' && /[A-Za-z!/?]/.test(source[p + 1] || '')) { let q=p+1, quote=''; for(;q<source.length;q++){const x=source[q];if(quote){if(x===quote)quote='';}else if(x==='"'||x==="'")quote=x;else if(x==='>')break;} if(q<source.length){tagSpans.push([p, q+1]); p=q+1;continue;} }
    if (ch === '[' || ch==='!' && source[p+1]==='[') { let q=p+(ch==='!'?2:1), depth=0; for(;q<source.length;q++){if(source[q]==='\\'){q++;continue;}if(source[q]==='[')depth++;else if(source[q]===']'){if(!depth)break;depth--;}} if(q<source.length && source[q+1]==='('){let z=q+2,par=0;for(;z<source.length;z++){if(source[z]==='\\'){z++;continue;}if(source[z]==='(')par++;else if(source[z]===')'){if(!par)break;par--;}}if(z<source.length){ const label=source.slice(p+(ch==='!'?2:1),q); if(!labelUnclosedInSource(label, p+(ch==='!'?2:1), source) && !/(?<!!)(?:\[[^\]]*\])\([^\n)]*\)/.test(label) && !labelHasDefinedRef(label, linkDefinitions)) { const tc = unclosedTickCount(label); if (tc > 0) { let nb = matchingTickEnd(source, z + 1, tc); if (nb < 0) nb = source.indexOf('`', z + 1); if (nb >= 0) suppressMarksUntil = nb; } p=z+1; continue; } } } }
    if (ch !== '*' && ch !== '_') { p++; continue; }
    if (suppressMarksUntil >= 0) { if (p < suppressMarksUntil) { let end = p + 1; while (source[end] === ch) end++; p = end; continue; } suppressMarksUntil = -1; }
    let end = p + 1; while (source[end] === ch) end++;
    const before = source[p - 1] || '', after = source[end] || '';
    const left = !!after && !/\s/.test(after) && (!punct(after) || !before || /\s/.test(before) || punct(before));
    const right = !!before && !/\s/.test(before) && (!punct(before) || !after || /\s/.test(after) || punct(after));
    marks.push({ ch, start:p, len:end-p, open:left && (ch !== '_' || !word(before) || !word(after)), close:right && (ch !== '_' || !word(before) || !word(after)), usedOpen:0, usedClose:0 }); p=end;
  }
  // When a doubled opener sits directly against a word inside a single-star
  // span and its doubled closer is followed by whitespace, marked leaves the
  // inner runs literal and lets the outer span consume the closer's last star.
  const shiftedClosers = new Set();
  for (let n = 0; n + 3 < marks.length; n++) {
    const outer = marks[n], innerOpen = marks[n + 1], innerClose = marks[n + 2], outerClose = marks[n + 3];
    if (outer.ch === '*' && outer.len === 1 && outer.open && !outer.close &&
        innerOpen.ch === '*' && innerOpen.len === 2 && innerOpen.open && innerOpen.close &&
        innerClose.ch === '*' && innerClose.len === 2 && innerClose.close && !innerClose.open &&
        outerClose.ch === '*' && outerClose.len === 1 && outerClose.close && !outerClose.open &&
        word(source[innerOpen.start - 1] || '') && /\s/.test(source[innerClose.start + innerClose.len] || '')) {
      innerOpen.open = false;
      innerOpen.close = false;
      shiftedClosers.add(n + 2);
    }
  }
  const events = new Map();
  const consumed = new Set();
  const addEvent = (at, value) => { let a=events.get(at); if (!a) events.set(at,a=[]); a.push(value); };
  const anchors = [];
  for (let a = 0; marks.length && a < source.length; a++) if (source[a] === '[' && !(a && source[a - 1] === '!')) {
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
      let found=-1, amount=0, foundAttachedInner=false;
      for (let oi=ci-1; oi>=0; oi--) {
        const opener=marks[oi]; const available=opener.len-opener.usedOpen-opener.usedClose;
        if (opener.ch!==closer.ch || !opener.open || available<=0) continue;
        // A completed pair inside this candidate whose closer is attached
        // to a word can block the surrounding pair: marked leaves the
        // outer delimiters literal when the inner closer's run and one of
        // the outer runs line up in threes (and the inner pair opened
        // after whitespace). Underscore outers are exempt: they span.
        const leftEdge = opener.start + opener.len;
        const rightEdge = closer.start;
        let attachedInnerClose = false, attachedInnerExists = false;
        // The mod-3 check must use the amounts that will actually be
        // consumed in this pair (1 for <em>, 2 for <strong>), not the full
        // run lengths: a trailing extra delimiter (e.g. the second * in
        // `markdown**`) must not count toward the three-alignment, and the
        // inner pair's amount comes from its tag, not its run length.
        const remainingForPair = closer.len - closer.usedClose - closer.usedOpen;
        const pairAmount = available >= 2 && remainingForPair >= 2 ? 2 : 1;
        if (closer.ch === '*') {
          for (const [at, tags] of events) {
            if (at <= leftEdge || at >= rightEdge || !word(source[at] || '')) continue;
            const closing = tags.find(tag => tag.startsWith('</em>') || tag.startsWith('</strong>'));
            if (!closing) continue;
            const openingTag = closing === '</em>' ? '<em>' : '<strong>';
            // Manual loop = [...events].find(...) without the array copy.
            let openingAt;
            for (const [pos, values] of events) { if (pos > leftEdge && pos < at && values.includes(openingTag)) { openingAt = pos; break; } }
            if (openingAt === undefined || !/\s/.test(source[openingAt - 1] || '')) continue;
            attachedInnerExists = true;
            let innerCloser;
            for (const m of marks) { if (m.start < at && at <= m.start + m.len) { innerCloser = m; break; } }
            const innerLen = closing === '</em>' ? 1 : 2;
            const blockedByThrees = (a, b) => (a + b) % 3 === 0 && !(a % 3 === 0 && b % 3 === 0);
            const hasDeadIntervener = innerCloser && innerLen === 1 && marks.some(m => m.start > innerCloser.start + innerCloser.len && m.start < closer.start && !m.open);
            if (closer.len % 3 !== 0 && !hasDeadIntervener && (blockedByThrees(innerLen, pairAmount) || blockedByThrees(innerLen, opener.len))) { attachedInnerClose = true; break; }
          }
        }
        if (attachedInnerClose) continue;
        const remaining=closer.len-closer.usedClose-closer.usedOpen;
        if (opener.close && available===2 && remaining===1 && !closer.open) continue;
        const both=closer.open || opener.close;
        const blockedByRuleOfThree = both && (available+remaining)%3===0 && !(available%3===0 && remaining%3===0);
        if (blockedByRuleOfThree) continue;
        amount=available>=2 && remaining>=2 ? 2 : 1; found=oi; foundAttachedInner=attachedInnerExists; break;
      }
      if (found<0) break;
      const opener=marks[found], openAt=opener.start+opener.len-opener.usedClose-opener.usedOpen-amount;
      // A closer run partially consumed by a STRONG pair spanning an
      // attached inner pair takes its delimiters from the END of the run
      // (the leftover star stays inside the emphasis); an em pair, and
      // any pair without an attached inner pair, takes them from the
      // start (leftover star outside).
      const closeAt=(foundAttachedInner && amount===2) ? closer.start+closer.len-closer.usedClose-amount : closer.start+closer.usedClose;
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
  // events is populated only by the pairing loop; when it stayed empty
  // the render loop must not pay a Map lookup per character.
  const hasEvents = events.size > 0;
  let out = '';
  // Literal text accumulates in `lit` and is escaped once per run instead
  // of one escapeHtml() call per character. Every branch that emits markup
  // flushes first so output order is preserved.
  let lit = '';
  // Autolink word-scan boundary: positions before this cannot start a
  // bare URL/email (their run holds no @, no www., and no ':' after it).
  let noAutoUntil = -1;
  const flush = () => { if (lit) { out += escapeHtml(lit); lit = ''; } };
  for (let i = 0; i < source.length;) {
    if (hasEvents && events.has(i)) { flush(); out += events.get(i).join(''); }
    if (source[i] === '*' || source[i] === '_') { if (consumed.has(i)) { i++; } else { lit += source[i]; i++; } continue; }
    const c = source[i];
    // GFM recognizes URL and email forms in ordinary text. Keep the scan
    // anchored at the current cursor so punctuation and adjacent markup stay
    // available to the normal inline scanner. Bare-URL and email autolinks
    // are suppressed inside link text and while a raw <a> tag has left the
    // lexer in "inside a link" state; angle autolinks are not suppressed.
    if (c !== '<' && !disableAutolinks && !linkDefinitions[IN_LINK] && i >= noAutoUntil && autolinkStartChar(c)) {
      // Word scan: a bare URL/email can only start in a run of autolink
      // characters that contains www., or is followed by ':' (a scheme)
      // or '@' (an email local part ends there — '@' itself is not in
      // the run's character class, so it is the run's terminator). A run
      // with none of those cannot start any autolink, so skip the regex
      // for the whole run. Mid-word https:// still works: its run is
      // 'https' and ':' follows it, so the regex still runs.
      let j = i, hasWww = false;
      while (j < source.length && autolinkStartChar(source[j])) {
        if ((source.charCodeAt(j) | 32) === 119 && (source.charCodeAt(j + 1) | 32) === 119 && (source.charCodeAt(j + 2) | 32) === 119 && source[j + 3] === '.') hasWww = true;
        j++;
      }
      if (!hasWww && source[j] !== ':' && source[j] !== '@') { noAutoUntil = j; }
      else {
      autolinkRe.lastIndex = i;
      const candidate = autolinkRe.exec(source);
      if (candidate) {
        let value = candidate[0];
        if (/^www\./i.test(value) && !/^www\./.test(value)) value = '';
        // A www. URL sitting directly after a < is not an autolink: the
        // angle bracket starts a failed tag attempt and marked leaves the
        // www. text literal (scheme URLs and emails after < still link).
        if (/^www\./i.test(value) && source[i - 1] === '<') value = '';
        // An email match cut short by a trailing _ or - is rejected
        // outright, unless that character is a consumed emphasis closer
        // (marked's emphasis pass consumes a closing _ before the
        // autolink is seen, so the email still counts).
        const afterEmail = source[i + value.length];
        if ((afterEmail === '_' || afterEmail === '-') && value.includes('@') && !/^(?:https?|ftp):\/\//i.test(value) && !/^www\./i.test(value) && !/^[A-Za-z][A-Za-z0-9+.-]{1,31}:/i.test(value)) {
          const closerMark = marks.find(m => m.start === i + value.length && m.ch === '_' && m.usedClose > 0);
          if (afterEmail !== '_' || !closerMark) value = '';
        }
        // Bare URLs take marked's backpedal (trailing punctuation, an
        // unmatched '(' ends the URL, ']' and '}' are kept). Bare emails
        // and mailto: keep the old stripping loop: marked matches those
        // without backpedalling, and their mailto: trailing-slash rules
        // live in that loop.
        const isEmailValue = value.includes('@') && !/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value) && !/^www\./i.test(value);
        if (!isEmailValue && !/^mailto:/i.test(value)) {
          let prevBackpedal;
          do { prevBackpedal = value; value = autolinkBackpedal.exec(value)?.[0] ?? ''; } while (value && value !== prevBackpedal);
        } else {
        // GFM trailing punctuation is stripped in passes until the value is
        // stable: a closing paren can expose a dot, a star can expose a
        // dot, and so on (for example `nova).)` or `example.net.*`).
        let prevValue;
        do {
          prevValue = value;
          if (/&[A-Za-z0-9]+;$/.test(value)) value = value.slice(0, value.lastIndexOf('&'));
          while (/[.,:;!?]$/.test(value)) value = value.slice(0, -1);
          if (!/^mailto:/i.test(value)) while (/[*_~]$/.test(value)) value = value.slice(0, -1);
          if (/^mailto:[^@]+@[^/]+\/$/i.test(value)) value = value.slice(0, -1);
          if (/^mailto:.*[-_]$/i.test(value)) value = '';
          while (/[)\]}]$/.test(value)) {
            const ch = value.at(-1), pair = ch === ')' ? '(' : ch === ']' ? '[' : '{';
            // A trailing closer is kept iff it closes an opener that is
            // still open just before it. Scan the value without the
            // trailing closer, clamping depth at 0 so an unmatched closer
            // early in the URL (e.g. the `)` in `a)](b)`) does not hide
            // the opener the trailing closer belongs to.
            let depth = 0;
            for (const c of value.slice(0, -1)) {
              if (c === pair) depth++;
              else if (c === ch) depth = Math.max(0, depth - 1);
            }
            if (depth >= 1) break;
            value = value.slice(0, -1);
          }
        } while (value && value !== prevValue);
        }
        if (value) {
          const email = value.includes('@') && !/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(value) && !/^www\./i.test(value);
          const rawHref = email ? 'mailto:' + value : /^www\./i.test(value) ? 'http://' + value : value;
          // marked percent-encodes autolink hrefs with encodeURI (']' ->
          // %5D, '}' -> %7D, '"' -> %22, ...); fall back to the old
          // replaces if the value is not a valid URI.
          let href;
          try { href = encodeURI(rawHref).replace(/%25/g, '%'); } catch { href = rawHref.replace(/\\/g, '%5C').replace(/\]/g, '%5D'); }
          flush(); out += `<a href="${escapeHtml(href)}">${escapeHtml(value)}</a>`;
          i += value.length; continue;
        }
        if (/^mailto:/i.test(candidate[0])) { flush(); out += escapeHtml(candidate[0]); i += candidate[0].length; continue; }
      }
      }
    }
    // Code spans take precedence over bracket syntax and escape handling.
    if (c === '`') {
      let n = 1; while (source[i + n] === '`') n++;
      const end = matchingTickEnd(source, i + n, n);
      if (end >= 0) { let text = source.slice(i + n, end).replace(/\n/g, ' '); if (/^ .* $/.test(text) && /[^ ]/.test(text)) text = text.slice(1, -1); flush(); out += '<code>' + escapeHtml(text) + '</code>'; i = end + n; continue; }
      lit += '`'.repeat(n); i += n; continue;
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
          if (codeEnd >= 0) { let d = depth, bad = false; if (ticks >= 2) { for (let q = close + 1; q < codeEnd; q++) { if (source[q] === '\\') { q++; continue; } if (source[q] === '[') d++; else if (source[q] === ']') { if (d === 0) { const after = source[q + 1]; if (after === '(' || after === '[') { bad = true; break; } } else d--; } } }
            // A ticks>=2 code span whose content holds a backtick blocks the
            // link unless the span is immediately followed by the label's
            // closing ] (marked: the label then fails to form). Only for a
            // genuine in-label span (not bad: a span spanning a ](/ [ is
            // not in-label, so it does not block).
            if (!bad && ticks >= 2) { let hasTick = false; for (let q = close + ticks; q < codeEnd; q++) if (source[q] === '`') { hasTick = true; break; } if (hasTick && !(depth === 0 && source[codeEnd + ticks] === ']')) { close = source.length; break; } }
            if (!bad) { close = codeEnd + ticks - 1; continue; } }
          else if (ticks === 1) { close = source.length; break; }
        }
        if (source[close] === '[') depth++;
        else if (source[close] === ']') { if (!depth) break; depth--; }
      }
      if (close < source.length) {
        const label = source.slice(start, close); let dest = null, title = '' , end = close + 1;
        // Markdown forbids an anchor from containing another anchor. If a
        // completed link occurs in this label, leave this opening bracket as
        // text so the inner construct can be rendered on its own.
        let nestedLink = !image && /(?<!!)\[[^\]]*\]\([^\n)]*\)/.test(label);
        if (!nestedLink && !image) {
          // A shortcut reference link inside the label also blocks the
          // outer link, but only when the bracketed text actually resolves
          // to a defined reference (an undefined [text] is plain text).
          // The same applies to full/collapsed refs [text][ref] / [text][]:
          // they block only when the referenced key is defined.
          // Code spans in the label do not count as links.
          for (let bi = 0; bi < label.length && !nestedLink; bi++) {
            const bch = label[bi];
            if (bch === '`') { let n = 1; while (label[bi + n] === '`') n++; const ce = matchingTickEnd(label, bi + n, n); bi = ce >= 0 ? ce + n - 1 : bi + n - 1; continue; }
            if (bch !== '[') continue;
            if (bi && label[bi - 1] === '!') { let cb2 = bi + 1; while (cb2 < label.length && label[cb2] !== ']') { if (label[cb2] === '\\') cb2++; cb2++; } if (cb2 < label.length) { const afterImg = label[cb2 + 1]; if (afterImg === '[') { let cb3 = cb2 + 2; while (cb3 < label.length && label[cb3] !== ']') { if (label[cb3] === '\\') cb3++; cb3++; } bi = cb3; } else if (afterImg === '(') { let par = 1, cb3 = cb2 + 2; while (cb3 < label.length && par) { if (label[cb3] === '\\') { cb3 += 2; continue; } if (label[cb3] === '(') par++; if (label[cb3] === ')') par--; cb3++; } bi = cb3 - 1; } else bi = cb2; } continue; }
            let cb = bi + 1;
            while (cb < label.length && label[cb] !== ']') { if (label[cb] === '\\') cb++; cb++; }
            if (cb >= label.length) continue;
            const after = label[cb + 1];
            if (after === '(') continue;
            if (after === '[') { let cb2 = cb + 2; while (cb2 < label.length && label[cb2] !== ']') { if (label[cb2] === '\\') cb2++; cb2++; } if (cb2 < label.length) { const refText = label.slice(cb + 2, cb2); const key = (refText || label.slice(bi + 1, cb)).replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss'); if (key && linkDefinitions[key]) nestedLink = true; bi = cb2; } continue; }
            const key = label.slice(bi + 1, cb).replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
            if (key && linkDefinitions[key]) nestedLink = true;
          }
        }
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
        if (dest !== null && !nestedLink) { const savedInLink = linkDefinitions[IN_LINK]; const altSource = label.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); const alt = inline(altSource, linkDefinitions, true).replace(/<[^>]*>/g, ''); const labelHtml = image ? '' : inline(label, linkDefinitions, true); linkDefinitions[IN_LINK] = savedInLink; const href = dest.replace(/ /g, '%20').replace(/"/g, '%22'); title = title.replace(/\\([\p{P}\p{S}])/gu, '$1'); flush(); out += image ? `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(alt)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>` : `<a href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${labelHtml}</a>`; i = end; continue; }
      if (dest === null && source[end] === '(') { const ref = label.replace(/\\([\\()[\]])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss'); const fallback = linkDefinitions[ref]; if (fallback) { dest = fallback.href; title = fallback.title || ''; end = close + 1; } }
      if (dest !== null && !nestedLink) { const href = dest.replace(/ /g, '%20').replace(/"/g, '%22'); const savedInLink = linkDefinitions[IN_LINK]; const labelHtml = inline(label, linkDefinitions, true); linkDefinitions[IN_LINK] = savedInLink; flush(); out += `<a href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}>${labelHtml}</a>`; i = end; continue; }
      }
    }
    if (c === '\\' && i + 1 < source.length) {
      if (source[i + 1] === '\n' && i + 2 < source.length) { flush(); out += '<br>'; i += 2; while (source[i] === ' ') i++; continue; }
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) { lit += source[i + 1]; i += 2; continue; }
    }
    if (c === '~') {
      let n = 1; while (source[i + n] === '~') n++;
      if (n > 2) { lit += '~'.repeat(n); i += n; continue; }
      // A tilde inside a <...> span is literal text, matching the
      // emphasis pre-pass which skips those spans for * and _.
      if (tagSpans.some(([s, e]) => i >= s && i < e)) { lit += '~'.repeat(n); i += n; continue; }
      const mark = '~'.repeat(n); let end = -1, depth = 1, cursor = i + n;
      while (cursor < source.length) {
        cursor = source.indexOf('~', cursor); if (cursor < 0) break;
        // Skip a tilde escaped by an odd run of backslashes (literal, not a delimiter).
        let bs = 0; for (let b = cursor - 1; b >= 0 && source[b] === '\\'; b--) bs++;
        if (bs % 2 === 1) { cursor += 1; continue; }
        let run = 1; while (source[cursor + run] === '~') run++;
        if (tagSpans.some(([s, e]) => cursor >= s && cursor < e)) { cursor += run; continue; }
        if (run === n) {
          const before = source[cursor - 1] || '', after = source[cursor + n] || '';
          const canClose = !!before && !/\s/.test(before), canOpen = !!after && !/\s/.test(after);
          if (canClose && depth > 0) { depth--; if (!depth) { end = cursor; break; } }
          if (canOpen) depth++;
        }
        cursor += run;
      }
      if (end >= 0) {
        flush(); out += `<del>${inline(source.slice(i + n, end), linkDefinitions, disableAutolinks)}</del>`;
        i = end + n; continue;
      }
      // No closer: the whole run is literal text (a failed ~~ opener is
      // not retried as a single ~).
      lit += '~'.repeat(n); i += n; continue;
    }

    if (c === '<') { if (source.startsWith('<![CDATA[', i)) { const end = source.indexOf(']]>', i + 9); if (end >= 0) { flush(); out += source.slice(i, end + 3); i = end + 3; continue; } } const e = tagEnd(source, i + 1); if (e >= 0) { const raw = source.slice(i, e + 1), inner = raw.slice(1, -1); const splitAt = inner.search(/\s/), head = splitAt < 0 ? inner : inner.slice(0, splitAt); if (splitAt >= 0 && /^(?:https?:\/\/|ftp:\/\/)[^<>]+$/i.test(head)) { flush(); out += `&lt;<a href="${escapeHtml(angleDestination(head))}">${escapeHtml(head)}</a>${escapeHtml(inner.slice(splitAt))}&gt;`; i = e + 1; continue; } if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^ <>]+$/.test(inner)) { flush(); out += `<a href="${escapeHtml(angleDestination(inner).replace(/`/g, '%60'))}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (/^(?:https?:\/\/|ftp:\/\/)[^ <>]+$/i.test(inner)) { flush(); out += `<a href="${escapeHtml(angleDestination(inner))}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (!inner.includes('\\') && /^[^ <>@]+@[^ <>]+\.[A-Za-z]{2,}$/.test(inner)) { flush(); out += `<a href="mailto:${escapeHtml(inner)}">${escapeHtml(inner)}</a>`; i = e + 1; continue; } if (validInlineTag(raw) || /^<!--/.test(raw) || /^<\?[\s\S]*\?>$/.test(raw) || /^<![A-Za-z][\s\S]*>$/.test(raw) || /^<!\[CDATA\[[\s\S]*\]\]>$/.test(raw)) { if (/^<a /i.test(raw)) linkDefinitions[IN_LINK] = true; else if (/^<\/a>/i.test(raw)) linkDefinitions[IN_LINK] = false; flush(); out += raw; i = e + 1; continue; } } }
    if (c === '&') { const m = source.slice(i).match(/^&(?:#(?:[0-9]{1,7}|[xX][0-9a-fA-F]{1,6})|[A-Za-z][A-Za-z0-9]*);/); if (m) { const dec = m[0].match(/^&#(\d+);$/), hex = m[0].match(/^&#[xX]([\da-fA-F]+);$/); if (dec || hex) { const cp = Number.parseInt((dec || hex)[1], dec ? 10 : 16); flush(); out += escapeHtml(!cp || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? '\uFFFD' : String.fromCodePoint(cp)); } else { flush(); out += m[0]; } i += m[0].length; continue; } }
    if (c === '\n') {
      flush();
      let spaces = 0; for (let p = out.length - 1; p >= 0 && out[p] === ' '; p--) spaces++;
      if (spaces >= 2 && i + 1 < source.length) { out = out.slice(0, -spaces); out += '<br>'; while (source[i + 1] === ' ') i++; }
      else out += '\n';
      i++; continue;
    }
    // Bulk literal run: the text up to the next markup character is plain
    // as long as no autolink can start inside it (no @, no www., and no
    // scheme word followed by ':'). Appending the run as one slice beats
    // one escapeHtml-batched append per character. A run that could hold
    // an autolink falls back to the per-character loop, which attempts
    // the regex at each position exactly as before.
    plainRunRe.lastIndex = i;
    const pm = plainRunRe.exec(source);
    const runEnd = pm ? pm.index : source.length;
    if (runEnd > i + 1) {
      const run = source.slice(i, runEnd);
      // No autolink can start in the run: no @, no www., and no scheme
      // word followed by ':'. indexOf gates the checks so they only run
      // when their trigger character is present; the www. and scheme
      // tests are manual scans (the combined regex was a hotspot: its
      // {1,31} scheme scan ran at every position). A scheme word is a
      // letter + 1-31 scheme chars immediately before a ':', so walking
      // back at most 32 chars from each ':' is exactly equivalent.
      let marker = run.indexOf('@') >= 0;
      if (!marker && (run.indexOf('w') >= 0 || run.indexOf('W') >= 0)) marker = /www\./i.test(run);
      if (!marker) {
        let ci = run.indexOf(':');
        while (ci >= 0 && !marker) {
          let k = ci - 1, n = 0;
          while (k >= 0 && n < 32) { const cc = run.charCodeAt(k); if (!((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 43 || cc === 46 || cc === 45)) break; n++; k--; }
          const lo = Math.max(k + 1, ci - 32);
          for (let p = lo; p <= ci - 2; p++) { const cc = run.charCodeAt(p); if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) { marker = true; break; } }
          ci = run.indexOf(':', ci + 1);
        }
      }
      if (!marker) { lit += run; i = runEnd; continue; }
    }
    lit += c; i++;
  }
  flush();
  if (hasEvents && events.has(source.length)) out += events.get(source.length).join('');
  return out;
}

// Paragraph-interrupt test, hoisted: the same pattern was built with
// `new RegExp` once per paragraph. Two module-level variants cover the
// nested (any ordered marker) and top-level (only `1.`) cases.
const paragraphInterruptNested = /^ {0,3}(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d{1,9}[.)])[ \t])/;
const paragraphInterruptPlain = /^ {0,3}(?:#{1,6}(?:\s|$)|>|(?:[-+*]|1[.)])[ \t])/;

// A line opens a fenced code block only when it is a genuine fence: for
// backtick fences the info string must not contain a backtick, so a line
// like ```inner backticks``` is paragraph text, not a fence start.
const isFenceStart = line => {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return false;
  return !(m[1][0] === '`' && m[2].includes('`'));
};

// --- Cursor-based line classifiers (Builder #4, M3) ---------------------
// The list tokenizer and the block loop tested every line with several
// regexes; these manual scans answer the same questions without regex
// setup cost. Each one is an exact transliteration of the regex it
// replaces — verified against the regex on a fuzz battery of generated
// lines (see the Builder #4 notes in README) plus the 720-case comparator.

// List marker at the start of a line: up to 3 leading spaces, then a
// bullet (-, +, *) or an ordered marker (1-9 digits + '.' or ')').
// `withContent` selects the two regex shapes the old code used: true is
// the item-start form `(?:[ \t]+(.*)|[ \t]*)$` (content is the text after
// the separator, undefined when the line ends at the marker); false is
// the continuation-check form `(?:[ \t]+|$)`. Returns null when the line
// holds no marker, else { marker, ordered, indent, content, pad } where
// pad is the separator's tab-aware column width (0 when the line ends at
// the marker — callers keep the old `if (!pad) pad = 1` rule).
const listMarkerAt = (line, withContent) => {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  const c = line[i];
  let markerLen = 0, ordered = false;
  if (c === '-' || c === '+' || c === '*') { markerLen = 1; }
  else if (c >= '0' && c <= '9') {
    let j = i;
    while (j < line.length && j - i < 9 && line[j] >= '0' && line[j] <= '9') j++;
    const d = line[j];
    if (d !== '.' && d !== ')') return null;
    markerLen = j - i + 1; ordered = true;
  } else return null;
  const marker = line.slice(i, i + markerLen);
  const sepStart = i + markerLen;
  let k = sepStart, pad = 0, col = sepStart;
  while (line[k] === ' ' || line[k] === '\t') {
    const n = line[k] === '\t' ? 4 - col % 4 : 1;
    pad += n; col += n; k++;
  }
  if (withContent) {
    if (k === sepStart && k < line.length) return null;
    return { marker, ordered, indent: i, content: k > sepStart ? line.slice(k) : undefined, pad };
  }
  if (k === sepStart && k < line.length) return null;
  return { marker, ordered, indent: i, content: undefined, pad };
};

// Exact manual form of
// /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const isHrLine = line => {
  let i = 0;
  while (i < 3 && line[i] === ' ') i++;
  const c = line[i];
  if (c !== '*' && c !== '-' && c !== '_') return false;
  let n = 0;
  while (i < line.length) {
    if (line[i] === c) { n++; i++; }
    else if (line[i] === ' ' || line[i] === '\t') i++;
    else return false;
  }
  return n >= 3;
};

// Exact manual form of /^ {0,N}(`{3,}|~{3,})(.*)$/ plus the
// backtick-info rule (a backtick fence whose info string holds a backtick
// is not a fence). Returns { char, len, info, indent } or null.
const fenceOpenAt = (line, maxIndent = 3) => {
  let i = 0;
  while (i < maxIndent && line[i] === ' ') i++;
  const c = line[i];
  if (c !== '`' && c !== '~') return null;
  let j = i;
  while (line[j] === c) j++;
  if (j - i < 3) return null;
  const info = line.slice(j);
  if (c === '`' && info.includes('`')) return null;
  return { char: c, len: j - i, info, indent: i };
};

// Exact manual form of a fence-close regex
// `^ {0,N}<char>{len,}[ \t]*$` (N = 3 for the plain close, indent + 3
// for the item-fence close that must sit at the item's content column).
const fenceCloseAt = (line, char, len, maxIndent) => {
  let i = 0;
  while (i < maxIndent && line[i] === ' ') i++;
  let j = i;
  while (line[j] === char) j++;
  if (j - i < len) return false;
  while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
  return j === line.length;
};

// Column width of the run of spaces/tabs starting at `from`, expanding
// tabs to the next multiple of 4 from column `col`. Replaces the two
// inline pad-measurement loops in the list tokenizer.
const padWidth = (line, from, col) => {
  let w = 0, c = col;
  for (let k = from; k < line.length && (line[k] === ' ' || line[k] === '\t'); k++) {
    const n = line[k] === '\t' ? 4 - c % 4 : 1;
    w += n; c += n;
  }
  return w;
};

// Any number of leading spaces, then a run of 3+ backticks or tildes
// (no info-string check, no end anchor) — the exact manual form of
// /^ *(?:`{3,}|~{3,})/ used for the blank-branch fence test. Returns the
// fence character or null.
const fenceRunAt = line => {
  let i = 0;
  while (line[i] === ' ') i++;
  const c = line[i];
  if (c !== '`' && c !== '~') return null;
  let j = i;
  while (line[j] === c) j++;
  return j - i >= 3 ? c : null;
};

// One or more leading spaces, then a list marker followed by a space or
// tab — the exact manual form of /^ +(?:[-+*]|\d{1,9}[.)])[ \t]/ used
// for the blank-branch nested-marker test.
const nestedMarkerAt = line => {
  let i = 0;
  while (line[i] === ' ') i++;
  if (i === 0) return false;
  const c = line[i];
  let m = 0;
  if (c === '-' || c === '+' || c === '*') m = 1;
  else if (c >= '0' && c <= '9') {
    let j = i;
    while (j < line.length && j - i < 9 && line[j] >= '0' && line[j] <= '9') j++;
    const d = line[j];
    if (d !== '.' && d !== ')') return false;
    m = j - i + 1;
  } else return false;
  const after = line[i + m];
  return after === ' ' || after === '\t';
};

function renderBlockTree(markdown, linkDefinitions = Object.create(null), nestedContext = false, collectDefinitions = false, defsOnly = false, stripTopPara = false, lastKind = null) {
  // Fast native scans replace a regex pass when the source has no CR or
  // tab at all (the common case): the \r replace and the leading-tab
  // expansion map are both identity then, so skip them outright.
  const src = markdown.includes('\r') ? markdown.replace(/\r\n?/g, '\n') : markdown;
  const rawLines = src.split('\n');
  const blockLines = src.includes('\t') ? rawLines.map(line => { let col = 0, n = 0; while (n < line.length && (line[n] === ' ' || line[n] === '\t')) { if (line[n] === '\t') { const step = 4 - col % 4; line = line.slice(0, n) + ' '.repeat(step) + line.slice(n + 1); col += step; n += step; } else { col++; n++; } } return line; }) : rawLines;
  const out = [];
  // Records the kind of the last top-level block pushed, so a caller (the
  // list renderer) can tell a structural block (which marked renders with
  // a trailing newline) from a paragraph or raw HTML block (which it
  // renders without one) — the rendered strings alone are ambiguous,
  // e.g. a raw <h1> line vs a real # heading.
  const push = (s, kind) => { if (lastKind) lastKind.kind = kind; out.push(s); };
  // Definitions-only pass: collect link definitions without rendering any
  // inline content or building output strings. The render pass is
  // untouched; a nested quote/list item is only re-parsed when its text
  // holds a `[label]:` line, the necessary condition for any definition.
  const IL = defsOnly ? () => '' : inline;
  const hasDefLine = text => text.includes(']:') && /\[[^\n]*\]:/.test(text);
  let i = 0;
  const blank = s => { for (let k = 0; k < s.length; k++) if (s[k] !== ' ') return false; return true; };
  const leadSpaces = s => { let n = 0; while (s[n] === ' ') n++; return n; };
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
    if (validInlineTag(s)) return { type: 7 };
    return null;
  };
  // Every HTML block type starts with `<` after at most 3 spaces; a line
  // that does not can never be an HTML block, so skip the regex battery.
  const htmlBlockOf = line => /^ {0,3}</.test(line) ? identifyHtmlBlock(line) : null;
  // Hoisted out of the per-line loop: these only depend on nestedContext
  // (fixed per call) and were re-allocated as closures for every line.
  const quoteLine = line => line.match(nestedContext ? /^ {0,6}>(?: ?)(.*)$/ : /^ {0,3}>(?: ?)(.*)$/);
  // Expand only leading tabs in quote content, from the content's real
  // starting column in the original line; tabs after the first
  // non-whitespace character stay literal. A `>` directly followed by a
  // tab donates that tab's first expanded space as the separator.
  const expandQuoteTabs = (line, content) => { if (!content.includes('\t')) return content; const startCol=line.length-content.length; const beforeChar=line[startCol-1]; let col=startCol,expanded='',seenNonWs=false; for(const ch of content){if(ch==='\t'&&!seenNonWs){const n=4-col%4;expanded+=' '.repeat(n);col+=n;}else{if(ch==='\t')expanded+='\t';else expanded+=ch;col++;if(ch!==' '&&ch!=='\t')seenNonWs=true;}} if (beforeChar==='>' && expanded.startsWith(' ')) expanded=expanded.slice(1); return expanded; };
  // An unmarked line continues a paragraph lazily when that paragraph
  // began inside the quote and the line does not start a new block.
  const interrupt = line => /^(?: {4,}|\t)|^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|1[.)])[ \t]|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(line) || isFenceStart(line);
  while (i < blockLines.length) {
    if (blank(blockLines[i])) { i++; continue; }
    let m;
    // GFM tables: a pipe header followed by a delimiter row.
    if (i + 1 < blockLines.length && blockLines[i].includes('|') && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(blockLines[i + 1]) && blockLines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length === blockLines[i + 1].trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).length) {
      const split = row => { row = row.trim().replace(/^\|/, '').replace(/\|$/, ''); return row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
      const heads = split(blockLines[i]), aligns = split(blockLines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const row = (cells, tag) => `<tr>\n${heads.map((_, n) => { const a = aligns[n]; return `<${tag}${a ? ` align="${a}"` : ''}>${IL(cells[n] || '', linkDefinitions)}</${tag}>\n`; }).join('')}</tr>\n`;
      let html = '<table>\n<thead>\n' + row(heads, 'th') + '</thead>\n'; i += 2;
      if (i < blockLines.length && (!blank(blockLines[i]) || rawLines[i]?.includes('\t'))) { html += '<tbody>'; while (i < blockLines.length && (!blank(blockLines[i]) || rawLines[i]?.includes('\t')) && !/^ {0,3}(?:>|#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(blockLines[i]) && !isFenceStart(blockLines[i]) && !(htmlBlockOf(blockLines[i])?.type <= 6)) html += row(split(blockLines[i++]), 'td'); html += '</tbody>'; }
      push(html + '</table>\n', 'table'); continue;
    }
    // Block HTML is passed through verbatim by marked; its contents are not parsed.
    const htmlKind = htmlBlockOf(blockLines[i]);
    if (htmlKind) {
      const start = i;
      const kind = htmlKind;
      let stopReason = 'eof';
      if (kind.type <= 5) {
        const terminator = kind.type === 1 ? new RegExp(`<\\/${kind.tag}\\s*>`, 'i') : kind.type === 2 ? /-->/ : kind.type === 3 ? /\?>/ : kind.type === 4 ? />/ : /\]\]>/;
        while (i < blockLines.length) {
          const line = blockLines[i++];
          if (terminator.test(line)) break;
        }
        if (i < blockLines.length && (blockLines[i] === '' && !(i === blockLines.length - 1 && src.endsWith('\n')))) stopReason = 'blank';
        else if (i < blockLines.length) stopReason = 'content';
      } else {
        while (i < blockLines.length && !realBlank(i)) i++;
        stopReason = i < blockLines.length ? 'blank' : 'eof';
      }
      const pieces = rawLines.slice(start, i);
      let raw = pieces.join('\n');
      if (pieces.length && pieces[pieces.length - 1] !== '' && (i < blockLines.length || src.endsWith('\n'))) raw += '\n';
      // The source's final separator belongs to the block only when it was
      // followed immediately by content or the source ended there.
      if (stopReason === 'blank' && raw.endsWith('\n')) raw = raw.slice(0, -1);
      if (!defsOnly) push(raw, 'html'); continue;
    }
    // Indented code blocks are recognized before other block constructs.
    const nestedFenceCandidate = nestedContext && /^ {4,20}(?:`{3,}|~{3,})/.test(blockLines[i]);
    if (/^(?: {4,}|\t)/.test(blockLines[i]) && !nestedFenceCandidate) {
      const code = [];
      while (i < blockLines.length) {
        if (/^(?: {4,}|\t)/.test(blockLines[i])) {
          const lead = leadSpaces(blockLines[i]);
          const original = rawLines[i];
          code.push(original.startsWith('\t') ? original.slice(1) : original.startsWith('    ') ? original.slice(4) : blockLines[i].slice(4)); i++;
        } else if (blank(blockLines[i])) {
          let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
          if (k < blockLines.length && /^(?: {4,}|\t)/.test(blockLines[k])) { while (i < k) { code.push(''); i++; } }
          else break;
        } else break;
      }
      while (code.length && code[code.length - 1] === '') code.pop();
      if (!defsOnly) push(`<pre><code>${escapeHtml(code.join('\n'))}${code.length ? '\n' : ''}</code></pre>\n`, 'fence'); continue;
    }
    if ((m = blockLines[i].match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)\s*$/))) { const d = m[1].length; let body = m[2].trim(); if (/^ {0,3}#{1,6}[ \t]+#+[ \t]*$/.test(blockLines[i])) body = ''; else body = body.replace(/[ \t]+#+[ \t]*$/, ''); push(`<h${d}>${IL(body, linkDefinitions)}</h${d}>\n`, 'heading'); i++; continue; }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[i])) { push('<hr>\n', 'hr'); i++; continue; }
    if ((m = blockLines[i].match(nestedContext ? /^( {0,20})(`{3,}|~{3,})/ : /^( {0,3})(`{3,}|~{3,})/)) && !(m[2][0] === '`' && blockLines[i].slice(m[0].length).includes('`'))) {
      const indent = m[1].length, fence = m[2], lang = blockLines[i].slice(m[0].length).trim().split(/[ \t]/)[0]; let j = i + 1;
      const closeFence = new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
      while (j < blockLines.length && !closeFence.test(blockLines[j])) j++;
      const dedentFenceLine = (line) => { let k = 0; while (k < indent && k < line.length && (line[k] === ' ' || line[k] === '\t')) k++; return line.slice(k); };
      const body = rawLines.slice(i + 1, j).map(line => fence[0] === '~' ? line : dedentFenceLine(line)).join('\n');
      const language = lang.replace(/\\([\p{P}\p{S}])/gu, '$1');
      if (!defsOnly) push(`<pre><code${language ? ` class="language-${escapeAttribute(language)}"` : ''}>${escapeHtml(body)}${body !== '' && !body.endsWith('\n') ? '\n' : ''}</code></pre>\n`, 'fence'); i = Math.min(j + 1, blockLines.length); continue;
    }
    if ((m = quoteLine(blockLines[i]))) {
      const q = []; let quoteFenceChar = '', quoteFenceLen = 0; while (i < blockLines.length && (m = quoteLine(blockLines[i]))) {
        let content=m[1];
        content=expandQuoteTabs(blockLines[i], content);
        if (content === ' ' && q.some(line=>line.trim())) content='\u0001';
        const fm = content.match(/^ {0,3}(`{3,}|~{3,})/);
        if (fm && !(fm[1][0] === '`' && content.slice(fm[0].length).includes('`'))) {
          // A fence line only toggles the quote's fence state when it can
          // actually open or close one: a backtick fence line inside a
          // tilde fence (or vice versa), a shorter run, or a run with an
          // info string is fence CONTENT, not a boundary. A bare toggle
          // lets a ```json line close a ~~~~ fence, after which a lazy
          // line wrongly joins the quote instead of ending it.
          if (!quoteFenceChar) { quoteFenceChar = fm[1][0]; quoteFenceLen = fm[1].length; }
          else if (fm[1][0] === quoteFenceChar && fm[1].length >= quoteFenceLen && /^[ \t]*$/.test(content.slice(fm[0].length))) { quoteFenceChar = ''; quoteFenceLen = 0; }
        }
        q.push(content); i++;
      }
      // A lazy setext = line gets four spaces when the line before it was
      // itself lazy (marked disarms it that way); after a > line it is
      // plain paragraph text as-is. A line already carrying a backslash
      // shield from an outer quote still counts as a setext line here.
      let prevLazy = false;
      let lastLazySetext = false;
      while(i<blockLines.length && !quoteFenceChar && !blank(blockLines[i]) && q.length && (quoteLine(blockLines[i]) || (q.at(-1).trim() && (!interrupt(q.at(-1)) || lastLazySetext || /^ {0,3}\d{1,9}[.)][ \t]+>/.test(q.at(-1))) && !/^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(q.at(-1))))) {
        const nextQuote=quoteLine(blockLines[i]);
        if(nextQuote){q.push(expandQuoteTabs(blockLines[i], nextQuote[1]));i++;prevLazy=false;lastLazySetext=false;continue;}
        const rawLazy = blockLines[i];
        // A lazy line that starts a block at 0-3 indent ends the quote.
        // An indented lazy line (4+ spaces) is paragraph text with
        // exactly four spaces removed; fewer spaces are kept as-is.
        if (interrupt(rawLazy) && !/^ {4,}/.test(rawLazy)) break;
        // A lazy line starting an HTML block (types 1-6) is a new block,
        // not paragraph continuation text: marked's lazy-line paragraph
        // pattern excludes html starts, so the quote ends here. Type 7
        // (inline tags) still continues the paragraph.
        if (!/^ {4,}/.test(rawLazy) && (identifyHtmlBlock(rawLazy)?.type ?? 7) <= 6) break;
        i++;
        let lazy = /^ {4,}/.test(rawLazy) ? rawLazy.slice(4) : rawLazy;
        // The stripped line is paragraph text, never a block start:
        // shield its first character so the inner re-parse cannot turn
        // it into a heading, list, fence, quote, setext underline or
        // HTML block. A backslash escape renders the literal character,
        // except for `<`, which must stay raw inline HTML: it gets a
        // sentinel that is stripped from the rendered quote.
        const first = lazy.search(/[^ ]/);
        const rest = first < 0 ? '' : lazy.slice(first);
        const unescapedRest = rest.startsWith('\\') ? rest.slice(1) : rest;
        const isSetextEq = /^=+[ \t]*$/.test(unescapedRest);
        const blocky = first >= 0 && (/^(?:#{1,6}(?:[ \t]|$)|>(?: ?)|`{3,}|~{3,}|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$|=+[ \t]*$|-+[ \t]*$|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(rest) || (identifyHtmlBlock(rest)?.type ?? 7) <= 6);
        if (isSetextEq && prevLazy) lazy = '    ' + unescapedRest;
        else if (blocky) {
          if (rest.startsWith('<')) lazy = lazy.slice(0, first) + '\u0003' + rest;
          else lazy = lazy.slice(0, first) + '\\' + rest;
        }
        q.push(lazy);
        lastLazySetext = isSetextEq && prevLazy;
        prevLazy = true;
      }
      if (defsOnly) {
        const qText = q.join('\n');
        if (hasDefLine(qText)) renderBlockTree(qText, linkDefinitions, true, collectDefinitions, defsOnly);
      } else {
        push(`<blockquote>\n${renderBlockTree(q.join('\n'), linkDefinitions, true, collectDefinitions).replace(/\u0001/g,' ').replace(/\u0003/g,'')}</blockquote>\n`, 'blockquote');
      }
      continue;
    }
    const listStart = listMarkerAt(blockLines[i], true);
    if (listStart && !isHrLine(blockLines[i])) {
      const ordered = listStart.ordered, tag = ordered ? 'ol' : 'ul';
      const marker = listStart.marker, markerIndent = listStart.indent;
      let markerPadding = listStart.pad;
      if(!markerPadding) markerPadding=1;
      const markerWidth = marker.length + (markerPadding > 4 ? 1 : markerPadding);
      const contentIndent = markerIndent + markerWidth;
      const startNumber = ordered ? Number.parseInt(marker, 10) : 1;
      const listItems = []; let hasLooseItems = false;
      // Item continuations are gathered as source lines and normalized against
      // the marker's content column at the point they enter the child parser.
      const itemContent = (sourceLine, column) => {
        let spaces = 0;
        while (spaces < sourceLine.length && spaces < column && sourceLine[spaces] === ' ') spaces++;
        return sourceLine.slice(spaces);
      };
      while (i < blockLines.length) {
        if (isHrLine(blockLines[i])) break;
        const itemMatch = listMarkerAt(blockLines[i], true);
        if (!itemMatch || (ordered ? itemMatch.marker.slice(-1) !== marker.slice(-1) : itemMatch.marker !== marker)) break;
        const itemIndent = itemMatch.indent;
        let padding = itemMatch.pad;
        if(!padding)padding=1;
        const width = itemMatch.marker.length + (padding > 4 ? 1 : padding);
        const indent = itemIndent + width;
        const emptyMarker = !(itemMatch.content || '').trim();
        const body = [padding > 4 ? ' '.repeat(padding - 1) + (itemMatch.content || '') : (itemMatch.content || '')]; i++;
        let itemFence = null;
        // A lazy setext underline (= or -) in this item is paragraph text,
        // not a heading, unless the content column is at least 3 wide and
        // every lazy continuation line so far sat at column 0. Track that
        // so the shield below matches marked.
        let allLazyLead0 = true;
        // Set when a disarmed setext line is followed by an inserted blank
        // line: the next lazy line still belongs to this item (as a new
        // paragraph) even though the body now ends with a blank line.
        let afterShieldedSetext = false;
        const trackFence = line => {
          if (itemFence) {
            if (fenceCloseAt(line, itemFence.char, itemFence.len, 3)) itemFence = null;
          } else {
            const open = fenceOpenAt(line);
            if (open) { itemFence = { char: open.char, run: open.char.repeat(open.len), len: open.len, indent: leadSpaces(line), info: open.info.trim().split(/[ \t]/)[0], hasBody: false }; }
          }
        };
        trackFence(body[0]);
        while (i < blockLines.length) {
          const next = listMarkerAt(blockLines[i], false);
          if (next && next.ordered === ordered && (!ordered ? next.marker === marker : next.marker.slice(-1) === marker.slice(-1)) && next.indent <= itemIndent && !isHrLine(blockLines[i])) break;
          if (itemFence) {
            const lead = leadSpaces(blockLines[i]);
            const validClose = fenceCloseAt(blockLines[i], itemFence.char, itemFence.len, indent + 3);
            if (validClose && lead >= indent) { body.push(itemContent(blockLines[i], indent)); itemFence = null; i++; continue; }
            if (validClose) {
              body.push(itemFence.run);
              itemFence = null;
              break;
            }
            if (blank(blockLines[i])) { body.push(''); i++; continue; }
            if (!itemFence.hasBody && lead < indent) {
              body.push(itemFence.run);
              itemFence = null;
              break;
            }
            if (!validClose && !itemFence.hasBody && lead >= indent) itemFence.hasBody = true;
            body.push(blockLines[i].slice(Math.min(indent, lead)));
            i++; continue;
          }
          if (blank(blockLines[i])) {
            if (emptyMarker && body.length === 1 && !body[0].trim()) {
              let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
              const following = k < blockLines.length ? listMarkerAt(blockLines[k], false) : null;
              if (!following || (ordered ? following.marker.slice(-1) !== marker.slice(-1) : following.marker !== marker)) break;
            }
            let k = i; while (k < blockLines.length && blank(blockLines[k])) k++;
            if (k >= blockLines.length) { i = k; break; }
            const followingFence = fenceRunAt(blockLines[k]);
            // A fence starts a new block in this item only at its content
            // indentation. A shallower fence closes the list before parsing.
            if (followingFence && leadSpaces(blockLines[k]) < indent) break;
            // A blank line followed by a different list type (different
            // bullet or ordered-ness) at this list's level ends the list;
            // it is a new list, not a loose continuation of this one.
            const km = listMarkerAt(blockLines[k], false);
            if (km && km.indent <= itemIndent) { const sameList = ordered ? (km.ordered && km.marker.slice(-1) === marker.slice(-1)) : (!km.ordered && km.marker === marker); if (!sameList) break; }
            const km2 = listMarkerAt(blockLines[k], false);
            if (km2 && km2.indent <= itemIndent + 3) { body.push(''); allLazyLead0 = true; i++; const kLead = leadSpaces(blockLines[k]); const nestedAlready = body.slice(1).some(line => { const lm = listMarkerAt(line, false); return !!lm && lm.pad > 0; }); const diffType = ordered ? (!km2.ordered || km2.marker.slice(-1) !== marker.slice(-1)) : (km2.ordered || km2.marker !== marker); if (!(kLead >= indent && nestedAlready) && !(diffType && kLead < indent)) hasLooseItems = true; continue; }
            if (blockLines[k].match(/^ {0,3}>/) && leadSpaces(blockLines[k]) >= indent) { body.push(''); allLazyLead0 = true; i++; hasLooseItems = true; continue; }
            if (leadSpaces(blockLines[k]) >= indent) { const nextLead = leadSpaces(blockLines[k]); const nestedMarker = nextLead >= indent && nestedMarkerAt(blockLines[k]); const nestedAlready = body.slice(1).some(line => { const lm = listMarkerAt(line, false); return !!lm && lm.pad > 0; }); body.push(''); allLazyLead0 = true; i++; if (nestedMarker ? !nestedAlready && body[0]?.trim() : (!nestedAlready || nextLead <= indent)) hasLooseItems = true; continue; }
            break;
          }
          const lead = leadSpaces(blockLines[i]);
          if (emptyMarker && body.length === 1 && !body[0].trim() && lead > itemIndent && lead < indent) { body.push(blockLines[i].slice(lead)); trackFence(body[body.length - 1]); }
          else if (lead === 4 && itemIndent === 3 && /^ {4}(?:[-+*]|\d{1,9}[.)])[ \t]+/.test(blockLines[i])) body.push('\\' + blockLines[i].slice(lead));
          else if (lead >= indent) { const pushed = itemContent(blockLines[i], indent); body.push(pushed); if (/^ /.test(pushed)) allLazyLead0 = false; afterShieldedSetext = false; trackFence(body[body.length - 1]); }
          else if (lead > 0 && body.length && (body.at(-1).trim() || afterShieldedSetext) && lead < indent && !/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])[ \t]|>|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(blockLines[i]) && !isFenceStart(blockLines[i])) { const rawLine = blockLines[i]; const effective = lead >= 4 ? rawLine.slice(4) : rawLine; const first = effective.search(/[^ ]/); const rest = first < 0 ? '' : effective.slice(first); const shieldSetext = /^(?:=+|-+)[ \t]*$/.test(rest) && !(indent >= 3 && allLazyLead0); if (shieldSetext) { body.push('\\' + rest); body.push(''); afterShieldedSetext = true; } else { body.push(effective); afterShieldedSetext = false; } allLazyLead0 = false; }
          else if (lead === 0 && body.length && (body.at(-1).trim() || afterShieldedSetext) && !/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-+*]|\d{1,9}[.)])[ \t]|>|(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})/.test(blockLines[i]) && !isFenceStart(blockLines[i])) { const line = blockLines[i]; const shieldSetext = /^(?:=+|-+)[ \t]*$/.test(line) && !(indent >= 3 && allLazyLead0); if (shieldSetext) { body.push('\\' + line); body.push(''); afterShieldedSetext = true; } else { body.push(line); afterShieldedSetext = false; } }
          else break;
          i++;
        }
        listItems.push(body);
      }
      let htmlItems;
      if (defsOnly) {
        // Collect definitions from items only; skip rendering entirely.
        // The task-checkbox prefix is stripped first, exactly as in the
        // render path, so a definition on the item's first line is seen
        // the same way.
        for (const linesInItem of listItems) {
          const task = linesInItem[0]?.match(/^\[([ xX])\][ \t]+(.*)$/);
          if (task) linesInItem[0] = task[2];
          const text = linesInItem.join('\n');
          if (hasDefLine(text)) renderBlockTree(text, linkDefinitions, true, collectDefinitions, defsOnly);
        }
        htmlItems = '';
      } else {
      htmlItems = listItems.map(linesInItem => {
        const task = linesInItem[0]?.match(/^\[([ xX])\][ \t]+(.*)$/);
        if (task) linesInItem[0] = task[2];
        const lk = { kind: '' };
        const rendered = renderBlockTree(linesInItem.join('\n'), linkDefinitions, true, collectDefinitions, false, !hasLooseItems, lk).replace(/\n$/, '');
        const checkbox = task ? `<input ${task[1] === ' ' ? 'disabled=""' : 'checked="" disabled=""'} type="checkbox"> ` : '';
        // Tight list items render as marked does: the item's block tokens
        // concatenated directly — a paragraph token contributes its inline
        // text with no <p> wrapper and no trailing newline (stripTopPara
        // above), an HTML token its raw text, and a structural block
        // (fence/heading/blockquote/nested list/table/hr) its rendering
        // with a trailing newline. So the </li> newline exists exactly
        // when the last block is structural. A loose item differs only
        // in that a trailing paragraph also keeps its newline.
        const structural = /^(?:fence|heading|blockquote|list|table|hr)$/.test(lk.kind);
        if (!hasLooseItems) return structural ? `<li>${checkbox}${rendered}\n</li>\n` : `<li>${checkbox}${rendered}</li>\n`;
        const looseNl = structural || lk.kind === 'para';
        if (rendered.startsWith('<pre>')) return looseNl ? `<li>${checkbox}${rendered}\n</li>\n` : `<li>${checkbox}${rendered}</li>\n`;
        if (rendered.startsWith('<p>')) return looseNl ? `<li><p>${checkbox}${rendered.slice(3)}\n</li>\n` : `<li><p>${checkbox}${rendered.slice(3)}</li>\n`;
        if (/^<\/?[A-Za-z!]/.test(rendered) && !/\n<\/?(?:p|ul|ol|blockquote|pre|h[1-6]|table|hr)/.test(rendered)) return looseNl ? `<li>${checkbox}${rendered}\n</li>\n` : `<li>${checkbox}${rendered}</li>\n`;
        return `<li>${checkbox}${rendered ? '\n' + rendered + '\n' : ''}</li>\n`;
      }).join('');
      }
      if (!hasLooseItems) htmlItems = htmlItems.replace(/<li>\n(?=<(?:blockquote|ul|ol)>)/g, '<li>');
      push(`<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>\n${htmlItems}</${tag}>\n`, 'list'); continue;
    }
    const definitionStart = blockLines[i].match(/^ {0,3}\[((?:\\.|[^\]])+)\]:[ \t]*(.*)$/);
    if (definitionStart && definitionStart[1].trim() && !/(^|[^\\])\[/.test(definitionStart[1])) {
      const rawLabel = definitionStart[1]; let rest = definitionStart[2], consumedLines = 1;
      if (!rest.trim() && i + 1 < blockLines.length && /^\s*\S/.test(blockLines[i + 1])) { rest = blockLines[i + 1].trim(); consumedLines++; }
      const destination = rest.match(/^(?:<([^>\n]*)>|(?!<)(\S+))(?:[ \t]+(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\)))?[ \t]*$/);
      if (destination) {
        const attachedTitle = destination[3] !== undefined || destination[4] !== undefined || destination[5] !== undefined;
        const rawDestination = rest.match(/^(?:<[^>\n]*>|\S+)/)?.[0] || '';
        if (attachedTitle && rest[rawDestination.length] && !/[ \t\n]/.test(rest[rawDestination.length])) { i++; continue; }
        let title = destination[3] ?? destination[4] ?? destination[5] ?? '';
        if (!title && i + consumedLines < blockLines.length) {
          const titleLine = blockLines[i + consumedLines].match(/^\s*(?:"([^"\n]*)"|'([^'\n]*)'|\(([^)\n]*)\))[ \t]*$/);
          if (titleLine) { title = titleLine[1] ?? titleLine[2] ?? titleLine[3]; consumedLines++; }
        }
        const label = rawLabel.replace(/\\([\\()[\]])/g, '$1');
        const key = label.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
        if (!linkDefinitions[key]) linkDefinitions[key] = { href: cleanDestination(destination[1] ?? destination[2]), title: title.replace(/\\([\p{P}\p{S}])/gu, '$1') };
        i += consumedLines; continue;
      }
    }
    if (i + 1 < blockLines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(blockLines[i + 1])) { const d = blockLines[i + 1].trim()[0] === '=' ? 1 : 2; push(`<h${d}>${IL(blockLines[i].trim(), linkDefinitions)}</h${d}>\n`, 'heading'); i += 2; continue; }
    let j = i + 1;
    const paragraphInterrupt = nestedContext ? paragraphInterruptNested : paragraphInterruptPlain;
    while (j < blockLines.length && !blank(blockLines[j]) && !/^ {0,3}(?:=+|-+)[ \t]*$/.test(blockLines[j]) && !(htmlBlockOf(blockLines[j])?.type <= 6) && !paragraphInterrupt.test(blockLines[j]) && !isFenceStart(blockLines[j]) && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockLines[j])) j++;
    if (j < blockLines.length && /^ {0,3}(=+|-+)[ \t]*$/.test(blockLines[j])) { const d=blockLines[j].trim()[0]==='='?1:2; push(`<h${d}>${IL(blockLines.slice(i,j).join('\n').trim(),linkDefinitions)}</h${d}>\n`, 'heading'); i=j+1; continue; }
    let paragraph = blockLines.slice(i, j).join('\n');
    const definitionPattern = /^ {0,3}\[((?:\\.|[^\]])+)\]:[ \t]*(?:<([^>\n]*)>|(?!<)(\S+))(?:(?:[ \t]+|\n[ \t]*)(?:"((?:(?!\n[ \t]*\n)[\s\S])*?)"|'((?:(?!\n[ \t]*\n)[\s\S])*?)'|\((.*)\)))?[ \t]*(?:\n|$)/;
    while (paragraph) {
      const definition = definitionPattern.exec(paragraph);
      if (!definition || definition.index !== 0) break;
      const [, rawLabel, angled, plain, dq, sq, paren] = definition;
      if (!rawLabel.trim() || /(^|[^\\])\[/.test(rawLabel)) break;
      const label = rawLabel.replace(/\\([\\()[\]])/g, '$1');
      const key = label.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ß/g, 'ss');
      if (!linkDefinitions[key]) linkDefinitions[key] = { href: cleanDestination(angled ?? plain), title: (dq ?? sq ?? paren ?? '').replace(/\\([\p{P}\p{S}])/gu, '$1') };
      paragraph = paragraph.slice(definition[0].length).replace(/^\n/, '');
    }
    if (paragraph) push(stripTopPara ? IL(paragraph, linkDefinitions) : `<p>${IL(paragraph, linkDefinitions)}</p>\n`, 'para');
    i = j;
  }
  if (defsOnly) return '';
  const joined = out.join('');
  // The <li> newline fix only applies when a nested list/blockquote
  // directly follows a <li> newline; skip the regex scan otherwise.
  return joined.includes('<li>\n<') ? joined.replace(/<li>\n(?=<(?:ol|ul)(?:\s|>)|<blockquote>)/g, '<li>') : joined;
}

/** Render a Markdown string into HTML. */
export function parse(markdown) {
  const source = String(markdown);
  const linkDefinitions = Object.create(null);
  linkDefinitions[IN_LINK] = false;
  // A document with no `[label]:` line anywhere cannot define any link
  // reference, so the collection pass is a no-op and is skipped outright.
  // Otherwise collect definitions with a render-free pass (no inline
  // lexing, no output strings) before the real render.
  if (/\[[^\n]*\]:/.test(source)) renderBlockTree(source, linkDefinitions, false, true, true);
  linkDefinitions[IN_LINK] = false;
  return renderBlockTree(source, linkDefinitions);
}
