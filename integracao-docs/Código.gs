/**
 * Fase 1 – Protótipo: citar da biblioteca online do Zotero direto no Google Docs.
 * Citação = texto formatado em ABNT + hiperlink para o item do Zotero.
 */

// CONFIRMAR: id do estilo ABNT autor-data no repositório do Zotero.
// Se a busca devolver erro de estilo ou citação vazia, troque aqui.
const STYLE = 'associacao-brasileira-de-normas-tecnicas';
const LOCALE = 'pt-BR';
const API = 'https://api.zotero.org';
// Reconhece links de itens do Zotero (ex.: https://www.zotero.org/usuario/items/ABCD2345)
const KEY_RE = /zotero\.org\/.*items\/([A-Z0-9]{8})/;
const CHUNK = 50;          // máximo de itemKey por requisição (CONFIRMAR na documentação do Zotero)
const SORT_GROUP = true;   // ABNT: citações simultâneas em ordem alfabética
const BIB_TITLE = 'REFERÊNCIAS';
const BIB_FONT_SIZE = 12;      // ABNT NBR 14724: mesmo tamanho do texto (12)
const BIB_PAGE_BREAK = false;   // NBR 14724: seção primária começa em nova página (false = sem quebra)

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Citações Zotero')
    .addItem('Citar…', 'openSidebar')
    .addItem('Gerar/atualizar referências', 'generateBibliographyMenu')
    .addItem('Testar vínculos', 'reportLinks')
    .addToUi();
}

function openSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Citar do Zotero');
  DocumentApp.getUi().showSidebar(html);
}

/* ---------- Configuração (chave fica só nas propriedades do usuário) ---------- */

function getStatus() {
  const p = PropertiesService.getUserProperties();
  return { configured: !!(p.getProperty('ZOTERO_USER') && p.getProperty('ZOTERO_KEY')) };
}

