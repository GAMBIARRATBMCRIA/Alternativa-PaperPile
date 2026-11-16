/* Consensus → Zotero | Lightweight multi-site content script (MV3) */
(() => {
  "use strict";

  const UI_ATTR = "data-czt-ui-root";
  const IGNORE_TITLE = /^(search results|results|related papers|references|abstract|documents|articles|papers|consensus meter)$/i;
  const MAX_ROOTS = 128;
  const MAX_CARDS_PER_ROOT = 160;
  const MAX_CARDS_PER_IDLE = 18;
  const adapters = globalThis.CZT_ADAPTERS || [];
  const hostname = location.hostname;
  const adapter = adapters.find((candidate) => candidate.hosts.some((pattern) => pattern.test(hostname)));
  if (!adapter) return;

  const matchesRoute = () => adapter.routes.some((pattern) => pattern.test(location.pathname));
  const isSinglePage = () => adapter.singlePage === true || (adapter.singlePageRoutes || []).some((pattern) => pattern.test(location.pathname));
  if (!matchesRoute()) {
    // Some supported hosts are SPAs and may navigate after the script starts.
    // The low-frequency route check is event-driven by DOM updates below; no timer is used.
  }

  const processed = new WeakMap();
  const pendingRoots = new Set();
  const queuedCards = new Set();
  let scanTimer = 0;
  let idleHandle = 0;
  let collectionCache = null;
  let collectionPromise = null;
  let lastRoute = location.pathname + location.search;

  const cleanText = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const textOf = (node) => cleanText(node?.innerText || node?.textContent || "");
  const isElement = (node) => node && node.nodeType === Node.ELEMENT_NODE;
  const rootQuery = (root, selector) => {
    try {
      const found = [];
      if (isElement(root) && root.matches(selector)) found.push(root);
      if (root?.querySelectorAll) found.push(...root.querySelectorAll(selector));
      return found;
    } catch { return []; }
  };
  const matchesAny = (node, selectors) => selectors.some((selector) => {
    try { return node.matches(selector); } catch { return false; }
  });

  function isValidCard(node) {
    if (!isElement(node)) return false;
    if (adapter.id !== "elicit") return true;
    if (node.matches("[role='row'][row-id], [role='row'][data-row-id]")) return true;
    if (node.tagName === "ARTICLE") return Boolean(node.querySelector("[data-testid='reference-title']"));
    if (node.tagName === "SECTION") {
      try { return Boolean(node.querySelector(":scope > header h3 a[href]")); }
      catch { return Boolean(node.querySelector("header h3 a[href]")); }
    }
    return false;
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) return reject(new Error(runtimeError.message));
        if (response?.error) return reject(new Error(response.error));
        resolve(response);
      });
    });
  }

  function getCollectionList() {
    if (collectionCache && Date.now() - collectionCache.at < 120000) {
      return Promise.resolve(collectionCache.items);
    }
    if (collectionPromise) return collectionPromise;
    collectionPromise = send({ type: "GET_COLLECTIONS" })
      .then((result) => {
        const items = result.collections || [];
        collectionCache = { at: Date.now(), items };
        return items;
      })
      .finally(() => { collectionPromise = null; });
    return collectionPromise;
  }

  // Consensus has two distinct Paperpile-style surfaces: search result cards and
  // structured citation previews rendered inside floating hover panels. Do not
  // run the generic article/heading heuristics on Consensus: they can mistake
  // user/assistant chat messages for publications.
  if (adapter.id === "consensus") {
    startConsensusIntegration();
    return;
  }

  function findTitleElement(card) {
    for (const selector of adapter.titleSelectors || []) {
      const candidates = rootQuery(card, selector);
      const match = candidates.find((node) => {
        const value = textOf(node);
        return value.length >= 12 && value.length <= 400 && !IGNORE_TITLE.test(value);
      });
      if (match) return match;
    }
    const candidates = rootQuery(card, "h1, h2, h3, h4, [role='heading']");
    const heading = candidates.find((node) => {
      const value = textOf(node);
      return value.length >= 12 && value.length <= 400 && !IGNORE_TITLE.test(value);
    });
    if (heading) return heading;
    if (card.tagName === "A") {
      const value = textOf(card);
      if (value.length >= 12 && value.length <= 400 && !IGNORE_TITLE.test(value)) return card;
    }
    const links = rootQuery(card, "a[href]");
    return links.find((node) => {
      const value = textOf(node);
      return value.length >= 18 && value.length <= 400 && !IGNORE_TITLE.test(value);
    }) || null;
  }

  function findCardForHeading(heading) {
    for (const selector of adapter.cardSelectors || []) {
      try {
        const matched = heading.closest(selector);
        if (matched && isValidCard(matched)) return matched;
      } catch { /* Ignore invalid or unsupported selectors. */ }
    }
    let node = heading.parentElement;
    let fallback = node;
    for (let depth = 0; node && node !== document.body && depth < 6; depth += 1) {
      const value = textOf(node);
      if (node.matches("article, li, [role='article'], [role='row']") && value.length < 4200 && isValidCard(node)) return node;
      if (depth >= 2 && value.length >= textOf(heading).length + 16 && value.length < 2600) {
        const headingCount = node.querySelectorAll("h1, h2, h3, h4, [role='heading']").length;
        if (headingCount === 1) {
          const hasArticleLink = [...node.querySelectorAll("a[href]")].some((link) => /doi\.org|\/document\/\d+|\/science\/article|\/article\/|\/paper\//i.test(link.href || ""));
          if (hasArticleLink) return node;
        }
      }
      fallback = node;
      node = node.parentElement;
    }
    return fallback || heading.parentElement;
  }

  function collectCards(root) {
    const cards = new Set();
    const allowed = matchesRoute();
    if (!allowed) return cards;

    if (isSinglePage()) {
      const pageRoot = document.querySelector("main") || document.querySelector("article") || document.body;
      const rootIsWithinPage = root === document || root === document.body || root === document.documentElement || root === pageRoot || (isElement(root) && pageRoot.contains(root));
      if (rootIsWithinPage) {
        if (findTitleElement(pageRoot) || pageRoot.querySelector("h1")) cards.add(pageRoot);
        return cards;
      }
    }

    for (const selector of adapter.cardSelectors || []) {
      for (const card of rootQuery(root, selector)) {
        if (card.closest?.(`[${UI_ATTR}]`) || !isValidCard(card)) continue;
        cards.add(card);
        if (cards.size >= MAX_CARDS_PER_ROOT) return cards;
      }
    }

    const headings = rootQuery(root, "h1, h2, h3, h4, [role='heading']");
    for (const heading of headings) {
      const title = textOf(heading);
      if (title.length < 12 || title.length > 400 || IGNORE_TITLE.test(title)) continue;
      if (heading.closest?.(`[${UI_ATTR}]`)) continue;
      const card = findCardForHeading(heading);
      if (card && isValidCard(card) && !card.closest?.(`[${UI_ATTR}]`)) cards.add(card);
      if (cards.size >= MAX_CARDS_PER_ROOT) break;
    }

    if (isSinglePage() && cards.size === 0) {
      const main = (isElement(root) && root.matches("main, article") ? root : rootQuery(root, "main, article")[0]) || (root === document ? document.body : null);
      if (main) cards.add(main);
    }
    return cards;
  }

  function parseJsonLd(root) {
    const nodes = rootQuery(root, "script[type='application/ld+json']").slice(0, 3);
    for (const script of nodes) {
      const raw = script.textContent || "";
      if (!raw || raw.length > 180000) continue;
      try {
        const parsed = JSON.parse(raw);
        const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
        while (stack.length) {
          const obj = stack.shift();
          if (!obj || typeof obj !== "object") continue;
          if (Array.isArray(obj)) { stack.push(...obj.slice(0, 10)); continue; }
          if (obj["@graph"] && Array.isArray(obj["@graph"])) stack.push(...obj["@graph"]);
          const types = Array.isArray(obj["@type"]) ? obj["@type"].join(" ") : String(obj["@type"] || "");
          if (/ScholarlyArticle|Article|Chapter|CreativeWork|Report/i.test(types) && (obj.headline || obj.name || obj.title)) return obj;
        }
      } catch { /* Ignore malformed page JSON-LD. */ }
    }
    return null;
  }

  function metaContent(root, names) {
    for (const name of names) {
      const meta = root.querySelector?.(`meta[name="${CSS.escape(name)}"], meta[property="${CSS.escape(name)}"]`);
      const value = cleanText(meta?.content);
      if (value) return value;
    }
    return "";
  }

  function extractDoi(root, text, structured) {
    const fromStructured = structured?.identifier;
    const candidates = [];
    if (typeof fromStructured === "string") candidates.push(fromStructured);
    else if (Array.isArray(fromStructured)) candidates.push(...fromStructured.map((entry) => typeof entry === "string" ? entry : entry?.value || ""));
    const metaDoi = metaContent(root, ["citation_doi", "dc.identifier", "DC.Identifier", "prism.doi"]);
    if (metaDoi) candidates.push(metaDoi);
    for (const link of root.querySelectorAll?.("a[href]") || []) candidates.push(link.href);
    candidates.push(text);
    for (const candidate of candidates) {
      const match = String(candidate).match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*:\s*)?(10\.\d{4,9}\/[\-._;()/:A-Z0-9]+)/i);
      if (match) return match[1].replace(/[\s.,;]+$/g, "");
    }
    return "";
  }

  function authorObjects(values) {
    const unique = new Set();
    const results = [];
    for (const value of values) {
      let name = cleanText(value)
        .replace(/^authors?\s*:\s*/i, "")
        .replace(/\bet al\.?\s*$/i, "")
        .replace(/\s+and\s+\d+\s+more\s*$/i, "")
        .trim();
      if (!name || name.length > 110) continue;

      let names = name.split(/\s*[;|]\s*/).filter(Boolean);
      if (names.length === 1 && /\s+and\s+/i.test(name)) {
        names = name.split(/\s+and\s+/i).filter(Boolean);
      }
      if (names.length === 1 && name.includes(",")) {
        const commaParts = name.split(/\s*,\s*/).filter(Boolean);
        if (commaParts.length === 2) {
          // Accept both "John Smith, Jane Doe" and citation-style "Smith, J.".
          if (commaParts.every((part) => part.split(/\s+/).length >= 2)) names = commaParts;
          else names = [`${commaParts[1]} ${commaParts[0]}`];
        } else if (commaParts.length >= 4 && commaParts.length % 2 === 0) {
          const paired = [];
          for (let index = 0; index < commaParts.length; index += 2) paired.push(`${commaParts[index + 1]} ${commaParts[index]}`);
          names = paired;
        }
      }

      for (const part of names) {
        const cleanName = cleanText(part);
        const normalized = cleanName.toLocaleLowerCase();
        if (normalized.length < 2 || unique.has(normalized)) continue;
        unique.add(normalized);
        const tokens = cleanName.split(/\s+/).filter(Boolean);
        if (tokens.length === 1) results.push({ creatorType: "author", lastName: tokens[0] });
        else results.push({ creatorType: "author", firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] });
        if (results.length >= 25) return results;
      }
    }
    return results;
  }

  function extractAuthors(root, structured) {
    const raw = [];
    const author = structured?.author || structured?.creator;
    if (Array.isArray(author)) {
      author.forEach((entry) => raw.push(typeof entry === "string" ? entry : entry?.name || [entry?.givenName, entry?.familyName].filter(Boolean).join(" ")));
    } else if (author) {
      raw.push(typeof author === "string" ? author : author.name || [author.givenName, author.familyName].filter(Boolean).join(" "));
    }

    for (const meta of root.querySelectorAll?.("meta[name='citation_author'], meta[name='DC.Creator'], meta[name='dc.creator'], meta[name='author']") || []) {
      if (meta.content) raw.push(meta.content);
    }

    if (!raw.length) {
      for (const selector of adapter.authorSelectors || []) {
        for (const node of rootQuery(root, selector).slice(0, 8)) {
          const value = node.getAttribute?.("aria-label") || textOf(node);
          if (value && value.length < 700) raw.push(value);
        }
        if (raw.length) break;
      }
    }
    return authorObjects(raw);
  }

  function firstText(root, selectors, maxLength = 1200) {
    for (const selector of selectors || []) {
      const value = textOf(root.querySelector?.(selector));
      if (value && value.length <= maxLength) return value;
    }
    return "";
  }

  function bestArticleUrl(root, doi) {
    const links = [...(root.querySelectorAll?.("a[href]") || [])];
    let best = "";
    let bestScore = -1;
    for (const link of links) {
      let url;
      try { url = new URL(link.href); } catch { continue; }
      if (!/^https?:$/.test(url.protocol)) continue;
      const href = url.href;
      if (/javascript:|mailto:|facebook\.com|twitter\.com|linkedin\.com/i.test(href)) continue;
      const path = `${url.hostname}${url.pathname}`;
      const label = textOf(link);
      let score = 0;
      if (/doi\.org$/i.test(url.hostname)) score += 14;
      if (/\/document\/\d+|\/science\/(?:article|chapter)|\/article\/|\/doi\/|\/paper\//i.test(path)) score += 9;
      if (/pdf/i.test(url.pathname)) score += 2;
      if (url.hostname === location.hostname) score += 1;
      if (url.hostname === "scopus.com" || url.hostname.endsWith(".scopus.com")) score -= 2;
      if (url.hostname === "elicit.com" || url.hostname.endsWith(".elicit.com")) score -= 2;
      if (label.length < 5) score -= 1;
      if (score > bestScore) { bestScore = score; best = href; }
    }
    if (doi) return `https://doi.org/${doi}`;
    return best || "";
  }

  function extractItem(card) {
    const titleNode = findTitleElement(card);
    const structured = parseJsonLd(card) || (isSinglePage() ? parseJsonLd(document) : null);
    const citationRoot = isSinglePage() ? document : card;
    const title = cleanText(
      textOf(titleNode) || structured?.headline || structured?.name ||
      metaContent(citationRoot, ["citation_title", "og:title", "dc.title", "DC.Title"])
    ).replace(/\s+[–—-]\s+(?:ScienceDirect|IEEE Xplore|Scopus).*$/i, "").trim();
    if (title.length < 8 || title.length > 420 || IGNORE_TITLE.test(title)) return null;

    const text = textOf(card);
    const doi = extractDoi(citationRoot, text, structured);
    const date = cleanText(
      structured?.datePublished || structured?.dateCreated ||
      metaContent(citationRoot, ["citation_publication_date", "citation_date", "dc.date", "DC.Date", "prism.publicationDate"]) ||
      (text.match(/\b(?:19|20)\d{2}\b/) || [""])[0]
    );
    const publicationTitle = cleanText(
      structured?.isPartOf?.name || structured?.publisher?.name ||
      firstText(card, adapter.journalSelectors) ||
      metaContent(citationRoot, ["citation_journal_title", "citation_conference_title", "prism.publicationName", "dc.source"])
    );
    const abstractNote = cleanText(
      structured?.description || firstText(card, adapter.abstractSelectors, 5000) ||
      metaContent(citationRoot, ["citation_abstract", "description", "og:description"])
    );
    const doiUrl = doi ? `https://doi.org/${doi}` : "";
    const url = bestArticleUrl(card, doi) || doiUrl || (isSinglePage() ? location.href : "");
    const conferenceMeta = metaContent(citationRoot, ["citation_conference_title", "prism.conferenceName"]);
    const typeText = `${structured?.['@type'] || ""} ${conferenceMeta} ${text}`;
    const itemType = /conference|proceedings-article/i.test(typeText) ? "conferencePaper" : "journalArticle";
    const journalOrProceedings = publicationTitle || conferenceMeta;

    return {
      title,
      doi,
      date,
      creators: extractAuthors(citationRoot, structured),
      publicationTitle: itemType === "journalArticle" ? journalOrProceedings : "",
      proceedingsTitle: itemType === "conferencePaper" ? journalOrProceedings : "",
      abstractNote,
      url,
      itemType,
      volume: metaContent(citationRoot, ["citation_volume", "prism.volume"]),
      issue: metaContent(citationRoot, ["citation_issue", "prism.number"]),
      pages: metaContent(citationRoot, ["citation_firstpage", "citation_lastpage", "prism.pageRange"]),
      source: adapter.label
    };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildCollectionOptions(select, collections) {
    while (select.options.length > 2) select.remove(2);
    const byKey = new Map(collections.map((item) => [item.key, item]));
    const depthOf = (item) => {
      let depth = 0;
      let parent = item.parentCollection;
      const visited = new Set();
      while (parent && byKey.has(parent) && !visited.has(parent)) {
        visited.add(parent);
        depth += 1;
        parent = byKey.get(parent).parentCollection;
      }
      return depth;
    };
    collections.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).forEach((item) => {
      const option = el("option", "", `${"　".repeat(Math.min(depthOf(item), 4))}${item.name}`);
      option.value = item.key;
      select.append(option);
    });
  }

  function sortedCollections(collections) {
    const byKey = new Map(collections.map((item) => [item.key, item]));
    const depthOf = (item) => {
      let depth = 0;
      let parent = item.parentCollection;
      const visited = new Set();
      while (parent && byKey.has(parent) && !visited.has(parent)) {
        visited.add(parent);
        depth += 1;
        parent = byKey.get(parent).parentCollection;
      }
      return depth;
    };
    return collections.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((item) => ({ ...item, depth: Math.min(depthOf(item), 5) }));
  }

  function mountSplitControl(card, currentItem, options = {}) {
    if (!matchesRoute() || !isElement(card) || card.closest?.(`[${UI_ATTR}]`)) return;
    const existing = processed.get(card);
    if (existing) {
      existing.item = currentItem;
      if (options.getFreshItem) existing.getFreshItem = options.getFreshItem;
      return;
    }

    const source = options.source || adapter.label;
    const mount = el("span", "czt-control");
    mount.setAttribute(UI_ATTR, adapter.id);
    mount.style.cssText = "display:inline-flex;vertical-align:middle;position:relative;margin:2px 5px 2px 0;z-index:2147483000;";
    const shadow = mount.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = `
      :host{all:initial;display:inline-flex;flex-direction:column;align-items:flex-start;vertical-align:middle;position:relative;z-index:2147483000;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#1f2937}
      *{box-sizing:border-box}
      .group{display:inline-flex;align-items:stretch;vertical-align:middle;white-space:nowrap}
      button{appearance:none;-webkit-appearance:none;font-family:Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;user-select:none}
      button:disabled{opacity:.58;cursor:wait}
      .main{height:22px;padding:0 7px;border:1px solid #aebfda;border-right:0;border-radius:5px 0 0 5px;background:#f7f9fd;color:#234a80;font-size:11px;line-height:20px;font-weight:700;letter-spacing:0}
      .main:hover:not(:disabled){background:#eaf1fb;border-color:#7799cb}
      .main.saved{background:#e9f7ef;border-color:#9ac9aa;color:#17663a;cursor:default}
      .arrow{width:19px;height:22px;padding:0;border:1px solid #aebfda;border-radius:0 5px 5px 0;background:#f7f9fd;color:#234a80;font-size:11px;line-height:20px;font-weight:700}
      .arrow:hover:not(:disabled){background:#eaf1fb;border-color:#7799cb}
      .menu{display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:190px;max-width:260px;max-height:210px;overflow:auto;padding:4px;border:1px solid #d7e0eb;border-radius:8px;background:#fff;box-shadow:0 5px 18px rgba(20,35,55,.18);z-index:2147483000}
      .menu.open{display:block}
      .menu-heading{padding:4px 7px 5px;color:#697586;font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}
      .menu-item{display:block;width:100%;min-height:27px;padding:5px 7px;border:0;border-radius:5px;background:transparent;color:#202b39;text-align:left;font-size:11px;line-height:1.3;white-space:normal;overflow-wrap:anywhere}
      .menu-item:hover:not(:disabled){background:#eef3fa}
      .menu-item.default:after{content:' · padrão';color:#64748b;font-size:10px}
      .menu-item.root{font-weight:650}
      .status{margin:4px 0 0;max-width:260px;color:#64748b;font:10px/1.35 Inter,ui-sans-serif,system-ui,sans-serif;overflow-wrap:anywhere}
      .status.error{color:#b42318}.status.success{color:#087443}
      .status a{color:#315fbc;font:10px Inter,ui-sans-serif,system-ui,sans-serif}
      @media(prefers-reduced-motion:no-preference){.menu{transition:opacity .08s ease}}
    `;

    const group = el("div", "group");
    const mainButton = el("button", "main", "+Zotero");
    mainButton.type = "button";
    mainButton.title = "Adicionar à coleção padrão do Zotero";
    mainButton.setAttribute("aria-label", "Adicionar ao Zotero na coleção padrão");
    const arrowButton = el("button", "arrow", "▾");
    arrowButton.type = "button";
    arrowButton.title = "Escolher outra coleção";
    arrowButton.setAttribute("aria-label", "Escolher coleção do Zotero");
    arrowButton.setAttribute("aria-expanded", "false");
    group.append(mainButton, arrowButton);
    const menu = el("div", "menu");
    menu.setAttribute("role", "menu");
    const status = el("p", "status", "");
    shadow.append(style, group, menu, status);

    // Keep pointer/click interactions inside the page's existing card/hover
    // layer. As with Paperpile, stop mousedown so parent cards do not navigate.
    for (const eventName of ["click", "mousedown", "pointerdown"]) {
      shadow.addEventListener(eventName, (event) => event.stopPropagation());
    }

    const state = {
      item: currentItem,
      getFreshItem: options.getFreshItem || (() => currentItem),
      busy: false,
      checking: true,
      saved: false,
      menuLoaded: false
    };
    processed.set(card, state);

    function setStatus(message, kind = "") {
      status.textContent = message || "";
      status.className = `status ${kind}`.trim();
    }

    function markAsSaved(match, message = "Já está na sua biblioteca.") {
      state.checking = false;
      state.saved = true;
      mainButton.textContent = "Salvo ✓";
      mainButton.classList.add("saved");
      mainButton.title = "Esta publicação já está na sua biblioteca Zotero";
      mainButton.disabled = true;
      arrowButton.disabled = true;
      setStatus(message, "success");
      addResultLink(match?.url);
    }

    async function checkCurrentItem() {
      mainButton.disabled = true;
      arrowButton.disabled = true;
      setStatus("Conferindo sua biblioteca…");
      try {
        const result = await send({ type: "CHECK_ITEMS", items: [state.item] });
        if (!mount.isConnected) return;
        state.checking = false;
        if (result.connected && result.matches?.[0]) {
          markAsSaved(result.matches[0]);
          return;
        }
        setStatus("");
        mainButton.disabled = false;
        arrowButton.disabled = false;
      } catch (error) {
        if (!mount.isConnected) return;
        state.checking = false;
        mainButton.disabled = false;
        arrowButton.disabled = false;
        setStatus("Não foi possível conferir agora; a biblioteca será verificada ao salvar.");
      }
    }

    function closeMenu() {
      menu.classList.remove("open");
      arrowButton.setAttribute("aria-expanded", "false");
    }

    function addResultLink(url) {
      if (!url) return;
      const link = el("a", "", "Abrir no Zotero ↗");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      status.append(document.createTextNode(" "), link);
    }

    async function saveToCollection(collectionKey, collectionLabel) {
      if (state.busy || state.checking || state.saved) return;
      state.item = state.getFreshItem?.() || state.item;
      if (!state.item?.title) {
        setStatus("Não foi possível identificar o título desta publicação.", "error");
        return;
      }
      state.busy = true;
      mainButton.disabled = true;
      arrowButton.disabled = true;
      mainButton.textContent = "Salvando…";
      setStatus(`Enviando para ${collectionLabel || "a coleção padrão"}…`);
      closeMenu();
      try {
        const result = await send({
          type: "SAVE_ITEM",
          item: state.item,
          collectionKey: collectionKey ?? "",
          pageUrl: location.href,
          source
        });
        if (result.status === "duplicate") {
          markAsSaved(result.duplicate);
        } else {
          markAsSaved({ url: result.url }, "Referência adicionada ao Zotero.");
        }
      } catch (error) {
        mainButton.textContent = "+Zotero";
        setStatus(error.message || "Não foi possível salvar a referência.", "error");
      } finally {
        state.busy = false;
        mainButton.disabled = state.saved;
        arrowButton.disabled = state.saved;
      }
    }

    function addMenuItem(label, key, isDefault = false, root = false, depth = 0) {
      const button = el("button", `menu-item${isDefault ? " default" : ""}${root ? " root" : ""}`);
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.style.paddingLeft = `${7 + Math.min(depth, 5) * 10}px`;
      button.textContent = label;
      button.addEventListener("click", () => saveToCollection(key, label));
      menu.append(button);
    }

    async function populateMenu() {
      menu.replaceChildren(el("div", "menu-heading", "Salvar em qual coleção?"));
      try {
        const [collectionsResult, settings] = await Promise.all([
          getCollectionList(), send({ type: "GET_SETTINGS" })
        ]);
        const defaultKey = settings.defaultCollectionKey || "";
        addMenuItem("Biblioteca principal (sem coleção)", "", defaultKey === "", true, 0);
        for (const collection of sortedCollections(collectionsResult)) {
          addMenuItem(collection.name, collection.key, collection.key === defaultKey, false, collection.depth);
        }
        if (!collectionsResult.length) {
          menu.append(el("div", "menu-heading", "Nenhuma coleção cadastrada"));
        }
        state.menuLoaded = true;
      } catch (error) {
        menu.append(el("div", "menu-heading", error.message || "Erro ao carregar coleções"));
      }
    }

    mainButton.addEventListener("click", async (event) => {
      event.preventDefault();
      if (state.busy || state.checking || state.saved) return;
      try {
        const settings = await send({ type: "GET_SETTINGS" });
        const key = settings.defaultCollectionKey || "";
        const label = settings.defaultCollectionName || "a coleção padrão";
        await saveToCollection(key, label);
      } catch (error) {
        setStatus(error.message || "Não foi possível carregar a coleção padrão.", "error");
      }
    });

    arrowButton.addEventListener("click", async (event) => {
      event.preventDefault();
      if (state.busy || state.checking || state.saved) return;
      if (menu.classList.contains("open")) {
        closeMenu();
        return;
      }
      menu.classList.add("open");
      arrowButton.setAttribute("aria-expanded", "true");
      if (!state.menuLoaded) await populateMenu();
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    options.insertHost(mount);
    checkCurrentItem();
  }

  function mountAction(card) {
    if (!matchesRoute() || !isElement(card) || card.closest?.(`[${UI_ATTR}]`)) return;
    const current = extractItem(card);
    if (!current) return;
    const heading = findTitleElement(card);
    if (!heading || !heading.parentElement) return;
    const insertionTarget = heading.closest("a[href]") || heading;
    if (!insertionTarget.parentElement) return;
    mountSplitControl(card, current, {
      source: adapter.label,
      getFreshItem: () => extractItem(card),
      insertHost: (host) => insertionTarget.insertAdjacentElement("afterend", host)
    });
  }

  function startConsensusIntegration() {
    const SELECTORS = {
      searchAnchor: 'a[data-testid="search-result"]',
      resultItem: '[data-testid="search-result-item"]',
      floating: '[data-floating-ui-focusable]',
      intercomTile: '[data-intercom-target*="result tile"]',
      inlineCitation: ".relative.max-w-none.prose"
    };
    const inlineObservers = new Map();
    const pending = new Set();
    let flushTimer = 0;
    let idleToken = 0;
    let lastUrl = location.pathname + location.search;

    function hasDirectInlineStructure(node) {
      try { return Boolean(node.querySelector(":scope > p:first-child + div.flex.flex-col + hr")); }
      catch { return false; }
    }

    function isInlineCitation(node) {
      if (!isElement(node) || !node.matches(SELECTORS.inlineCitation)) return false;
      const hasDoiLabel = [...node.querySelectorAll("span")].some((span) => textOf(span) === "DOI");
      // Mirrors the Paperpile detection guard: only citation-shaped prose with
      // a DOI label or the known title/metadata/HR layout is eligible.
      return hasDoiLabel || hasDirectInlineStructure(node);
    }

    function getConsensusSearchAnchor(node) {
      if (!isElement(node)) return null;
      if (node.matches(SELECTORS.searchAnchor)) return node;
      const direct = node.querySelector(SELECTORS.searchAnchor);
      if (direct) return direct;
      if (node.matches(SELECTORS.floating)) {
        const floatingLink = node.querySelector('a[href*="/papers/"]');
        if (floatingLink && (floatingLink.querySelector("h3") || textOf(floatingLink).length >= 12)) return floatingLink;
      }
      if (node.matches(SELECTORS.intercomTile)) {
        const tileLink = node.querySelector(SELECTORS.searchAnchor);
        if (tileLink) return tileLink;
      }
      return null;
    }

    function consensusSearchContainer(anchor) {
      return anchor.closest(`${SELECTORS.resultItem}, .pt-6.border-b, ${SELECTORS.intercomTile}, ${SELECTORS.floating}`) || anchor;
    }

    function extractConsensusSearch(anchor) {
      const container = consensusSearchContainer(anchor);
      const titleNode = anchor.querySelector("h3") || container.querySelector("h3") || anchor.querySelector("[data-testid='reference-title']");
      const title = cleanText(textOf(titleNode) || textOf(anchor)).replace(/\s+/g, " ");
      if (title.length < 8 || title.length > 420 || IGNORE_TITLE.test(title)) return null;

      const doiLink = container.querySelector('[data-testid="doi-link"]');
      const doi = extractDoi(container, textOf(container), null) || extractDoi(anchor, doiLink?.getAttribute("href") || "", null);
      const authorNode = container.querySelector("span.notranslate");
      const yearNode = container.querySelector("span.tiny-mono-bold");
      const yearText = cleanText(textOf(yearNode));
      const date = (yearText.match(/(?:19|20)\d{2}/) || [""])[0];
      const publisherNode = container.querySelector("span.italic");
      const publicationTitle = cleanText(textOf(publisherNode) || publisherNode?.getAttribute("title") || "");
      const h3Link = anchor.querySelector("h3")?.closest("a[href]");
      const url = doi ? `https://doi.org/${doi}` : (h3Link?.href || anchor.href || "");
      return {
        title,
        doi,
        date,
        creators: authorObjects(authorNode ? [textOf(authorNode)] : []),
        publicationTitle,
        abstractNote: "",
        url,
        itemType: "journalArticle",
        source: "Consensus"
      };
    }

    function extractConsensusInline(prose) {
      const titleNode = prose.querySelector(":scope > p") || prose.querySelector("p");
      const title = cleanText(textOf(titleNode));
      if (title.length < 8 || title.length > 420 || IGNORE_TITLE.test(title)) return null;

      const authorNode = prose.querySelector("span.notranslate");
      const yearNode = prose.querySelector("span.font-medium.text-fg-base");
      const yearText = cleanText(textOf(yearNode));
      const date = (yearText.match(/(?:19|20)\d{2}/) || textOf(prose).match(/(?:19|20)\d{2}/) || [""])[0];
      const publisherNode = prose.querySelector("span[title]");
      const publisher = cleanText(publisherNode?.getAttribute("title") || textOf(publisherNode));
      const doiLabel = [...prose.querySelectorAll("span")].find((span) => textOf(span) === "DOI");
      const doiValue = doiLabel?.nextElementSibling?.textContent || "";
      const doi = extractDoi(prose, doiValue || textOf(prose), null);
      const articleLink = [...prose.querySelectorAll("a[href]")].find((link) => /\/papers\//i.test(link.pathname || ""));
      return {
        title,
        doi,
        date,
        creators: authorObjects(authorNode ? [textOf(authorNode)] : []),
        publicationTitle: publisher,
        abstractNote: "",
        url: doi ? `https://doi.org/${doi}` : (articleLink?.href || ""),
        itemType: "journalArticle",
        source: "Consensus"
      };
    }

    function insertSearchControl(anchor, card, item) {
      const toolbarSelector = ".flex.items-center.gap-\\[6px\\].min-w-0";
      const container = consensusSearchContainer(anchor);
      const toolbar = container.querySelector(toolbarSelector);
      mountSplitControl(card, item, {
        source: "Consensus",
        getFreshItem: () => extractConsensusSearch(anchor) || item,
        insertHost: (host) => {
          if (toolbar) {
            toolbar.prepend(host);
          } else if (anchor.isConnected) {
            anchor.insertAdjacentElement("afterend", host);
          }
        }
      });
    }

    function insertInlineControl(prose, item) {
      mountSplitControl(prose, item, {
        source: "Consensus",
        getFreshItem: () => extractConsensusInline(prose) || item,
        insertHost: (host) => {
          const doiLabel = [...prose.querySelectorAll("span")].find((span) => textOf(span) === "DOI");
          const doiRow = doiLabel?.closest("div");
          if (doiRow && doiRow !== prose) {
            doiRow.insertAdjacentElement("afterend", host);
            return;
          }
          const structuralRow = (() => {
            try {
              const hr = prose.querySelector(":scope > p:first-child + div.flex.flex-col + hr");
              return hr?.previousElementSibling || null;
            } catch { return null; }
          })();
          if (structuralRow) {
            structuralRow.append(host);
            return;
          }
          const firstParagraph = prose.querySelector(":scope > p") || prose.querySelector("p");
          if (firstParagraph) firstParagraph.insertAdjacentElement("afterend", host);
          else prose.append(host);
        },
        inline: true
      });
    }

    function watchFloating(node) {
      if (!isElement(node) || !node.matches(SELECTORS.floating) || inlineObservers.has(node)) return;
      const styleObserver = new MutationObserver(() => {
        // Paperpile reacts when the floating panel becomes visible; observe only
        // the style attribute of this one panel, never attributes page-wide.
        if (node.isConnected && node.style.opacity === "1") enqueue(node);
      });
      styleObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
      inlineObservers.set(node, styleObserver);
    }

    function disposeFloating(root) {
      if (!isElement(root)) return;
      const candidates = [];
      if (root.matches(SELECTORS.floating)) candidates.push(root);
      root.querySelectorAll?.(SELECTORS.floating).forEach((node) => candidates.push(node));
      for (const node of candidates) {
        inlineObservers.get(node)?.disconnect();
        inlineObservers.delete(node);
      }
    }

    function processRoot(root) {
      if (!matchesRoute() || !isElement(root) || root.closest?.(`[${UI_ATTR}]`)) return;
      if (root.matches(SELECTORS.floating)) watchFloating(root);

      const anchors = [];
      if (root.matches(SELECTORS.searchAnchor)) anchors.push(root);
      if (root.matches(SELECTORS.resultItem) || root.matches(SELECTORS.intercomTile) || root.matches(SELECTORS.floating)) {
        const anchor = getConsensusSearchAnchor(root);
        if (anchor) anchors.push(anchor);
      }
      root.querySelectorAll?.(SELECTORS.searchAnchor).forEach((anchor) => anchors.push(anchor));
      root.querySelectorAll?.(`${SELECTORS.floating}, ${SELECTORS.intercomTile}, ${SELECTORS.resultItem}`).forEach((container) => {
        if (container.matches(SELECTORS.floating)) watchFloating(container);
        const anchor = getConsensusSearchAnchor(container);
        if (anchor) anchors.push(anchor);
      });

      const uniqueAnchors = new Set(anchors);
      for (const anchor of uniqueAnchors) {
        const item = extractConsensusSearch(anchor);
        if (!item) continue;
        const card = consensusSearchContainer(anchor);
        insertSearchControl(anchor, card, item);
      }

      const inlineNodes = [];
      if (root.matches(SELECTORS.inlineCitation)) inlineNodes.push(root);
      root.querySelectorAll?.(SELECTORS.inlineCitation).forEach((node) => inlineNodes.push(node));
      for (const prose of new Set(inlineNodes)) {
        if (!isInlineCitation(prose) || prose.closest?.(`[${UI_ATTR}]`)) continue;
        const item = extractConsensusInline(prose);
        if (item) insertInlineControl(prose, item);
      }

      // When a floating card itself is replaced, descendants are added later;
      // this pass also handles its known alternative /papers/ link shape.
      if (root.matches(SELECTORS.intercomTile)) {
        const anchor = getConsensusSearchAnchor(root);
        if (anchor) {
          const item = extractConsensusSearch(anchor);
          if (item) insertSearchControl(anchor, consensusSearchContainer(anchor), item);
        }
      }
    }

    function enqueue(node) {
      if (!isElement(node) || node.closest?.(`[${UI_ATTR}]`)) return;
      pending.add(node);
      if (flushTimer) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = 0;
        scheduleIdleFlush();
      }, 90);
    }

    function scheduleIdleFlush() {
      const run = () => {
        idleToken = 0;
        let count = 0;
        for (const node of pending) {
          pending.delete(node);
          if (node.isConnected) processRoot(node);
          count += 1;
          if (count >= 12) break;
        }
        if (pending.size) scheduleIdleFlush();
      };
      if (idleToken) return;
      if ("requestIdleCallback" in window) idleToken = window.requestIdleCallback(run, { timeout: 800 });
      else idleToken = window.setTimeout(run, 40);
    }

    function scanInitial() {
      const root = document.body || document.documentElement;
      if (!root) return;
      processRoot(root);
      // Only inspect the exact Consensus elements used for result cards and
      // hover previews. Do not sweep generic article, heading, or message nodes.
      root.querySelectorAll(`${SELECTORS.floating}, ${SELECTORS.intercomTile}, ${SELECTORS.resultItem}`).forEach((node) => {
        watchFloating(node);
        enqueue(node);
      });
      root.querySelectorAll(SELECTORS.inlineCitation).forEach((node) => enqueue(node));
    }

    scanInitial();

    const observer = new MutationObserver((records) => {
      const routeNow = location.pathname + location.search;
      if (routeNow !== lastUrl) {
        lastUrl = routeNow;
        if (matchesRoute()) enqueue(document.querySelector("main") || document.body);
      }
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (isElement(removed)) disposeFloating(removed);
        }
        for (const node of record.addedNodes) {
          if (!isElement(node) || node.closest?.(`[${UI_ATTR}]`)) continue;
          if (node.matches(SELECTORS.floating)) watchFloating(node);
          enqueue(node);
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    window.addEventListener("popstate", () => {
      lastUrl = location.pathname + location.search;
      if (matchesRoute()) enqueue(document.querySelector("main") || document.body);
    }, { passive: true });
  }

  function queueCard(card) {
    if (!isElement(card) || card.closest?.(`[${UI_ATTR}]`)) return;
    queuedCards.add(card);
    if (!idleHandle) scheduleIdleFlush();
  }

  function scheduleIdleFlush() {
    const run = () => {
      idleHandle = 0;
      if (!matchesRoute()) return;
      let processedCount = 0;
      for (const card of queuedCards) {
        queuedCards.delete(card);
        if (card.isConnected) mountAction(card);
        processedCount += 1;
        if (processedCount >= MAX_CARDS_PER_IDLE) break;
      }
      if (queuedCards.size) scheduleIdleFlush();
    };
    if ("requestIdleCallback" in window) idleHandle = window.requestIdleCallback(run, { timeout: 1200 });
    else idleHandle = window.setTimeout(run, 50);
  }

  function scanRoot(root) {
    if (!matchesRoute()) return;
    const cards = collectCards(root);
    for (const card of cards) queueCard(card);
  }

  function addPendingRoot(node) {
    if (!isElement(node) || node.closest?.(`[${UI_ATTR}]`)) return;
    // Prefer the closest known result-card ancestor when a small descendant changes.
    let candidate = node;
    for (let parent = node.parentElement, depth = 0; parent && depth < 7; parent = parent.parentElement, depth += 1) {
      if (matchesAny(parent, adapter.cardSelectors || [])) { candidate = parent; break; }
    }
    for (const existing of pendingRoots) {
      if (existing === candidate || existing.contains?.(candidate)) return;
    }
    for (const existing of [...pendingRoots]) {
      if (candidate.contains?.(existing)) pendingRoots.delete(existing);
    }
    pendingRoots.add(candidate);
    // Never fall back to rescanning the whole page on busy SPAs; cap pending
    // roots instead so a burst of framework mutations cannot trigger a large sweep.
    if (pendingRoots.size > MAX_ROOTS) pendingRoots.delete(candidate);
  }

  function schedulePendingScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      const roots = [...pendingRoots];
      pendingRoots.clear();
      for (const root of roots) scanRoot(root);
    }, 420);
  }

  function handleDomChanges(records) {
    const routeNow = location.pathname + location.search;
    if (routeNow !== lastRoute) {
      lastRoute = routeNow;
      collectionCache = null;
      if (matchesRoute()) addPendingRoot(document.querySelector("main") || document.body);
    }
    let sawAdded = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!isElement(node) || node.closest?.(`[${UI_ATTR}]`)) continue;
        addPendingRoot(node);
        sawAdded = true;
      }
      if (isElement(record.target)) {
        const card = record.target.closest?.((adapter.cardSelectors || []).join(","));
        if (card && !card.closest?.(`[${UI_ATTR}]`)) {
          addPendingRoot(card);
          sawAdded = true;
        }
      }
    }
    if (sawAdded || pendingRoots.size) schedulePendingScan();
  }

  // One bounded first pass; later scans are limited to newly inserted subtrees.
  if (matchesRoute()) scanRoot(document.querySelector("main") || document.body);

  const observer = new MutationObserver(handleDomChanges);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", () => {
    lastRoute = location.pathname + location.search;
    collectionCache = null;
    if (matchesRoute()) { addPendingRoot(document.querySelector("main") || document.body); schedulePendingScan(); }
  }, { passive: true });
})();
