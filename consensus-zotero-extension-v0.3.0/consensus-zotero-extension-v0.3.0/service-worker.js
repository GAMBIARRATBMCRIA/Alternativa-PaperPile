/* Consensus → Zotero | Manifest V3 service worker
 * Zotero credentials stay in chrome.storage.local and are never passed to sites.
 */

const STORAGE_KEYS = ["apiKey", "userID", "username", "writeAllowed", "defaultCollectionKey", "defaultCollectionName"];
const API_BASE = "https://api.zotero.org";
const CROSSREF_BASE = "https://api.crossref.org/works";
const VALID_ITEM_TYPES = new Set(["journalArticle", "conferencePaper", "preprint"]);
const templateCache = new Map();
let collectionsCache = { at: 0, userID: "", items: [] };
if (chrome.storage?.local?.setAccessLevel) {
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
}


async function getConfig() {
  return chrome.storage.local.get(STORAGE_KEYS);
}

function apiHeaders(apiKey, extra = {}) {
  return {
    "Zotero-API-Key": apiKey,
    "Zotero-API-Version": "3",
    "Accept": "application/json",
    ...extra
  };
}

async function readResponse(response) {
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = raw; }
  }
  if (!response.ok) {
    const detail = typeof data === "string"
      ? data
      : (data?.message || data?.error || JSON.stringify(data || {}));
    const error = new Error(`Zotero respondeu ${response.status}: ${detail}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return { data, response };
}

async function zoteroRequest(path, options = {}, config = null) {
  const cfg = config || await getConfig();
  if (!cfg.apiKey || !cfg.userID) throw new Error("Conecte sua conta Zotero nas configurações da extensão.");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: apiHeaders(cfg.apiKey, options.headers || {}),
    cache: "no-store"
  });
  return readResponse(response);
}

async function fetchAllCollections(cfg, force = false) {
  if (!force && collectionsCache.userID === cfg.userID && Date.now() - collectionsCache.at < 120000) {
    return collectionsCache.items;
  }
  const all = [];
  const pageSize = 100;
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const { data, response } = await zoteroRequest(
      `/users/${encodeURIComponent(cfg.userID)}/collections?limit=${pageSize}&start=${start}&sort=title&direction=asc`,
      { method: "GET" }, cfg
    );
    if (!Array.isArray(data)) break;
    all.push(...data);
    const totalHeader = Number(response.headers.get("Total-Results"));
    total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : all.length;
    if (data.length < pageSize) break;
    start += data.length;
  }
  const mapped = all.map((entry) => ({
    key: entry.key || entry.data?.key,
    name: entry.data?.name || entry.name || "Coleção sem nome",
    parentCollection: entry.data?.parentCollection || false
  })).filter((entry) => entry.key);
  collectionsCache = { at: Date.now(), userID: cfg.userID, items: mapped };
  return mapped;
}

function normalizeDoi(value) {
  return String(value || "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .replace(/[\s.,;]+$/g, "")
    .toLowerCase();
}

function normalizeTitle(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSimilarity(a, b) {
  const left = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const right = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function crossrefDate(work) {
  const dateParts = work?.["published-print"]?.["date-parts"]?.[0]
    || work?.["published-online"]?.["date-parts"]?.[0]
    || work?.created?.["date-parts"]?.[0];
  return Array.isArray(dateParts) && dateParts.length ? dateParts.join("-") : "";
}

function applyCrossrefWork(metadata, work) {
  const enriched = { ...metadata };
  const crossrefType = String(work?.type || "").toLowerCase();
  if (crossrefType === "proceedings-article") {
    enriched.itemType = "conferencePaper";
    enriched.proceedingsTitle ||= enriched.publicationTitle || "";
  } else if (crossrefType === "posted-content") {
    enriched.itemType = "preprint";
  } else if (crossrefType === "journal-article") {
    enriched.itemType = "journalArticle";
    enriched.publicationTitle ||= enriched.proceedingsTitle || "";
  }

  if (!enriched.title && work?.title?.[0]) enriched.title = work.title[0];
  if ((!Array.isArray(enriched.creators) || !enriched.creators.length) && Array.isArray(work?.author)) {
    enriched.creators = work.author
      .filter((author) => author.family || author.given || author.name)
      .map((author) => ({
        creatorType: "author",
        ...(author.name ? { name: author.name } : {
          firstName: author.given || "",
          lastName: author.family || ""
        })
      }));
  }
  const container = work?.["container-title"]?.[0] || "";
  if (container) {
    if (enriched.itemType === "conferencePaper") enriched.proceedingsTitle ||= container;
    else enriched.publicationTitle ||= container;
  }
  enriched.date ||= crossrefDate(work);
  enriched.url ||= work?.URL || "";
  enriched.abstractNote ||= work?.abstract ? stripHtml(work.abstract) : "";
  enriched.DOI ||= work?.DOI || "";
  enriched.volume ||= work?.volume || "";
  enriched.issue ||= work?.issue || "";
  enriched.pages ||= work?.page || "";
  enriched.publisher ||= work?.publisher || "";
  if (Array.isArray(work?.ISSN) && work.ISSN.length) enriched.ISSN ||= work.ISSN[0];
  return enriched;
}

async function enrichFromCrossref(metadata) {
  let work = null;
  const doi = normalizeDoi(metadata.DOI || metadata.doi);
  try {
    if (doi) {
      const response = await fetch(`${CROSSREF_BASE}/${encodeURIComponent(doi)}`, {
        headers: { "Accept": "application/json" }, cache: "no-store"
      });
      if (response.ok) work = (await response.json())?.message || null;
    } else if (metadata.title) {
      // Only enrich on an explicit save action, never while browsing/searching.
      const params = new URLSearchParams({ "query.title": metadata.title, rows: "3" });
      const response = await fetch(`${CROSSREF_BASE}?${params.toString()}`, {
        headers: { "Accept": "application/json" }, cache: "no-store"
      });
      if (response.ok) {
        const payload = await response.json();
        const candidates = payload?.message?.items || [];
        const match = candidates
          .map((candidate) => ({ candidate, score: titleSimilarity(metadata.title, candidate.title?.[0] || "") }))
          .sort((a, b) => b.score - a.score)[0];
        if (match && match.score >= 0.92) work = match.candidate;
      }
    }
  } catch (error) {
    console.warn("Consensus → Zotero: Crossref indisponível; mantendo os metadados extraídos da página.", error);
  }
  return work ? applyCrossrefWork(metadata, work) : metadata;
}

async function findDuplicate(metadata, cfg) {
  const query = metadata.title;
  if (!query) return null;
  const params = new URLSearchParams({ q: query, itemType: "-attachment", limit: "100", format: "json" });
  const { data } = await zoteroRequest(
    `/users/${encodeURIComponent(cfg.userID)}/items?${params.toString()}`,
    { method: "GET" }, cfg
  );
  if (!Array.isArray(data)) return null;
  const wantedDoi = normalizeDoi(metadata.DOI);
  const wantedTitle = normalizeTitle(metadata.title);
  const match = data.find((entry) => {
    const item = entry.data || entry;
    const existingDoi = normalizeDoi(item.DOI);
    if (wantedDoi && existingDoi) return wantedDoi === existingDoi;
    return wantedTitle && wantedTitle === normalizeTitle(item.title);
  });
  if (!match) return null;
  const key = match.key || match.data?.key;
  return {
    key,
    title: match.data?.title || metadata.title,
    url: match.links?.alternate?.href || `https://www.zotero.org/users/${encodeURIComponent(cfg.userID)}/items/${key}`
  };
}

