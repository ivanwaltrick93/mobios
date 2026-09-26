/*
 * Componentes base do style guide. Use sempre estes em vez de classes soltas:
 * cores só por tokens (bg-primaria, text-texto-suave...), definidos em src/index.css.
 */
import { Eye, Info, Search, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Link } from 'react-router';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TdHTMLAttributes,
  TextareaHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

const base =
  'block w-full rounded-md border border-borda-forte bg-superficie px-2.5 py-1.5 text-sm text-texto shadow-sm placeholder:text-texto-suave focus:border-primaria focus:outline-none focus:ring-1 focus:ring-primaria disabled:bg-superficie-alt';

type CampoProps = { rotulo: string; erro?: { message?: string }; dica?: string; children: ReactNode };

export function Campo({ rotulo, erro, dica, children }: CampoProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-texto-suave">{rotulo}</span>
      {children}
      {erro?.message ? (
        <span className="text-xs text-perigo">{erro.message}</span>
      ) : (
        dica && <span className="text-xs text-texto-suave">{dica}</span>
      )}
    </label>
  );
}

export const Input = ({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`${base} ${className}`} {...props} />
);
export const Select = ({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`${base} ${className}`} {...props} />
);
/**
 * Campo com máscara aplicada enquanto se digita (CPF, CNPJ, telefone, CEP, placa...).
 * Use com `register`: `<InputMascara registro={form.register('telefone')} mascara={mascaraTelefone} />`.
 * A máscara só formata; quem valida e tira a pontuação é o schema.
 */
export const InputMascara = ({
  registro,
  mascara,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { registro: UseFormRegisterReturn; mascara: (v: string) => string }) => (
  <Input
    autoComplete="off"
    {...props}
    {...registro}
    onChange={(e) => {
      e.target.value = mascara(e.target.value);
      registro.onChange(e);
    }}
  />
);

export const AreaTexto = ({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} className={`${base} ${className}`} {...props} />
);

/** Caixa de seleção com rótulo ao lado (use com `register`). */
export const Marcador = ({ rotulo, ...props }: InputHTMLAttributes<HTMLInputElement> & { rotulo: ReactNode }) => (
  <label className="flex items-center gap-2 text-sm text-texto">
    <input type="checkbox" className="size-4 accent-primaria" {...props} />
    {rotulo}
  </label>
);

/** Bloco de formulário com título (ex.: "Contato", "Endereços"). */
export const Secao = ({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) => (
  <section className="space-y-3 border-t border-borda pt-4 first:border-0 first:pt-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">{titulo}</h3>
      {acao}
    </div>
    {children}
  </section>
);

type Variante = 'primario' | 'secundario' | 'perigo' | 'sucesso';

const coresBotao: Record<Variante, string> = {
  primario: 'bg-botao-primario text-botao-primario-texto hover:bg-botao-primario-hover',
  secundario:
    'border border-botao-secundario-borda bg-botao-secundario text-botao-secundario-texto hover:bg-botao-secundario-hover',
  perigo: 'bg-perigo text-sobre-perigo hover:bg-perigo-hover',
  // Verde fixo (não segue o tema da oficina): ações de conclusão, como emitir o orçamento.
  sucesso: 'bg-sucesso text-sobre-sucesso hover:bg-sucesso-hover',
};

export const classesBotao = (variante: Variante = 'primario', className = '') =>
  `inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition disabled:opacity-50 ${coresBotao[variante]} ${className}`;

type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante };

export const Botao = ({ variante = 'primario', className = '', ...props }: BotaoProps) => (
  <button className={classesBotao(variante, className)} {...props} />
);

/** Ação discreta em texto (ex.: "Editar" numa linha de tabela). */
export const BotaoLink = ({
  perigo,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { perigo?: boolean }) => (
  <button className={`text-sm hover:underline ${perigo ? 'text-perigo' : 'text-primaria'} ${className}`} {...props} />
);

export const Alerta = ({ children }: { children: ReactNode }) =>
  children ? <div className="rounded-md bg-perigo-suave px-3 py-2 text-sm text-perigo">{children}</div> : null;

/** Aviso que não é erro (ex.: itens recalculados ou removidos ao salvar). */
export const Aviso = ({ children }: { children: ReactNode }) =>
  children ? (
    <div role="status" className="rounded-md bg-alerta-suave px-3 py-2 text-sm text-alerta">
      {children}
    </div>
  ) : null;

/** `className` substitui o padding padrão (p-4), evitando classes de padding conflitantes. */
export const Cartao = ({ children, className = 'p-4' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-lg border border-borda bg-superficie shadow-sm ${className}`}>{children}</div>
);

export const Titulo = ({ children, acao }: { children: ReactNode; acao?: ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <h1 className="text-xl font-semibold text-texto">{children}</h1>
    {acao}
  </div>
);

export const TextoSuave = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-sm text-texto-suave ${className}`}>{children}</p>
);

export type Tom = 'sucesso' | 'neutro' | 'primario' | 'alerta' | 'perigo' | 'info';

const coresSelo: Record<Tom, string> = {
  sucesso: 'bg-sucesso-suave text-sucesso',
  neutro: 'bg-superficie-alt text-texto-suave',
  primario: 'bg-primaria-suave text-primaria',
  alerta: 'bg-alerta-suave text-alerta',
  perigo: 'bg-perigo-suave text-perigo',
  info: 'bg-info-suave text-info',
};

/** Status curto (StatusBadge). `ponto`: bolinha colorida antes do texto, para situação de registro (Ativo, Inativo). */
export const Selo = ({
  tom = 'neutro',
  titulo,
  ponto = false,
  children,
}: {
  tom?: Tom;
  titulo?: string;
  ponto?: boolean;
  children: ReactNode;
}) => (
  <span
    title={titulo}
    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${coresSelo[tom]}`}
  >
    {ponto && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

// ---------- Tabela ----------

/**
 * Tabela densa (DataTable): borda leve, sem margens internas, rolagem horizontal só dentro dela em telas estreitas.
 * Números alinhados à direita com `tabular-nums`; ordenação com `ThOrdenavel`; ações da linha com `MenuAcoes`.
 */
export const Tabela = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto rounded-md border border-borda bg-superficie">
    <table className="w-full text-left text-sm">{children}</table>
  </div>
);

export const Cabecalho = ({ children }: { children: ReactNode }) => (
  <thead className="border-b border-borda bg-superficie-alt text-xs text-texto-suave">
    <tr>{children}</tr>
  </thead>
);

export const Th = ({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`} {...props} />
);

export const Linha = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <tr className={`border-b border-borda last:border-0 ${className}`}>{children}</tr>
);

