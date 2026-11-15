/* Consensus → Zotero content script.
 * The Paperpile archive informed the supported Consensus search-route pattern;
 * this implementation uses independent selectors and original extraction code.
 */

(() => {
  "use strict";

  const ROOT_ATTR = "data-consensus-zotero-mounted";
  const SEARCH_ROUTE = /^\/search\/[^/]+\/(?!new\/)[A-Za-z0-9_-]+\/?$/i;
  const EXCLUDED_TITLES = /^(consensus|search results|results|related papers|references|consensus meter)$/i;
  let scanTimer = null;

  function isSupportedRoute() {
    return SEARCH_ROUTE.test(window.location.pathname);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getTitleCandidates() {
    return [...document.querySelectorAll("h2, h3, h4, [role='heading'][aria-level='2'], [role='heading'][aria-level='3']")]
      .filter((element) => {
        if (element.closest("[data-cz-ui-root]")) return false;
        const text = cleanText(element.innerText || element.textContent);
        return text.length >= 18 && text.length <= 320 && !EXCLUDED_TITLES.test(text);
      });
  }

  function countHeadings(element) {
    return element.querySelectorAll("h1, h2, h3, h4, [role='heading']").length;
  }

  function findCardRoot(heading) {
    const title = cleanText(heading.innerText || heading.textContent);
    let node = heading.parentElement;
    let fallback = node;
    let depth = 0;

    while (node && node !== document.body && depth < 8) {
      const text = cleanText(node.innerText || node.textContent);
      const titleCount = countHeadings(node);
      const lengthOkay = text.length >= title.length + 18 && text.length <= 3600;
      const metadataHint = /\b(?:19|20)\d{2}\b|\bdoi\b|journal|authors?|citations?|references?|published/i.test(text);
      const hasUsefulLink = [...node.querySelectorAll("a[href]")].some((a) => {
        try {
          const url = new URL(a.href);
          return url.protocol === "https:" && !url.hostname.endsWith("consensus.app");
        } catch { return false; }
      });

      if (lengthOkay && titleCount === 1 && depth >= 1 && (metadataHint || hasUsefulLink || depth >= 3)) {
        return node;
      }
      fallback = node;
      node = node.parentElement;
      depth += 1;
    }
    return fallback || heading.parentElement;
  }

  function extractDoi(text, root) {
    const hrefs = [...root.querySelectorAll("a[href]")].map((a) => a.href).join(" ");
    const match = `${text} ${hrefs}`.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi\s*:\s*)?(10\.\d{4,9}\/[\-._;()/:A-Z0-9]+)/i);
    if (!match) return "";
    return match[1].replace(/[\s.,;]+$/g, "");
  }

  function extractCreators(root) {
    const selectors = [
      '[data-testid*="author" i]',
      '[class*="author-name" i]',
      '[class*="authors" i]',
      '[class*="author" i]'
    ];
    const nodes = selectors.flatMap((selector) => [...root.querySelectorAll(selector)]);
    const unique = [...new Set(nodes)].filter((node) => {
      const text = cleanText(node.innerText || node.textContent);
      return text.length > 1 && text.length < 500 && !node.closest("[data-cz-ui-root]");
    });
    const raw = unique.map((node) => cleanText(node.innerText || node.textContent)).join(", ");
    if (!raw) return [];

    const seen = new Set();
    return raw
      .split(/\s*[;,]\s*/)
      .map((name) => name.replace(/\bet al\.?\b/ig, "").trim())
      .filter((name) => {
        const key = name.toLocaleLowerCase();
        if (name.length <= 1 || name.length >= 100 || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20)
      .map((name) => {
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length === 1) return { creatorType: "author", lastName: parts[0] };
        return { creatorType: "author", firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
      });
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = cleanText(element?.innerText || element?.textContent);
      if (value && value.length < 1200) return value;
    }
    return "";
  }

  function extractPaper(heading, root) {
    const title = cleanText(heading.innerText || heading.textContent);
    const text = cleanText(root.innerText || root.textContent);
    const doi = extractDoi(text, root);
    const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
    const articleLink = [...root.querySelectorAll("a[href]")].map((a) => a.href).find((href) => {
      try {
        const url = new URL(href);
        return url.protocol === "https:" && !url.hostname.endsWith("consensus.app") && !/google\.|facebook\.|twitter\./i.test(url.hostname);
      } catch { return false; }
    });
    const summary = firstText(root, [
      '[data-testid*="abstract" i]',
      '[class*="abstract" i]'
    ]);
    const journal = firstText(root, [
      '[data-testid*="journal" i]',
      '[class*="journal" i]',
      '[class*="publication" i]',
      '[class*="source" i]'
    ]);

    return {
      title,
      doi,
      date: yearMatch ? yearMatch[1] : "",
      creators: extractCreators(root),
      publicationTitle: journal,
      abstractNote: summary,
      url: articleLink || (doi ? `https://doi.org/${doi}` : window.location.href)
    };
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

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mountCardAction(heading, root) {
    if (!root || root.querySelector(`[${ROOT_ATTR}]`)) return;
    if (root.closest("[data-cz-ui-root]")) return;

    const item = extractPaper(heading, root);
    if (!item.title || item.title.length < 5) return;

    const mount = document.createElement("div");
    mount.setAttribute(ROOT_ATTR, "true");
    mount.style.display = "block";
    mount.style.margin = "8px 0 4px";
    const shadow = mount.attachShadow({ mode: "open" });

    const style = element("style");
    style.textContent = `
      :host { all: initial; display: block; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      .toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      button { border:1px solid #b8c9e8; border-radius:7px; padding:6px 10px; background:#f5f8ff; color:#214c9b; font:600 12px/1.2 Inter,system-ui,sans-serif; cursor:pointer; }
      button:hover { background:#eaf0ff; border-color:#86a2d8; }
      button:disabled { opacity:.6; cursor:wait; }
      .panel { display:none; margin-top:8px; padding:10px; max-width:360px; border:1px solid #dbe3ef; border-radius:9px; background:#fff; color:#17212b; box-shadow:0 4px 14px rgba(20,35,60,.10); }
      .panel.open { display:block; }
      .label { display:block; margin-bottom:6px; color:#364152; font:600 11px/1.3 Inter,system-ui,sans-serif; }
      select { width:100%; min-height:32px; border:1px solid #cbd5e1; border-radius:6px; padding:5px 7px; background:#fff; color:#17212b; font:12px Inter,system-ui,sans-serif; }
      .save { margin-top:8px; background:#315fbc; color:white; border-color:#315fbc; }
      .save:hover { background:#264f9f; }
      .note { margin:7px 0 0; color:#667382; font:11px/1.4 Inter,system-ui,sans-serif; }
      .status { margin:7px 0 0; color:#536273; font:11px/1.4 Inter,system-ui,sans-serif; overflow-wrap:anywhere; }
      .status.error { color:#b42318; }
      .status.success { color:#087443; }
      a { color:#315fbc; font:11px Inter,system-ui,sans-serif; }
    `;

    const toolbar = element("div", "toolbar");
    const openButton = element("button", "open-button", "＋ Adicionar ao Zotero");
    openButton.type = "button";
    const panel = element("div", "panel");
    const label = element("label", "label", "Salvar em qual coleção?");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Coleção do Zotero");
    const placeholder = element("option", "", "Selecione uma coleção…");
    placeholder.value = "__choose__";
    placeholder.selected = true;
    select.append(placeholder);
    const noCollection = element("option", "", "Biblioteca principal (sem coleção)");
    noCollection.value = "";
    select.append(noCollection);
    const saveButton = element("button", "save", "Salvar referência");
    saveButton.type = "button";
    const note = element("p", "note", "O artigo será adicionado à sua biblioteca pessoal do Zotero.");
    const status = element("p", "status", "");
    panel.append(label, select, saveButton, note, status);
    toolbar.append(openButton);
    shadow.append(style, toolbar, panel);

    openButton.addEventListener("click", async () => {
      if (panel.classList.contains("open")) {
        panel.classList.remove("open");
        return;
      }
      panel.classList.add("open");
      openButton.disabled = true;
      status.textContent = "Carregando coleções do Zotero…";
      status.className = "status";
      try {
        const result = await send({ type: "GET_COLLECTIONS" });
        while (select.options.length > 2) select.remove(2);
        const collections = result.collections || [];
        const byKey = new Map(collections.map((collection) => [collection.key, collection]));
        const depthOf = (collection) => {
          let depth = 0;
          let parent = collection.parentCollection;
          const seen = new Set();
          while (parent && byKey.has(parent) && !seen.has(parent)) {
            seen.add(parent);
            depth += 1;
            parent = byKey.get(parent).parentCollection;
          }
          return depth;
        };
        collections
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
          .forEach((collection) => {
            const option = element("option", "", `${"　".repeat(Math.min(depthOf(collection), 4))}${collection.name}`);
            option.value = collection.key;
            select.append(option);
          });
        status.textContent = collections.length
          ? `${collections.length} coleção(ões) disponível(is).`
          : "Nenhuma coleção encontrada. Você pode salvar na biblioteca principal.";
      } catch (error) {
        status.textContent = error.message;
        status.className = "status error";
      } finally {
        openButton.disabled = false;
      }
    });

    saveButton.addEventListener("click", async () => {
      if (select.value === "__choose__") {
        status.textContent = "Escolha uma coleção ou selecione a biblioteca principal.";
        status.className = "status error";
        return;
      }
      saveButton.disabled = true;
      openButton.disabled = true;
      saveButton.textContent = "Salvando…";
      status.textContent = "Enviando referência ao Zotero…";
      status.className = "status";
      try {
        const result = await send({
          type: "SAVE_ITEM",
          item,
          collectionKey: select.value,
          pageUrl: window.location.href
        });
        if (result.status === "duplicate") {
          status.textContent = "Esta referência já está na sua biblioteca.";
          status.className = "status success";
          saveButton.textContent = "Já está no Zotero";
          const link = element("a", "", "Abrir no Zotero ↗");
          link.href = result.duplicate.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          status.append(document.createTextNode(" "), link);
        } else {
          status.textContent = "Referência adicionada com sucesso.";
          status.className = "status success";
          saveButton.textContent = "Salvo no Zotero ✓";
          const link = element("a", "", "Abrir no Zotero ↗");
          link.href = result.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          status.append(document.createTextNode(" "), link);
        }
      } catch (error) {
        status.textContent = error.message;
        status.className = "status error";
        saveButton.disabled = false;
        saveButton.textContent = "Tentar novamente";
      } finally {
        openButton.disabled = false;
      }
    });

    // Attach below the title without changing Consensus's own card layout.
    heading.insertAdjacentElement("afterend", mount);
  }

  function scan() {
    if (!isSupportedRoute()) return;
    const titles = getTitleCandidates();
    const seen = new Set();
    for (const heading of titles) {
      const root = findCardRoot(heading);
      if (!root || seen.has(root) || root.closest("[data-cz-ui-root]")) continue;
      seen.add(root);
      mountCardAction(heading, root);
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  // Observe even when the tab initially opens outside the search route: Consensus
  // navigates as a SPA, so the route may change without reloading the document.
  scheduleScan();
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target?.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target?.parentElement;
      return !target?.closest?.("[data-cz-ui-root]") && !target?.closest?.(`[${ROOT_ATTR}]`);
    });
    if (relevant) scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", scheduleScan);
  window.addEventListener("hashchange", scheduleScan);
})();
