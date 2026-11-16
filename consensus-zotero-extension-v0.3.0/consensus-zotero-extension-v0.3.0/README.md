# Consensus → Zotero (0.3.0)

Extensão Manifest V3 para Google Chrome e Microsoft Edge. Salva publicações na biblioteca pessoal do Zotero pela Web API v3. Esta versão mantém os adaptadores de Consensus, Elicit, Scopus, ScienceDirect, Connected Papers e IEEE Xplore.

## Mudanças da versão 0.3.0

- **Consensus alinhado ao mecanismo observado no Paperpile 1.5.1218:** identifica resultados por `a[data-testid="search-result"]`, `data-testid="search-result-item"`, painéis `[data-floating-ui-focusable]` e cartões `data-intercom-target` de resultado.
- **Citações exibidas em texto/preview:** trata separadamente `.relative.max-w-none.prose`, e só considera esse bloco quando encontra o marcador `DOI` ou a estrutura conhecida `p + div.flex.flex-col + hr`. Mensagens genéricas do usuário/assistente não são varridas por heurísticas genéricas de `article`, `h2`, `h3` ou `[role=article]` no Consensus.
- **Inserção dentro da prévia flutuante:** o controle é adicionado ao mesmo bloco de metadados/toolbar da publicação, permanecendo dentro da região hover do Consensus. Isso busca evitar que a prévia feche quando o cursor passa sobre o controle.
- **Botão compacto dividido:** `+Zotero` salva diretamente na coleção padrão; a pequena seta `▾` abre as coleções alternativas e salva na coleção escolhida.
- **Coleção padrão nas opções:** a página de opções da extensão permite selecionar e persistir a coleção padrão. O botão da extensão também abre essa página.
- **Custo de execução:** no Consensus, o content script não varre cartões genéricos. Usa seletores específicos, uma leitura inicial, `MutationObserver` limitado a `childList`, observadores de `style` somente em painéis flutuantes identificados, agrupamento curto e processamento em pequenos lotes ociosos. Os observadores dos painéis flutuantes são desconectados quando esses painéis saem do DOM.
- A configuração da coleção padrão é mantida no `chrome.storage.local`; a API Key continua restrita ao service worker.

## O que foi observado no pacote Paperpile fornecido

O adaptador Consensus encontrado em `dist-new/cs-webimport.js` na versão 1.5.1218 usa estes padrões concretos:

- resultados de busca localizados por `a[data-testid="search-result"]`;
- wrappers/tiles identificados por `data-testid="search-result-item"`, `[data-floating-ui-focusable]` e `data-intercom-target` contendo `result tile`;
- prévias de citação pelo seletor `.relative.max-w-none.prose`;
- detecção da prévia por um `span` com texto `DOI` ou pelo padrão estrutural `p:first-child + div.flex.flex-col + hr`;
- título no primeiro `p` da prévia, autores em `span.notranslate`, ano em `span.font-medium.text-fg-base`, publisher em `[title]` e DOI no elemento seguinte ao rótulo `DOI`;
- inserção dos controles na linha de metadados do resultado ou junto à linha do DOI, dentro do próprio cartão/prévia;
- um `MutationObserver` para nós inseridos e observadores pontuais de `style` em painéis flutuantes, em vez de uma varredura genérica contínua.

A implementação desta extensão é independente. Ela reproduz os seletores e o fluxo de inserção identificados no arquivo disponibilizado, não copia nem executa o código do Paperpile.

## Plataformas

| Site | Cobertura atual |
|---|---|
| Consensus | Resultados de busca e prévias de citação reconhecidas pelos seletores acima. |
| Elicit | Linhas/resultados com título e metadados expostos no DOM. |
| Scopus | Rotas de resultados e metadados que a página expõe. |
| ScienceDirect | Busca e páginas individuais de artigo/capítulo. |
| Connected Papers | Cartões/links de publicações com título legível no DOM. |
| IEEE Xplore | Resultados de busca e páginas individuais de documento. |

Os demais adaptadores continuam usando o motor genérico de extração; os seletores podem variar conforme a interface, sessão e testes A/B das plataformas.

## Como instalar/atualizar