export const Td = ({
  suave,
  className = '',
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { suave?: boolean }) => (
  <td className={`px-3 py-2 ${suave ? 'text-texto-suave' : ''} ${className}`} {...props} />
);

export const LinhaVazia = ({ colunas, children }: { colunas: number; children: ReactNode }) => (
  <tr>
    <td colSpan={colunas} className="px-4 py-8 text-center text-texto-suave">
      {children}
    </td>
  </tr>
);

/**
 * Ação "Visualizar" das tabelas: ícone de olho com a dica "Visualizar".
 * Com `para`, leva à página de detalhes; com `aoClicar`, abre os detalhes na própria linha (`aberto` destaca).
 */
export function BotaoVisualizar({
  para,
  aoClicar,
  aberto = false,
  titulo = 'Visualizar',
}: {
  para?: string;
  aoClicar?: () => void;
  aberto?: boolean;
  /** Dica e rótulo acessível (ex.: "Visualizar cliente"). */
  titulo?: string;
}) {
  const classes = `inline-flex rounded-md p-1.5 hover:bg-superficie-alt ${aberto ? 'text-primaria' : 'text-texto-suave hover:text-primaria'}`;
  const icone = <Eye className="size-4" aria-hidden />;
  return para ? (
    <Link to={para} title={titulo} aria-label={titulo} className={classes}>
      {icone}
    </Link>
  ) : (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-expanded={aberto}
      onClick={aoClicar}
      className={classes}
    >
      {icone}
    </button>
  );
}

/** Dados de um registro só para leitura (detalhes abertos na linha da tabela). */
export const Detalhes = ({ itens }: { itens: { rotulo: string; valor: ReactNode }[] }) => (
  <dl className="grid gap-x-6 gap-y-3 rounded-md bg-superficie-alt p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
    {itens.map((i) => (
      <div key={i.rotulo}>
        <dt className="text-xs text-texto-suave">{i.rotulo}</dt>
        <dd className="text-texto">{i.valor}</dd>
      </div>
    ))}
  </dl>
);

// ---------- Paginação ----------

/** Registros por página em todas as listagens. */
export const POR_PAGINA = 20;

/**
 * Navegação entre páginas de uma listagem paginada na API (`pagina`/`porPagina`).
 * Com tudo numa página só, mostra apenas o total.
 */
export function Paginacao({
  pagina,
  total,
  aoMudar,
  carregando = false,
  porPagina = POR_PAGINA,
}: {
  pagina: number;
  total: number;
  aoMudar: (pagina: number) => void;
  carregando?: boolean;
  porPagina?: number;
}) {
  if (total === 0) return null;
  const paginas = Math.ceil(total / porPagina);
  const primeiro = (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(total, pagina * porPagina);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3">
      <TextoSuave className="text-xs">
        {paginas > 1 ? `${primeiro}–${ultimo} de ` : ''}
        {total.toLocaleString('pt-BR')} registro(s)
      </TextoSuave>
      {paginas > 1 && (
        <div className="flex items-center gap-2">
          <Botao variante="secundario" disabled={pagina <= 1 || carregando} onClick={() => aoMudar(pagina - 1)}>
            Anterior
          </Botao>
          <span className="text-sm text-texto-suave">
            Página {pagina} de {paginas}
          </span>
          <Botao variante="secundario" disabled={pagina >= paginas || carregando} onClick={() => aoMudar(pagina + 1)}>
            Próxima
          </Botao>
        </div>
      )}
    </nav>
  );
}

// ---------- Abas ----------

/** Abas de uma página (ex.: perfil do cliente). `contagem` aparece ao lado do rótulo. */
export function Abas<T extends string>({
  abas,
  atual,
  aoTrocar,
}: {
  abas: { id: T; rotulo: string; contagem?: number }[];
  atual: T;
  aoTrocar: (id: T) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-borda" role="tablist">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          role="tab"
          aria-selected={a.id === atual}
          onClick={() => aoTrocar(a.id)}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
            a.id === atual
              ? 'border-primaria font-medium text-primaria'
              : 'border-transparent text-texto-suave hover:text-texto'
          }`}
        >
          {a.rotulo}
          {a.contagem != null && (
            <span
              className={`rounded-full px-1.5 text-xs ${a.id === atual ? 'bg-primaria-suave' : 'bg-superficie-alt'}`}
            >
              {a.contagem}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** Campo de busca grande, com lupa, usado no topo das listagens. */
export const CampoBusca = ({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  autoFocus,
}: {
  /** Nome acessível do campo (lido por leitores de tela). */
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) => (
  <div className="relative">
    <Search
      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-suave"
      aria-hidden
    />
    <Input
      autoFocus={autoFocus}
      className="h-9 pl-9"
      placeholder={placeholder}
      aria-label={rotulo}
      value={valor}
      onChange={(e) => aoMudar(e.target.value)}
    />
  </div>
);

/** Estado vazio amigável: ícone, mensagem e ação opcional. */
export const Vazio = ({
  icone,
  titulo,
  children,
  acao,
}: {
  icone: ReactNode;
  titulo: string;
  children?: ReactNode;
  acao?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-borda-forte px-6 py-8 text-center">
    <span className="text-texto-suave [&>svg]:size-10">{icone}</span>
    <p className="font-medium text-texto">{titulo}</p>
    {children && <p className="max-w-md text-sm text-texto-suave">{children}</p>}
    {acao && <div className="mt-2">{acao}</div>}
  </div>
);

/** Título e botão de fechar de Janela e Gaveta. */
const BarraDoDialogo = ({ titulo, aoFechar }: { titulo: string; aoFechar: () => void }) => (
  <div className="flex items-center justify-between gap-3 border-b border-borda px-5 py-3">
    <h2 className="font-semibold">{titulo}</h2>
    <button
      type="button"
      title="Fechar"
      aria-label="Fechar"
      onClick={aoFechar}
      className="rounded-md p-1.5 text-texto-suave hover:bg-superficie-alt hover:text-texto"
    >
      <X className="size-4" aria-hidden />
    </button>
  </div>
);

/**
 * Janela sobre a página (modal nativo <dialog>): fecha no X, com Esc ou clicando fora.
 * Renderize só enquanto estiver aberta: `{aberta && <Janela ... />}`.
 */
export function Janela({
  titulo,
  aoFechar,
  largura = 'max-w-lg',
  children,
}: {
  titulo: string;
  aoFechar: () => void;
  /** Largura máxima (ex.: 'max-w-5xl' para uma lista de escolha). */
  largura?: string;
  children: ReactNode;
}) {
  const janela = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    janela.current?.showModal();
  }, []);
  return (
    <dialog
      ref={janela}
      aria-label={titulo}
      onClose={aoFechar}
      // O clique no fundo escurecido chega ao próprio <dialog>; dentro do conteúdo, não.
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      className={`m-auto w-[calc(100%-2rem)] ${largura} rounded-lg border border-borda bg-superficie p-0 text-texto shadow-xl backdrop:bg-texto/40`}
    >
      <BarraDoDialogo titulo={titulo} aoFechar={aoFechar} />
      <div className="p-5">{children}</div>
    </dialog>
  );
}

/**
 * Gaveta lateral (Drawer) para consultar algo sem sair do processo (ex.: "Visualizar cliente" no orçamento): presa
 * à direita, com a página visível ao fundo. Mesmo <dialog> modal da Janela: fecha no X, com Esc ou clicando fora.
 * Renderize só enquanto estiver aberta: `{aberta && <Gaveta ... />}`.
 */
export function Gaveta({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  const gaveta = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    gaveta.current?.showModal();
  }, []);
  return (
    <dialog
      ref={gaveta}
      aria-label={titulo}
      onClose={aoFechar}
      onClick={(e) => e.target === e.currentTarget && aoFechar()}
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-xl border-l border-borda bg-superficie p-0 text-texto shadow-xl backdrop:bg-texto/30"
    >
      <div className="flex h-full flex-col">
        <BarraDoDialogo titulo={titulo} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Dica (Tooltip acessível): ícone de informação que mostra `texto` ao passar o mouse, ao receber foco e ao tocar
 * (não depende de hover). Fecha ao sair, com Esc ou tocando fora. O texto descreve o botão para leitores de tela.
 * Posição fixa, calculada ao abrir: não é cortada por tabelas com rolagem.
 */
export function Dica({
  texto,
  rotulo = 'Mais informações',
  alerta = false,
}: {
  texto: string;
  rotulo?: string;
  /** Ícone de atenção (laranja) em vez do de informação: ex.: item que passará por aprovação comercial. */
  alerta?: boolean;
}) {
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const id = useId();
  const abrir = () => {
    const r = botao.current?.getBoundingClientRect();
    if (r) setPosicao({ top: r.top - 6, left: Math.min(Math.max(r.left + r.width / 2, 128), window.innerWidth - 128) });
  };
  const fechar = () => setPosicao(null);
  return (
    <span className="inline-flex" onMouseEnter={abrir} onMouseLeave={fechar}>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        aria-describedby={id}
        aria-expanded={!!posicao}
        // Toque: o foco abre e o clique mantém aberta (alternar fecharia logo em seguida).
        onClick={abrir}
        onFocus={abrir}
        onBlur={fechar}
        onKeyDown={(e) => e.key === 'Escape' && fechar()}
        className={`inline-flex size-9 items-center justify-center rounded-md hover:bg-superficie-alt focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none ${alerta ? 'text-alerta' : 'text-texto-suave hover:text-primaria'}`}
      >
        {alerta ? <TriangleAlert className="size-4" aria-hidden /> : <Info className="size-4" aria-hidden />}
      </button>
      <span
        id={id}
        role="tooltip"
        style={posicao ?? undefined}
        className={`fixed z-50 w-60 -translate-x-1/2 -translate-y-full rounded-md bg-texto px-2.5 py-1.5 text-xs text-superficie shadow-lg ${posicao ? '' : 'hidden'}`}
      >
        {texto}
      </span>
    </span>
  );
}
