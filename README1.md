# Consensus → Zotero (0.1.0)

Extensão Manifest V3 para Chrome e Microsoft Edge. Adiciona um controle **＋ Adicionar ao Zotero** nos resultados de pesquisa do Consensus e envia a referência para a biblioteca pessoal do Zotero pela Web API v3.

## O que esta versão faz

- Reconhece a rota de pesquisa observada no pacote do Paperpile: `/search/{segmento}/{identificador}`.
- Detecta títulos nos resultados e insere um controle independente em cada cartão detectado.
- Ao clicar, carrega as coleções da biblioteca pessoal e permite escolher uma coleção ou salvar na biblioteca principal.
- Extrai título, DOI, ano, autores (quando identificáveis no DOM), periódico, resumo e URL.
- Quando há DOI, tenta completar metadados ausentes usando Crossref.
- Verifica duplicidade por DOI; sem DOI, usa correspondência exata de título entre os resultados da busca da API.
- Salva um item `journalArticle` na API v3 do Zotero e adiciona a etiqueta `Consensus`.
- Mantém a API Key em `chrome.storage.local`; a chave não é enviada ao Content Script nem ao site Consensus.

## Instalação no Chrome

1. Extraia o ZIP para uma pasta local.
2. Abra `chrome://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta `consensus-zotero-extension` extraída.
5. Abra o popup da extensão.

## Instalação no Microsoft Edge

1. Extraia o ZIP para uma pasta local.
2. Abra `edge://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e selecione a pasta extraída.
5. Abra o popup da extensão.

A extensão usa APIs padrão de Manifest V3 e não depende de APIs exclusivas do Chrome.

## Configuração do Zotero

1. Acesse [Zotero API Keys](https://www.zotero.org/settings/keys).
2. Crie uma chave dedicada para esta extensão.
3. Habilite leitura e escrita na **biblioteca pessoal**. A permissão de arquivos não é necessária nesta versão.
4. Copie a chave e cole no popup **Consensus → Zotero**.
5. Clique em **Conectar ao Zotero**. A extensão valida a chave, identifica seu usuário e testa o acesso às coleções.

A chave é armazenada localmente no perfil do navegador. Não a compartilhe nem envie prints que a revelem. Para revogar, remova a chave nas configurações da sua conta Zotero ou clique em **Desconectar** e revogue a chave se não for mais utilizá-la.

## Como usar

1. Abra uma pesquisa no Consensus.
2. Em cada resultado identificado, clique em **＋ Adicionar ao Zotero**.
3. Escolha a coleção ou **Biblioteca principal (sem coleção)**.
4. Clique em **Salvar referência**.
5. O controle informa se o item foi salvo ou se já existia na biblioteca.

## Arquitetura

- `manifest.json`: permissões mínimas, popup, service worker e Content Script.
- `content.js`: reconhecimento de resultados, extração dos metadados e UI injetada em Shadow DOM.
- `service-worker.js`: armazenamento de credenciais, chamadas à API Zotero, leitura de coleções, enriquecimento Crossref, detecção de duplicatas e criação do item.
- `popup.html`, `popup.css`, `popup.js`: conexão e desconexão da conta.

Fluxo: `Consensus DOM → Content Script → runtime message → Service Worker → Zotero Web API v3`.

## Limitações conhecidas da versão 0.1.0

- O Consensus é uma aplicação web dinâmica. Os seletores são heurísticos e precisam ser validados contra a versão real da página e os dois modos de visualização (padrão e compacto). Pode haver resultados sem botão ou um cartão escolhido de forma imprecisa.
- A extensão só inicializa automaticamente na rota de pesquisa compatível com o padrão observado no pacote Paperpile. Se o Consensus alterar a URL, o filtro de rota precisará ser atualizado.
- A extração de autores e periódico depende dos atributos e classes presentes no DOM. Quando não forem encontrados, o DOI/Crossref pode completar parte dos campos; sem DOI, alguns metadados podem ficar vazios.
- Esta versão salva referências, não PDFs/anexos. A API Key não recebe permissão de arquivos.
- A verificação de duplicidade não é uma transação atômica: duas ações simultâneas em abas diferentes ainda podem criar uma duplicata.

## Próxima validação necessária

Instale a extensão, conecte uma chave Zotero de teste e envie uma captura de tela de uma página de resultados do Consensus mostrando um cartão onde o botão apareceu (ou não apareceu). Com isso, os seletores podem ser ajustados ao DOM real. Não envie a API Key.

## Referências técnicas

- [Zotero Web API v3 – Basics](https://www.zotero.org/support/dev/web_api/v3/basics)
- [Zotero Web API v3 – Write Requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
- [Crossref REST API](https://api.crossref.org/)