1. Extraia o ZIP para uma pasta local.
2. Abra `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
3. Ative **Modo do desenvolvedor**.
4. Na primeira instalação, clique em **Carregar sem compactação** e selecione a pasta `consensus-zotero-extension-v0.3.0`.
5. Para atualizar, substitua os arquivos da pasta que já está carregada e clique em **Recarregar**. Use a mesma pasta/ID de extensão para manter a configuração local.

## Configuração

1. Acesse [Zotero API Keys](https://www.zotero.org/settings/keys) e crie uma chave dedicada com leitura e escrita para a biblioteca pessoal.
2. Clique no ícone da extensão e conecte a conta Zotero.
3. No popup, clique em **Configurar coleção padrão**. Também é possível abrir **Opções** nos detalhes da extensão do Chrome/Edge.
4. Selecione a coleção padrão e clique em **Salvar preferência**.
5. O botão `+Zotero` salva diretamente nessa coleção. A seta `▾` permite salvar em outra coleção ou na biblioteca principal.

## Comportamento do botão

- `+Zotero`: adiciona a publicação à coleção padrão configurada nas opções.
- `▾`: abre uma lista de coleções. Ao escolher uma delas, a extensão inicia a gravação naquela coleção.
- A lista usa cache curto na aba para não consultar repetidamente a API a cada resultado.
- Duplicatas são verificadas por DOI ou título antes de criar um novo item.

## Extração e armazenamento

A extensão extrai título, autores, DOI, data/ano, periódico, URL e outros campos que estejam disponíveis no DOM ou em metadados estruturados. Quando necessário, pode consultar Crossref durante a ação explícita de salvar. Em seguida cria um item Zotero (`journalArticle`, `conferencePaper` ou `preprint`, conforme os metadados disponíveis) e grava uma etiqueta com a plataforma de origem.

A API Key é mantida em `chrome.storage.local` com acesso limitado a contextos confiáveis e não é inserida no DOM da plataforma pesquisada. O Content Script conversa com o service worker, que é o único componente que chama a Zotero Web API.

## Desempenho

- Sem timer de varredura contínua.
- No Consensus, sem seletores genéricos de mensagem/artigo: apenas padrões específicos da plataforma.
- `MutationObserver` acompanha `childList`; as alterações são agrupadas em lotes ociosos.
- Observadores de atributo são registrados somente nos painéis flutuantes do Consensus para detectar quando ficam visíveis; eles são desconectados na remoção do painel.
- Nenhuma requisição Zotero/Crossref ocorre apenas por navegar ou passar o mouse. As requisições acontecem ao carregar a lista de coleções ou ao salvar.

Essas medidas reduzem trabalho adicional, mas não substituem medições no navegador real. A extensão ainda deve ser testada com buscas longas e diferentes layouts.

## Arquivos

- `manifest.json`: Manifest V3, domínios, service worker e página de opções.
- `adapters.js`: registro de plataformas e padrões por site.
- `content.js`: extração, controles Shadow DOM, observação incremental e adaptador Paperpile-compatível do Consensus.
- `service-worker.js`: autenticação, cache de coleções/templates, Crossref, duplicatas e criação de itens no Zotero.
- `popup.html/js/css`: conexão/desconexão da conta e acesso às opções.
- `options.html/js/css`: escolha da coleção padrão.

## Limitações e validação pendente

- A inspeção do pacote Paperpile confirma os seletores e o fluxo descritos acima, mas a estrutura do Consensus pode mudar por rollout ou teste A/B.
- A validação estática (sintaxe JavaScript, JSON do Manifest V3 e estrutura do pacote) não confirma comportamento em sessão real. É necessário testar cartões de busca, prévias de citações, mensagens do usuário e seleção de coleção em uma conta autenticada.
- Se uma prévia não exibir o marcador DOI nem a estrutura HTML reconhecida, esta versão não injeta o botão nela deliberadamente; isso evita inserir controles em mensagens comuns.
- A extração de metadados depende do conteúdo efetivamente fornecido pelo site. A extensão não tenta contornar autenticação, paywalls ou bloqueios.
- PDFs/anexos não são enviados ao Zotero nesta versão.

## Referências técnicas

- [Zotero Web API v3 – Basics](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Zotero Web API v3 – Write Requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
- [Crossref REST API](https://api.crossref.org/)