function saveConfig(userId, apiKey) {
  userId = String(userId || '').trim();
  apiKey = String(apiKey || '').trim();
  if (!/^\d+$/.test(userId)) throw new Error('O userID do Zotero é numérico.');
  if (!apiKey) throw new Error('Informe a chave de API.');
  const res = UrlFetchApp.fetch(API + '/users/' + userId + '/items?limit=1', {
    headers: { 'Zotero-API-Key': apiKey, 'Zotero-API-Version': '3' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Falha na conexão com o Zotero (HTTP ' + res.getResponseCode() + '). Confira userID e chave.');
  }
  const p = PropertiesService.getUserProperties();
  p.setProperty('ZOTERO_USER', userId);
  p.setProperty('ZOTERO_KEY', apiKey);
  return true;
}

/* ---------- Zotero ---------- */

function zotero_(path, params) {
  const p = PropertiesService.getUserProperties();
  const user = p.getProperty('ZOTERO_USER');
  const key = p.getProperty('ZOTERO_KEY');
  if (!user || !key) throw new Error('Configure o userID e a chave de API primeiro.');
  const qs = Object.keys(params || {})
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  const res = UrlFetchApp.fetch(API + '/users/' + user + path + (qs ? '?' + qs : ''), {
    headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 429) throw new Error('Limite de requisições do Zotero. Tente em instantes.');
  if (code !== 200) throw new Error('Zotero respondeu HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function stripHtml_(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

function toResult_(it) {
  const link = it.links && it.links.alternate && it.links.alternate.href;
  return {
    key: it.key,
    title: (it.data && it.data.title) || '(sem título)',
    creators: (it.meta && it.meta.creatorSummary) || '',
    year: (it.meta && it.meta.parsedDate && String(it.meta.parsedDate).slice(0, 4)) || '',
    citation: stripHtml_(it.citation),
    url: link || ''
  };
}

/** Busca na biblioteca (título, autor, ano). Chamada pela barra lateral. */
function searchItems(q) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const items = zotero_('/items/top', {
    q: q, qmode: 'titleCreatorYear', limit: 20,
    format: 'json', include: 'data,citation', style: STYLE, locale: LOCALE
  });
  return items
    .filter(function (it) { return it.data && it.data.itemType !== 'attachment' && it.data.itemType !== 'note'; })
    .map(toResult_);
}

/* ---------- Inserção no documento ---------- */

/** Insere a citação formatada, como hiperlink, na posição do cursor. */
function insertCitation(key) {
  const it = zotero_('/items/' + key, { format: 'json', include: 'data,citation', style: STYLE, locale: LOCALE });
  const r = toResult_(it);
  if (!r.citation) throw new Error('O Zotero não devolveu a citação. Verifique o estilo (STYLE) em Code.gs.');
  if (!r.url) throw new Error('O item não trouxe um link; não é possível criar o vínculo.');

  const cursor = DocumentApp.getActiveDocument().getCursor();
  if (!cursor) throw new Error('Clique no texto, no ponto onde a citação deve entrar (sem selecionar trechos).');

  const el = cursor.getElement();
  if (el.getType() === DocumentApp.ElementType.TEXT) {
    const t = el.asText();
    const off = cursor.getSurroundingTextOffset();
    t.insertText(off, r.citation);
    // Remove link herdado e aplica o vínculo só ao trecho inserido
    t.setLinkUrl(off, off + r.citation.length - 1, null);
    t.setLinkUrl(off, off + r.citation.length - 1, r.url);
  } else {
    const t = cursor.insertText(r.citation);
    if (!t) throw new Error('Não foi possível inserir neste ponto do documento.');
    t.setLinkUrl(r.url);
  }
  return r.citation;
}

/* ---------- Teste de vínculos ---------- */

/** Coleta recursivamente os elementos de texto de um elemento do Docs. */
function collectTextElements_(element, out) {
  if (element.getType() === DocumentApp.ElementType.TEXT) {
    out.push(element.asText());
    return;
  }
  if (typeof element.getNumChildren !== 'function') return;
  for (let i = 0; i < element.getNumChildren(); i++) {
    collectTextElements_(element.getChild(i), out);
  }
}

/** Percorre o corpo do documento e lista os links reconhecidos como citações. */
function findCitationLinks_() {
  const texts = [];
  collectTextElements_(DocumentApp.getActiveDocument().getBody(), texts);
  const out = [];
  texts.forEach(function (t) {
    const s = t.getText();
    const idx = t.getTextAttributeIndices();
    for (let i = 0; i < idx.length; i++) {
      const url = t.getLinkUrl(idx[i]);
      const m = url && KEY_RE.exec(url);
      if (m) {
        const end = (i + 1 < idx.length ? idx[i + 1] : s.length);
        out.push({ text: s.substring(idx[i], end), key: m[1] });
      }
    }
  });
  return out;
}

function reportLinks() {
  const links = findCitationLinks_();
  const lines = links.slice(0, 40).map(function (l, i) { return (i + 1) + '. ' + l.text + '  [' + l.key + ']'; });
  DocumentApp.getUi().alert(
    'Vínculos encontrados: ' + links.length,
    links.length ? lines.join('\n') : 'Nenhuma citação com link do Zotero foi encontrada.',
    DocumentApp.getUi().ButtonSet.OK
  );
}

/* ---------- Complementos: citação agrupada ---------- */

/** Remove apenas os parênteses externos de uma citação autor-data. */
function citationCore_(citation) {
  citation = String(citation || '').trim();
  if (citation.charAt(0) === '(' && citation.charAt(citation.length - 1) === ')') {
    return citation.slice(1, -1).trim();
  }
  return citation;
}

/** Busca vários itens usando a mesma estrutura da busca atual. */
function getCitationItems_(keys) {
  keys = (keys || []).map(String).filter(function (key) { return /^[A-Z0-9]{8}$/.test(key); });
  if (!keys.length) throw new Error('Selecione pelo menos uma referência.');
  if (keys.length > CHUNK) throw new Error('Selecione no máximo ' + CHUNK + ' referências por citação.');

  const items = zotero_('/items', {
    itemKey: keys.join(','),
    limit: CHUNK,
    format: 'json',
    include: 'data,citation',
    style: STYLE,
    locale: LOCALE
  });

  const byKey = {};
  items.forEach(function (it) { byKey[it.key] = toResult_(it); });
  return keys.map(function (key) {
    if (!byKey[key]) throw new Error('O item ' + key + ' não foi encontrado no Zotero.');
    if (!byKey[key].citation) throw new Error('O Zotero não devolveu a citação do item ' + key + '.');
    if (!byKey[key].url) throw new Error('O item ' + key + ' não trouxe um link.');
    return byKey[key];
  });
}

/**
 * Insere uma citação agrupada. Cada referência recebe seu próprio link;
 * parênteses e separadores permanecem sem vínculo.
 */
function insertCitationGroup(keys) {
  const items = getCitationItems_(keys);
  if (SORT_GROUP) {
    items.sort(function (a, b) {
      const x = norm_(citationCore_(a.citation));
      const y = norm_(citationCore_(b.citation));
      return x < y ? -1 : (x > y ? 1 : 0);
    });
  }
  const cores = items.map(function (item) { return citationCore_(item.citation); });
  const text = '(' + cores.join('; ') + ')';
  const ranges = [];
  let cursorOffset = 1;
  cores.forEach(function (core, index) {
    ranges.push({
      start: cursorOffset,
      end: cursorOffset + core.length - 1,
      url: items[index].url
    });
    cursorOffset += core.length + (index < cores.length - 1 ? 2 : 0);
  });

  const cursor = DocumentApp.getActiveDocument().getCursor();
  if (!cursor) throw new Error('Clique no texto, no ponto onde a citação deve entrar (sem selecionar trechos).');

  const el = cursor.getElement();
  let t;
  let base;
  if (el.getType() === DocumentApp.ElementType.TEXT) {
    t = el.asText();
    base = cursor.getSurroundingTextOffset();
    t.insertText(base, text);
    t.setLinkUrl(base, base + text.length - 1, null);
  } else {
    t = cursor.insertText(text);
    if (!t) throw new Error('Não foi possível inserir neste ponto do documento.');
    base = 0;
  }

  ranges.forEach(function (range) {
    t.setLinkUrl(base + range.start, base + range.end, range.url);
  });
  return text;
}

/* ---------- Complementos: bibliografia ---------- */

const BIB_RANGE_NAME = 'ZOTERO_REFERENCIAS_V2';

/** Obtém itemKeys únicos das citações já inseridas no documento. */
function referencedKeys_() {
  const seen = {};
  return findCitationLinks_().map(function (link) { return link.key; }).filter(function (key) {
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/** Faz uma requisição ao Zotero preservando conteúdo que não seja JSON. */
function zoteroRaw_(path, params) {
  const p = PropertiesService.getUserProperties();
  const user = p.getProperty('ZOTERO_USER');
  const key = p.getProperty('ZOTERO_KEY');
  if (!user || !key) throw new Error('Configure o userID e a chave de API primeiro.');
  const qs = Object.keys(params || {})
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  const res = UrlFetchApp.fetch(API + '/users/' + user + path + (qs ? '?' + qs : ''), {
    headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 429) throw new Error('Limite de requisições do Zotero. Tente em instantes.');
  if (code !== 200) throw new Error('Zotero respondeu HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  return res.getContentText();
}

function htmlDecode_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

/** Converte o XHTML simples do Zotero em blocos de texto com marcadores de estilo. */
function bibBlocks_(html) {
  html = String(html || '').replace(/\r/g, '');
  const blocks = [];
  const re = /<div[^>]*class=["'][^"']*csl-entry[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = re.exec(html))) {
    const content = match[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>/gi, '\u0001$1\u0002')
      .replace(/<\/a>/gi, '\u0007')
      .replace(/<(?:i|em)>/gi, '\u0003')
      .replace(/<\/(?:i|em)>/gi, '\u0005')
      .replace(/<(?:b|strong)>/gi, '\u0004')
      .replace(/<\/(?:b|strong)>/gi, '\u0006')
      .replace(/<[^>]+>/g, '')
      .replace(/\s*\n\s*/g, ' ');
    blocks.push(htmlDecode_(content).trim());
  }
  if (!blocks.length) {
    const plain = stripHtml_(html);
    if (plain) blocks.push(plain);
  }
  return blocks;
}

/** Converte os marcadores internos em texto e intervalos de estilo. */
function renderBibBlocks_(blocks) {
  const text = [];
  const runs = [];
  let italic = false;
  let bold = false;
  let link = null;

  blocks.forEach(function (block, blockIndex) {
    if (blockIndex) text.push('\n\n');
    let i = 0;
    while (i < block.length) {
      const ch = block.charAt(i);
      if (ch === '\u0003') { italic = true; i++; continue; }
      if (ch === '\u0005') { italic = false; i++; continue; }
      if (ch === '\u0004') { bold = true; i++; continue; }
      if (ch === '\u0006') { bold = false; i++; continue; }
      if (ch === '\u0007') { link = null; i++; continue; }
      if (ch === '\u0001') {
        const end = block.indexOf('\u0002', i + 1);
        if (end >= 0) {
          link = block.slice(i + 1, end);
          i = end + 1;
          continue;
        }
      }
      const start = text.join('').length;
      text.push(ch);
      const end = start;
      if (italic || bold || link) {
        runs.push({ start: start, end: end, italic: italic, bold: bold, url: link });
      }
      i++;
    }
  });

  const plain = text.join('');
  const normalized = [];
  runs.forEach(function (run) {
    if (run.end < run.start && run.url) return;
    const previous = normalized[normalized.length - 1];
    if (previous && previous.end + 1 === run.start &&
        previous.italic === run.italic && previous.bold === run.bold && previous.url === run.url) {
      previous.end = run.end;
    } else {
      normalized.push(run);
    }
  });
  return { text: plain, runs: normalized };
}

function applyBibRuns_(text, baseOffset, runs) {
  runs.forEach(function (run) {
    const start = baseOffset + run.start;
    const end = baseOffset + run.end;
    if (end < start) return;
    if (run.url) text.setLinkUrl(start, end, run.url);
    if (run.italic !== undefined) text.setItalic(start, end, run.italic);
    if (run.bold !== undefined) text.setBold(start, end, run.bold);
  });
}

/** Normaliza para ordenação: sem acentos e minúsculas. */
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Busca as referências formatadas (uma entrada por obra), em lotes. */
function fetchBibEntries_(keys) {
  let entries = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const html = zoteroRaw_('/items', {
      itemKey: keys.slice(i, i + CHUNK).join(','),
      limit: CHUNK,
      format: 'bib',
      style: STYLE,
      locale: LOCALE,
      linkwrap: 1
    });
    bibBlocks_(html).forEach(function (block) {
      const r = renderBibBlocks_([block]);
      if (r.text) entries.push(r);
    });
  }
  // Com mais de um lote, a ordem do servidor vale só dentro de cada lote
  if (keys.length > CHUNK) {
    entries.sort(function (a, b) { return norm_(a.text) < norm_(b.text) ? -1 : 1; });
  }
  return entries;
}

/** Parágrafo sem conteúdo (só espaços)? */
function isBlankParagraph_(el) {
  if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) return false;
  const p = el.asParagraph();
  for (let i = 0; i < p.getNumChildren(); i++) {
    if (p.getChild(i).getType() !== DocumentApp.ElementType.TEXT) return false;
  }
  return p.getText().trim() === '';
}

/** Aplica a formatação ABNT (NBR 6023/14724) a um parágrafo da seção. */
function formatBibParagraph_(p, isTitle) {
  p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  p.setIndentFirstLine(0);
  p.setIndentStart(0);
  p.setIndentEnd(0);
  p.setLineSpacing(1);                 // espaço simples
  p.setSpacingBefore(0);
  // Título: 1,5 linha até o texto; referências: uma linha em branco entre elas
  p.setSpacingAfter(isTitle ? 18 : 12);
  // Título centralizado; referências alinhadas só à margem esquerda
  p.setAlignment(isTitle ? DocumentApp.HorizontalAlignment.CENTER : DocumentApp.HorizontalAlignment.LEFT);
  const t = p.editAsText();
  t.setFontSize(BIB_FONT_SIZE);
  t.setBold(!!isTitle);
  t.setItalic(false);
  t.setUnderline(false);
  const len = t.getText().length;
  if (len) t.setLinkUrl(0, len - 1, null);
  return t;
}

/**
 * Escreve a seção de referências com parágrafos reais.
 * Primeira vez: entra onde está o cursor (como o sumário do Word).
 * Depois: substitui no mesmo lugar.
 */
function writeBibliography_(entries) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const oldRanges = doc.getNamedRanges(BIB_RANGE_NAME);

  let oldEls = [];
  let index = -1;
  let blankHolder = null;

  if (oldRanges.length) {
    oldEls = oldRanges[0].getRange().getRangeElements()
      .map(function (re) { return re.getElement(); })
      .filter(function (el) {
        const p = el.getParent();
        return p && p.getType() === DocumentApp.ElementType.BODY_SECTION;
      });
    if (oldEls.length) index = body.getChildIndex(oldEls[0]);
  }

  if (index < 0) {
    const cursor = doc.getCursor();
    if (!cursor) {
      throw new Error('Posicione o cursor onde a seção de referências deve entrar (como no sumário do Word).');
    }
    let el = cursor.getElement();
    while (el.getParent() && el.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
      el = el.getParent();
    }
    if (!el.getParent() || el.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
      throw new Error('Posicione o cursor no corpo do documento (não em cabeçalho, rodapé ou nota).');
    }
    index = body.getChildIndex(el);
    if (isBlankParagraph_(el)) {
      blankHolder = el;      // a seção ocupa o lugar do parágrafo vazio
    } else {
      index += 1;            // senão, entra logo depois do parágrafo do cursor
    }
  }

  const title = body.insertParagraph(index++, BIB_TITLE);
  formatBibParagraph_(title, true);
  if (BIB_PAGE_BREAK) {
    try { title.insertPageBreak(0); } catch (err) { /* segue sem quebra */ }
  }

  let last = title;
  entries.forEach(function (e) {
    const p = body.insertParagraph(index++, e.text);
    const t = formatBibParagraph_(p, false);
    applyBibRuns_(t, 0, e.runs);
    last = p;
  });

  // Só depois de inserir a nova seção, remove a antiga (e o parágrafo vazio usado como ponto)
  oldEls.forEach(function (el) {
    try { el.removeFromParent(); }
    catch (err) { try { el.asParagraph().clear(); } catch (err2) { /* mantém */ } }
  });
  oldRanges.forEach(function (r) { r.remove(); });
  if (blankHolder) {
    try { blankHolder.removeFromParent(); } catch (err) { /* último parágrafo: mantém */ }
  }

  doc.addNamedRange(BIB_RANGE_NAME, doc.newRange().addElementsBetween(title, last).build());
}

/** Gera ou atualiza a seção de referências a partir dos links do documento. */
function generateBibliography() {
  const keys = referencedKeys_();
  if (!keys.length) throw new Error('Nenhuma citação com link do Zotero foi encontrada no documento.');
  const entries = fetchBibEntries_(keys);
  if (!entries.length) throw new Error('O Zotero não devolveu uma bibliografia válida.');
  writeBibliography_(entries);
  let msg = entries.length + ' referência(s) para ' + keys.length + ' obra(s) citada(s).';
  if (entries.length < keys.length) {
    msg += ' Atenção: ' + (keys.length - entries.length) + ' obra(s) citada(s) não voltaram do Zotero (apagadas ou sem permissão?).';
  }
  return msg;
}

/** Versão para o menu: mostra erros em caixa de diálogo. */
function generateBibliographyMenu() {
  const ui = DocumentApp.getUi();
  try {
    ui.alert('Referências', generateBibliography(), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Erro', e.message, ui.ButtonSet.OK);
  }
}