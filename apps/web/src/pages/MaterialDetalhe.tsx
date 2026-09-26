import {
  formatarData,
  formatarMoeda,
  mascaraCest,
  mascaraMoeda,
  mascaraNcm,
  moedaParaCentavos,
  ORIGENS_FISCAIS,
  UNIDADES,
  type Material,
  type Pmc,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Abas, Alerta, Botao, BotaoLink, Cartao, classesBotao, Input, Selo, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { PrecosItem } from './PrecosItem';
import { EstoqueMaterial } from './EstoqueMaterial';

const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="text-sm text-texto">{children || '—'}</dd>
  </div>
);

const Bloco = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <Cartao className="p-5">
    <h3 className="mb-3 text-sm font-semibold">{titulo}</h3>
    <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
  </Cartao>
);

const simNao = (v: boolean) => (v ? 'Sim' : 'Não');

/**
 * PMC (preço médio de compra): custo de compra, base da margem da aprovação comercial. Só aparece para quem tem
 * "Custos e margem" (a API também só devolve a eles); alterar exige Editar. Vazio = não disponível.
 */
function BlocoPmc({ materialId }: { materialId: string }) {
  const pode = usePode();
  const queryClient = useQueryClient();
  const chave = ['materiais', materialId, 'pmc'];
  const pmc = useQuery({ queryKey: chave, queryFn: () => api<Pmc>(`/materiais/${materialId}/pmc`) });
  const [valor, setValor] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (dados: { pmcCentavos: number | null; anteriorCentavos: number | null }) =>
      api(`/materiais/${materialId}/pmc`, { method: 'PUT', body: dados }),
    onSuccess: () => {
      setValor(null);
      queryClient.invalidateQueries({ queryKey: chave });
    },
  });
  const atual = pmc.data?.pmcCentavos ?? null;
  return (
    <Cartao className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Custo (PMC)</h3>
        {pode('custos', 'editar') && valor === null && pmc.data && (
          <BotaoLink onClick={() => setValor(atual == null ? '' : mascaraMoeda(String(atual)))}>Alterar</BotaoLink>
        )}
      </div>
      {pmc.isError && <Alerta>{pmc.error.message}</Alerta>}
      {valor === null ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <Dado rotulo="PMC (preço médio de compra)">{atual == null ? 'Não disponível' : formatarMoeda(atual)}</Dado>
        </dl>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="PMC em reais"
            className="max-w-40 tabular-nums"
            inputMode="numeric"
            placeholder="Vazio = não disponível"
            value={valor}
            onChange={(e) => setValor(mascaraMoeda(e.target.value))}
          />
          <Botao
            disabled={salvar.isPending}
            onClick={() => salvar.mutate({ pmcCentavos: moedaParaCentavos(valor), anteriorCentavos: atual })}
          >
            Salvar
          </Botao>
          <Botao variante="secundario" onClick={() => setValor(null)}>
            Cancelar
          </Botao>
        </div>
      )}
      <div className="mt-2">
        <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      </div>
      <TextoSuave className="mt-2 text-xs">
        Informação interna: o vendedor não vê. É copiado para o item quando ele entra no orçamento e usado na análise de
        margem da aprovação comercial.
      </TextoSuave>
      {!!pmc.data?.historico.length && (
        <ul className="mt-3 space-y-1 border-t border-borda pt-2 text-xs text-texto-suave">
          {pmc.data.historico.map((h, n) => (
            <li key={n}>
              {new Date(h.criadoEm).toLocaleString('pt-BR')} ·{' '}
              {h.antesCentavos == null ? '—' : formatarMoeda(h.antesCentavos)} →{' '}
              {h.depoisCentavos == null ? '—' : formatarMoeda(h.depoisCentavos)}
              {h.usuario && ` · ${h.usuario}`}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

export function MaterialDetalhe() {
  const { id } = useParams() as { id: string };
  const [params, setParams] = useSearchParams();
  const pode = usePode();
  const queryClient = useQueryClient();
  const pedida = params.get('aba');
  const aba =
    pedida === 'precos' && pode('precos') ? 'precos' : pedida === 'estoque' && pode('estoque') ? 'estoque' : 'dados';
  const material = useQuery({ queryKey: ['materiais', id], queryFn: () => api<Material>(`/materiais/${id}`) });
  const status = useMutation({
    mutationFn: (ativo: boolean) => api<Material>(`/materiais/${id}/status`, { method: 'PATCH', body: { ativo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['materiais'] }),
  });

  if (material.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (material.isError) return <Alerta>{material.error.message}</Alerta>;
  const m = material.data;
  const editar = pode('materiais', 'editar');

  return (
    <div className="space-y-6">
      <Cartao>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-superficie-alt px-2 py-0.5 font-mono text-sm font-semibold">{m.sku}</span>
              <Selo tom="primario">{m.tipoNome}</Selo>
              <Selo tom={m.ativo ? 'sucesso' : 'neutro'}>{m.ativo ? 'Ativo' : 'Inativo'}</Selo>
            </div>
            <h1 className="text-2xl font-semibold text-texto">{m.descricao}</h1>
            <p className="text-sm text-texto-suave">
              {[m.marcaNome, m.categoriaCaminho, `${m.unidade} — ${UNIDADES[m.unidade].nome}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {editar && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" disabled={status.isPending} onClick={() => status.mutate(!m.ativo)}>
                <Power className="mr-1.5 size-4" aria-hidden /> {m.ativo ? 'Inativar' : 'Reativar'}
              </Botao>
              <Link to={`/materiais/${id}/editar`} className={classesBotao('primario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden /> Editar
              </Link>
            </div>
          )}
        </div>
        <div className="mt-3">
          <Alerta>{status.isError && status.error.message}</Alerta>
        </div>
      </Cartao>

      {(pode('precos') || pode('estoque')) && (
        <Abas
          abas={[
            { id: 'dados', rotulo: 'Dados' },
            ...(pode('precos') ? [{ id: 'precos' as const, rotulo: 'Preços' }] : []),
            ...(pode('estoque') ? [{ id: 'estoque' as const, rotulo: 'Estoque' }] : []),
          ]}
          atual={aba}
          aoTrocar={(a) => setParams(a === 'dados' ? {} : { aba: a }, { replace: true })}
        />
      )}

      {aba === 'precos' ? (
        <PrecosItem item={{ tipo: 'material', id: m.id, ativo: m.ativo }} />
      ) : aba === 'estoque' ? (
        <EstoqueMaterial material={m} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Bloco titulo="Identificação">
            <Dado rotulo="Descrição curta">{m.descricaoCurta}</Dado>
            <Dado rotulo="Código de barras">{m.codigoBarras}</Dado>
            <Dado rotulo="Código do fabricante">{m.codigoFabricante}</Dado>
            <Dado rotulo="Marca">{m.marcaNome}</Dado>
          </Bloco>
          <Bloco titulo="Fiscal">
            <Dado rotulo="NCM">{m.ncm && mascaraNcm(m.ncm)}</Dado>
            <Dado rotulo="CEST">{m.cest && mascaraCest(m.cest)}</Dado>
            <Dado rotulo="Origem">{m.origem != null && `${m.origem} — ${ORIGENS_FISCAIS[m.origem]}`}</Dado>
          </Bloco>
          <Bloco titulo="Controles">
            <Dado rotulo="Controla estoque">{simNao(m.controlaEstoque)}</Dado>
            <Dado rotulo="Permite venda">{simNao(m.permiteVenda)}</Dado>
            <Dado rotulo="Permite compra">{simNao(m.permiteCompra)}</Dado>
            <Dado rotulo="Permite uso em O.S.">{simNao(m.permiteUsoOs)}</Dado>
            <Dado rotulo="Controla lote">{simNao(m.controlaLote)}</Dado>
            <Dado rotulo="Controla número de série">{simNao(m.controlaSerie)}</Dado>
            <Dado rotulo="Múltiplo de venda">{m.multiplo === 1 ? '1 (unitário)' : m.multiplo}</Dado>
            <Dado rotulo="Leadtime">{m.leadtimeDias} dia(s) corrido(s)</Dado>
          </Bloco>
          {pode('custos') && <BlocoPmc materialId={m.id} />}
          <Bloco titulo="Auditoria">
            <Dado rotulo="Cadastrado">
              {formatarData(new Date(m.criadoEm))} por {m.criadoPor ?? '—'}
            </Dado>
            <Dado rotulo="Última alteração">
              {formatarData(new Date(m.atualizadoEm))} por {m.atualizadoPor ?? '—'}
            </Dado>
            <Dado rotulo="Versão">{m.versao}</Dado>
          </Bloco>
        </div>
      )}
    </div>
  );
}
