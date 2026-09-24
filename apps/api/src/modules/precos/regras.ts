import { formatarDataIso, hojeIso } from '@mobios/shared';
import { and, asc, eq, gt, gte, isNull, lte, not, or, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import {
  materiais,
  materiaisPrecos,
  precosEventos,
  precosPadrao,
  precosPadraoEventos,
  tabelasPreco,
} from '../../db/schema.js';
import { ErroHttp, naoEncontrado } from '../../lib/erros.js';

// Regras de gravação de preço (vigências e preço padrão), usadas pelas rotas e pela importação de planilha.
// Tudo roda dentro de withTenant e da trava por material + tabela.

/** Dia anterior de uma data AAAA-MM-DD (sem fuso: só a data). */
export const diaAnterior = (data: string) =>
  new Date(Date.parse(`${data}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Vigência (não cancelada) que vale na data. A constraint EXCLUDE garante que é no máximo uma. */
export const vigenteEm = (materialId: string, tabelaPrecoId: string, data: string): SQL =>
  and(
    eq(materiaisPrecos.materialId, materialId),
    eq(materiaisPrecos.tabelaPrecoId, tabelaPrecoId),
    not(materiaisPrecos.cancelado),
    lte(materiaisPrecos.dataInicio, data),
    or(isNull(materiaisPrecos.dataFim), gte(materiaisPrecos.dataFim, data)),
  )!;

/**
 * Serializa alterações de preço do mesmo material + tabela (trava liberada no fim da transação).
 * A constraint EXCLUDE já impede sobreposição; a trava evita que duas inclusões simultâneas
 * leiam o mesmo "preço atual" e uma delas falhe no meio do encerramento automático.
 */
export const travar = (tx: Tx, materialId: string, tabelaPrecoId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`precos:${materialId}:${tabelaPrecoId}`}))`);

type Evento = 'criado' | 'alterado' | 'encerrado' | 'cancelado' | 'reaberto';
export const registrar = (
  tx: Tx,
  precoId: string,
  evento: Evento,
  usuarioId: string,
  antes: object | null,
  depois: object | null,
) => tx.insert(precosEventos).values({ precoId, evento, usuarioId, antes, depois });

/** Campos da vigência que entram na trilha de auditoria. */
export const retrato = (p: { precoCentavos: number; dataInicio: string; dataFim: string | null }) => ({
  precoCentavos: p.precoCentavos,
  dataInicio: p.dataInicio,
  dataFim: p.dataFim,
});

/**
 * Material do preço, pelo id ou pelo SKU digitado. SKU inexistente: 400 apontando o campo `sku`
 * (a tela da tabela de preço mostra o erro no próprio campo, antes de gravar qualquer coisa).
 */
export async function resolverMaterial(tx: Tx, { materialId, sku }: { materialId?: string; sku?: string }) {
  const [material] = await tx
    .select({ id: materiais.id, ativo: materiais.ativo })
    .from(materiais)
    .where(materialId ? eq(materiais.id, materialId) : eq(materiais.sku, sku ?? ''));
  if (material) return material;
  if (materialId) throw naoEncontrado('Material');
  throw new ErroHttp(400, `SKU ${sku} não encontrado.`, { sku: 'SKU não encontrado' });
}

/** Material e tabela precisam estar ativos para receber preço novo. */
async function exigirAtivos(tx: Tx, material: { ativo: boolean }, tabelaPrecoId: string) {
  if (!material.ativo) throw new ErroHttp(400, 'Material inativo não recebe preço novo. Reative-o primeiro.');
  const [tabela] = await tx
    .select({ ativa: tabelasPreco.ativa })
    .from(tabelasPreco)
    .where(eq(tabelasPreco.id, tabelaPrecoId));
  if (!tabela) throw naoEncontrado('Tabela de preço');
  if (!tabela.ativa) throw new ErroHttp(400, 'Tabela de preço inativa não recebe preço novo. Reative-a primeiro.');
}

export type NovaVigencia = {
  material: { id: string; ativo: boolean };
  tabelaPrecoId: string;
  precoCentavos: number;
  dataInicio: string;
  dataFim: string | null;
};

/**
 * Nova vigência. Nunca apaga nem reescreve o passado:
 * - início hoje ou depois;
 * - a vigência que vale na data de início é encerrada no dia anterior (e volta ao fim original se a nova for cancelada);
 * - fim vazio = aberta; havendo preço futuro depois, a nova termina na véspera dele;
 * - fim informado que invade um preço futuro, ou que termina antes do fim da vigência atual, = conflito (409).
 * Devolve o id da vigência criada.
 */
export async function criarVigencia(tx: Tx, nova: NovaVigencia, usuarioId: string): Promise<string> {
  const { material, tabelaPrecoId, precoCentavos, dataInicio } = nova;
  let { dataFim } = nova;
  if (dataInicio < hojeIso())
    throw new ErroHttp(400, 'A vigência não pode começar no passado: o histórico de preços não é reescrito.');

  await travar(tx, material.id, tabelaPrecoId);
  await exigirAtivos(tx, material, tabelaPrecoId);

  const [atual] = await tx
    .select()
    .from(materiaisPrecos)
    .where(vigenteEm(material.id, tabelaPrecoId, dataInicio));
  if (atual?.dataInicio === dataInicio) {
    throw new ErroHttp(
      409,
      'Já existe um preço começando nesta data. Edite-o (se ainda não começou) ou escolha outra data de início.',
    );
  }
  const [proximo] = await tx
    .select({ dataInicio: materiaisPrecos.dataInicio })
    .from(materiaisPrecos)
    .where(
      and(
        eq(materiaisPrecos.materialId, material.id),
        eq(materiaisPrecos.tabelaPrecoId, tabelaPrecoId),
        not(materiaisPrecos.cancelado),
        gt(materiaisPrecos.dataInicio, dataInicio),
      ),
    )
    .orderBy(asc(materiaisPrecos.dataInicio))
    .limit(1);
  if (proximo) {
    if (!dataFim) dataFim = diaAnterior(proximo.dataInicio);
    else if (dataFim >= proximo.dataInicio) {
      throw new ErroHttp(
        409,
        `Já existe preço programado a partir de ${formatarDataIso(proximo.dataInicio)}. ` +
          'Termine a nova vigência antes dessa data.',
      );
    }
  }

  // A nova só substitui a atual se cobrir o resto do período dela; terminar no meio partiria a vigência
  // em duas (com um buraco sem preço) — isso é sobreposição e é recusado.
  if (atual && dataFim && (atual.dataFim === null || dataFim < atual.dataFim)) {
    const fimAtual = atual.dataFim ? `até ${formatarDataIso(atual.dataFim)}` : 'sem data de fim';
    throw new ErroHttp(
      409,
      `O período se sobrepõe ao preço vigente (${fimAtual}). ` +
        'Deixe a nova vigência sem fim ou termine-a depois do fim da atual.',
    );
  }

  // Encerra a vigência atual na véspera (guardando o fim anterior para desfazer se a nova for cancelada).
  if (atual) {
    await tx
      .update(materiaisPrecos)
      .set({ dataFim: diaAnterior(dataInicio), dataFimAnterior: atual.dataFim, atualizadoPor: usuarioId })
      .where(eq(materiaisPrecos.id, atual.id));
  }
  const [novo] = (await tx
    .insert(materiaisPrecos)
    .values({
      materialId: material.id,
      tabelaPrecoId,
      precoCentavos,
      dataInicio,
      dataFim: dataFim ?? null,
      criadoPor: usuarioId,
      atualizadoPor: usuarioId,
    })
    .returning()) as [typeof materiaisPrecos.$inferSelect];
  await registrar(tx, novo.id, 'criado', usuarioId, null, retrato(novo));
  if (atual) {
    await tx.update(materiaisPrecos).set({ encerradoPeloPrecoId: novo.id }).where(eq(materiaisPrecos.id, atual.id));
    await registrar(tx, atual.id, 'encerrado', usuarioId, retrato(atual), {
      ...retrato(atual),
      dataFim: diaAnterior(dataInicio),
      motivo: 'Nova vigência',
    });
  }
  return novo.id;
}

const chavePadrao = (materialId: string, tabelaPrecoId: string) =>
  and(eq(precosPadrao.materialId, materialId), eq(precosPadrao.tabelaPrecoId, tabelaPrecoId));

/**
 * Define (ou altera) o preço padrão de um material numa tabela. Com `versao`, confere que ninguém alterou
 * desde a leitura (409); sem ela (importação), o valor informado prevalece. Mesmo valor = nada a gravar.
 */
export async function definirPrecoPadrao(
  tx: Tx,
  dados: { material: { id: string; ativo: boolean }; tabelaPrecoId: string; precoCentavos: number; versao?: number },
  usuarioId: string,
): Promise<'definido' | 'alterado' | 'sem_alteracao'> {
  const { material, tabelaPrecoId, precoCentavos, versao } = dados;
  await travar(tx, material.id, tabelaPrecoId);
  await exigirAtivos(tx, material, tabelaPrecoId);
  const [atual] = await tx.select().from(precosPadrao).where(chavePadrao(material.id, tabelaPrecoId)).for('update');

  if (atual && versao != null && versao !== atual.versao) {
    throw new ErroHttp(409, 'O preço padrão foi alterado por outra pessoa. Recarregue e refaça a alteração.');
  }
  if (atual?.precoCentavos === precoCentavos) return 'sem_alteracao';

  if (atual) {
    await tx
      .update(precosPadrao)
      .set({ precoCentavos, atualizadoPor: usuarioId, versao: atual.versao + 1 })
      .where(eq(precosPadrao.id, atual.id));
  } else {
    await tx.insert(precosPadrao).values({
      materialId: material.id,
      tabelaPrecoId,
      precoCentavos,
      criadoPor: usuarioId,
      atualizadoPor: usuarioId,
    });
  }
  const evento = atual ? 'alterado' : 'definido';
  await tx.insert(precosPadraoEventos).values({
    materialId: material.id,
    tabelaPrecoId,
    evento,
    precoAntes: atual?.precoCentavos ?? null,
    precoDepois: precoCentavos,
    usuarioId,
  });
  return evento;
}

/** Remove o preço padrão (o material fica sem preço nos dias sem vigência). Fica registrado na trilha. */
export async function removerPrecoPadrao(tx: Tx, materialId: string, tabelaPrecoId: string, usuarioId: string) {
  await travar(tx, materialId, tabelaPrecoId);
  const [removido] = await tx
    .delete(precosPadrao)
    .where(chavePadrao(materialId, tabelaPrecoId))
    .returning({ precoCentavos: precosPadrao.precoCentavos });
  if (!removido) throw naoEncontrado('Preço padrão');
  await tx.insert(precosPadraoEventos).values({
    materialId,
    tabelaPrecoId,
    evento: 'removido',
    precoAntes: removido.precoCentavos,
    precoDepois: null,
    usuarioId,
  });
}
