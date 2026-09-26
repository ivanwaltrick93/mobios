import {
  formatarMoeda,
  FORMAS_PRECO_SERVICO,
  mascaraHoras,
  mascaraMoeda,
  mascaraQuantidade,
  SITUACOES_OS,
  UNIDADES,
  type SituacaoOs,
  type TipoItemPreco,
} from '@mobios/shared';
import { Plus, Trash2 } from 'lucide-react';
import { avulsoNovo, totalDoAvulso, type LinhaAvulsa } from '../lib/ordensServico';
import { Botao, Input, Select, Selo, TextoSuave, type Tom } from './ui';

// Peças da O.S. usadas em mais de uma tela (docs/modulos/ORDENS_SERVICO.md).

/** Tom de cada situação: neutro no início e no fim, alerta no que espera alguém, sucesso no que anda bem. */
const TOM_SITUACAO_OS: Record<SituacaoOs, Tom> = {
  aberta: 'neutro',
  em_diagnostico: 'info',
  aguardando_aprovacao: 'alerta',
  aprovada: 'primario',
  em_execucao: 'primario',
  aguardando_peca: 'alerta',
  concluida: 'sucesso',
  entregue: 'sucesso',
  recusada: 'perigo',
  cancelada: 'neutro',
};

export const SeloSituacaoOs = ({ situacao }: { situacao: SituacaoOs }) => (
  <Selo tom={TOM_SITUACAO_OS[situacao]} ponto>
    {SITUACOES_OS[situacao]}
  </Selo>
);

/** Campos de um avulso: tipo, descrição, unidade ou forma de preço, quantidade ou horas, preço e total. */
function LinhaDoAvulso({
  l,
  pecas,
  aoMudar,
  aoRemover,
}: {
  l: LinhaAvulsa;
  pecas: boolean;
  aoMudar: (mudanca: Partial<LinhaAvulsa>) => void;
  aoRemover: () => void;
}) {
  const porHora = l.tipo === 'servico' && l.formaPreco === 'hora';
  return (
    <li className="grid gap-2 rounded-md border border-borda p-3 sm:grid-cols-[8rem_minmax(0,1fr)_9rem_7rem_8rem_7rem_2.25rem] sm:items-center">
      <Select
        aria-label="Tipo do item avulso"
        value={l.tipo}
        // Sem "Peças na O.S.", o avulso só pode ser serviço (a peça já gravada fica como está).
        disabled={!pecas && l.tipo === 'material'}
        onChange={(e) => aoMudar({ tipo: e.target.value as TipoItemPreco })}
      >
        <option value="servico">Serviço</option>
        {(pecas || l.tipo === 'material') && <option value="material">Peça</option>}
      </Select>
      <Input
        aria-label="Descrição do item avulso"
        placeholder="Descrição"
        maxLength={200}
        value={l.descricao}
        onChange={(e) => aoMudar({ descricao: e.target.value })}
      />
      {l.tipo === 'material' ? (
        <Select
          aria-label={`Unidade de ${l.descricao || 'item avulso'}`}
          value={l.unidade}
          onChange={(e) => aoMudar({ unidade: e.target.value as LinhaAvulsa['unidade'] })}
        >
          {Object.entries(UNIDADES).map(([codigo, u]) => (
            <option key={codigo} value={codigo}>
              {codigo} — {u.nome}
            </option>
          ))}
        </Select>
      ) : (
        <Select
          aria-label={`Forma de preço de ${l.descricao || 'item avulso'}`}
          value={l.formaPreco}
          onChange={(e) => aoMudar({ formaPreco: e.target.value as LinhaAvulsa['formaPreco'] })}
        >
          {Object.entries(FORMAS_PRECO_SERVICO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
      )}
      {porHora ? (
        <Input
          aria-label={`Horas de ${l.descricao || 'item avulso'}`}
          className="text-center tabular-nums"
          inputMode="numeric"
          placeholder="0:00"
          value={l.horas}
          onChange={(e) => aoMudar({ horas: mascaraHoras(e.target.value) })}
        />
      ) : (
        <Input
          aria-label={`Quantidade de ${l.descricao || 'item avulso'}`}
          className="text-center tabular-nums"
          inputMode="decimal"
          value={l.quantidade}
          onChange={(e) =>
            aoMudar({
              quantidade: mascaraQuantidade(e.target.value, l.tipo === 'material' && UNIDADES[l.unidade].fracionada),
            })
          }
        />
      )}
      <Input
        aria-label={`${porHora ? 'Valor-hora' : 'Preço'} de ${l.descricao || 'item avulso'}`}
        className="tabular-nums"
        inputMode="numeric"
        placeholder={porHora ? 'R$/hora' : 'Preço'}
        value={l.preco}
        onChange={(e) => aoMudar({ preco: mascaraMoeda(e.target.value) })}
      />
      <span className="text-right text-sm font-semibold tabular-nums">{formatarMoeda(totalDoAvulso(l))}</span>
      <button
        type="button"
        title="Remover item"
        aria-label={`Remover ${l.descricao || 'item avulso'}`}
        className="inline-flex size-9 items-center justify-center justify-self-end rounded-md text-texto-suave hover:bg-superficie-alt hover:text-perigo"
        onClick={aoRemover}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Itens avulsos da O.S. (docs/modulos/ORDENS_SERVICO.md §4): serviço ou peça sem cadastro, com descrição e preço
 * digitados. O preço é o final: sem desconto, alçada, estoque nem PMC. Peça avulsa exige "Peças na O.S.".
 */
export function ItensAvulsos({
  linhas,
  aoMudarLinhas,
  pecas,
}: {
  linhas: LinhaAvulsa[];
  aoMudarLinhas: (mudanca: (atuais: LinhaAvulsa[]) => LinhaAvulsa[]) => void;
  /** Pode incluir e alterar peças ("Peças na O.S." em Editar). */
  pecas: boolean;
}) {
  return (
    <section aria-labelledby="titulo-avulsos" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="titulo-avulsos" className="text-base font-semibold text-texto">
            Itens avulsos
          </h2>
          <TextoSuave>Serviço ou peça sem cadastro, com o preço final digitado (sem desconto).</TextoSuave>
        </div>
        <Botao
          type="button"
          variante="secundario"
          onClick={() => aoMudarLinhas((atuais) => [...atuais, avulsoNovo('servico')])}
        >
          <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar avulso
        </Botao>
      </div>
      {linhas.length > 0 && (
        <ul className="space-y-2">
          {linhas.map((l) => (
            <LinhaDoAvulso
              key={l.chave}
              l={l}
              pecas={pecas}
              aoMudar={(mudanca) =>
                aoMudarLinhas((atuais) => atuais.map((x) => (x.chave === l.chave ? { ...x, ...mudanca } : x)))
              }
              aoRemover={() => aoMudarLinhas((atuais) => atuais.filter((x) => x.chave !== l.chave))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
