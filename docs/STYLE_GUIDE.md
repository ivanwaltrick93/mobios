# MobiOS — Style guide

Toda a interface usa **tokens** definidos em [`apps/web/src/index.css`](../apps/web/src/index.css).
Nenhuma tela usa cor fixa do Tailwind (`slate-*`, `blue-*`, `bg-white`, hex solto). Mudou um token, mudou o sistema inteiro.

## Cores

### Parametrizáveis por oficina

Configuradas pelo admin em **Configurações → Aparência** e salvas na tabela `tenant_aparencia` (uma linha por oficina; `null` = padrão, e nas cores de texto `null` = contraste automático).
Aplicadas em runtime por [`lib/tema.ts`](../apps/web/src/lib/tema.ts), inclusive na **tela de login** (via `GET /api/publico/aparencia`). A tela de configuração avisa quando uma combinação fica abaixo do contraste WCAG AA (4,5:1).

| Token | Classe Tailwind | Padrão | Uso |
|---|---|---|---|
| `--cor-primaria` | `bg-primaria`, `text-primaria`, `border-primaria` | `#1d4ed8` | Links, destaques, ícones, item ativo (e fundo padrão do botão principal) |
| `--cor-sobre-primaria` | `text-sobre-primaria` | calculada | Texto sobre a cor principal |
| `--cor-menu` | `bg-menu` | `#ffffff` | Fundo do menu lateral |
| `--cor-menu-texto` | `text-menu-texto` | calculada | Texto do menu |
| `--cor-botao-primario` | `bg-botao-primario` | = cor principal | Fundo do botão principal (Salvar, Entrar, Confirmar) |
| `--cor-botao-primario-texto` | `text-botao-primario-texto` | automático | Escrita do botão principal |
| `--cor-botao-secundario` | `bg-botao-secundario` | `#ffffff` | Fundo do botão secundário (Cancelar, Voltar) |
| `--cor-botao-secundario-texto` | `text-botao-secundario-texto` | automático | Escrita do botão secundário |

### Derivadas (não configurar diretamente)

Calculadas com `color-mix()` a partir das parametrizáveis, então acompanham a troca de cor.

| Token | Classe | Uso |
|---|---|---|
| `--cor-primaria-hover` | `hover:bg-primaria-hover` | Hover de elementos na cor principal (reservado) |
| `--cor-primaria-suave` | `bg-primaria-suave` | Fundo de item selecionado, selo de destaque |
| `--cor-menu-ativo` | `bg-menu-ativo` | Item ativo/hover no menu |
| `--cor-menu-borda` | `border-menu-borda` | Divisória do menu |
| `--cor-botao-primario-hover` / `--cor-botao-secundario-hover` | `hover:bg-botao-*-hover` | Hover dos botões |
| `--cor-botao-secundario-borda` | `border-botao-secundario-borda` | Borda do botão secundário (acompanha o texto) |

### Neutros e estados (fixos)

| Token | Classe | Uso |
|---|---|---|
| `--cor-fundo` | `bg-fundo` | Fundo da página |
| `--cor-superficie` | `bg-superficie` | Cartões, campos, tabelas |
| `--cor-superficie-alt` | `bg-superficie-alt` | Cabeçalho de tabela, hover de linha, áreas de formulário |
| `--cor-borda` / `--cor-borda-forte` | `border-borda` / `border-borda-forte` | Divisórias / bordas de campo e botão secundário |
| `--cor-texto` / `--cor-texto-suave` | `text-texto` / `text-texto-suave` | Texto principal / secundário |
| `--cor-sucesso` (+ `-suave`, `-hover`, `sobre-sucesso`) | `text-sucesso`, `bg-sucesso-suave`, `bg-sucesso` | Confirmações, status "Ativo", botão `sucesso` |
| `--cor-perigo` (+ `-suave`, `-hover`, `sobre-perigo`) | `bg-perigo`, `text-perigo`, `bg-perigo-suave` | Erros, exclusão |
| `--cor-alerta` (+ `-suave`) | `text-alerta`, `bg-alerta-suave` | Avisos, "cadastro incompleto" |
| `--cor-placa-*` (fundo, texto, borda, faixa, faixa-texto) | `bg-placa-faixa`... | Desenho da placa Mercosul (componente `Placa`); fixas, não seguem o tema |

## Marca MobiOS

Engrenagem com "M" vazado, em [`components/Marca.tsx`](../apps/web/src/components/Marca.tsx):

