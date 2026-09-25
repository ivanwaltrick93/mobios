import { formatarCodigoServico, formatarData, formatarHoras, FORMAS_PRECO_SERVICO, type Servico } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Abas, Alerta, Botao, Cartao, classesBotao, Selo, TextoSuave } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { PrecosItem } from './PrecosItem';

const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="text-sm whitespace-pre-line text-texto">{children || '—'}</dd>
  </div>
);

const Bloco = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <Cartao className="p-5">
    <h3 className="mb-3 text-sm font-semibold">{titulo}</h3>
    <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
  </Cartao>
);

/** Detalhe do serviço: abas Dados e Preços (as mesmas tabelas de preço dos materiais). */
export function ServicoDetalhe() {
  const { id } = useParams() as { id: string };
  const [params, setParams] = useSearchParams();
  const pode = usePode();
  const queryClient = useQueryClient();
  const aba = params.get('aba') === 'precos' && pode('precos') ? 'precos' : 'dados';
  const servico = useQuery({ queryKey: ['servicos', id], queryFn: () => api<Servico>(`/servicos/${id}`) });
  const status = useMutation({
    mutationFn: (ativo: boolean) => api<Servico>(`/servicos/${id}/status`, { method: 'PATCH', body: { ativo } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servicos'] }),
  });

  if (!pode('servicos')) return <Alerta>Você não tem permissão para acessar os serviços.</Alerta>;
  if (servico.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (servico.isError) return <Alerta>{servico.error.message}</Alerta>;
  const s = servico.data;
  const editar = pode('servicos', 'editar');

  return (
    <div className="space-y-6">
      <Cartao>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-superficie-alt px-2 py-0.5 font-mono text-sm font-semibold">
                {formatarCodigoServico(s.codigo)}
              </span>
              {s.classificacaoNome && <Selo tom="primario">{s.classificacaoNome}</Selo>}
              <Selo tom={s.ativo ? 'sucesso' : 'neutro'}>{s.ativo ? 'Ativo' : 'Inativo'}</Selo>
            </div>
            <h1 className="text-2xl font-semibold text-texto">{s.nome}</h1>
            <p className="text-sm text-texto-suave">
              {[
                FORMAS_PRECO_SERVICO[s.formaPreco],
                s.tempoMinutos != null && `${formatarHoras(s.tempoMinutos)} h de trabalho`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {editar && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" disabled={status.isPending} onClick={() => status.mutate(!s.ativo)}>
                <Power className="mr-1.5 size-4" aria-hidden /> {s.ativo ? 'Inativar' : 'Reativar'}
              </Botao>
              <Link to={`/servicos/${id}/editar`} className={classesBotao('primario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden /> Editar
              </Link>
            </div>
          )}
        </div>
        <div className="mt-3">
          <Alerta>{status.isError && status.error.message}</Alerta>
        </div>
      </Cartao>

      {pode('precos') && (
        <Abas
          abas={[
            { id: 'dados', rotulo: 'Dados' },
            { id: 'precos' as const, rotulo: 'Preços' },
          ]}
          atual={aba}
          aoTrocar={(a) => setParams(a === 'dados' ? {} : { aba: a }, { replace: true })}
        />
      )}

      {aba === 'precos' ? (
        <PrecosItem item={{ tipo: 'servico', id: s.id, ativo: s.ativo, porHora: s.formaPreco === 'hora' }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Bloco titulo="Serviço">
            <Dado rotulo="Descrição">{s.descricao}</Dado>
            <Dado rotulo="Classificação">{s.classificacaoNome}</Dado>
            <Dado rotulo="Forma de preço">{FORMAS_PRECO_SERVICO[s.formaPreco]}</Dado>
            <Dado rotulo="Horas de trabalho">{s.tempoMinutos != null && formatarHoras(s.tempoMinutos)}</Dado>
          </Bloco>
          <Bloco titulo="Garantia">
            <Dado rotulo="Prazo">{s.garantiaDias != null && `${s.garantiaDias} dia(s)`}</Dado>
            <Dado rotulo="Quilometragem">{s.garantiaKm != null && `${s.garantiaKm.toLocaleString('pt-BR')} km`}</Dado>
          </Bloco>
          <Bloco titulo="Observação">
            <Dado rotulo="Observação">{s.observacao}</Dado>
          </Bloco>
          <Bloco titulo="Auditoria">
            <Dado rotulo="Cadastrado">
              {formatarData(new Date(s.criadoEm))} por {s.criadoPor ?? '—'}
            </Dado>
            <Dado rotulo="Última alteração">
              {formatarData(new Date(s.atualizadoEm))} por {s.atualizadoPor ?? '—'}
            </Dado>
          </Bloco>
        </div>
      )}
    </div>
  );
}
