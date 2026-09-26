import {
  formatarHoras,
  formatarQuantidade,
  mascaraQuantidade,
  quantidadeParaNumero,
  SITUACOES_OS_EM_ABERTO,
  SITUACOES_OS_EXECUCAO,
  STATUS_SOLICITACAO_PECA,
  type OrdemServico,
  type StatusSolicitacaoPeca,
} from '@mobios/shared';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, PackagePlus, Undo2, Users } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { useMecanicosOs } from '../lib/ordensServico';
import { useSessao } from '../lib/sessao';
import {
  Alerta,
  AreaTexto,
  Botao,
  Campo,
  Confirmacao,
  Input,
  Janela,
  Marcador,
  Secao,
  Selo,
  TextoSuave,
  useNotificar,
  type Tom,
} from './ui';

// Execução da O.S. (onda 5.3; docs/modulos/ORDENS_SERVICO.md §11), pensada para o celular do mecânico.

type Props = { os: OrdemServico; aoSalvar: (o: OrdemServico) => void };
type Item = OrdemServico['itens'][number];
type Solicitacao = OrdemServico['solicitacoesPeca'][number];

const dataHora = (d: Date | string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const TOM_SOLICITACAO: Record<StatusSolicitacaoPeca, Tom> = {
  pendente: 'alerta',
  atendida: 'sucesso',
  recusada: 'neutro',
};

/** Janela para escolher os mecânicos do serviço (substitui a lista; quem não está na O.S. passa a estar). */
function JanelaMecanicos({ os: o, item, aoSalvar, aoFechar }: Props & { item: Item; aoFechar: () => void }) {
  const mecanicos = useMecanicosOs();
  const [escolhidos, setEscolhidos] = useState(() => new Set(item.mecanicos.map((m) => m.id)));
  const salvar = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/itens/${item.id}/mecanicos`, {
        method: 'PUT',
        body: { usuarioIds: [...escolhidos], versao: o.versao },
      }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      aoFechar();
    },
  });
  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  return (
    <Janela titulo={`Mecânicos — ${item.descricao}`} aoFechar={aoFechar}>
      <div className="space-y-4">
        {mecanicos.data?.length === 0 ? (
          <TextoSuave>Nenhum usuário com função de mecânico.</TextoSuave>
        ) : (
          <ul className="space-y-2">
            {mecanicos.data?.map((m) => (
              <li key={m.id}>
                <Marcador rotulo={m.nome} checked={escolhidos.has(m.id)} onChange={() => alternar(m.id)} />
              </li>
            ))}
          </ul>
        )}
        <TextoSuave>Quem ainda não está na O.S. passa a estar vinculado a ela.</TextoSuave>
        <Alerta>{salvar.isError && salvar.error.message}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            Salvar
          </Botao>
        </div>
      </div>
    </Janela>
  );
}

/** Um cartão por serviço: situação da execução, mecânicos e as ações (confirmar, desfazer, mecânicos). */
function CartaoServico({
  os: o,
  item,
  podeExecutar,
  podeAtribuir,
  aoSalvar,
}: Props & { item: Item; podeExecutar: boolean; podeAtribuir: boolean }) {
  const meuId = useSessao().data?.usuario.id;
  const [atribuindo, setAtribuindo] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);
  const executar = useMutation({
    mutationFn: (desfazer: boolean) =>
      api<OrdemServico>(`/ordens-servico/${o.id}/itens/${item.id}/${desfazer ? 'desfazer-execucao' : 'executar'}`, {
        method: 'POST',
        body: { versao: o.versao },
      }),
    onSuccess: (salva) => {
      setDesfazendo(false);
      aoSalvar(salva);
    },
  });
  const meu = item.mecanicos.some((m) => m.id === meuId);
  const quantidade =
    item.tempoMinutos != null
      ? `${formatarHoras(item.tempoMinutos)} h`
      : `${formatarQuantidade(item.quantidade!)} ${item.unidade}`;
  return (
    <li
      className={`space-y-3 rounded-md border p-3 ${item.executadoEm ? 'border-sucesso/40 bg-sucesso-suave/40' : 'border-borda'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{item.descricao}</p>
          <p className="text-xs text-texto-suave">
            {quantidade}
            {item.avulso && ' · avulso'}
          </p>
        </div>
        {item.aprovacao === 'pendente' ? (
          <Selo tom="alerta">Aguardando cliente</Selo>
        ) : item.executadoEm ? (
          <Selo tom="sucesso" ponto>
            Executado
          </Selo>
        ) : (
          <Selo tom="neutro" ponto>
            A executar
          </Selo>
        )}
      </div>
      {item.executadoEm && (
        <TextoSuave>
          Confirmado por {item.executadoPor ?? '—'} em {dataHora(item.executadoEm)}.
        </TextoSuave>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Users className="size-4 text-texto-suave" aria-hidden />
        {item.mecanicos.length ? (
          item.mecanicos.map((m) => (
            <Selo key={m.id} tom={m.id === meuId ? 'primario' : 'neutro'}>
              {m.nome}
            </Selo>
          ))
        ) : (
          <span className="text-texto-suave">Sem mecânico atribuído</span>
        )}
        {meu && <span className="text-xs text-primaria">(seu serviço)</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {podeExecutar && item.aprovacao === 'aprovado' && !item.executadoEm && (
          <Botao variante="sucesso" disabled={executar.isPending} onClick={() => executar.mutate(false)}>
            <CheckCircle2 className="mr-1.5 size-4" aria-hidden /> Confirmar execução
          </Botao>
        )}
        {podeExecutar && item.executadoEm && (
          <Botao variante="secundario" onClick={() => setDesfazendo(true)}>
            <Undo2 className="mr-1.5 size-4" aria-hidden /> Desfazer
          </Botao>
        )}
        {podeAtribuir && (
          <Botao variante="secundario" onClick={() => setAtribuindo(true)}>
            <Users className="mr-1.5 size-4" aria-hidden /> Mecânicos
          </Botao>
        )}
      </div>
      <Alerta>{executar.isError && !desfazendo && executar.error.message}</Alerta>
      {atribuindo && <JanelaMecanicos os={o} item={item} aoSalvar={aoSalvar} aoFechar={() => setAtribuindo(false)} />}
      {desfazendo && (
        <Confirmacao
          titulo="Desfazer execução"
          mensagem={`"${item.descricao}" volta a ficar a executar (fica registrado no histórico).`}
          rotuloConfirmar="Desfazer"
          carregando={executar.isPending}
          erro={executar.isError && executar.error.message}
          aoConfirmar={() => executar.mutate(true)}
          aoFechar={() => setDesfazendo(false)}
        />
      )}
    </li>
  );
}

/** Pedido de peça pelo mecânico: descrição, quantidade e observação. */
function FormularioSolicitacao({ os: o, aoSalvar, aoFechar }: Props & { aoFechar: () => void }) {
  const [descricao, setDescricao] = useState('');
  const [quantidade, setQuantidade] = useState('1');
  const [observacao, setObservacao] = useState('');
  const pedir = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/solicitacoes-peca`, {
        method: 'POST',
        body: { descricao, quantidade: quantidadeParaNumero(quantidade) ?? 0, observacao, versao: o.versao },
      }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      aoFechar();
    },
  });
  return (
    <Janela titulo="Solicitar peça" aoFechar={aoFechar}>
      <div className="space-y-4">
        <Campo rotulo="Peça *">
          <Input
            maxLength={200}
            placeholder="Ex.: pastilha de freio dianteira"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Campo>
        <Campo rotulo="Quantidade *">
          <Input
            inputMode="decimal"
            className="w-32"
            value={quantidade}
            onChange={(e) => setQuantidade(mascaraQuantidade(e.target.value, true))}
          />
        </Campo>
        <Campo rotulo="Observação">
          <AreaTexto
            rows={2}
            maxLength={500}
            placeholder="Medida, marca, lado…"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </Campo>
        <Alerta>{pedir.isError && pedir.error.message}</Alerta>
        <div className="flex justify-end gap-2">
          <Botao variante="secundario" onClick={aoFechar}>
            Voltar
          </Botao>
          <Botao disabled={pedir.isPending || !descricao.trim()} onClick={() => pedir.mutate()}>
            Solicitar
          </Botao>
        </div>
      </div>
    </Janela>
  );
}

/** Atender (resposta opcional) ou recusar (motivo obrigatório) uma solicitação. */
function JanelaResposta({
  os: o,
  solicitacao,
  acao,
  aoSalvar,
  aoFechar,
}: Props & { solicitacao: Solicitacao; acao: 'atender' | 'recusar'; aoFechar: () => void }) {
  const [resposta, setResposta] = useState('');
  const responder = useMutation({
    mutationFn: () =>
      api<OrdemServico>(`/ordens-servico/${o.id}/solicitacoes-peca/${solicitacao.id}/${acao}`, {
        method: 'POST',
        body: { versao: o.versao, resposta },
      }),
    onSuccess: (salva) => {
      aoSalvar(salva);
      aoFechar();
    },
  });
  const recusar = acao === 'recusar';
  return (
    <Confirmacao
      titulo={recusar ? 'Recusar solicitação' : 'Atender solicitação'}
      mensagem={
        recusar
          ? `Recusar "${solicitacao.descricao}". O mecânico vê o motivo na O.S.`
          : `Marca "${solicitacao.descricao}" como atendida. Inclua a peça nos itens da O.S. (aba Serviços e produtos).`
      }
      rotuloConfirmar={recusar ? 'Recusar' : 'Atender'}
      perigo={recusar}
      carregando={responder.isPending || (recusar && !resposta.trim())}
      erro={responder.isError && responder.error.message}
      aoConfirmar={() => responder.mutate()}
      aoFechar={aoFechar}
    >
      <Campo rotulo={recusar ? 'Motivo *' : 'Resposta (opcional)'}>
        <AreaTexto rows={2} maxLength={500} value={resposta} onChange={(e) => setResposta(e.target.value)} />
      </Campo>
    </Confirmacao>
  );
}

/** Solicitações de peça da O.S. (OS-21): o mecânico pede; quem tem "Peças na O.S." atende ou recusa. */
function SolicitacoesPeca({ os: o, aoSalvar }: Props) {
  const emAberto = SITUACOES_OS_EM_ABERTO.includes(o.situacao);
  const [pedindo, setPedindo] = useState(false);
  const [respondendo, setRespondendo] = useState<{ solicitacao: Solicitacao; acao: 'atender' | 'recusar' } | null>(
    null,
  );
  return (
    <Secao
      titulo="Peças solicitadas"
      acao={
        o.permissoes.alterar &&
        emAberto && (
          <Botao variante="secundario" onClick={() => setPedindo(true)}>
            <PackagePlus className="mr-1.5 size-4" aria-hidden /> Solicitar peça
          </Botao>
        )
      }
    >
      {o.solicitacoesPeca.length === 0 ? (
        <TextoSuave>Nenhuma peça solicitada.</TextoSuave>
      ) : (
        <ul className="divide-y divide-borda">
          {o.solicitacoesPeca.map((s) => (
            <li key={s.id} className="space-y-1.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">
                    {formatarQuantidade(s.quantidade)} × {s.descricao}
                  </span>
                  {s.observacao && <span className="text-texto-suave"> — {s.observacao}</span>}
                </p>
                <Selo tom={TOM_SOLICITACAO[s.status]}>{STATUS_SOLICITACAO_PECA[s.status]}</Selo>
              </div>
              <TextoSuave>
                Pedida por {s.solicitadaPor ?? '—'} em {dataHora(s.solicitadaEm)}
                {s.resolvidaEm &&
                  ` · ${s.status === 'atendida' ? 'atendida' : 'recusada'} por ${s.resolvidaPor ?? '—'} em ${dataHora(s.resolvidaEm)}`}
                {s.resposta && ` — ${s.resposta}`}
              </TextoSuave>
              {s.status === 'pendente' && o.permissoes.produtos && emAberto && (
                <div className="flex gap-2">
                  <Botao variante="sucesso" onClick={() => setRespondendo({ solicitacao: s, acao: 'atender' })}>
                    Atender
                  </Botao>
                  <Botao variante="secundario" onClick={() => setRespondendo({ solicitacao: s, acao: 'recusar' })}>
                    Recusar
                  </Botao>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {pedindo && <FormularioSolicitacao os={o} aoSalvar={aoSalvar} aoFechar={() => setPedindo(false)} />}
      {respondendo && (
        <JanelaResposta os={o} {...respondendo} aoSalvar={aoSalvar} aoFechar={() => setRespondendo(null)} />
      )}
    </Secao>
  );
}

/**
 * Aba Execução: serviços (confirmar a execução, mecânicos), peças solicitadas e o que falta para concluir.
 * Produtos não aparecem aqui: não têm execução.
 */
export function ExecucaoOs({ os: o, aoSalvar }: Props) {
  const notificar = useNotificar();
  const servicos = o.itens.filter((i) => i.tipo === 'servico');
  const executados = servicos.filter((i) => i.executadoEm).length;
  const podeExecutar = o.permissoes.alterar && SITUACOES_OS_EXECUCAO.includes(o.situacao);
  const podeAtribuir = o.permissoes.alterar && SITUACOES_OS_EM_ABERTO.includes(o.situacao);
  const salvar = (salva: OrdemServico) => {
    aoSalvar(salva);
    if (salva.situacao === 'em_execucao' && salva.pendenciasConclusao.length === 0 && o.pendenciasConclusao.length)
      notificar('Tudo pronto: a O.S. já pode ser concluída.');
  };
  return (
    <div className="space-y-6">
      <Secao titulo={`Serviços (${executados} de ${servicos.length} executados)`}>
        {!SITUACOES_OS_EXECUCAO.includes(o.situacao) && o.situacao !== 'concluida' && (
          <TextoSuave>A confirmação de execução fica disponível depois de "Iniciar execução".</TextoSuave>
        )}
        {servicos.length === 0 ? (
          <TextoSuave>Nenhum serviço na O.S.</TextoSuave>
        ) : (
          <ul className="space-y-2">
            {servicos.map((i) => (
              <CartaoServico
                key={i.id}
                os={o}
                item={i}
                podeExecutar={podeExecutar}
                podeAtribuir={podeAtribuir}
                aoSalvar={salvar}
              />
            ))}
          </ul>
        )}
      </Secao>
      <SolicitacoesPeca os={o} aoSalvar={salvar} />
    </div>
  );
}