| Uso | Onde |
|---|---|
| `MarcaMobiOS` | Só o símbolo. Usa `currentColor`, então segue a cor do texto em volta |
| `LogoMobiOS` | Símbolo + nome. Aparece no menu e no login quando a oficina não tem logo próprio (`herdarCor` no menu, para manter o contraste com o fundo do menu) |
| `Rodape` | "ANO - MobiOS Oficina - Sistema de Gestão Empresarial", em todas as telas |
| `public/favicon.svg`, `public/mobios-logo.svg` | Arquivos fixos na cor padrão (#1d4ed8): ícone da aba e README |

O logo da **oficina** (Configurações → Logo) tem prioridade sobre a marca MobiOS no menu e no login; o rodapé sempre mostra a marca MobiOS.

## Componentes

Em [`components/ui/`](../apps/web/src/components/ui/) (`base`, `pagina`, `filtros`, `acoes`, `feedback`); as telas importam tudo de `'../components/ui'`. Use-os em vez de repetir classes.

### Direção visual (UX 2.0, desde 25/09/2026)

Aplicação enterprise densa, inspirada em SAP Fiori, com identidade própria: fundo claro, superfícies brancas com borda sutil e sombra mínima, azul (ou a cor da oficina) só para ação, seleção, link, navegação ativa e foco. Fonte **Inter** (`@fontsource-variable/inter`). Corpo 13–14 px, título de página 20 px, linhas de tabela ~36 px, conteúdo fluido até 1600 px. Cards só para KPI, resumo ou bloco independente; listas e formulários ficam abertos e densos.

### Estrutura (AppShell, em `components/Layout.tsx`)

- **Menu lateral** com ícones, grupos com submenu e modo **recolhido** (só ícones; a escolha fica no navegador). **Configurações** separada no pé. No celular, vira gaveta aberta pelo botão ☰.
- **Topo**: ☰ (celular), **Voltar**, **trilha** (área › página › registro; a página de detalhe completa com `useTrilha(nome)` de `lib/trilha.ts`) e o menu do usuário (Meu perfil, Sair).

### Componentes do design system

| Componente | Equivale a | Para quê |
|---|---|---|
| `CabecalhoPagina` | PageHeader | Título, contexto e ações da página |
| `BarraFerramentas` | Toolbar | Ações/controles em linha |
| `BarraFiltros` + `FiltroSelect` | FilterBar / FilterField | Busca + 2–3 filtros em linha; os demais em "Mais filtros" (com contador e "Limpar"); total de registros à direita |
| `ThOrdenavel` | ordenação | Cabeçalho que ordena a lista (crescente/decrescente) |
| `MenuAcoes` | ActionMenu | Ações do registro no "⋯" (Visualizar, Editar, WhatsApp, Excluir…) |
| `BotaoIcone` | IconButton | Botão só com ícone, com dica |
| `Suspenso` | popover | Painel que abre abaixo de um botão (base do menu e do "Mais filtros") |
| `CartaoKpi` | KPI Card | Indicador com valor, detalhe e variação ↑↓ contra o período anterior; `null` = "Em breve" |
| `CabecalhoObjeto` | ObjectHeader | Cabeçalho do detalhe: ícone, nome, selos, 3–5 atributos em linha, ações e avisos curtos |
| `Bloco` | Section | Bloco com título (detalhe e Início) |
| `Dado` | atributo | Par rótulo/valor de leitura |
| `Carregando` | LoadingState | Carregamento padrão |
| `Confirmacao` | ConfirmationDialog | Confirmação de ação (no lugar do `confirm()` do navegador) |
| `useNotificar()` + `ProvedorNotificacoes` | Toast | Aviso rápido que some sozinho (ex.: "Cliente excluído.") |
| `GraficoRosca`, `GraficoBarras` (`components/Graficos.tsx`) | gráficos | SVG/HTML próprio, cores por token |

### Componentes base

| Componente | Para quê |
|---|---|
| `Titulo` | Título da página, com ação opcional à direita |
| `Cartao` | Bloco de conteúdo (`className` substitui o padding padrão) |
| `Botao` (`primario` = confirmar / `secundario` = cancelar, voltar / `perigo` = excluir / `sucesso` = concluir, sempre verde, fora do tema: ex.: Emitir orçamento), `BotaoLink` | Ações. Use sempre a variante pela função do botão, para o tema da oficina valer |
| `Campo` + `Input` / `Select` / `AreaTexto` | Formulários, com rótulo, dica e erro |
| `Marcador` | Caixa de seleção com rótulo ao lado |
| `InputMascara` + `mascara*` (`packages/shared/src/mascaras.ts`) | Campo com máscara ao digitar (CPF/CNPJ, telefone, CEP, placa, e-mail...). Só formata: a validação e a limpeza da pontuação ficam no schema |
| `Secao` | Bloco de formulário com título (Identificação, Contato, Endereços...) e ação opcional |
| `Alerta` | Mensagem de erro |
| `Aviso` | Aviso que não é erro (ex.: itens recalculados ou removidos ao salvar o orçamento) |
| `SeloSituacao`, `ClienteDoOrcamento`, `PrecoNegociado`, `Totais` (`components/Orcamento.tsx`) | Orçamento: situação, cliente com ícone de alerta (inativo/incompleto), preço negociado com o de tabela riscado e o percentual, e subtotal/descontos/total |
| `Selo` (`sucesso` / `neutro` / `primario` / `alerta` / `perigo` / `info`; `ponto` = bolinha de status) | StatusBadge. Status curtos; `alerta` para pendências (ex.: "Cadastro incompleto"); `ponto` para situação do registro (● Ativo) |
| `Tabela`, `Cabecalho`, `Th`, `Linha`, `Td`, `LinhaVazia` | Listagens |
| `TextoSuave` | Texto secundário |
| `Avatar` (`sm` / `md` / `perfil` / `lg`), `Iniciais` | Foto do usuário em círculo; sem foto (ou para clientes), iniciais na cor principal |
| `Placa` (`sm` / `md` / `lg`) | Placa do veículo desenhada no padrão Mercosul |
| `Abas` | Abas de uma página (ex.: perfil do cliente), com contagem opcional |
| `Etapas` + `useAssistente` (`lib/assistente.ts`) | Cadastro em etapas: cada etapa valida só os seus campos; na edição, etapas livres e "Salvar" sempre visível |
| `Vazio` | Estado vazio com ícone, mensagem e ação (nunca uma tabela vazia) |
| `CampoBusca` | Busca com lupa (dentro da `BarraFiltros` nas listas) |
| `Paginacao` (`POR_PAGINA` = 20) | Anterior/Próxima, "Página X de Y" e total; usada em toda listagem |
| `BotaoVisualizar` | Ação "Visualizar" das tabelas: ícone de olho com a dica "Visualizar". Com `para`, abre a página de detalhes; com `aoClicar`, abre os detalhes na própria linha |
| `Detalhes` | Dados do registro só para leitura, abertos na linha da tabela (cadastros sem página própria: categorias, marcas, depósitos, vendedores) |
| `Janela` | Janela sobre a página (`<dialog>` nativo) para consulta rápida sem sair da tela; fecha no X, com Esc ou clicando fora. Ex.: dados do usuário vinculado ao vendedor |
| `ImportarCsv` (em `components/ImportarCsv.tsx`) | Importação de planilha: colunas aceitas, modelo para baixar e resultado linha a linha |

## Padrões de tela

- **Listas de cadastro** em tabela (decisão do dono do produto: mais analítico, menos rolagem): filtros acima, nome do registro como link para o detalhe, status em `Selo`, **20 por página** com `Paginacao`.
- **Listas (padrão UX 2.0, já em Clientes):** `CabecalhoPagina` → `BarraFiltros` → `Tabela` densa (nome como link, números à direita com `tabular-nums`, status com `Selo ponto`, colunas ordenáveis quando a API permite) → ações no `MenuAcoes` da última coluna → `Paginacao`. Telas ainda não migradas mantêm o `BotaoVisualizar` e os filtros antigos até a onda delas.
- **Filtros extras** ficam em "Mais filtros" (painel suspenso), com a contagem dos que estão diferentes do padrão; a busca fica sempre visível.
- **Menu lateral** com submenu que abre e fecha quando a área tem mais de uma página (Clientes → Clientes · Veículos; Orçamentos (item único); Ofertas → Materiais · Serviços · Categorias · Marcas · Depósitos (cada item segue o próprio módulo de acesso); Política Comercial → Linhas de Preço · Tabelas de Preço; Equipe → Usuários · Vendedores; Configurações → Aparência e logo · Funções e permissões · uma página por lista parametrizável). Com o submenu, as páginas não repetem abas de navegação.
- **Importação por planilha** sempre com `ImportarCsv`: mostra as colunas aceitas, avisa que a 1ª linha é o cabeçalho, oferece o modelo e lista as linhas com erro.
- **Voltar** fica no topo, à esquerda, em todas as páginas menos o Início (componente `Voltar`, no `Layout`). Páginas raiz do menu voltam ao Início; as demais, à página anterior. Não crie links de voltar dentro das páginas.
- **Detalhe (Object Page, já em Cliente):** `CabecalhoObjeto` compacto (atributos principais em linha, "Editar" + `MenuAcoes`), abas logo abaixo, conteúdo em `Bloco`s e listas em `Tabela`. Confirmações sempre com `Confirmacao`.
- **Início:** `CabecalhoPagina` com período e atalhos, faixa de `CartaoKpi`, depois gráficos e blocos que respondem uma pergunta de negócio cada.
- **Cadastro novo** em etapas curtas, com botões grandes para escolhas (ex.: Pessoa física / jurídica).

## Regras

1. Cor nova? Crie um token em `index.css` (`:root` + `@theme inline`) e documente aqui. Nunca use cor direto no componente.
2. Texto sobre fundo colorido usa o token `sobre-*` correspondente, nunca `text-white`.
3. Tela nova usa os componentes de `components/ui`; classe solta só para layout (grid, espaçamento, tamanho).
4. Contraste mínimo WCAG AA; as cores parametrizáveis já garantem isso pelo cálculo automático do texto.
