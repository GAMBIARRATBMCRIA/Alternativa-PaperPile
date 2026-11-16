/* Consensus → Zotero | Manifest V3 service worker
 * Zotero credentials stay in chrome.storage.local and are never passed to sites.
 */

const STORAGE_KEYS = ["apiKey", "userID", "username", "writeAllowed", "defaultCollectionKey", "defaultCollectionName"];
const API_BASE = "https://api.zotero.org";
const CROSSREF_BASE = "https://api.crossref.org/works";
const VALID_ITEM_TYPES = new Set(["journalArticle", "conferencePaper", "preprint"]);
const templateCache = new Map();
let collectionsCache = { at: 0, userID: "", items: [] };
const LIBRARY_INDEX_KEY = "zoteroLibraryIndexV1";
const LIBRARY_INDEX_TTL_MS = 5 * 60 * 1000;
let libraryIndexState = null;
let libraryIndexPromise = null;
let libraryIndexRetryAfter = 0;
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

function firstCreatorSignature(creators) {
  if (!Array.isArray(creators) || !creators.length) return "";
  const first = creators.find((creator) => creator && (creator.lastName || creator.name));
  if (!first) return "";
  return normalizeTitle(first.lastName || first.name || "");
}

function publicationYear(value) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function compactLibraryItem(entry, userID) {
  const data = entry?.data || entry || {};
  const key = entry?.key || data.key;
  if (!key || !data.title) return null;
  return {
    key,
    title: String(data.title),
    doi: normalizeDoi(data.DOI),
    year: publicationYear(data.date),
    firstAuthor: firstCreatorSignature(data.creators)
  };
}

function findIndexedDuplicate(metadata, entries) {
  const wantedDoi = normalizeDoi(metadata.DOI || metadata.doi);
  const wantedTitle = normalizeTitle(metadata.title);
  if (!wantedDoi && !wantedTitle) return null;
  const wantedYear = publicationYear(metadata.date);
  const wantedAuthor = firstCreatorSignature(metadata.creators);

  // DOI is the strongest identifier and takes precedence over title matching.
  if (wantedDoi) {
    const doiMatch = entries.find((entry) => entry.doi && entry.doi === wantedDoi);
    if (doiMatch) return doiMatch;
  }
  if (!wantedTitle) return null;

  return entries.find((entry) => {
    if (normalizeTitle(entry.title) !== wantedTitle) return false;
    // Do not label different DOI records as the same work merely because
    // their titles happen to match (e.g. preprint vs. published version).
    if (wantedDoi && entry.doi && wantedDoi !== entry.doi) return false;
    if (wantedYear && entry.year && Math.abs(wantedYear - entry.year) > 1) return false;
    if (wantedAuthor && entry.firstAuthor && wantedAuthor !== entry.firstAuthor) return false;
    return true;
  }) || null;
}

function indexMatchesMessage(item, entries, userID) {
  const match = findIndexedDuplicate(item || {}, entries);
  return match ? {
    key: match.key,
    title: match.title,
    url: `https://www.zotero.org/users/${encodeURIComponent(userID)}/items/${match.key}`
  } : null;
}

async function readLibraryPage(path, cfg) {
  return zoteroRequest(path, { method: "GET" }, cfg);
}

async function fetchFullLibraryIndex(cfg) {
  const entries = [];
  const pageSize = 100;
  let start = 0;
  let total = Infinity;
  let baseVersion = null;
  while (start < total) {
    const params = new URLSearchParams({ format: "json", limit: String(pageSize), start: String(start) });
    const { data, response } = await readLibraryPage(
      `/users/${encodeURIComponent(cfg.userID)}/items/top?${params.toString()}`,
      cfg
    );
    if (!Array.isArray(data)) break;
    if (baseVersion === null) baseVersion = Number(response.headers.get("Last-Modified-Version")) || 0;
    entries.push(...data.map((entry) => compactLibraryItem(entry, cfg.userID)).filter(Boolean));
    const totalHeader = Number(response.headers.get("Total-Results"));
    total = Number.isFinite(totalHeader) && totalHeader >= 0 ? totalHeader : entries.length;
    if (data.length < pageSize) break;
    start += data.length;
  }
  return {
    userID: String(cfg.userID),
    version: baseVersion || 0,
    fetchedAt: Date.now(),
    entries
  };
}

async function fetchItemsByKeys(keys, cfg) {
  const updated = [];
  for (let offset = 0; offset < keys.length; offset += 50) {
    const chunk = keys.slice(offset, offset + 50);
    if (!chunk.length) continue;
    const params = new URLSearchParams({ itemKey: chunk.join(","), format: "json", includeTrashed: "1" });
    const { data } = await readLibraryPage(
      `/users/${encodeURIComponent(cfg.userID)}/items?${params.toString()}`,
      cfg
    );
    if (Array.isArray(data)) updated.push(...data);
  }
  return updated;
}

