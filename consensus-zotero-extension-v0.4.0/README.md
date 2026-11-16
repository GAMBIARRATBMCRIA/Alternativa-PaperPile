# Consensus → Zotero (0.4.0)

Extensão Manifest V3 para Google Chrome e Microsoft Edge. Salva publicações na biblioteca pessoal do Zotero pela Web API v3. Esta versão mantém os adaptadores de Consensus, Elicit, Scopus, ScienceDirect, Connected Papers e IEEE Xplore.

## Mudanças da versão 0.4.0

- **Consensus alinhado ao mecanismo observado no Paperpile 1.5.1218:** identifica resultados por `a[data-testid="search-result"]`, `data-testid="search-result-item"`, painéis `[data-floating-ui-focusable]` e cartões `data-intercom-target` de resultado.
- **Citações exibidas em texto/preview:** trata separadamente `.relative.max-w-none.prose`, e só considera esse bloco quando encontra o marcador `DOI` ou a estrutura conhecida `p + div.flex.flex-col + hr`. Mensagens genéricas do usuário/assistente não são varridas por heurísticas genéricas de `article`, `h2`, `h3` ou `[role=article]` no Consensus.
- **Inserção dentro da prévia flutuante:** o controle é adicionado ao mesmo bloco de metadados/toolbar da publicação, permanecendo dentro da região hover do Consensus. Isso busca evitar que a prévia feche quando o cursor passa sobre o controle.
- **Botão compacto dividido:** `+Zotero` salva diretamente na coleção padrão; a pequena seta `▾` abre as coleções alternativas e salva na coleção escolhida.
- **Coleção padrão nas opções:** a página de opções da extensão permite selecionar e persistir a coleção padrão. O botão da extensão também abre essa página.
- **Detecção automática de referências já salvas:** ao encontrar uma publicação na página, a extensão consulta um índice local dos metadados da biblioteca pessoal do Zotero. Quando encontra correspondência, troca o botão por `Salvo ✓`, desabilita a inclusão e mostra um link para abrir o registro no Zotero.
- **Comparação em camadas:** DOI exato tem prioridade; sem DOI correspondente, compara título normalizado e confere ano e primeiro autor quando esses dados existem. Se dois DOI diferentes estão presentes, não considera os registros iguais apenas porque os títulos coincidem.
- **Índice incremental da biblioteca:** na primeira consulta, carrega os registros de nível superior em páginas de até 100 itens. Nas consultas posteriores, usa `since`, `format=versions` e a lista de exclusões da API para buscar apenas mudanças. O índice compacto fica no `chrome.storage.local` e é reaproveitado por cinco minutos.
- **Prevenção também no clique:** antes de gravar, a extensão atualiza o índice e verifica novamente a duplicidade. Se a API não puder confirmar a consulta, não cria um novo item às cegas.
- **Custo de execução:** no Consensus, o content script não varre cartões genéricos. Usa seletores específicos, uma leitura inicial, `MutationObserver` limitado a `childList`, observadores de `style` somente em painéis flutuantes identificados, agrupamento curto e processamento em pequenos lotes ociosos. Os observadores dos painéis flutuantes são desconectados quando esses painéis saem do DOM.
- A configuração da coleção padrão, a API Key e o índice compacto ficam no `chrome.storage.local`; a API Key continua restrita ao service worker.

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
4. Na primeira instalação, clique em **Carregar sem compactação** e selecione a pasta `consensus-zotero-extension-v0.4.0`.
5. Para atualizar, substitua os arquivos da pasta que já está carregada e clique em **Recarregar**. Use a mesma pasta/ID de extensão para manter a configuração local.

## Configuração

