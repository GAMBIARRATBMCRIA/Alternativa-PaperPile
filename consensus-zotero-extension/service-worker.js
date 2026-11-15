/* Consensus → Zotero | Manifest V3 service worker
 * API credentials remain in chrome.storage.local and are never sent to the page.
 */

const STORAGE_KEYS = ["apiKey", "userID", "username", "writeAllowed"];
const API_BASE = "https://api.zotero.org";
const CROSSREF_BASE = "https://api.crossref.org/works/";

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
    const err = new Error(`Zotero respondeu ${response.status}: ${detail}`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return { data, response };
}

async function zoteroRequest(path, options = {}, config = null) {
  const cfg = config || await getConfig();
  if (!cfg.apiKey || !cfg.userID) {
    throw new Error("Conecte sua conta Zotero nas configurações da extensão.");
  }
  const headers = apiHeaders(cfg.apiKey, options.headers || {});
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });
  return readResponse(response);
}

async function fetchAllCollections(cfg) {
  const all = [];
  const pageSize = 100;
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const { data, response } = await zoteroRequest(
      `/users/${encodeURIComponent(cfg.userID)}/collections?limit=${pageSize}&start=${start}&sort=title&direction=asc`,
      { method: "GET" },
      cfg
    );
    if (!Array.isArray(data)) break;
    all.push(...data);
    const totalHeader = Number(response.headers.get("Total-Results"));
    total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : all.length;
    if (data.length < pageSize) break;
    start += data.length;
  }

  return all.map((entry) => ({
    key: entry.key || entry.data?.key,
    name: entry.data?.name || entry.name || "Coleção sem nome",
    parentCollection: entry.data?.parentCollection || false
  })).filter((entry) => entry.key);
}

