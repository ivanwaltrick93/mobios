import {
  CATEGORIAS_FOTO_OS,
  ESTADOS_CHECKLIST,
  ITENS_CHECKLIST_PADRAO,
  MAXIMO_FOTOS_OS,
  MAXIMO_ITENS_CHECKLIST,
  NIVEIS_COMBUSTIVEL,
  type CategoriaFotoOs,
  type EstadoChecklist,
  type NivelCombustivel,
  type OrdemServico,
} from '@mobios/shared';
import { useMutation } from '@tanstack/react-query';
import { Camera, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { reduzirImagem } from '../lib/imagem';
import {
  Alerta,
  AreaTexto,
  Botao,
  Campo,
  Confirmacao,
  Input,
  Janela,
  Secao,
  Select,
  Selo,
  TextoSuave,
  useNotificar,
  type Tom,
} from './ui';

// Recepção e diagnóstico da O.S. (onda 5.2; docs/modulos/ORDENS_SERVICO.md §10).

type Props = {
  os: OrdemServico;
  /** Quem altera a O.S. e ela está em aberto (a API confere de novo). */
  podeAlterar: boolean;
  aoSalvar: (o: OrdemServico) => void;
};

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const TOM_ESTADO: Record<EstadoChecklist, Tom> = {
  presente: 'sucesso',
  ausente: 'alerta',
  avariado: 'perigo',
  nao_aplicavel: 'neutro',
};

type LinhaChecklist = { chave: string; item: string; estado: EstadoChecklist; observacao: string };

const linhaNova = (item = ''): LinhaChecklist => ({
  chave: crypto.randomUUID(),
  item,
  estado: 'presente',
  observacao: '',
});

/** Nível de combustível em botões (um toque no celular). */
function SeletorCombustivel({
  valor,
  aoMudar,
}: {
  valor: NivelCombustivel | '';
  aoMudar: (v: NivelCombustivel | '') => void;
}) {
  return (
    <div role="radiogroup" aria-label="Nível de combustível" className="flex flex-wrap gap-1.5">
      {Object.entries(NIVEIS_COMBUSTIVEL).map(([nivel, rotulo]) => (
        <button
          key={nivel}
          type="button"
          role="radio"
          aria-checked={valor === nivel}
          onClick={() => aoMudar(valor === nivel ? '' : (nivel as NivelCombustivel))}
          className={`min-w-14 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none ${
            valor === nivel
              ? 'border-primaria bg-primaria text-sobre-primaria'
              : 'border-borda-forte text-texto-suave hover:bg-superficie-alt'
          }`}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * Checklist de entrada (OS-03): cada item com o estado (presente, ausente, avariado, não se aplica) e observação,
 * o combustível e as avarias. A primeira vez começa com os itens sugeridos; dá para tirar e incluir outros.
 */
export function ChecklistOs({ os: o, podeAlterar, aoSalvar }: Props) {
  const notificar = useNotificar();
  const [editando, setEditando] = useState(false);
  const [linhas, setLinhas] = useState<LinhaChecklist[]>([]);
  const [combustivel, setCombustivel] = useState<NivelCombustivel | ''>('');
  const [avarias, setAvarias] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/checklist`, {
        method: 'PUT',
        body: {
          itens: linhas.map(({ item, estado, observacao }) => ({ item, estado, observacao })),
          combustivel,
          avariasEntrada: avarias,
          versao: o.versao,
        },
      }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      setEditando(false);
      notificar('Checklist registrado.');
    },
  });
  const comecar = () => {
    setLinhas(
      o.checklistEm
        ? o.checklist.map((i) => ({ ...linhaNova(i.item), estado: i.estado, observacao: i.observacao ?? '' }))
        : ITENS_CHECKLIST_PADRAO.map((i) => linhaNova(i)),
    );
    setCombustivel(o.combustivel ?? '');
    setAvarias(o.avariasEntrada ?? '');
    setErro(null);
    salvar.reset();
    setEditando(true);
  };
  const mudar = (chave: string, mudanca: Partial<LinhaChecklist>) =>
    setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));
  const conferirESalvar = () => {
    if (linhas.some((l) => !l.item.trim())) return setErro('Informe o nome de todos os itens (ou remova os vazios).');
    const nomes = linhas.map((l) => l.item.trim().toLowerCase());
    if (new Set(nomes).size !== nomes.length) return setErro('Há itens repetidos no checklist.');
    setErro(null);
    salvar.mutate();
  };

  if (editando)
    return (
      <Secao titulo="Checklist de entrada">
        <ul className="space-y-2">
          {linhas.map((l) => (
            <li
              key={l.chave}
              className="grid gap-2 rounded-md border border-borda p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_2.25rem] sm:items-center"
            >
              <Input
                aria-label="Item"
                placeholder="Item"
                maxLength={60}
                value={l.item}
                onChange={(e) => mudar(l.chave, { item: e.target.value })}
              />
              <Select
                aria-label={`Estado de ${l.item || 'item'}`}
                value={l.estado}
                onChange={(e) => mudar(l.chave, { estado: e.target.value as EstadoChecklist })}
              >
                {Object.entries(ESTADOS_CHECKLIST).map(([estado, rotulo]) => (
                  <option key={estado} value={estado}>
                    {rotulo}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`Observação de ${l.item || 'item'}`}
                placeholder="Observação (opcional)"
                maxLength={200}
                value={l.observacao}
                onChange={(e) => mudar(l.chave, { observacao: e.target.value })}
              />
              <button
                type="button"
                title="Remover item"
                aria-label={`Remover ${l.item || 'item'}`}
                className="inline-flex size-9 items-center justify-center justify-self-end rounded-md text-texto-suave hover:bg-superficie-alt hover:text-perigo"
                onClick={() => setLinhas((atuais) => atuais.filter((x) => x.chave !== l.chave))}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div>
          <Botao
            type="button"
            variante="secundario"
            disabled={linhas.length >= MAXIMO_ITENS_CHECKLIST}
            onClick={() => setLinhas((atuais) => [...atuais, linhaNova()])}
          >
            <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar item
          </Botao>
        </div>
        <Campo rotulo="Combustível">
          <SeletorCombustivel valor={combustivel} aoMudar={setCombustivel} />
        </Campo>
        <Campo rotulo="Avarias na entrada">
          <AreaTexto
            rows={3}
            maxLength={1000}
            placeholder="Riscos, amassados, vidros trincados… (registre também com fotos)"
            value={avarias}
            onChange={(e) => setAvarias(e.target.value)}
          />
        </Campo>
        <Alerta>{erro || (salvar.isError && salvar.error.message)}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setEditando(false)}>
            Cancelar
          </Botao>
          <Botao disabled={salvar.isPending} onClick={conferirESalvar}>
            {salvar.isPending ? 'Salvando…' : 'Salvar checklist'}
          </Botao>
        </div>
      </Secao>
    );

  return (
    <Secao
      titulo="Checklist de entrada"
      acao={
        podeAlterar && (
          <Botao variante={o.checklistEm ? 'secundario' : 'primario'} onClick={comecar}>
            <Pencil className="mr-1.5 size-4" aria-hidden /> {o.checklistEm ? 'Alterar' : 'Registrar checklist'}
          </Botao>
        )
      }
    >
      {!o.checklistEm ? (
        <TextoSuave>Checklist ainda não registrado.</TextoSuave>
      ) : (
        <>
          <TextoSuave>Registrado em {dataHora(o.checklistEm)}.</TextoSuave>
          {o.checklist.length > 0 && (
            <ul className="divide-y divide-borda text-sm">
              {o.checklist.map((i) => (
                <li key={i.item} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <span>
                    <span className="font-medium">{i.item}</span>
                    {i.observacao && <span className="text-texto-suave"> — {i.observacao}</span>}
                  </span>
                  <Selo tom={TOM_ESTADO[i.estado]}>{ESTADOS_CHECKLIST[i.estado]}</Selo>
                </li>
              ))}
            </ul>
          )}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-texto-suave">Combustível</dt>
              <dd className="text-sm">{o.combustivel ? NIVEIS_COMBUSTIVEL[o.combustivel] : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-texto-suave">Avarias na entrada</dt>
              <dd className="whitespace-pre-line text-sm">{o.avariasEntrada || '—'}</dd>
            </div>
          </dl>
        </>
      )}
    </Secao>
  );
}

/** Diagnóstico técnico e observações do mecânico (OS-05). */
export function DiagnosticoOs({ os: o, podeAlterar, aoSalvar }: Props) {
  const notificar = useNotificar();
  const [texto, setTexto] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/diagnostico`, {
        method: 'PUT',
        body: { diagnostico: texto, versao: o.versao },
      }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      setTexto(null);
      notificar('Diagnóstico salvo.');
    },
  });

  if (texto != null)
    return (
      <Secao titulo="Diagnóstico">
        <Campo rotulo="Diagnóstico técnico e observações do mecânico">
          <AreaTexto
            rows={8}
            maxLength={4000}
            placeholder="O que foi encontrado, causa provável e o que recomenda fazer"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </Campo>
        <Alerta>{salvar.isError && salvar.error.message}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={() => setTexto(null)}>
            Cancelar
          </Botao>
          <Botao disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : 'Salvar diagnóstico'}
          </Botao>
        </div>
      </Secao>
    );

  return (
    <Secao
      titulo="Diagnóstico"
      acao={
        podeAlterar && (
          <Botao variante={o.diagnostico ? 'secundario' : 'primario'} onClick={() => setTexto(o.diagnostico ?? '')}>
            <Pencil className="mr-1.5 size-4" aria-hidden /> {o.diagnostico ? 'Alterar' : 'Registrar diagnóstico'}
          </Botao>
        )
      }
    >
      {o.diagnostico ? (
        <p className="whitespace-pre-line text-sm">{o.diagnostico}</p>
      ) : (
        <TextoSuave>Diagnóstico ainda não registrado.</TextoSuave>
      )}
    </Secao>
  );
}

/** Lado maior da foto enviada: nítida o bastante para mostrar uma avaria e bem abaixo de 1 MB em JPEG. */
const LADO_FOTO = 1600;

/**
 * Fotos da O.S. (OS-04): até MAXIMO_FOTOS_OS, com categoria. "Tirar foto" abre a câmera traseira no celular;
 * "Escolher foto", a galeria ou os arquivos. A imagem é reduzida no navegador antes de enviar.
 */
export function FotosOs({ os: o, podeAlterar, aoSalvar }: Props) {
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [categoria, setCategoria] = useState<CategoriaFotoOs>(o.situacao === 'em_execucao' ? 'execucao' : 'entrada');
  const [aberta, setAberta] = useState<OrdemServico['fotos'][number] | null>(null);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cheia = o.fotos.length >= MAXIMO_FOTOS_OS;
  const enviar = useMutation({
    mutationFn: async (arquivo: File) => {
      // Reduz qualquer foto que o navegador consiga abrir (inclusive HEIC do iPhone, no Safari) para JPEG.
      const reduzida = await reduzirImagem(arquivo, LADO_FOTO).catch(() => {
        throw new Error('Não foi possível ler esta imagem. Tente outra foto (JPEG ou PNG).');
      });
      return api<OrdemServico>(`/ordens-servico/${o.id}/fotos?categoria=${categoria}&versao=${o.versao}`, {
        method: 'POST',
        arquivo: { conteudo: reduzida, tipo: reduzida.type },
      });
    },
    onSuccess: aoSalvar,
    onError: (e) => setErro(e.message),
  });
  const remover = useMutation({
    mutationFn: (fotoId: string) =>
      api<OrdemServico>(`/ordens-servico/${o.id}/fotos/${fotoId}?versao=${o.versao}`, { method: 'DELETE' }),
    onSuccess: (salva) => {
      setRemovendo(false);
      setAberta(null);
      aoSalvar(salva);
    },
  });
  const escolher = (arquivo: File | undefined) => {
    setErro(null);
    if (arquivo) enviar.mutate(arquivo);
  };
  const entrada = (ref: typeof camera, capturar: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      // Celular: abre direto a câmera traseira.
      capture={capturar ? 'environment' : undefined}
      className="hidden"
      onChange={(e) => {
        escolher(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );
  const url = (fotoId: string) => `/api/ordens-servico/${o.id}/fotos/${fotoId}`;

  return (
    <Secao titulo={`Fotos (${o.fotos.length} de ${MAXIMO_FOTOS_OS})`}>
      {podeAlterar && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Categoria">
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaFotoOs)}>
              {Object.entries(CATEGORIAS_FOTO_OS).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          {entrada(camera, true)}
          {entrada(galeria, false)}
          <Botao disabled={cheia || enviar.isPending} onClick={() => camera.current?.click()}>
            <Camera className="mr-1.5 size-4" aria-hidden /> {enviar.isPending ? 'Enviando…' : 'Tirar foto'}
          </Botao>
          <Botao variante="secundario" disabled={cheia || enviar.isPending} onClick={() => galeria.current?.click()}>
            <ImagePlus className="mr-1.5 size-4" aria-hidden /> Escolher foto
          </Botao>
        </div>
      )}
      {podeAlterar && cheia && (
        <TextoSuave>Limite de {MAXIMO_FOTOS_OS} fotos atingido: remova uma para enviar outra.</TextoSuave>
      )}
      <Alerta>{erro}</Alerta>
      {o.fotos.length === 0 ? (
        <TextoSuave>Nenhuma foto ainda.</TextoSuave>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {o.fotos.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                aria-label={`Ampliar foto (${CATEGORIAS_FOTO_OS[f.categoria]})`}
                className="block w-full overflow-hidden rounded-md border border-borda focus-visible:ring-2 focus-visible:ring-primaria focus-visible:outline-none"
                onClick={() => setAberta(f)}
              >
                <img src={url(f.id)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              </button>
              <div className="mt-1 flex items-center justify-between gap-1 text-xs text-texto-suave">
                <Selo tom={f.categoria === 'avaria' ? 'perigo' : 'neutro'}>{CATEGORIAS_FOTO_OS[f.categoria]}</Selo>
                <span>{dataHora(f.criadaEm)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {aberta && (
        <Janela
          titulo={`Foto — ${CATEGORIAS_FOTO_OS[aberta.categoria]}`}
          largura="max-w-4xl"
          aoFechar={() => setAberta(null)}
        >
          <div className="space-y-3">
            <img
              src={url(aberta.id)}
              alt={`Foto da O.S. (${CATEGORIAS_FOTO_OS[aberta.categoria]})`}
              className="mx-auto max-h-[70vh] rounded-md"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TextoSuave>
                {dataHora(aberta.criadaEm)}
                {aberta.criadaPor && ` por ${aberta.criadaPor}`}
              </TextoSuave>
              {podeAlterar && (
                <Botao variante="perigo" onClick={() => setRemovendo(true)}>
                  <Trash2 className="mr-1.5 size-4" aria-hidden /> Remover foto
                </Botao>
              )}
            </div>
          </div>
        </Janela>
      )}
      {removendo && aberta && (
        <Confirmacao
          titulo="Remover foto"
          mensagem="A foto sai da O.S. (a remoção fica no histórico)."
          rotuloConfirmar="Remover"
          perigo
          carregando={remover.isPending}
          erro={remover.isError && remover.error.message}
          aoConfirmar={() => remover.mutate(aberta.id)}
          aoFechar={() => setRemovendo(false)}
        />
      )}
    </Secao>
  );
}
