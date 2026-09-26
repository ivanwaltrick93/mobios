import { describe, expect, it } from 'vitest';
import { calcularMargem, type ItemParaMargem } from './margem.js';

// Casos da especificação de margem (docs/modulos/APROVACAO_COMERCIAL.md §Margem). Valores em centavos.
const material = (
  quantidade: number,
  precoTabela: number,
  precoLiquido: number,
  pmc: number | null,
): ItemParaMargem => ({
  tipo: 'material',
  quantidade,
  brutoCentavos: Math.round(precoTabela * quantidade),
  totalCentavos: Math.round(precoLiquido * quantidade),
  pmcCentavos: pmc,
});
const servico = (total: number): ItemParaMargem => ({
  tipo: 'servico',
  quantidade: 1,
  brutoCentavos: total,
  totalCentavos: total,
  pmcCentavos: null,
});

describe('margem comercial', () => {
  it('caso 1 — sem desconto: PMC 100, venda 150 → margem 50 (33,33%)', () => {
    const m = calcularMargem([material(1, 15_000, 15_000, 10_000)]);
    expect(m.comDesconto).toMatchObject({ receitaCentavos: 15_000, custoCentavos: 10_000, margemCentavos: 5_000 });
    expect(m.comDesconto!.margemPercentual).toBeCloseTo(33.3333, 4);
  });

  it('caso 2 — com desconto: tabela 150, líquido 135, PMC 100 → margem 35 (25,93%) e o comparativo', () => {
    const m = calcularMargem([material(1, 15_000, 13_500, 10_000)]);
    expect(m.comDesconto).toMatchObject({ receitaCentavos: 13_500, margemCentavos: 3_500 });
    expect(m.comDesconto!.margemPercentual).toBeCloseTo(25.9259, 4);
    // Sem desconto: a mesma conta com o preço de tabela.
    expect(m.semDesconto).toMatchObject({ receitaCentavos: 15_000, margemCentavos: 5_000 });
  });

  it('caso 3 — quantidade 5: receita 750, custo 500, margem 250 (33,33%)', () => {
    const m = calcularMargem([material(5, 15_000, 15_000, 10_000)]);
    expect(m.comDesconto).toMatchObject({ receitaCentavos: 75_000, custoCentavos: 50_000, margemCentavos: 25_000 });
    expect(m.comDesconto!.margemPercentual).toBeCloseTo(33.3333, 4);
  });

  it('casos 4 e 5 — serviço não entra: produto 1.000 com PMC 600 + serviço 500 → margem 400 (40%)', () => {
    const m = calcularMargem([material(1, 100_000, 100_000, 60_000), servico(50_000)]);
    expect(m).toMatchObject({ produtosConsiderados: 1, servicosExcluidos: 1, produtosSemPmc: 0 });
    expect(m.comDesconto).toEqual({
      receitaCentavos: 100_000,
      custoCentavos: 60_000,
      margemCentavos: 40_000,
      margemPercentual: 40,
    });
    expect(m.itens[1]).toMatchObject({ considerado: false, motivo: 'servico', comDesconto: null });
  });

  it('caso 6 — margem negativa e margem zero aparecem como são', () => {
    const negativa = calcularMargem([material(1, 9_000, 9_000, 10_000)]).comDesconto!;
    expect(negativa.margemCentavos).toBe(-1_000);
    expect(negativa.margemPercentual).toBeCloseTo(-11.1111, 4);
    expect(calcularMargem([material(1, 10_000, 10_000, 10_000)]).comDesconto).toMatchObject({
      margemCentavos: 0,
      margemPercentual: 0,
    });
  });

  it('caso 7 — sem PMC: o item não calcula e o consolidado fica não disponível (PMC nunca vira zero)', () => {
    const m = calcularMargem([material(1, 15_000, 15_000, 10_000), material(1, 5_000, 5_000, null)]);
    expect(m).toMatchObject({ produtosConsiderados: 1, produtosSemPmc: 1, comDesconto: null, semDesconto: null });
    expect(m.itens[1]).toMatchObject({ considerado: false, motivo: 'sem_pmc', pmcCentavos: null });
    expect(m.itens[0]!.comDesconto!.margemCentavos).toBe(5_000);
  });

  it('caso 9 — consolidado pela soma (Σ venda − Σ custo), não pela média das margens', () => {
    // Item A: 1.000 − 900 = 100 (10%); item B: 100 − 10 = 90 (90%). Média seria 50%; o certo é 190 ÷ 1.100.
    const m = calcularMargem([material(1, 100_000, 100_000, 90_000), material(1, 10_000, 10_000, 1_000)]);
    expect(m.comDesconto!.margemCentavos).toBe(19_000);
    expect(m.comDesconto!.margemPercentual).toBeCloseTo(17.2727, 4);
  });

  it('custo com quantidade fracionada fica exato (sem arredondar antes); receita zero não divide', () => {
    const m = calcularMargem([material(0.333, 1_000, 1_000, 1_001)]);
    expect(m.comDesconto!.custoCentavos).toBeCloseTo(333.333, 3);
    const zero = calcularMargem([material(1, 0, 0, 500)]).comDesconto!;
    expect(zero.margemPercentual).toBeNull();
    expect(Number.isFinite(zero.margemCentavos)).toBe(true);
  });
});