function normalizeDoi(value) {
  if (!value) return "";
  return String(value)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
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

function stripHtml(value) {
  return String(value || "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function enrichFromCrossref(metadata) {
  const doi = normalizeDoi(metadata.DOI || metadata.doi);
  if (!doi) return metadata;

  try {
    const response = await fetch(`${CROSSREF_BASE}${encodeURIComponent(doi)}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    if (!response.ok) return metadata;
    const payload = await response.json();
    const work = payload?.message;
    if (!work) return metadata;

    const enriched = { ...metadata };
    if (!enriched.title && work.title?.[0]) enriched.title = work.title[0];
    if ((!enriched.creators || enriched.creators.length === 0) && Array.isArray(work.author)) {
      enriched.creators = work.author
        .filter((author) => author.family || author.given || author.name)
        .map((author) => ({
          creatorType: "author",
          firstName: author.given || "",
          lastName: author.family || author.name || ""
        }));
    }
    if (!enriched.publicationTitle && work["container-title"]?.[0]) {
      enriched.publicationTitle = work["container-title"][0];
    }
    if (!enriched.date) {
      const dateParts = work["published-print"]?.["date-parts"]?.[0]
        || work["published-online"]?.["date-parts"]?.[0]
        || work.created?.["date-parts"]?.[0];
      if (dateParts?.length) enriched.date = dateParts.join("-");
    }
    if (!enriched.url && work.URL) enriched.url = work.URL;
    if (!enriched.abstractNote && work.abstract) enriched.abstractNote = stripHtml(work.abstract);
    if (work.type === "journal-article") enriched.itemType = "journalArticle";
    return enriched;
  } catch (error) {
    console.warn("Consensus → Zotero: Crossref indisponível; usando os dados do Consensus.", error);
    return metadata;
  }
}

async function findDuplicate(metadata, cfg) {
  const doi = normalizeDoi(metadata.DOI || metadata.doi);
  // Zotero's default quick search is title/creator based. Search by title,
  // then compare the returned DOI field exactly when one is available.
  const query = metadata.title;
  if (!query) return null;

  const params = new URLSearchParams({
    q: query,
    itemType: "-attachment",
    limit: "100",
    format: "json"
  });
  const { data } = await zoteroRequest(
    `/users/${encodeURIComponent(cfg.userID)}/items?${params.toString()}`,
    { method: "GET" },
    cfg
  );
  if (!Array.isArray(data)) return null;

  const wantedTitle = normalizeTitle(metadata.title);
  const match = data.find((entry) => {
    const item = entry.data || entry;
    const existingDoi = normalizeDoi(item.DOI);
    if (doi && existingDoi === doi) return true;
    if (doi && existingDoi && existingDoi !== doi) return false;
    return wantedTitle && normalizeTitle(item.title) === wantedTitle;
  });
  if (!match) return null;
  return {
    key: match.key || match.data?.key,
    title: match.data?.title || metadata.title,
    url: match.links?.alternate?.href || `https://www.zotero.org/users/${cfg.userID}/items/${match.key || match.data?.key}`
  };
}

function cleanCreators(creators) {
  if (!Array.isArray(creators)) return [];
  return creators
    .filter((creator) => creator && (creator.lastName || creator.name))
    .map((creator) => ({
      creatorType: "author",
      ...(creator.name
        ? { name: String(creator.name).trim() }
        : {
            firstName: String(creator.firstName || "").trim(),
            lastName: String(creator.lastName || "").trim()
          })
    }))
    .slice(0, 30);
}

async function saveItem(message) {
  const cfg = await getConfig();
  if (!cfg.apiKey || !cfg.userID) {
    throw new Error("Primeiro conecte sua conta Zotero no menu da extensão.");
  }
  if (cfg.writeAllowed === false) {
    throw new Error("A chave do Zotero não possui permissão de escrita na biblioteca pessoal.");
  }

  const input = message.item || {};
  const title = String(input.title || "").trim();
  if (title.length < 5) throw new Error("Não consegui identificar um título válido neste resultado.");

  let item = {
    itemType: "journalArticle",
    title,
    creators: cleanCreators(input.creators),
    date: String(input.date || "").trim(),
    DOI: normalizeDoi(input.doi),
    publicationTitle: String(input.publicationTitle || "").trim(),
    abstractNote: String(input.abstractNote || "").trim(),
    url: String(input.url || locationSafeUrl(message.pageUrl) || "").trim(),
    language: String(input.language || "").trim(),
    tags: [{ tag: "Consensus" }],
    collections: message.collectionKey ? [String(message.collectionKey)] : []
  };
  item = await enrichFromCrossref(item);
  item.creators = cleanCreators(item.creators);
  item.DOI = normalizeDoi(item.DOI);

  const duplicate = await findDuplicate(item, cfg);
  if (duplicate) return { status: "duplicate", duplicate };

  // Zotero recommends starting from its editable item template.
  const templateParams = new URLSearchParams({ itemType: item.itemType });
  const { data: template } = await zoteroRequest(
    `/items/new?${templateParams.toString()}`,
    { method: "GET" },
    cfg
  );
  const payload = {
    ...(template || {}),
    ...item,
    tags: [{ tag: "Consensus" }],
    collections: message.collectionKey ? [String(message.collectionKey)] : []
  };

  const writeToken = crypto.randomUUID().replace(/-/g, "");
  const { data: result } = await zoteroRequest(
    `/users/${encodeURIComponent(cfg.userID)}/items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Zotero-Write-Token": writeToken
      },
      body: JSON.stringify([payload])
    },
    cfg
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
    title,
    url: `https://www.zotero.org/users/${cfg.userID}/items/${key}`
  };
}

function locationSafeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

async function connect(apiKey) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("Informe sua Zotero API Key.");

  const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(cleanKey)}`, {
    headers: {
      "Zotero-API-Version": "3",
      "Accept": "application/json"
    },
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

  // Validate access to the personal library before persisting credentials.
  await fetchAllCollections(config);
  await chrome.storage.local.set(config);
  return {
    connected: true,
    userID: config.userID,
    username: config.username,
    writeAllowed: config.writeAllowed
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "CONNECT":
        return await connect(message.apiKey);
      case "DISCONNECT":
        await chrome.storage.local.remove(STORAGE_KEYS);
        return { disconnected: true };
      case "GET_STATUS": {
        const cfg = await getConfig();
        return {
          connected: Boolean(cfg.apiKey && cfg.userID),
          userID: cfg.userID || null,
          username: cfg.username || null,
          writeAllowed: cfg.writeAllowed !== false
        };
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
