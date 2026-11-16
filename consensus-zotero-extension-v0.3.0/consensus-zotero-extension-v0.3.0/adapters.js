/*
 * Site adapters for Consensus → Zotero.
 * These selectors are intentionally conservative and are isolated per host.
 * The extraction engine is shared; platform-specific rules only describe
 * supported routes and likely result-card/title/author containers.
 */
(() => {
  "use strict";

  const adapters = [
    {
      id: "consensus",
      label: "Consensus",
      hosts: [/^(?:www\.)?consensus\.app$/i],
      routes: [/^\/search\/[^/]+\/(?!new\/)[A-Za-z0-9_-]+\/?$/i],
      // Consensus is handled by a dedicated Paperpile-compatible observer in content.js.
      // Keep these exact selectors here for documentation and future adapter tests.
      cardSelectors: ['a[data-testid="search-result"]', '[data-testid="search-result-item"]', '[data-floating-ui-focusable]', '[data-intercom-target*="result tile"]', '.relative.max-w-none.prose'],
      titleSelectors: ["h3", ":scope > p"],
      authorSelectors: ["span.notranslate"],
      journalSelectors: ["span.italic", "span[title]"],
      abstractSelectors: [],
      singlePage: false
    },
    {
      id: "elicit",
      label: "Elicit",
      hosts: [/^(?:www\.)?elicit\.com$/i],
      routes: [/^\/agent\/[0-9a-f-]+(?:\/|$)/i],
      cardSelectors: ["[role='row'][row-id]", "[role='row'][data-row-id]", "article", "section"],
      titleSelectors: ["[data-testid='reference-title']", "h3 a[href]", "[data-testid*='title' i]", "[class*='title' i] a", "[role='heading']", "h2", "h3", "a[href*='doi.org']"],
      authorSelectors: ["[data-testid*='author' i]", "[class*='author' i]", "[aria-label*='author' i]", "button[aria-label]"],
      journalSelectors: ["[data-testid='reference-citation-value']", "[data-testid*='journal' i]", "[class*='journal' i]", "[class*='venue' i]", "[class*='source' i]"],
      abstractSelectors: ["[data-testid='reference-abstract']", "[data-testid*='abstract' i]", "[class*='abstract' i]"],
      singlePage: false
    },
    {
      id: "scopus",
      label: "Scopus",
      hosts: [/^(?:www\.)?scopus\.com$/i],
      routes: [/\/results\/(?:results|citedbyresults)\.uri/i, /\/authid\/detail\.uri/i],
      cardSelectors: [".search-results-item", ".searchDocument", "[data-testid*='search-result' i]", "[class*='search-result' i]", "[class*='result-item' i]", "[role='row']"],
      titleSelectors: [".result-title a", "[class*='result-title' i] a", "[data-testid*='title' i]", "h2 a", "h3 a", "h2", "h3"],
      authorSelectors: ["[class*='author' i]", "[data-testid*='author' i]"],
      journalSelectors: ["[class*='publication' i]", "[class*='source' i]", "[class*='journal' i]"],
      abstractSelectors: ["[class*='abstract' i]", "[data-testid*='abstract' i]"],
      singlePage: false
    },
    {
      id: "sciencedirect",
      label: "ScienceDirect",
      hosts: [/^(?:www\.)?sciencedirect\.com$/i],
      routes: [/^\/search(?:\/|$)/i, /^\/science\/(?:article|chapter)\//i],
      cardSelectors: ["li.ResultItem", ".ResultItem", "[data-testid*='search-result' i]", "[class*='result-item' i]", "article"],
      titleSelectors: ["h2 a", "h3 a", "[data-testid*='title' i]", "[class*='result-list-title' i]", "h1", "h2", "h3"],
      authorSelectors: [".author-group", "[class*='author-name' i]", "[class*='author' i]"],
      journalSelectors: ["[class*='publication-title' i]", "[class*='journal' i]", "[class*='publication' i]"],
      abstractSelectors: ["[class*='abstract' i]", "[id*='abstract' i]"],
      singlePageRoutes: [/^\/science\/(?:article|chapter)\//i]
    },
    {
      id: "connectedpapers",
      label: "Connected Papers",
      hosts: [/^(?:www\.)?connectedpapers\.com$/i],
      routes: [/\//],
      cardSelectors: ["[data-testid*='paper' i]", "[data-paper-id]", "[data-node-id]", "[class*='paper-card' i]", "[class*='PaperCard' i]", "a[href*='/paper/']"],
      titleSelectors: ["[data-paper-title]", "[data-testid*='title' i]", "h2", "h3", "h4", "[role='heading']", "[class*='paper-title' i]", "[class*='title' i]"],
      authorSelectors: ["[class*='author' i]", "[data-testid*='author' i]"],
      journalSelectors: ["[class*='journal' i]", "[class*='venue' i]", "[class*='publication' i]"],
      abstractSelectors: ["[class*='abstract' i]", "[data-testid*='abstract' i]"],
      singlePage: false
    },
    {
      id: "ieeexplore",
      label: "IEEE Xplore",
      hosts: [/^ieeexplore\.ieee\.org$/i],
      routes: [/\/searchresult\.jsp/i, /\/document\/\d+/i],
      cardSelectors: [".List-results-items", "[class*='List-results-item' i]", "[data-testid*='search-result' i]", "[class*='result-item' i]", "article"],
      titleSelectors: [".fw-bold a", ".title a", "[data-testid*='title' i]", "h2 a", "h3 a", "h2", "h3", "h1"],
      authorSelectors: [".authors", "[class*='author' i]", "[data-testid*='author' i]"],
      journalSelectors: ["[class*='publication-title' i]", "[class*='publication' i]", "[class*='journal' i]", "[class*='conference' i]"],
      abstractSelectors: ["[class*='abstract' i]", "[id*='abstract' i]"],
      singlePageRoutes: [/^\/document\/\d+/i]
    }
  ];

  Object.defineProperty(globalThis, "CZT_ADAPTERS", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(adapters)
  });
})();
