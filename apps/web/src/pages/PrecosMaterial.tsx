import {
  formatarDataIso,
  formatarMoeda,
  hojeIso,
  mascaraMoeda,
  moedaParaCentavos,
  SITUACOES_PRECO,
  type Material,
  type Preco,
  type SituacaoPreco,
  type TabelaPreco,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  Alerta,
  Botao,
  BotaoLink,
  Campo,
  Cartao,
  classesBotao,
  Input,
  Selo,
  TextoSuave,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useTabelasPreco } from '../lib/materiais';
import { usePode } from '../lib/sessao';

const tomSituacao: Record<SituacaoPreco, 'sucesso' | 'primario' | 'neutro' | 'alerta'> = {
  vigente: 'sucesso',
  futuro: 'primario',
  encerrado: 'neutro',
  cancelado: 'alerta',
};
const periodo = (p: Preco) =>
  `${formatarDataIso(p.dataInicio)} → ${p.dataFim ? formatarDataIso(p.dataFim) : 'sem fim'}`;

/** Aba Preços do material: por tabela, o preço vigente, os programados e o histórico (nada é apagado). */
export function PrecosMaterial({ material }: { material: Material }) {
  const pode = usePode();
  const editar = pode('precos', 'editar');
  const tabelas = useTabelasPreco();
  const precos = useQuery({
    queryKey: ['precos', material.id],
    queryFn: () => api<Preco[]>(`/precos?materialId=${material.id}`),
  });

  if (tabelas.isPending || precos.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (tabelas.isError) return <Alerta>{tabelas.error.message}</Alerta>;
  // Tabelas ativas, mais as inativas que têm histórico deste material.
  const lista = tabelas.data.filter((t) => t.ativa || precos.data?.some((p) => p.tabelaPrecoId === t.id));
  if (lista.length === 0) {
    return (
      <Vazio
        icone={<Tag />}
        titulo="Nenhuma tabela de preço cadastrada"
        acao={
          editar && (
            <Link to="/tabelas-preco" className={classesBotao('primario')}>
              Cadastrar tabela de preço
            </Link>
          )
        }
      >
        Crie as tabelas (Varejo, Oficina, Atacado...) para informar os preços deste material.
      </Vazio>
    );
  }
  return (
    <div className="space-y-4">
      {!material.ativo && (
        <Alerta>Material inativo: não recebe preços novos, mas o histórico continua disponível.</Alerta>
      )}
      {lista.map((t) => (
        <PrecosDaTabela
          key={t.id}
          material={material}
          tabela={t}
          precos={precos.data?.filter((p) => p.tabelaPrecoId === t.id) ?? []}
          editar={editar}
        />
      ))}
    </div>
  );
}

function PrecosDaTabela({
  material,
  tabela,
  precos,
  editar,
}: {
  material: Material;
  tabela: TabelaPreco;
  precos: Preco[];
  editar: boolean;
}) {
  const [nova, setNova] = useState(false);
  const [historico, setHistorico] = useState(false);
  const vigente = precos.find((p) => p.situacao === 'vigente');
  const futuros = precos
    .filter((p) => p.situacao === 'futuro')
    .sort((a, b) => a.dataInicio.localeCompare(b.dataInicio));
  const passados = precos.filter((p) => p.situacao === 'encerrado' || p.situacao === 'cancelado');
  const podeNova = editar && material.ativo && tabela.ativa;

  return (
    <Cartao className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-texto">{tabela.nome}</h3>
            <span className="font-mono text-xs text-texto-suave">{tabela.codigo}</span>
            {!tabela.ativa && <Selo>Tabela inativa</Selo>}
          </div>
          {vigente ? (
            <div className="mt-1">
              <span className="text-2xl font-semibold text-texto">{formatarMoeda(vigente.precoCentavos)}</span>
              <span className="ml-2 text-sm text-texto-suave">vigente · {periodo(vigente)}</span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-texto-suave">Sem preço vigente hoje.</p>
          )}
        </div>
        {podeNova && !nova && <Botao onClick={() => setNova(true)}>Nova vigência</Botao>}
      </div>

      {nova && <NovaVigencia material={material} tabela={tabela} vigente={vigente} aoConcluir={() => setNova(false)} />}

      {vigente && editar && <AcoesPreco preco={vigente} />}
      {futuros.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">Programados</h4>
          {futuros.map((p) => (
            <LinhaPreco key={p.id} preco={p} editar={editar} />
          ))}
        </div>
      )}
      {passados.length > 0 && (
        <div>
          <BotaoLink onClick={() => setHistorico((h) => !h)} className="inline-flex items-center gap-1">
            <History className="size-4" aria-hidden />{' '}
            {historico ? 'Ocultar histórico' : `Ver histórico (${passados.length})`}
          </BotaoLink>
          {historico && (
            <div className="mt-2 space-y-2">
              {passados.map((p) => (
                <LinhaPreco key={p.id} preco={p} editar={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}

function useInvalidarPrecos(materialId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['precos', materialId] });
    queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] });
    queryClient.invalidateQueries({ queryKey: ['lista-precos'] });
  };
}

/** Nova vigência: a atual é encerrada na véspera; nada do histórico é apagado. */
function NovaVigencia({
  material,
  tabela,
  vigente,
  aoConcluir,
}: {
  material: Material;
  tabela: TabelaPreco;
  vigente?: Preco;
  aoConcluir: () => void;
}) {
  const invalidar = useInvalidarPrecos(material.id);
  const [valor, setValor] = useState('');
  const [inicio, setInicio] = useState(hojeIso());
  const [fim, setFim] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      api<Preco>('/precos', {
        method: 'POST',
        body: {
          materialId: material.id,
          tabelaPrecoId: tabela.id,
          precoCentavos: moedaParaCentavos(valor),
          dataInicio: inicio,
          dataFim: fim || null,
        },
      }),
    onSuccess: () => {
      invalidar();
      aoConcluir();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-md border border-borda bg-superficie-alt p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Preço (R$) *">
          <Input
            autoFocus
            inputMode="numeric"
            placeholder="0,00"
            value={valor}
            onChange={(e) => setValor(mascaraMoeda(e.target.value))}
          />
        </Campo>
        <Campo rotulo="Início da vigência *" dica="Hoje ou depois">
          <Input type="date" min={hojeIso()} value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Campo>
        <Campo rotulo="Fim da vigência" dica="Vazio = sem data de fim">
          <Input type="date" min={inicio} value={fim} onChange={(e) => setFim(e.target.value)} />
        </Campo>
      </div>
      {vigente && inicio > vigente.dataInicio && (
        <TextoSuave className="text-xs">
          O preço vigente ({formatarMoeda(vigente.precoCentavos)}) será encerrado automaticamente na véspera do novo
          início.
        </TextoSuave>
      )}
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending || !valor}>
          {salvar.isPending ? 'Salvando…' : 'Salvar vigência'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

function LinhaPreco({ preco, editar }: { preco: Preco; editar: boolean }) {
  return (
    <div className="rounded-md border border-borda p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{formatarMoeda(preco.precoCentavos)}</span>
          <span className="text-texto-suave">{periodo(preco)}</span>
          <Selo tom={tomSituacao[preco.situacao]}>{SITUACOES_PRECO[preco.situacao]}</Selo>
        </span>
        <span className="text-xs text-texto-suave">por {preco.criadoPor ?? '—'}</span>
      </div>
      {preco.motivoCancelamento && (
        <p className="mt-1 text-xs text-texto-suave">
          Cancelado por {preco.canceladoPor ?? '—'}: {preco.motivoCancelamento}
        </p>
      )}
      {editar && <AcoesPreco preco={preco} />}
    </div>
  );
}

type Acao = 'editar' | 'encerrar' | 'cancelar' | 'eventos' | null;

/** Futuro: editar valor/fim ou cancelar. Vigente: encerrar. Todos: ver a trilha de alterações. */
function AcoesPreco({ preco }: { preco: Preco }) {
  const invalidar = useInvalidarPrecos(preco.materialId);
  const [acao, setAcao] = useState<Acao>(null);
  const [valor, setValor] = useState(mascaraMoeda(String(preco.precoCentavos)));
  const [data, setData] = useState(preco.dataFim ?? '');
  const [motivo, setMotivo] = useState('');
  const executar = useMutation({
    mutationFn: () => {
      if (acao === 'editar')
        return api(`/precos/${preco.id}`, {
          method: 'PUT',
          body: { precoCentavos: moedaParaCentavos(valor), dataFim: data || null },
        });
      if (acao === 'encerrar') return api(`/precos/${preco.id}/encerrar`, { method: 'POST', body: { dataFim: data } });
      return api(`/precos/${preco.id}/cancelar`, { method: 'POST', body: { motivo } });
    },
    onSuccess: () => {
      invalidar();
      setAcao(null);
    },
  });
  const futuro = preco.situacao === 'futuro';

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        {futuro && <BotaoLink onClick={() => setAcao('editar')}>Editar</BotaoLink>}
        {(futuro || preco.situacao === 'vigente') && (
          <BotaoLink
            onClick={() => {
              setData(preco.dataFim ?? hojeIso());
              setAcao('encerrar');
            }}
          >
            Encerrar
          </BotaoLink>
        )}
        {futuro && (
          <BotaoLink perigo onClick={() => setAcao('cancelar')}>
            Cancelar preço
          </BotaoLink>
        )}
        <BotaoLink onClick={() => setAcao(acao === 'eventos' ? null : 'eventos')}>Alterações</BotaoLink>
      </div>
      {acao === 'eventos' && <Eventos precoId={preco.id} />}
      {acao && acao !== 'eventos' && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-md bg-superficie-alt p-3"
          onSubmit={(e) => {
            e.preventDefault();
            executar.mutate();
          }}
        >
          {acao === 'editar' && (
            <>
              <div className="w-36">
                <Campo rotulo="Preço (R$)">
                  <Input inputMode="numeric" value={valor} onChange={(e) => setValor(mascaraMoeda(e.target.value))} />
                </Campo>
              </div>
              <div className="w-44">
                <Campo rotulo="Fim da vigência">
                  <Input type="date" min={preco.dataInicio} value={data} onChange={(e) => setData(e.target.value)} />
                </Campo>
              </div>
            </>
          )}
          {acao === 'encerrar' && (
            <div className="w-44">
              <Campo rotulo="Último dia do preço">
                <Input
                  type="date"
                  min={hojeIso() > preco.dataInicio ? hojeIso() : preco.dataInicio}
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </Campo>
            </div>
          )}
          {acao === 'cancelar' && (
            <div className="min-w-60 flex-1">
              <Campo rotulo="Motivo do cancelamento">
                <Input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </Campo>
            </div>
          )}
          <Botao type="submit" variante={acao === 'cancelar' ? 'perigo' : 'primario'} disabled={executar.isPending}>
            Confirmar
          </Botao>
          <Botao type="button" variante="secundario" onClick={() => setAcao(null)}>
            Voltar
          </Botao>
          <div className="w-full">
            <Alerta>{executar.isError && executar.error.message}</Alerta>
          </div>
        </form>
      )}
    </div>
  );
}

const NOMES_EVENTO: Record<string, string> = {
  criado: 'Criado',
  alterado: 'Alterado',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
  reaberto: 'Reaberto',
};

function Eventos({ precoId }: { precoId: string }) {
  const eventos = useQuery({
    queryKey: ['precos', 'eventos', precoId],
    queryFn: () =>
      api<
        {
          evento: string;
          antes: Record<string, unknown> | null;
          depois: Record<string, unknown> | null;
          usuario: string | null;
          criadoEm: string;
        }[]
      >(`/precos/${precoId}/eventos`),
  });
  const resumo = (d: Record<string, unknown> | null) =>
    d
      ? [
          typeof d.precoCentavos === 'number' && formatarMoeda(d.precoCentavos),
          'dataFim' in d && `fim ${d.dataFim ? formatarDataIso(String(d.dataFim)) : 'aberto'}`,
          typeof d.motivo === 'string' && d.motivo,
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  return (
    <ul className="space-y-1 rounded-md bg-superficie-alt p-3 text-xs">
      {eventos.data?.map((e, i) => (
        <li key={i}>
          <strong>{NOMES_EVENTO[e.evento] ?? e.evento}</strong> em {new Date(e.criadoEm).toLocaleString('pt-BR')} por{' '}
          {e.usuario ?? '—'}
          {e.depois && <span className="text-texto-suave"> — {resumo(e.depois)}</span>}
        </li>
      ))}
    </ul>
  );
}
