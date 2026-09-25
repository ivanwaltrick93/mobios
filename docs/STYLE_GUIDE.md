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

Em [`components/ui.tsx`](../apps/web/src/components/ui.tsx). Use-os em vez de repetir classes:

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
| `Selo` (`sucesso` / `neutro` / `primario` / `alerta`) | Status curtos; `alerta` para pendências (ex.: "Cadastro incompleto") |
| `Tabela`, `Cabecalho`, `Th`, `Linha`, `Td`, `LinhaVazia` | Listagens |
| `TextoSuave` | Texto secundário |
| `Avatar` (`sm` / `md` / `perfil` / `lg`), `Iniciais` | Foto do usuário em círculo; sem foto (ou para clientes), iniciais na cor principal |
| `Placa` (`sm` / `md` / `lg`) | Placa do veículo desenhada no padrão Mercosul |
| `Abas` | Abas de uma página (ex.: perfil do cliente), com contagem opcional |
| `Etapas` + `useAssistente` (`lib/assistente.ts`) | Cadastro em etapas: cada etapa valida só os seus campos; na edição, etapas livres e "Salvar" sempre visível |
| `Vazio` | Estado vazio com ícone, mensagem e ação (nunca uma tabela vazia) |
| `CampoBusca` | Busca grande com lupa no topo das listagens |
| `Paginacao` (`POR_PAGINA` = 20) | Anterior/Próxima, "Página X de Y" e total; usada em toda listagem |
| `BotaoVisualizar` | Ação "Visualizar" das tabelas: ícone de olho com a dica "Visualizar". Com `para`, abre a página de detalhes; com `aoClicar`, abre os detalhes na própria linha |
| `Detalhes` | Dados do registro só para leitura, abertos na linha da tabela (cadastros sem página própria: categorias, marcas, depósitos, vendedores) |
| `Janela` | Janela sobre a página (`<dialog>` nativo) para consulta rápida sem sair da tela; fecha no X, com Esc ou clicando fora. Ex.: dados do usuário vinculado ao vendedor |
| `ImportarCsv` (em `components/ImportarCsv.tsx`) | Importação de planilha: colunas aceitas, modelo para baixar e resultado linha a linha |

## Padrões de tela

- **Listas de cadastro** em tabela (decisão do dono do produto: mais analítico, menos rolagem): filtros acima, nome do registro como link para o detalhe, status em `Selo`, **20 por página** com `Paginacao`.
- **Toda tabela de cadastro** tem na última coluna a ação `BotaoVisualizar` (olho, dica "Visualizar"), antes das demais ações da linha.
- **Filtros extras** de uma listagem ficam recolhidos por padrão (botão "Mostrar filtros", com a contagem dos que estão diferentes do padrão); a busca fica sempre visível.
- **Menu lateral** com submenu que abre e fecha quando a área tem mais de uma página (Clientes → Clientes · Veículos; Orçamentos (item único); Ofertas → Materiais · Serviços · Categorias · Marcas · Depósitos (cada item segue o próprio módulo de acesso); Política Comercial → Linhas de Preço · Tabelas de Preço; Equipe → Usuários · Vendedores; Configurações → Aparência e logo · Funções e permissões · uma página por lista parametrizável). Com o submenu, as páginas não repetem abas de navegação.
- **Importação por planilha** sempre com `ImportarCsv`: mostra as colunas aceitas, avisa que a 1ª linha é o cabeçalho, oferece o modelo e lista as linhas com erro.
- **Voltar** fica no topo, à esquerda, em todas as páginas menos o Início (componente `Voltar`, no `Layout`). Páginas raiz do menu voltam ao Início; as demais, à página anterior. Não crie links de voltar dentro das páginas.
- **Detalhe** como perfil: cabeçalho com ações rápidas (WhatsApp, Editar) e abas.
- **Cadastro novo** em etapas curtas, com botões grandes para escolhas (ex.: Pessoa física / jurídica).

## Regras

1. Cor nova? Crie um token em `index.css` (`:root` + `@theme inline`) e documente aqui. Nunca use cor direto no componente.
2. Texto sobre fundo colorido usa o token `sobre-*` correspondente, nunca `text-white`.
3. Tela nova usa os componentes de `ui.tsx`; classe solta só para layout (grid, espaçamento, tamanho).
4. Contraste mínimo WCAG AA; as cores parametrizáveis já garantem isso pelo cálculo automático do texto.
