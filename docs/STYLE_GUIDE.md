# MobiOS — Style guide

Toda a interface usa **tokens** definidos em [`apps/web/src/index.css`](../apps/web/src/index.css).
Nenhuma tela usa cor fixa do Tailwind (`slate-*`, `blue-*`, `bg-white`, hex solto). Mudou um token, mudou o sistema inteiro.

## Cores

### Parametrizáveis por oficina

Configuradas pelo admin em **Configurações → Aparência** e salvas na tabela `tenants` (`cor_primaria`, `cor_menu`; `null` = padrão).
Aplicadas em runtime por [`lib/tema.ts`](../apps/web/src/lib/tema.ts), que também calcula a cor do texto por contraste (WCAG).

| Token | Classe Tailwind | Padrão | Uso |
|---|---|---|---|
| `--cor-primaria` | `bg-primaria`, `text-primaria`, `border-primaria` | `#1d4ed8` | Botões, links, destaques, item ativo |
| `--cor-sobre-primaria` | `text-sobre-primaria` | calculada | Texto sobre a cor principal |
| `--cor-menu` | `bg-menu` | `#ffffff` | Fundo do menu lateral |
| `--cor-menu-texto` | `text-menu-texto` | calculada | Texto do menu |

### Derivadas (não configurar diretamente)

Calculadas com `color-mix()` a partir das parametrizáveis, então acompanham a troca de cor.

| Token | Classe | Uso |
|---|---|---|
| `--cor-primaria-hover` | `hover:bg-primaria-hover` | Hover do botão principal |
| `--cor-primaria-suave` | `bg-primaria-suave` | Fundo de item selecionado, selo de destaque |
| `--cor-menu-ativo` | `bg-menu-ativo` | Item ativo/hover no menu |
| `--cor-menu-borda` | `border-menu-borda` | Divisória do menu |

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
| `--cor-alerta` | `text-alerta` | Avisos |

## Componentes

Em [`components/ui.tsx`](../apps/web/src/components/ui.tsx). Use-os em vez de repetir classes:

| Componente | Para quê |
|---|---|
| `Titulo` | Título da página, com ação opcional à direita |
| `Cartao` | Bloco de conteúdo (`className` substitui o padding padrão) |
| `Botao` (`primario` / `secundario` / `perigo`), `BotaoLink` | Ações |
| `Campo` + `Input` / `Select` | Formulários, com rótulo, dica e erro |
| `Alerta` | Mensagem de erro |
| `Selo` (`sucesso` / `neutro` / `primario`) | Status curtos |
| `Tabela`, `Cabecalho`, `Th`, `Linha`, `Td`, `LinhaVazia` | Listagens |
| `TextoSuave` | Texto secundário |

## Regras

1. Cor nova? Crie um token em `index.css` (`:root` + `@theme inline`) e documente aqui. Nunca use cor direto no componente.
2. Texto sobre fundo colorido usa o token `sobre-*` correspondente, nunca `text-white`.
3. Tela nova usa os componentes de `ui.tsx`; classe solta só para layout (grid, espaçamento, tamanho).
4. Contraste mínimo WCAG AA; as cores parametrizáveis já garantem isso pelo cálculo automático do texto.
