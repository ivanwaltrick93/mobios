import { z } from 'zod';

/*
 * Margem comercial aproximada da aprovação comercial (docs/modulos/APROVACAO_COMERCIAL.md §Margem): indicador de
 * apoio ao aprovador, a partir do PMC congelado no item e do preço líquido negociado. Não é margem contábil nem
 * gatilho de aprovação. Só materiais: serviço não tem PMC e fica fora.
 *
 *   Receita líquida = quantidade × preço líquido      (= total do item, em centavos)
 *   Custo           = quantidade × PMC
 *   Margem R$       = receita − custo
 *   Margem %        = margem ÷ receita × 100          (receita 0 → não calculada)
 *   Consolidado     = Σ receitas − Σ custos (nunca a média das margens); com algum produto sem PMC, não disponível.
 *
 * O custo é calculado em milésimos de centavo (PMC × quantidade em milésimos), sem arredondar etapas: só a exibição
 * arredonda. Por isso custo e margem podem ter frações de centavo.
 */

export type ItemParaMargem = {
  tipo: 'material' | 'servico';
  /** Material: quantidade (até 3 casas). Serviço: ignorada. */
  quantidade: number | null;
  /** Preço de tabela × quantidade (sem desconto), em centavos. */
  brutoCentavos: number;
  /** Preço líquido × quantidade, em centavos. */
  totalCentavos: number;
  /** PMC congelado no item; null = não disponível. */
  pmcCentavos: number | null;
};

const valores = z.object({
  receitaCentavos: z.number(),
  custoCentavos: z.number(),
  margemCentavos: z.number(),
  /** null = não calculada (receita zero). */
  margemPercentual: z.number().nullable(),
});
export type ValoresMargem = z.infer<typeof valores>;

export const margemItemSchema = z.object({
  /** Posição do item no retrato (mesma ordem de `snapshot.itens`). */
  indice: z.number(),
  considerado: z.boolean(),
  /** Por que não entrou: serviço ou material sem PMC. */
  motivo: z.enum(['servico', 'sem_pmc']).nullable(),
  pmcCentavos: z.number().nullable(),
  comDesconto: valores.nullable(),
  semDesconto: valores.nullable(),
});
export type MargemItem = z.infer<typeof margemItemSchema>;

export const margemSchema = z.object({
  calculadoEm: z.coerce.date(),
  produtosConsiderados: z.number(),
  produtosSemPmc: z.number(),
  servicosExcluidos: z.number(),
  /** Consolidado só dos produtos com PMC; null quando algum produto não tem PMC (margem não disponível). */
  comDesconto: valores.nullable(),
  semDesconto: valores.nullable(),
  itens: z.array(margemItemSchema),
});
export type Margem = z.infer<typeof margemSchema>;

/** Receita e custo em milésimos de centavo → valores (margem % a partir dos valores exatos). */
function paraValores(receitaMil: bigint, custoMil: bigint): ValoresMargem {
  const margemMil = receitaMil - custoMil;
  return {
    receitaCentavos: Number(receitaMil) / 1000,
    custoCentavos: Number(custoMil) / 1000,
    margemCentavos: Number(margemMil) / 1000,
    margemPercentual: receitaMil === 0n ? null : (Number(margemMil) / Number(receitaMil)) * 100,
  };
}

export function calcularMargem(itens: ItemParaMargem[], calculadoEm: Date = new Date()): Margem {
  let receitaCom = 0n;
  let receitaSem = 0n;
  let custo = 0n;
  let produtosConsiderados = 0;
  let produtosSemPmc = 0;
  let servicosExcluidos = 0;
  const porItem = itens.map((i, indice): MargemItem => {
    if (i.tipo === 'servico') {
      servicosExcluidos++;
      return { indice, considerado: false, motivo: 'servico', pmcCentavos: null, comDesconto: null, semDesconto: null };
    }
    if (i.pmcCentavos == null) {
      produtosSemPmc++;
      return { indice, considerado: false, motivo: 'sem_pmc', pmcCentavos: null, comDesconto: null, semDesconto: null };
    }
    const custoMil = BigInt(i.pmcCentavos) * BigInt(Math.round((i.quantidade ?? 0) * 1000));
    const comMil = BigInt(i.totalCentavos) * 1000n;
    const semMil = BigInt(i.brutoCentavos) * 1000n;
    produtosConsiderados++;
    receitaCom += comMil;
    receitaSem += semMil;
    custo += custoMil;
    return {
      indice,
      considerado: true,
      motivo: null,
      pmcCentavos: i.pmcCentavos,
      comDesconto: paraValores(comMil, custoMil),
      semDesconto: paraValores(semMil, custoMil),
    };
  });
  const disponivel = produtosSemPmc === 0 && produtosConsiderados > 0;
  return {
    calculadoEm,
    produtosConsiderados,
    produtosSemPmc,
    servicosExcluidos,
    comDesconto: disponivel ? paraValores(receitaCom, custo) : null,
    semDesconto: disponivel ? paraValores(receitaSem, custo) : null,
    itens: porItem,
  };
}
