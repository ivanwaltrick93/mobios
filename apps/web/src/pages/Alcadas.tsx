import { formatarPercentual, type Alcada, type AlcadaEvento } from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alerta,
  Bloco,
  Botao,
  BotaoLink,
  Cabecalho,
  CabecalhoPagina,
  Carregando,
  Input,
  Linha,
  Marcador,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  useNotificar,
} from '../components/ui';
import { api } from '../lib/api';
import { useAdmin } from '../lib/sessao';

const chaveAlcadas = ['alcadas'] as const;
const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR');
const rotulo = (percentual: number | null, ativa: boolean | null) =>
  percentual == null ? '—' : `${formatarPercentual(percentual)}${ativa === false ? ' (inativa)' : ''}`;

/** Edição da alçada de uma função, na própria linha. */
function LinhaAlcada({ alcada }: { alcada: Alcada }) {
  const queryClient = useQueryClient();
  const notificar = useNotificar();
  const [editando, setEditando] = useState(false);
  const [percentual, setPercentual] = useState('');
  const [ativa, setAtiva] = useState(alcada.ativa);
  const salvar = useMutation({
    mutationFn: () =>
      api<Alcada>(`/alcadas/${alcada.funcaoId}`, {
        method: 'PUT',
        body: { percentual: Number(percentual.replace(',', '.')), ativa, versao: alcada.versao },
      }),
    onSuccess: (salva) => {
      setEditando(false);
      queryClient.invalidateQueries({ queryKey: chaveAlcadas });
      notificar(`Alçada de ${salva.funcao}: ${rotulo(salva.percentual, salva.ativa)}.`);
    },
  });
  const abrir = () => {
    setPercentual(String(alcada.percentual / 100).replace('.', ','));
    setAtiva(alcada.ativa);
    salvar.reset();
    setEditando(true);
  };

  return (
    <Linha className={alcada.funcaoAtiva ? '' : 'opacity-60'}>
      <Td className="font-medium">
        {alcada.funcao} {!alcada.funcaoAtiva && <Selo>função desativada</Selo>}
      </Td>
      {editando ? (
        <Td colSpan={3}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              <Input
                aria-label={`Alçada de ${alcada.funcao} (%)`}
                inputMode="decimal"
                className="w-24 text-right"
                value={percentual}
                onChange={(e) => setPercentual(e.target.value)}
              />
              %
            </label>
            <Marcador rotulo="Ativa" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
            <Botao disabled={salvar.isPending || percentual.trim() === ''} onClick={() => salvar.mutate()}>
              Salvar
            </Botao>
            <Botao variante="secundario" onClick={() => setEditando(false)}>
              Cancelar
            </Botao>
            {salvar.isError && (
              <span className="w-full">
                <Alerta>{salvar.error.message}</Alerta>
              </span>
            )}
          </div>
        </Td>
      ) : (
        <>
          <Td className="text-right font-semibold tabular-nums">
            {formatarPercentual(alcada.ativa ? alcada.percentual : 0)}
            {!alcada.ativa && <span className="ml-1.5 text-xs font-normal text-texto-suave">(inativa)</span>}
          </Td>
          <Td suave className="text-xs">
            {alcada.atualizadoEm
              ? `${dataHora(alcada.atualizadoEm)}${alcada.atualizadoPor ? ` por ${alcada.atualizadoPor}` : ''}`
              : 'Nunca configurada (vale 0%)'}
          </Td>
          <Td className="text-right">
            <BotaoLink onClick={abrir}>Alterar</BotaoLink>
          </Td>
        </>
      )}
    </Linha>
  );
}

/**
 * Configurações → Alçadas de desconto (só o Administrador): o desconto máximo que cada função concede sem
 * aprovação comercial. Vale para as próximas emissões e decisões; o histórico guarda cada mudança.
 */
export function Alcadas() {
  const admin = useAdmin();
  const alcadas = useQuery({ queryKey: chaveAlcadas, queryFn: () => api<Alcada[]>('/alcadas'), enabled: admin });
  const historico = useQuery({
    queryKey: [...chaveAlcadas, 'historico'],
    queryFn: () => api<AlcadaEvento[]>('/alcadas/historico'),
    enabled: admin,
  });

  if (!admin) return <Alerta>Apenas o Administrador pode configurar as alçadas de desconto.</Alerta>;

  return (
    <div className="space-y-4">
      <CabecalhoPagina
        titulo="Alçadas de desconto"
        subtitulo="Desconto máximo que cada função concede sem aprovação comercial. Acima dele, o documento aguarda quem tenha alçada suficiente."
      />
      <TextoSuave className="max-w-3xl">
        O usuário fica com a maior alçada entre as suas funções ativas. Função sem alçada, ou com ela inativa, vale 0%:
        qualquer desconto pede aprovação. Para aprovar, a função precisa também de "Aprovação comercial" em Editar
        (Funções e permissões). Mudanças valem para as próximas emissões; aprovações já pedidas ou decididas guardam a
        alçada do momento.
      </TextoSuave>

      {alcadas.isError && <Alerta>{alcadas.error.message}</Alerta>}
      {!alcadas.data ? (
        <Carregando />
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Função</Th>
            <Th className="text-right">Alçada</Th>
            <Th>Última alteração</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {alcadas.data.map((a) => (
              <LinhaAlcada key={a.funcaoId} alcada={a} />
            ))}
          </tbody>
        </Tabela>
      )}

      <Bloco titulo="Histórico das alçadas">
        {historico.data?.length ? (
          <ul className="-my-2 divide-y divide-borda text-sm">
            {historico.data.map((e, n) => (
              <li key={n} className="flex flex-wrap gap-x-2 py-2">
                <span className="whitespace-nowrap text-texto-suave">{dataHora(e.criadoEm)}</span>
                <span className="font-medium">{e.funcao}</span>
                <span>
                  {rotulo(e.percentualAntes, e.ativaAntes)} → {rotulo(e.percentualDepois, e.ativaDepois)}
                </span>
                {e.usuario && <span className="text-texto-suave">por {e.usuario}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <TextoSuave>Nenhuma alteração ainda.</TextoSuave>
        )}
      </Bloco>
    </div>
  );
}