async function refreshLibraryIndex(previous, cfg) {
  if (!previous || previous.userID !== String(cfg.userID) || previous.version === undefined || previous.version === null) {
    return fetchFullLibraryIndex(cfg);
  }

  const since = String(previous.version);
  const basePath = `/users/${encodeURIComponent(cfg.userID)}`;
  const [versionsResult, deletedResult] = await Promise.all([
    readLibraryPage(`${basePath}/items/top?${new URLSearchParams({ since, format: "versions", includeTrashed: "1" }).toString()}`, cfg),
    readLibraryPage(`${basePath}/deleted?${new URLSearchParams({ since }).toString()}`, cfg)
  ]);

  const changedKeys = Object.keys(versionsResult.data || {});
  const deletedKeys = Array.isArray(deletedResult.data?.items) ? deletedResult.data.items : [];
  const updatedItems = await fetchItemsByKeys(changedKeys, cfg);
  const entryMap = new Map((previous.entries || []).map((entry) => [entry.key, entry]));

  for (const key of deletedKeys) entryMap.delete(key);
  for (const item of updatedItems) {
    const compact = compactLibraryItem(item, cfg.userID);
    const key = item?.key || item?.data?.key;
    if (!compact || item?.data?.deleted || item?.deleted) {
      if (key) entryMap.delete(key);
    } else {
      entryMap.set(compact.key, compact);
    }
  }

  // Keep the earlier version boundary if the library changed between the
  // versions and deleted-item requests; the next sync will safely catch up.
  const headers = [
    Number(versionsResult.response.headers.get("Last-Modified-Version")),
    Number(deletedResult.response.headers.get("Last-Modified-Version"))
  ].filter((value) => Number.isFinite(value) && value > 0);
  const version = headers.length ? Math.min(...headers) : previous.version;

  return {
    userID: String(cfg.userID),
    version,
    fetchedAt: Date.now(),
    entries: [...entryMap.values()]
  };
}

async function getLibraryIndex(cfg, forceRefresh = false) {
  if (libraryIndexPromise) return libraryIndexPromise;
  libraryIndexPromise = (async () => {
    let current = libraryIndexState;
    if (!current || current.userID !== String(cfg.userID)) {
      const stored = await chrome.storage.local.get([LIBRARY_INDEX_KEY]);
      current = stored[LIBRARY_INDEX_KEY] || null;
    }
    if (!current && Date.now() < libraryIndexRetryAfter) {
      throw new Error("A consulta ao Zotero está temporariamente indisponível. Tente novamente em instantes.");
    }
    if (!forceRefresh && current?.userID === String(cfg.userID) &&
        Date.now() - Number(current.fetchedAt || 0) < LIBRARY_INDEX_TTL_MS) {
      libraryIndexState = current;
      return current;
    }

    let refreshed;
    try {
      refreshed = await refreshLibraryIndex(current, cfg);
    } catch (error) {
      // If a previous index exists, a temporary connection/API error should
      // not erase it. Surface the error only when no usable index is available.
      if (current?.userID === String(cfg.userID) && Array.isArray(current.entries)) {
        console.warn("Consensus → Zotero: usando índice local ainda disponível após falha de atualização.", error);
        libraryIndexState = { ...current, fetchedAt: Date.now(), refreshFailed: true };
        return libraryIndexState;
      }
      libraryIndexRetryAfter = Date.now() + 60 * 1000;
      throw error;
    }
    libraryIndexRetryAfter = 0;
    libraryIndexState = refreshed;
    try {
      await chrome.storage.local.set({ [LIBRARY_INDEX_KEY]: refreshed });
    } catch (storageError) {
      console.warn("Consensus → Zotero: índice mantido apenas em memória; armazenamento local indisponível.", storageError);
    }
    return refreshed;
  })().finally(() => { libraryIndexPromise = null; });
  return libraryIndexPromise;
}

async function findDuplicate(metadata, cfg) {
  const index = await getLibraryIndex(cfg, true);
  if (index.refreshFailed) {
    throw new Error("Não foi possível confirmar se a referência já existe no Zotero. Tente salvar novamente quando a conexão voltar.");
  }
  return indexMatchesMessage(metadata, index.entries || [], cfg.userID);
}

async function checkExistingItems(message) {
  const cfg = await getConfig();
  if (!cfg.apiKey || !cfg.userID) return { connected: false, matches: [] };
  const items = Array.isArray(message.items) ? message.items.slice(0, 100) : [];
  if (!items.length) return { connected: true, matches: [] };
  const index = await getLibraryIndex(cfg, false);
  return {
    connected: true,
    matches: items.map((item) => indexMatchesMessage(item, index.entries || [], cfg.userID))
  };
}

async function rememberSavedItem(item, key, cfg, url) {
  if (!key) return;
  try {
    const stored = libraryIndexState?.userID === String(cfg.userID)
      ? libraryIndexState
      : (await chrome.storage.local.get([LIBRARY_INDEX_KEY]))[LIBRARY_INDEX_KEY];
    const entry = compactLibraryItem({ key, data: { ...item, key }, links: { alternate: { href: url } } }, cfg.userID);
    if (!entry) return;
    const state = stored?.userID === String(cfg.userID)
      ? stored
      : { userID: String(cfg.userID), version: 0, fetchedAt: 0, entries: [] };
    const entries = new Map((state.entries || []).map((existing) => [existing.key, existing]));
    entries.set(key, entry);
    const updated = { ...state, fetchedAt: Date.now(), entries: [...entries.values()] };
    libraryIndexState = updated;
    await chrome.storage.local.set({ [LIBRARY_INDEX_KEY]: updated });
  } catch (storageError) {
    console.warn("Consensus → Zotero: item salvo, mas índice não pôde ser atualizado localmente.", storageError);
  }
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
  const savedUrl = `https://www.zotero.org/users/${encodeURIComponent(cfg.userID)}/items/${key}`;
  await rememberSavedItem(item, key, cfg, savedUrl);
  return {
    status: "saved",
    key,
    title: item.title,
    url: savedUrl
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
  if (!sameAccount) {
    libraryIndexState = null;
    libraryIndexRetryAfter = 0;
    await chrome.storage.local.remove(LIBRARY_INDEX_KEY);
  }
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
        await chrome.storage.local.remove([...STORAGE_KEYS, LIBRARY_INDEX_KEY]);
        collectionsCache = { at: 0, userID: "", items: [] };
        libraryIndexState = null;
        libraryIndexRetryAfter = 0;
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
      case "CHECK_ITEMS":
        return await checkExistingItems(message);
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