function cleanCreators(creators) {
  if (!Array.isArray(creators)) return [];
  return creators
    .filter((creator) => creator && (creator.lastName || creator.name))
    .map((creator) => ({
      creatorType: creator.creatorType || "author",
      ...(creator.name
        ? { name: String(creator.name).trim() }
        : {
          firstName: String(creator.firstName || "").trim(),
          lastName: String(creator.lastName || "").trim()
        })
    }))
    .slice(0, 30);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function normalizeFieldsForType(item) {
  if (item.itemType === "conferencePaper") {
    item.proceedingsTitle ||= item.publicationTitle || "";
    delete item.publicationTitle;
    delete item.volume;
    delete item.issue;
    delete item.ISSN;
    delete item.repository;
    delete item.archiveID;
  } else if (item.itemType === "preprint") {
    delete item.publicationTitle;
    delete item.proceedingsTitle;
    delete item.conferenceName;
    delete item.place;
    delete item.volume;
    delete item.issue;
    delete item.ISSN;
    delete item.pages;
  } else {
    item.publicationTitle ||= item.proceedingsTitle || "";
    delete item.proceedingsTitle;
    delete item.conferenceName;
    delete item.place;
    delete item.repository;
    delete item.archiveID;
  }
  return item;
}

function buildItem(input, source, collectionKey) {
  const requestedType = String(input.itemType || "journalArticle");
  const itemType = VALID_ITEM_TYPES.has(requestedType) ? requestedType : "journalArticle";
  const item = {
    itemType,
    title: String(input.title || "").trim(),
    creators: cleanCreators(input.creators),
    date: String(input.date || "").trim(),
    DOI: normalizeDoi(input.DOI || input.doi),
    abstractNote: String(input.abstractNote || "").trim(),
    url: safeUrl(input.url),
    language: String(input.language || "").trim(),
    tags: [{ tag: String(source || input.source || "Academic Web Import").slice(0, 80) }],
    collections: collectionKey ? [String(collectionKey)] : []
  };
  if (itemType === "conferencePaper") {
    item.proceedingsTitle = String(input.proceedingsTitle || input.publicationTitle || "").trim();
    item.conferenceName = String(input.conferenceName || "").trim();
    item.publisher = String(input.publisher || "").trim();
    item.place = String(input.place || "").trim();
    item.pages = String(input.pages || "").trim();
  } else if (itemType === "journalArticle") {
    item.publicationTitle = String(input.publicationTitle || "").trim();
    item.volume = String(input.volume || "").trim();
    item.issue = String(input.issue || "").trim();
    item.pages = String(input.pages || "").trim();
    item.ISSN = String(input.ISSN || "").trim();
  } else if (itemType === "preprint") {
    item.repository = String(input.repository || input.publisher || "").trim();
    item.archiveID = String(input.archiveID || "").trim();
  }
  return item;
}

async function getItemTemplate(itemType, cfg) {
  const cached = templateCache.get(itemType);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.data;
  const params = new URLSearchParams({ itemType });
  const { data } = await zoteroRequest(`/items/new?${params.toString()}`, { method: "GET" }, cfg);
  templateCache.set(itemType, { at: Date.now(), data });
  return data || {};
}

async function saveItem(message) {
  const cfg = await getConfig();
  if (!cfg.apiKey || !cfg.userID) throw new Error("Primeiro conecte sua conta Zotero no menu da extensão.");
  if (cfg.writeAllowed === false) throw new Error("A chave do Zotero não possui permissão de escrita na biblioteca pessoal.");

  const selectedCollectionKey = message.collectionKey === undefined
    ? (cfg.defaultCollectionKey || "")
    : String(message.collectionKey || "");
  if (selectedCollectionKey) {
    const collections = await fetchAllCollections(cfg);
    if (!collections.some((entry) => entry.key === selectedCollectionKey)) {
      throw new Error("A coleção selecionada não foi encontrada na sua biblioteca Zotero. Atualize as coleções nas opções da extensão.");
    }
  }
  let item = buildItem(message.item || {}, message.source, selectedCollectionKey);
  if (item.title.length < 5) throw new Error("Não consegui identificar um título válido neste resultado.");
  item = await enrichFromCrossref(item);
  item = normalizeFieldsForType(item);
  item.creators = cleanCreators(item.creators);
  item.DOI = normalizeDoi(item.DOI);
  item.url = safeUrl(item.url) || (item.DOI ? `https://doi.org/${item.DOI}` : safeUrl(message.pageUrl));

  const duplicate = await findDuplicate(item, cfg);
  if (duplicate) return { status: "duplicate", duplicate };

  const template = await getItemTemplate(item.itemType, cfg);
  const payload = {
    ...template,
    ...item,
    tags: item.tags,
    collections: item.collections
  };
  const writeToken = crypto.randomUUID().replace(/-/g, "");
  const { data: result } = await zoteroRequest(
    `/users/${encodeURIComponent(cfg.userID)}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Zotero-Write-Token": writeToken },
      body: JSON.stringify([payload])
    }, cfg
  );
  const key = result?.successful?.["0"];
  if (!key) {
    const failure = result?.failed?.["0"];
    const reason = failure?.message || failure?.error || JSON.stringify(failure || result || {});
    throw new Error(`O Zotero não confirmou a gravação: ${reason}`);
  }
  return {
    status: "saved",
    key,
    title: item.title,
    url: `https://www.zotero.org/users/${encodeURIComponent(cfg.userID)}/items/${key}`
  };
}

async function connect(apiKey) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("Informe sua Zotero API Key.");
  const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(cleanKey)}`, {
    headers: { "Zotero-API-Version": "3", "Accept": "application/json" },
    cache: "no-store"
  });
  const { data: keyInfo } = await readResponse(response);
  const userID = keyInfo?.userID;
  if (!userID) throw new Error("A API não retornou o ID da sua biblioteca pessoal.");
  const libraryAccess = keyInfo?.access?.user?.library;
  if (libraryAccess?.write === false) {
    throw new Error("Esta chave não tem permissão de escrita. Crie outra chave com acesso de leitura e escrita à biblioteca pessoal.");
  }
  const config = {
    apiKey: cleanKey,
    userID: String(userID),
    username: String(keyInfo?.username || "Usuário Zotero"),
    writeAllowed: libraryAccess?.write !== false
  };
  const availableCollections = await fetchAllCollections(config, true);
  const previous = await chrome.storage.local.get(["userID", "defaultCollectionKey", "defaultCollectionName"]);
  const sameAccount = String(previous.userID || "") === config.userID;
  const retainedCollection = sameAccount && previous.defaultCollectionKey
    ? availableCollections.find((entry) => entry.key === previous.defaultCollectionKey)
    : null;
  await chrome.storage.local.set({
    ...config,
    defaultCollectionKey: retainedCollection?.key || "",
    defaultCollectionName: retainedCollection?.name || "Biblioteca principal"
  });
  return { connected: true, userID: config.userID, username: config.username, writeAllowed: config.writeAllowed };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "CONNECT":
        return await connect(message.apiKey);
      case "DISCONNECT":
        await chrome.storage.local.remove(STORAGE_KEYS);
        collectionsCache = { at: 0, userID: "", items: [] };
        templateCache.clear();
        return { disconnected: true };
      case "GET_STATUS": {
        const cfg = await getConfig();
        return {
          connected: Boolean(cfg.apiKey && cfg.userID),
          userID: cfg.userID || null,
          username: cfg.username || null,
          writeAllowed: cfg.writeAllowed !== false,
          defaultCollectionKey: cfg.defaultCollectionKey || "",
          defaultCollectionName: cfg.defaultCollectionName || "Biblioteca principal"
        };
      }
      case "GET_SETTINGS": {
        const cfg = await getConfig();
        if (!cfg.apiKey || !cfg.userID) throw new Error("Conecte sua conta Zotero nas opções da extensão.");
        return {
          defaultCollectionKey: cfg.defaultCollectionKey || "",
          defaultCollectionName: cfg.defaultCollectionName || "Biblioteca principal"
        };
      }
      case "SET_DEFAULT_COLLECTION": {
        const cfg = await getConfig();
        if (!cfg.apiKey || !cfg.userID) throw new Error("Conecte sua conta Zotero nas opções da extensão.");
        const collectionKey = String(message.collectionKey || "");
        const collections = await fetchAllCollections(cfg);
        const chosen = collectionKey ? collections.find((entry) => entry.key === collectionKey) : null;
        if (collectionKey && !chosen) throw new Error("A coleção selecionada não existe na biblioteca pessoal.");
        const defaultCollectionName = chosen?.name || "Biblioteca principal";
        await chrome.storage.local.set({ defaultCollectionKey: collectionKey, defaultCollectionName });
        return { saved: true, defaultCollectionKey: collectionKey, defaultCollectionName };
      }
      case "GET_COLLECTIONS": {
        const cfg = await getConfig();
        if (!cfg.apiKey || !cfg.userID) throw new Error("Conecte sua conta Zotero no popup da extensão.");
        return { collections: await fetchAllCollections(cfg) };
      }
      case "SAVE_ITEM":
        return await saveItem(message);
      default:
        throw new Error("Comando desconhecido.");
    }
  })().then(sendResponse).catch((error) => {
    sendResponse({ error: error?.message || "Erro inesperado." });
  });
  return true;
});
