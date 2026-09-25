import { describe, expect, it } from 'vitest';
import {
  arredondarMinutos,
  arredondarQuantidade,
  calcularItem,
  descontoPorPercentual,
  formatarNumeroOrcamento,
  itemOrcamentoInputSchema,
  percentualDoDesconto,
  situacaoOrcamento,
} from './orcamentos.js';

describe('orçamentos: contas', () => {
  it('quantidade sobe até o múltiplo de venda; fração só em unidade fracionada de múltiplo 1', () => {
    expect(arredondarQuantidade(7, 6, false)).toBe(12);
    expect(arredondarQuantidade(12, 6, false)).toBe(12);
    expect(arredondarQuantidade(1.2, 1, false)).toBe(2);
    expect(arredondarQuantidade(1.5, 1, true)).toBe(1.5);
    expect(arredondarQuantidade(3.5, 2, true)).toBe(4);
    // Valor-hora: múltiplos das horas do serviço (1:30).
    expect(arredondarMinutos(120, 90)).toBe(180);
    expect(arredondarMinutos(90, 90)).toBe(90);
  });

  it('desconto por percentual arredonda para cima (a favor do cliente) e nunca passa do preço', () => {
    expect(descontoPorPercentual(12_345, 1_000)).toBe(1_235); // 10% de R$ 123,45 = R$ 12,345
    expect(descontoPorPercentual(100, 3_333)).toBe(34);
    expect(descontoPorPercentual(12_345, 10_000)).toBe(12_345);
    expect(descontoPorPercentual(12_345, 0)).toBe(0);
    expect(percentualDoDesconto(11_000, 10_000)).toBe(9.09);
    expect(percentualDoDesconto(12_345, 11_110)).toBe(10);
  });

  it('linha: bruto pela tabela, total pelo preço negociado; valor-hora pelos minutos', () => {
    expect(calcularItem(12_345, 11_110, { quantidadeMilesimos: 2_000 })).toEqual({
      brutoCentavos: 24_690,
      descontoCentavos: 2_470,
      totalCentavos: 22_220,
    });
    expect(calcularItem(20_000, 20_000, { tempoMinutos: 90 }).totalCentavos).toBe(30_000);
    // 1,5 L a R$ 33,33 = R$ 49,995 → R$ 50,00.
    expect(calcularItem(3_333, 3_333, { quantidadeMilesimos: 1_500 }).totalCentavos).toBe(5_000);
  });

  it('vence depois do dia seguinte ao da validade; rascunho não vence', () => {
    expect(situacaoOrcamento('emitido', '2026-09-30', '2026-10-01')).toBe('emitido');
    expect(situacaoOrcamento('enviado', '2026-09-30', '2026-10-02')).toBe('vencido');
    expect(situacaoOrcamento('rascunho', '2026-09-30', '2026-12-01')).toBe('rascunho');
    expect(situacaoOrcamento('aprovado', '2026-09-30', '2026-12-01')).toBe('aprovado');
    expect(formatarNumeroOrcamento(12)).toBe('ORC-0000000012');
  });

  it('item: percentual com até 2 casas, e percentual ou preço (não os dois)', () => {
    const base = { tipo: 'material', materialId: crypto.randomUUID(), quantidade: 1 };
    expect(itemOrcamentoInputSchema.safeParse({ ...base, descontoPercentual: 7.5 }).success).toBe(true);
    expect(itemOrcamentoInputSchema.safeParse({ ...base, descontoPercentual: 7.555 }).success).toBe(false);
    expect(itemOrcamentoInputSchema.safeParse({ ...base, descontoPercentual: 101 }).success).toBe(false);
    expect(
      itemOrcamentoInputSchema.safeParse({ ...base, descontoPercentual: 5, precoUnitarioCentavos: 100 }).success,
    ).toBe(false);
    expect(
      itemOrcamentoInputSchema.parse({ tipo: 'servico', servicoId: base.materialId, tempoMinutos: '1:30' }),
    ).toMatchObject({
      tempoMinutos: 90,
    });
  });
});