1. Acesse [Zotero API Keys](https://www.zotero.org/settings/keys) e crie uma chave dedicada com leitura e escrita para a biblioteca pessoal.
2. Clique no ícone da extensão e conecte a conta Zotero.
3. No popup, clique em **Configurar coleção padrão**. Também é possível abrir **Opções** nos detalhes da extensão do Chrome/Edge.
4. Selecione a coleção padrão e clique em **Salvar preferência**.
5. O botão `+Zotero` salva diretamente nessa coleção. A seta `▾` permite salvar em outra coleção ou na biblioteca principal.

## Comportamento do botão

- Durante a verificação inicial, os dois segmentos ficam temporariamente desabilitados e o status exibe **Conferindo sua biblioteca…**.
- `Salvo ✓`: significa que a publicação foi localizada na biblioteca pessoal do Zotero. O controle fica desabilitado e aparece o link **Abrir no Zotero**.
- `+Zotero`: se a publicação ainda não existir, adiciona à coleção padrão configurada nas opções.
- `▾`: abre uma lista de coleções. Ao escolher uma delas, a extensão inicia a gravação naquela coleção.
- Quando a publicação não é encontrada, o botão volta a ficar disponível. A extensão repete a checagem no momento do salvamento para reduzir risco de duplicação por mudanças recentes feitas em outro dispositivo.

## Extração e armazenamento

A extensão extrai título, autores, DOI, data/ano, periódico, URL e outros campos que estejam disponíveis no DOM ou em metadados estruturados. Para reconhecer registros já existentes, consulta os itens de nível superior da biblioteca pessoal (`/users/{userID}/items/top`), incluindo os registros bibliográficos aos quais os PDFs/anexos costumam estar associados. O índice local guarda apenas chave, título, DOI, ano e primeiro autor — não baixa nem armazena os arquivos PDF. Quando necessário, pode consultar Crossref durante a ação explícita de salvar. Se a publicação não existir, cria um item Zotero (`journalArticle`, `conferencePaper` ou `preprint`, conforme os metadados disponíveis) e grava uma etiqueta com a plataforma de origem.

A API Key é mantida em `chrome.storage.local` com acesso limitado a contextos confiáveis e não é inserida no DOM da plataforma pesquisada. O Content Script conversa com o service worker, que é o único componente que chama a Zotero Web API.

## Desempenho

- Sem timer de varredura contínua.
- No Consensus, sem seletores genéricos de mensagem/artigo: apenas padrões específicos da plataforma.
- `MutationObserver` acompanha `childList`; as alterações são agrupadas em lotes ociosos.
- Observadores de atributo são registrados somente nos painéis flutuantes do Consensus para detectar quando ficam visíveis; eles são desconectados na remoção do painel.
- A consulta de duplicatas ocorre em segundo plano após identificar um resultado publicável, sem bloquear a navegação da página.
- O primeiro acesso após conectar uma conta cria o índice por páginas (somente metadados, sem PDFs); em bibliotecas grandes, essa primeira carga pode levar mais tempo. Depois, o índice é reutilizado por cinco minutos e sincronizado de forma incremental com a API do Zotero.
- O salvamento força uma atualização incremental antes de gravar; o pacote não baixa PDFs nem consulta Crossref durante a simples verificação de status.

Essas medidas reduzem trabalho adicional, mas não substituem medições no navegador real. A extensão ainda deve ser testada com buscas longas e diferentes layouts.

## Arquivos

- `manifest.json`: Manifest V3, domínios, service worker e página de opções.
- `adapters.js`: registro de plataformas e padrões por site.
- `content.js`: extração, controles Shadow DOM, observação incremental e adaptador Paperpile-compatível do Consensus.
- `service-worker.js`: autenticação, cache de coleções/templates, sincronização incremental do índice bibliográfico, detecção de duplicatas, Crossref e criação de itens no Zotero.
- `popup.html/js/css`: conexão/desconexão da conta e acesso às opções.
- `options.html/js/css`: escolha da coleção padrão.

## Limitações e validação pendente

- A inspeção do pacote Paperpile confirma os seletores e o fluxo descritos acima, mas a estrutura do Consensus pode mudar por rollout ou teste A/B.
- A validação estática (sintaxe JavaScript, JSON do Manifest V3 e estrutura do pacote) não confirma comportamento em sessão real. É necessário testar cartões de busca, prévias de citações, mensagens do usuário e seleção de coleção em uma conta autenticada.
- Se uma prévia não exibir o marcador DOI nem a estrutura HTML reconhecida, esta versão não injeta o botão nela deliberadamente; isso evita inserir controles em mensagens comuns.
- A extração de metadados depende do conteúdo efetivamente fornecido pelo site. A extensão não tenta contornar autenticação, paywalls ou bloqueios.
- A comparação por título exige igualdade após normalização; ano e primeiro autor são critérios de segurança adicionais quando ambos estão disponíveis. Registros sem DOI e com títulos muito alterados podem não ser reconhecidos automaticamente.
- A detecção consulta a biblioteca pessoal conectada, não bibliotecas de grupos.
- Os PDFs/anexos não são baixados nem enviados pela extensão. A detecção identifica o registro bibliográfico já existente; normalmente, os anexos aparecem como filhos desse registro no Zotero.

## Referências técnicas

- [Zotero Web API v3 – Basics](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Zotero Web API v3 – Syncing](https://www.zotero.org/support/dev/web_api/v3/syncing)
- [Zotero Web API v3 – Write Requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
- [Crossref REST API](https://api.crossref.org/)
