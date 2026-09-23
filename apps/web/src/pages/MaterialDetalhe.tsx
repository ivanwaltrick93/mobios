import { formatarData, mascaraCest, mascaraNcm, ORIGENS_FISCAIS, UNIDADES, type Material } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Abas, Alerta, Botao, Cartao, classesBotao, Selo, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { PrecosMaterial } from './PrecosMaterial';
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
        <PrecosMaterial material={m} />
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
          </Bloco>
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
