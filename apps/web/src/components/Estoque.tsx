import { formatarQuantidade, mascaraQuantidade, quantidadeParaNumero, UNIDADES, type AjusteEstoque, type Saldo } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Alerta, Botao, Campo, Input, TextoSuave } from './ui';

const formatarNaUnidade = (n: number, unidade: Saldo['unidade']) => mascaraQuantidade(String(n).replace('.', ','), UNIDADES[unidade].fracionada);

/**
 * Ajuste manual do saldo de um material num depósito: novos valores de disponível e reservado + motivo.
 * Envia a versão lida; se outra pessoa ajustou antes, a API recusa (409) e nada é sobrescrito.
 */
export function AjusteEstoqueForm({ saldo, aoConcluir }: { saldo: Saldo; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const fracionada = UNIDADES[saldo.unidade].fracionada;
  const [disponivel, setDisponivel] = useState(formatarNaUnidade(saldo.disponivel, saldo.unidade));
  const [reservado, setReservado] = useState(formatarNaUnidade(saldo.reservado, saldo.unidade));
  const [motivo, setMotivo] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      api<Saldo>(`/estoque/${saldo.materialId}/${saldo.depositoId}`, {
        method: 'PUT',
        body: { disponivel: quantidadeParaNumero(disponivel) ?? 0, reservado: quantidadeParaNumero(reservado) ?? 0, motivo, versao: saldo.versao ?? undefined },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lista-precos'] });
      aoConcluir();
    },
  });
  const enviar = (e: FormEvent) => (e.preventDefault(), salvar.mutate());

  return (
    <form onSubmit={enviar} className="space-y-3 rounded-md border border-borda bg-superficie-alt p-4">
      <TextoSuave className="text-xs">
        Informe as quantidades corretas agora ({saldo.unidade} — {UNIDADES[saldo.unidade].nome}
        {fracionada ? ', até 3 casas' : ', só inteiros'}). O ajuste fica registrado com o motivo.
      </TextoSuave>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Disponível *" dica="Livre para vender ou usar">
          <Input autoFocus inputMode="decimal" value={disponivel} onChange={(e) => setDisponivel(mascaraQuantidade(e.target.value, fracionada))} />
        </Campo>
        <Campo rotulo="Reservado *" dica="Separado para O.S. ou pedido">
          <Input inputMode="decimal" value={reservado} onChange={(e) => setReservado(mascaraQuantidade(e.target.value, fracionada))} />
        </Campo>
        <Campo rotulo="Motivo *" dica="Ex.: inventário, avaria, correção">
          <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      </div>
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending || motivo.trim().length < 3}>
          {salvar.isPending ? 'Salvando…' : 'Salvar ajuste'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

/** Últimos ajustes do material no depósito: antes → depois, motivo, quem e quando. */
export function HistoricoAjustes({ saldo }: { saldo: Saldo }) {
  const ajustes = useQuery({
    queryKey: ['estoque', 'ajustes', saldo.materialId, saldo.depositoId],
    queryFn: () => api<AjusteEstoque[]>(`/estoque/${saldo.materialId}/${saldo.depositoId}/ajustes`),
  });
  if (ajustes.isPending) return <TextoSuave className="text-xs">Carregando…</TextoSuave>;
  if (!ajustes.data?.length) return <TextoSuave className="text-xs">Nenhum ajuste registrado.</TextoSuave>;
  return (
    <ul className="space-y-1 rounded-md bg-superficie-alt p-3 text-xs">
      {ajustes.data.map((a) => (
        <li key={a.id}>
          <strong>{new Date(a.criadoEm).toLocaleString('pt-BR')}</strong> por {a.usuario ?? '—'}: disponível {formatarQuantidade(a.disponivelAntes)} → {formatarQuantidade(a.disponivelDepois)}
          {a.reservadoAntes !== a.reservadoDepois && `, reservado ${formatarQuantidade(a.reservadoAntes)} → ${formatarQuantidade(a.reservadoDepois)}`}
          <span className="text-texto-suave"> — {a.motivo}</span>
        </li>
      ))}
    </ul>
  );
}
