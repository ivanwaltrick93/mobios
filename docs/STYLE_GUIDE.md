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
| `--cor-sucesso` (+ `-suave`) | `text-sucesso`, `bg-sucesso-suave` | Confirmações, status "Ativo" |
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
| `Botao` (`primario` = confirmar / `secundario` = cancelar, voltar / `perigo` = excluir), `BotaoLink` | Ações. Use sempre a variante pela função do botão, para o tema da oficina valer |
| `Campo` + `Input` / `Select` / `AreaTexto` | Formulários, com rótulo, dica e erro |
| `Marcador` | Caixa de seleção com rótulo ao lado |
| `Secao` | Bloco de formulário com título (Identificação, Contato, Endereços...) e ação opcional |
| `Alerta` | Mensagem de erro |
| `Selo` (`sucesso` / `neutro` / `primario` / `alerta`) | Status curtos; `alerta` para pendências (ex.: "Cadastro incompleto") |
| `Tabela`, `Cabecalho`, `Th`, `Linha`, `Td`, `LinhaVazia` | Listagens |
| `TextoSuave` | Texto secundário |
| `Avatar` (`sm` / `md` / `perfil` / `lg`), `Iniciais` | Foto do usuário em círculo; sem foto (ou para clientes), iniciais na cor principal |
| `Placa` (`sm` / `md` / `lg`) | Placa do veículo desenhada no padrão Mercosul |
| `Abas` | Abas de uma página (ex.: perfil do cliente), com contagem opcional |
| `Etapas` + `useAssistente` (`lib/assistente.ts`) | Cadastro em etapas: cada etapa valida só os seus campos; na edição, etapas livres e "Salvar" sempre visível |
| `Vazio` | Estado vazio com ícone, mensagem e ação (nunca uma tabela vazia) |

## Padrões de tela

- **Listas de cadastro** em cartões (quem é, como falar, o que tem), não em tabelas. Tabelas ficam para relatórios.
- **Detalhe** como perfil: cabeçalho com ações rápidas (WhatsApp, Editar) e abas.
- **Cadastro novo** em etapas curtas, com botões grandes para escolhas (ex.: Pessoa física / jurídica).

## Regras

1. Cor nova? Crie um token em `index.css` (`:root` + `@theme inline`) e documente aqui. Nunca use cor direto no componente.
2. Texto sobre fundo colorido usa o token `sobre-*` correspondente, nunca `text-white`.
3. Tela nova usa os componentes de `ui.tsx`; classe solta só para layout (grid, espaçamento, tamanho).
4. Contraste mínimo WCAG AA; as cores parametrizáveis já garantem isso pelo cálculo automático do texto.
