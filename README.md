# Zotero + Google Docs — fluxo integrado de referências

Este projeto reúne dois componentes independentes que utilizam a mesma biblioteca pessoal do **Zotero**:

1. **Extensão de navegador Consensus → Zotero**: captura referências em plataformas científicas e as salva na biblioteca Zotero.
2. **Google Docs — Citações Zotero**: pesquisa referências já salvas no Zotero, insere citações no documento e gera/atualiza a lista de referências.

O fluxo geral é:

```text
Consensus / Elicit / Scopus / ScienceDirect / Connected Papers / IEEE Xplore
                                  |
                                  v
                  Extensão Consensus → Zotero
                                  |
                                  v
                         Zotero (biblioteca)
                                  |
                                  v
                   Apps Script vinculado ao Docs
                                  |
                     +------------+------------+
                     |                         |
                     v                         v
              Citações no texto        Lista de referências
```

> **Importante — integridade dos arquivos recebidos:** o arquivo `integracao-docs.zip` fornecido para esta documentação contém `Código.gs`, mas `Sidebar.html` e `appsscript.json` estão vazios (0 bytes). O código `Código.gs` chama `HtmlService.createHtmlOutputFromFile('Sidebar')`; portanto, a barra lateral é necessária para a função **Citar…**. O conteúdo dela não foi fornecido e não é possível reconstruir fielmente sua interface ou seus controles a partir do `Código.gs` sozinho. O manifesto `appsscript.json` pode ser recriado com os padrões do Apps Script, mas a barra lateral precisa ser recuperada ou implementada antes de a experiência completa de citação estar operacional. O README documenta o funcionamento comprovado pelo código recebido e sinaliza esse bloqueio sem presumir detalhes ausentes.

---

## 1. O que cada componente faz

### 1.1 Extensão de navegador — Consensus → Zotero

A extensão é compatível com **Google Chrome e Microsoft Edge**, utilizando Manifest V3.

Na versão documentada (0.3.0), os adaptadores incluídos são:

- Consensus
- Elicit
- Scopus
- ScienceDirect
- Connected Papers
- IEEE Xplore

Em páginas suportadas, a extensão identifica resultados bibliográficos e insere um pequeno controle junto ao resultado:

- **`+Zotero`**: salva diretamente na coleção padrão configurada.
- **Seta ao lado do botão**: permite escolher outra coleção para aquela publicação.

A extensão também oferece:

- conexão com a biblioteca pessoal do Zotero por API Key;
- configuração de coleção padrão;
- consulta às coleções da biblioteca;
- extração de metadados bibliográficos;
- enriquecimento complementar por Crossref quando aplicável;
- verificação de possíveis duplicatas;
- indicação visual do resultado da operação.

A extensão não substitui o Zotero: ela envia os metadados para a biblioteca online do usuário.

### 1.2 Google Docs — Citações Zotero

O Apps Script é vinculado a um documento Google Docs e adiciona o menu **Citações Zotero**.

Conforme o `Código.gs` recebido, esse menu oferece:

- **Citar…**: abre a barra lateral chamada `Sidebar`;
- **Gerar/atualizar referências**: monta ou atualiza a seção de referências a partir das citações identificadas no documento;
- **Testar vínculos**: procura links de itens do Zotero no documento e apresenta os vínculos reconhecidos.

O código também implementa estas operações:

- pesquisa de itens na biblioteca por título, autor ou ano;
- inserção de uma citação formatada na posição do cursor;
- inserção de citações agrupadas;
- ordenação alfabética das citações agrupadas;
- geração de bibliografia com base nos itens citados;
- atualização da seção de referências no mesmo local em que ela foi criada anteriormente.

**Limitação da fonte recebida:** os detalhes visuais da barra lateral — campos, botões, filtros, resultados e mensagens — não podem ser descritos com segurança porque `Sidebar.html` está vazio no ZIP recebido.

---

## 2. Pré-requisitos

Antes de instalar:

- uma conta no [Zotero](https://www.zotero.org/);
- Google Chrome ou Microsoft Edge para a extensão;
- acesso ao Google Docs e ao Google Apps Script;
- uma API Key do Zotero com permissão de leitura e escrita na biblioteca pessoal;
- o ZIP da extensão `consensus-zotero-extension-v0.3.0.zip`;
- o projeto Apps Script com `Código.gs` e o conteúdo válido de `Sidebar.html`.

### 2.1 Criar a API Key do Zotero

1. Entre em [zotero.org](https://www.zotero.org/).
2. Abra [Configurações → Feeds/API → Chaves](https://www.zotero.org/settings/keys).
3. Crie uma nova chave.
4. Conceda acesso de leitura e escrita à sua biblioteca pessoal.
5. Guarde a chave em local seguro.

A extensão utiliza a API Key para salvar referências. O Apps Script também utiliza uma API Key para pesquisar itens e obter as citações e a bibliografia formatadas.

A chave usada pelos dois componentes pode ser a mesma, desde que tenha as permissões necessárias. Cada componente mantém sua própria configuração:

- a extensão guarda a configuração no armazenamento local do navegador;
- o Apps Script guarda `ZOTERO_USER` e `ZOTERO_KEY` nas propriedades do usuário do Apps Script.

A chave não deve ser inserida em documentos, repositórios públicos, capturas de tela ou trechos de código compartilhados.

### 2.2 Encontrar o User ID do Zotero

O Apps Script recebido utiliza o **User ID numérico** da conta pessoal, não o nome de usuário.

Ele pode ser consultado nas configurações da conta/API do Zotero. A função `saveConfig(userId, apiKey)` valida que o identificador seja numérico.

---

## 3. Instalação da extensão no Chrome

1. Baixe o arquivo `consensus-zotero-extension-v0.3.0.zip`.
2. Extraia o ZIP para uma pasta permanente do computador.
3. Abra `chrome://extensions`.
4. Ative **Modo do desenvolvedor**.
5. Clique em **Carregar sem compactação**.
6. Selecione a pasta extraída que contém `manifest.json`.
7. Confirme que a extensão **Consensus → Zotero** aparece na lista.

Não selecione o arquivo ZIP diretamente: o Chrome precisa da pasta extraída.

### 3.1 Instalação no Microsoft Edge

1. Extraia o mesmo ZIP para uma pasta permanente.
2. Abra `edge://extensions`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta que contém `manifest.json`.

A extensão usa Manifest V3 e declara compatibilidade com Chrome e Edge.

### 3.2 Conectar a extensão ao Zotero

1. Clique no ícone da extensão na barra do navegador.
2. Cole a API Key do Zotero.
3. Clique em **Conectar ao Zotero**.
4. Aguarde a validação da conexão.
5. Quando a conta aparecer como conectada, abra as opções da extensão.

A extensão consulta a biblioteca pessoal e as coleções disponíveis.

### 3.3 Definir a coleção padrão

1. Abra o popup da extensão.
2. Clique em **Configurar coleção padrão**.
3. Aguarde o carregamento das coleções.
4. Selecione a coleção desejada.
5. Clique em **Salvar preferência**.

Se a opção **Biblioteca principal (sem coleção)** for selecionada, os novos itens serão adicionados à biblioteca sem associação a uma coleção específica.

### 3.4 Usar a extensão nas plataformas científicas

Abra uma página de pesquisa ou resultados em uma das plataformas suportadas.

Quando um resultado bibliográfico for reconhecido, a extensão apresenta o controle:

- clique em **`+Zotero`** para salvar na coleção padrão;
- clique na pequena seta para escolher outra coleção para aquele item.

A extensão tenta extrair os metadados do resultado, podendo complementar informações por DOI/Crossref. Antes de criar um novo item, verifica possíveis duplicatas na biblioteca.

Confira no Zotero se a referência foi salva corretamente. A qualidade da referência depende dos metadados disponibilizados pela página de origem e dos dados complementares encontrados.

### 3.5 Atualizar a extensão

Para atualizar uma instalação carregada sem compactação:

1. Faça uma cópia de segurança da pasta atual.
2. Extraia a nova versão.
3. Substitua os arquivos da pasta instalada.
4. Abra `chrome://extensions` ou `edge://extensions`.
5. Clique em **Recarregar** no cartão da extensão.

Manter a mesma instalação e o mesmo ID é importante para preservar as configurações locais. Não remova a extensão antes de atualizar se quiser manter os dados armazenados no perfil do navegador.

---

## 4. Instalação do Apps Script no Google Docs

O componente de citações é um **Apps Script vinculado ao documento** (*container-bound script*). Ele não é uma extensão de navegador e, conforme o código recebido, não precisa ser publicado como aplicativo da web.

### 4.1 Abrir o editor Apps Script

1. Abra o Google Docs.
2. Crie ou abra o documento em que deseja inserir citações.
3. Acesse **Extensões → Apps Script**.
4. O editor abrirá o projeto vinculado ao documento.

### 4.2 Adicionar o código principal

1. Abra o arquivo `Código.gs` do pacote `integracao-docs.zip`.
2. Copie todo o conteúdo.
3. No editor Apps Script, cole o código no arquivo `.gs` principal.
4. Salve o projeto.

O código recebido define o menu `Citações Zotero`, a comunicação com a API e as rotinas de inserção e bibliografia.

### 4.3 Adicionar a barra lateral

No editor Apps Script:

1. Clique em **+** ao lado de Arquivos.
2. Escolha **HTML**.
3. Crie um arquivo chamado exatamente `Sidebar`.
4. Recupere e cole o conteúdo correto do arquivo `Sidebar.html` do projeto original.
5. Salve o projeto.

> **Bloqueio no material recebido:** o `Sidebar.html` que veio no ZIP tem 0 bytes. Não há conteúdo para colar nesta etapa. Sem esse arquivo HTML válido, a opção **Citar…** não consegue abrir a barra lateral, porque `openSidebar()` chama `createHtmlOutputFromFile('Sidebar')`. É necessário recuperar o arquivo original ou desenvolver sua interface antes de considerar a instalação completa.

A barra lateral deve chamar as funções do servidor por meio de `google.script.run`. As funções de servidor disponíveis no `Código.gs` incluem `getStatus`, `saveConfig`, `searchItems`, `insertCitation`, `insertCitationGroup` e `generateBibliography`.

### 4.4 Salvar e autorizar

1. Salve o projeto Apps Script.
2. Volte ao Google Docs.
3. Atualize a página do documento.
4. Aguarde o menu **Citações Zotero** aparecer.
5. Execute uma operação que exija acesso externo e siga o fluxo de autorização do Google.

O script utiliza `DocumentApp`, `PropertiesService` e `UrlFetchApp` para manipular o documento, guardar configurações por usuário e consultar a API do Zotero.

Não é necessário implantar como Web App para o fluxo descrito no código.

### 4.5 Manifesto `appsscript.json`

O arquivo `appsscript.json` do ZIP recebido também está vazio. Para o uso comum pelo editor, o Apps Script pode trabalhar com o manifesto padrão gerado pelo Google. Se o projeto exigir configurações específicas de runtime, escopos ou fuso horário, elas devem ser definidas no manifesto do próprio projeto, de acordo com a configuração desejada.

Não foi possível confirmar configurações adicionais porque o arquivo fornecido não contém conteúdo.

---

## 5. Configurar o Zotero no Google Docs

O `Código.gs` define a função:

```javascript
saveConfig(userId, apiKey)
```

Ela recebe:

- `userId`: ID numérico da biblioteca pessoal;
- `apiKey`: chave de API do Zotero.

A função testa a conexão consultando a biblioteca e, se a resposta for HTTP 200, grava os dois valores em `PropertiesService.getUserProperties()`.

Isso significa que a configuração é armazenada nas propriedades do usuário do Apps Script, e não no corpo do documento.

**Atenção:** o procedimento visual para preencher e enviar esses dados depende da barra lateral `Sidebar.html`, que não veio preenchida no ZIP. Não execute `saveConfig` sem fornecer os argumentos corretos. A interface de configuração precisa ser recuperada ou implementada.

---

## 6. Como citar no Google Docs

Depois de instalada e configurada a barra lateral:

1. Abra o documento.
2. Posicione o cursor no ponto em que deseja inserir a citação.
3. Abra **Citações Zotero → Citar…**.
4. Pesquise a referência na biblioteca Zotero.
5. Selecione a referência e use o controle de inserção disponibilizado pela barra lateral.

O comportamento interno comprovado no `Código.gs` é:

- a pesquisa utiliza título, autor e ano (`qmode=titleCreatorYear`);
- a consulta retorna até 20 resultados;
- anexos e notas são filtrados;
- a citação é solicitada ao Zotero com o estilo configurado;
- a citação inserida recebe um hiperlink para o item correspondente no Zotero.

O código define o estilo:

```javascript
const STYLE = 'associacao-brasileira-de-normas-tecnicas';
const LOCALE = 'pt-BR';
```

Portanto, o formato de citação configurado é ABNT autor-data, em português do Brasil.

### 6.1 Citação individual

A função `insertCitation(key)` consulta o item no Zotero e solicita a citação formatada. Em seguida, insere o texto na posição do cursor e aplica o link do item ao trecho inserido.

Se o cursor estiver em um elemento de texto, o código usa o deslocamento do cursor para inserir no ponto exato.

### 6.2 Citação agrupada

A função `insertCitationGroup(keys)` permite inserir mais de uma referência em uma única citação.

O código:

- aceita até 50 chaves por operação;
- consulta os itens no Zotero;
- remove os parênteses externos de cada citação individual;
- ordena alfabeticamente quando `SORT_GROUP` está ativado;
- monta uma estrutura como `(Autor, ano; Autor, ano)`;
- mantém um hiperlink individual em cada referência, sem vincular os parênteses e separadores.

A ordenação é feita a partir do texto retornado pelo estilo de citação.

---

## 7. Gerar e atualizar a lista de referências

O menu **Citações Zotero → Gerar/atualizar referências** executa a geração da bibliografia.

O procedimento implementado é:

1. Percorrer o documento e localizar links que correspondam ao padrão de itens Zotero.
2. Extrair as chaves dos itens citados.
3. Remover chaves repetidas.
4. Consultar os itens no Zotero.
5. Solicitar a bibliografia formatada em HTML (`format=bib`).
6. Converter o conteúdo em texto, preservando links e formatação em itálico/negrito quando identificados.
7. Inserir a seção no documento.

O título da seção é:

```text
REFERÊNCIAS
```

O código define fonte de tamanho 12, alinhamento centralizado para o título, referências alinhadas à esquerda e espaçamento simples dentro de cada referência, com espaço posterior entre entradas.

### 7.1 Atualização sem duplicar a seção

O código utiliza o intervalo nomeado `ZOTERO_REFERENCIAS_V2` para localizar a seção de referências gerada anteriormente.

Quando a função é executada novamente, ela tenta inserir a nova seção no mesmo local e remover a seção anterior. Assim, a intenção é atualizar a bibliografia em vez de criar uma nova cópia a cada execução.

### 7.2 O que entra na bibliografia

Somente itens reconhecidos como citações com links de itens do Zotero são incluídos.

O script procura URLs contendo `/items/` seguidas por uma chave de oito caracteres alfanuméricos. Uma citação sem o link esperado pode não ser reconhecida pelo gerador de referências.

---

## 8. Testar os vínculos das citações

Use **Citações Zotero → Testar vínculos**.

O script percorre os elementos de texto do corpo do documento e identifica links que correspondam ao padrão de item Zotero.

O resultado apresenta:

- quantidade de vínculos encontrados;
- texto associado ao link;
- chave do item Zotero.

Esse recurso ajuda a verificar se as citações inseridas continuam vinculadas aos itens corretos.

---

## 9. Como os dois componentes trabalham juntos

Os dois componentes são independentes, mas compartilham a mesma biblioteca pessoal.

### Etapa A — Capturar uma publicação

1. Pesquise um artigo em uma plataforma suportada.
2. Clique em `+Zotero`.
3. O item é salvo na coleção padrão ou na coleção alternativa escolhida.

### Etapa B — Confirmar no Zotero

1. Abra a biblioteca Zotero.
2. Localize o item recém-adicionado.
3. Confira título, autores, ano, DOI e demais metadados.
4. Corrija manualmente eventuais dados incompletos ou incorretos.

### Etapa C — Citar no Google Docs

1. Abra o documento com o Apps Script instalado.
2. Posicione o cursor.
3. Abra a barra lateral de citações.
4. Pesquise o item que já está na biblioteca.
5. Insira a citação.

### Etapa D — Gerar as referências

1. Insira todas as citações desejadas.
2. Posicione o cursor no local em que a seção de referências deve começar, caso seja a primeira geração.
3. Execute **Gerar/atualizar referências**.
4. O script reúne as referências identificadas pelos links do documento e solicita ao Zotero a bibliografia formatada.

A extensão não insere citações no Google Docs. Ela apenas alimenta a biblioteca. O Apps Script não captura artigos das páginas de pesquisa. Ele utiliza os itens que já estão armazenados no Zotero.

---

## 10. Configurações técnicas do Apps Script

Os principais parâmetros encontrados no `Código.gs` são:

| Constante | Valor | Função |
|---|---|---|
| `STYLE` | `associacao-brasileira-de-normas-tecnicas` | Estilo bibliográfico |
| `LOCALE` | `pt-BR` | Idioma/localidade |
| `API` | `https://api.zotero.org` | API do Zotero |
| `CHUNK` | `50` | Tamanho de lote usado em operações com vários itens |
| `SORT_GROUP` | `true` | Ordenação alfabética de citações agrupadas |
| `BIB_TITLE` | `REFERÊNCIAS` | Título da seção |
| `BIB_FONT_SIZE` | `12` | Tamanho da fonte da bibliografia |
| `BIB_PAGE_BREAK` | `false` | Não força quebra de página antes da seção |

Esses valores estão definidos no código recebido. Alterações devem ser feitas com cuidado e testadas em uma cópia do documento.

---

## 11. Segurança e armazenamento das credenciais

### Extensão de navegador

A extensão solicita uma API Key do Zotero e utiliza permissões de host para acessar:

- `https://api.zotero.org/*`
- `https://api.crossref.org/*`

A permissão `storage` é declarada no Manifest V3. A chave fica no armazenamento da extensão no perfil do navegador, não no código-fonte da página pesquisada.

Proteja o perfil do navegador e não compartilhe a pasta de dados do perfil.

### Google Apps Script

O Apps Script utiliza `PropertiesService.getUserProperties()` para guardar:

- `ZOTERO_USER`
- `ZOTERO_KEY`

Essas propriedades são associadas ao usuário do script. Não coloque a chave diretamente em `Código.gs` nem em arquivos HTML.

---

## 12. Solução de problemas

### A extensão não aparece em uma página

- Confirme que a URL pertence a um domínio suportado.
- Verifique se a página é uma página de resultados compatível com o adaptador.
- Atualize a página depois de instalar ou recarregar a extensão.
- Confira erros em `chrome://extensions` ou `edge://extensions`.

A estrutura dos sites pode mudar. Se os seletores de resultados forem alterados, o adaptador correspondente pode precisar de atualização.

### O botão aparece, mas os metadados estão incompletos

- Confira se o resultado apresenta DOI.
- Verifique a página original do artigo.
- Confira os dados no Zotero e corrija o que estiver faltando.
- Nem todas as plataformas disponibilizam os mesmos metadados na página de resultados.

### O item já existe no Zotero

A extensão tenta identificar duplicatas antes da criação. Se encontrar um possível item correspondente, confira o registro existente na biblioteca antes de repetir a importação.

### A coleção padrão não aparece

- Abra o popup e confira se a conta está conectada.
- Atualize a lista de coleções nas opções.
- Verifique se a API Key tem acesso de leitura à biblioteca pessoal.

### O menu Citações Zotero não aparece no Docs

- Atualize o documento.
- Confira se o projeto Apps Script está vinculado ao documento correto.
- Verifique se `onOpen()` está presente no arquivo `Código.gs`.
- Salve o projeto e reabra o documento.

### A opção Citar… gera erro ao abrir a barra lateral

O arquivo `Sidebar.html` precisa existir no projeto e conter HTML válido. O ZIP recebido contém esse arquivo vazio. Recupere a versão correta da barra lateral antes de usar essa função.

### A busca não encontra uma referência

- Confira se o item está na biblioteca pessoal configurada.
- Tente pesquisar por parte do título ou sobrenome do autor.
- Confira a conexão e as permissões da API Key.
- Verifique se o item não está apenas em outra conta ou biblioteca de grupo.

### A bibliografia não inclui uma citação

A geração depende de links reconhecidos como itens do Zotero. Use **Testar vínculos** para verificar se o documento contém os links esperados.

### Erro HTTP 429

O Zotero pode limitar temporariamente as requisições. Aguarde e tente novamente.

---

## 13. Estrutura dos projetos

### Extensão

A versão 0.3.0 contém, entre outros:

```text
consensus-zotero-extension/
├── manifest.json
├── adapters.js
├── content.js
├── service-worker.js
├── popup.html
├── popup.js
├── popup.css
├── options.html
├── options.js
├── options.css
└── icons/
```

Responsabilidades principais:

- `manifest.json`: configuração e permissões da extensão;
- `adapters.js`: reconhecimento das plataformas e regras específicas;
- `content.js`: identificação de resultados e inserção dos controles;
- `service-worker.js`: comunicação com Zotero/Crossref e operações de salvamento;
- `popup.*`: conexão e estado da conta;
- `options.*`: configuração da coleção padrão.

### Google Docs

O pacote Apps Script recebido contém:

```text
integracao-docs/
├── Código.gs
├── Sidebar.html
└── appsscript.json
```

No material recebido, apenas `Código.gs` contém conteúdo. `Sidebar.html` e `appsscript.json` estão vazios e precisam ser recuperados/preenchidos conforme descrito na seção de instalação.

---

## 14. Checklist de instalação

### Extensão de navegador

- [ ] Extrair o ZIP da extensão.
- [ ] Carregar a pasta no Chrome ou Edge.
- [ ] Criar API Key com leitura e escrita.
- [ ] Conectar a extensão ao Zotero.
- [ ] Definir a coleção padrão.
- [ ] Testar a captura em uma plataforma suportada.
- [ ] Conferir o item na biblioteca Zotero.

### Google Docs

- [ ] Abrir o Apps Script vinculado ao documento.
- [ ] Inserir o conteúdo de `Código.gs`.
- [ ] Recuperar/preencher `Sidebar.html`.
- [ ] Conferir o manifesto do projeto.
- [ ] Salvar e autorizar o script.
- [ ] Configurar User ID e API Key.
- [ ] Pesquisar uma referência.
- [ ] Inserir uma citação individual.
- [ ] Inserir uma citação agrupada.
- [ ] Testar os vínculos.
- [ ] Gerar/atualizar a seção de referências.

---

## 15. Limites e observações

- A extensão e o Apps Script são projetos separados; a integração entre eles ocorre por meio da biblioteca Zotero compartilhada.
- A extensão documentada é a versão 0.3.0. Se uma versão posterior for instalada, atualize este README para refletir os arquivos e recursos reais.
- O Apps Script documentado é o conteúdo de `Código.gs` recebido no arquivo `integracao-docs.zip`.
- A interface da barra lateral não pode ser descrita ou validada até que o `Sidebar.html` correto seja fornecido.
- O arquivo `appsscript.json` recebido está vazio; não foi possível confirmar configurações específicas do manifesto.
- A formatação bibliográfica é solicitada ao Zotero usando o estilo configurado no código. O resultado depende da disponibilidade do estilo e dos metadados dos itens.
- Antes de utilizar em um trabalho acadêmico final, revise os metadados e confira as exigências institucionais aplicáveis à versão da norma ABNT adotada.

---

## 16. Recursos oficiais

- [Zotero](https://www.zotero.org/)
- [Zotero — Configurações de API Keys](https://www.zotero.org/settings/keys)
- [Zotero Web API](https://www.zotero.org/support/dev/web_api/v3/start)
- [Google Apps Script](https://developers.google.com/apps-script)
- [Google Apps Script — Document Service](https://developers.google.com/apps-script/reference/document)
- [Google Apps Script — HTML Service](https://developers.google.com/apps-script/guides/html)
- [Google Docs](https://docs.google.com/)

