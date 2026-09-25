import { formatarQuantidade, UNIDADES, type Material, type Saldo } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { Warehouse } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { AjusteEstoqueForm, HistoricoAjustes } from '../components/Estoque';
import { Alerta, BotaoLink, Cartao, classesBotao, Selo, TextoSuave, Vazio } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';

/** Aba Estoque do material: saldo em cada depósito, com ajuste e histórico. */
export function EstoqueMaterial({ material }: { material: Material }) {
  const pode = usePode();
  const editar = pode('estoque', 'editar');
  const [aberto, setAberto] = useState<{ depositoId: string; modo: 'ajuste' | 'historico' } | null>(null);
  const saldos = useQuery({
    queryKey: ['estoque', 'material', material.id],
    queryFn: () => api<Saldo[]>(`/estoque/material/${material.id}`),
  });

  if (!material.controlaEstoque)
    return <Alerta>Este material não controla estoque (veja a etapa Controles do cadastro).</Alerta>;
  if (saldos.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (saldos.isError) return <Alerta>{saldos.error.message}</Alerta>;
  if (saldos.data.length === 0) {
    return (
      <Vazio
        icone={<Warehouse />}
        titulo="Nenhum depósito cadastrado"
        acao={
          pode('materiais', 'editar') && (
            <Link to="/materiais/depositos" className={classesBotao('primario')}>
              Cadastrar depósito
            </Link>
          )
        }
      />
    );
  }
  const soma = (campo: 'disponivel' | 'reservado' | 'saldo') => saldos.data.reduce((acc, s) => acc + s[campo], 0);
  const unidade = `${material.unidade} — ${UNIDADES[material.unidade].nome}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['Disponível', 'disponivel', 'Tudo o que existe no depósito'],
            ['Reservado', 'reservado', 'Separado para O.S. ou pedido'],
            ['Saldo', 'saldo', 'Disponível − reservado: livre para vender ou usar'],
          ] as const
        ).map(([rotulo, campo, dica]) => (
          <Cartao key={campo} className="p-5">
            <div className="text-sm text-texto-suave">{rotulo} (todos os depósitos)</div>
            <div className="text-3xl font-semibold text-texto">{formatarQuantidade(soma(campo))}</div>
            <div className="text-xs text-texto-suave">
              {unidade} · {dica}
            </div>
          </Cartao>
        ))}
      </div>

      {!material.ativo && <Alerta>Material inativo: os saldos continuam visíveis, mas não recebem ajuste.</Alerta>}
      <Cartao className="divide-y divide-borda p-0">
        {saldos.data.map((s) => (
          <div key={s.depositoId} className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{s.depositoCodigo}</span>
                <span className="font-medium">{s.depositoNome}</span>
                {!s.depositoAtivo && <Selo>Depósito inativo</Selo>}
              </span>
              <span className="flex flex-wrap items-center gap-4">
                <span>
                  Disponível <strong>{formatarQuantidade(s.disponivel)}</strong>
                </span>
                <span>
                  Reservado <strong>{formatarQuantidade(s.reservado)}</strong>
                </span>
                <span>
                  Saldo <strong className={s.saldo === 0 ? 'text-alerta' : ''}>{formatarQuantidade(s.saldo)}</strong>
                </span>
                {editar && material.ativo && s.depositoAtivo && (
                  <BotaoLink onClick={() => setAberto({ depositoId: s.depositoId, modo: 'ajuste' })}>Ajustar</BotaoLink>
                )}
                {s.versao != null && (
                  <BotaoLink
                    onClick={() =>
                      setAberto(
                        aberto?.depositoId === s.depositoId && aberto.modo === 'historico'
                          ? null
                          : { depositoId: s.depositoId, modo: 'historico' },
                      )
                    }
                  >
                    Histórico
                  </BotaoLink>
                )}
              </span>
            </div>
            {aberto?.depositoId === s.depositoId &&
              (aberto.modo === 'ajuste' ? (
                <AjusteEstoqueForm saldo={s} aoConcluir={() => setAberto(null)} />
              ) : (
                <HistoricoAjustes saldo={s} />
              ))}
          </div>
        ))}
      </Cartao>
    </div>
  );
}
