import { describe, expect, it } from 'vitest';
import { dentroDaAlcada, formatarPercentual, percentualDeDesconto, percentualDoItem } from './aprovacoes.js';

describe('percentual de desconto do documento', () => {
  it('é desconto ÷ subtotal em centésimos, arredondado para cima', () => {
    expect(percentualDeDesconto(1_000_000, 80_000)).toBe(800);
    expect(percentualDeDesconto(12_345, 988)).toBe(801); // 8,0032% → 8,01%
    expect(percentualDeDesconto(12_345, 2_469)).toBe(2000);
    expect(percentualDeDesconto(12_345, 12_345)).toBe(10_000);
  });

  it('sem subtotal ou sem desconto, é zero', () => {
    expect(percentualDeDesconto(0, 0)).toBe(0);
    expect(percentualDeDesconto(12_345, 0)).toBe(0);
  });

  it('igual à alçada está dentro; um centésimo acima, fora', () => {
    expect(dentroDaAlcada(500, 500)).toBe(true);
    expect(dentroDaAlcada(501, 500)).toBe(false);
    expect(dentroDaAlcada(0, 0)).toBe(true);
  });

  it('formata com duas casas', () => {
    expect(formatarPercentual(801)).toBe('8,01%');
    expect(formatarPercentual(10_000)).toBe('100,00%');
  });
});

describe('percentual de desconto do item (base da alçada)', () => {
  it('desconto digitado em %: vale o digitado, mesmo com os centavos arredondados a favor do cliente', () => {
    // 15% de R$ 56,90 = R$ 8,535 → R$ 8,54 de desconto (15,01% efetivo), mas a alçada vê 15,00%.
    expect(percentualDoItem(5_690, 4_836, 1_500)).toBe(1_500);
  });

  it('preço digitado ou recalculado: percentual efetivo arredondado para cima', () => {
    expect(percentualDoItem(11_000, 10_000, null)).toBe(910); // 9,0909% → 9,10%
    expect(percentualDoItem(10_000, 9_200, null)).toBe(800);
  });

  it('sem desconto: zero (inclusive preço igual ao de tabela com percentual zerado)', () => {
    expect(percentualDoItem(10_000, 10_000, null)).toBe(0);
    expect(percentualDoItem(10_000, 10_000, 0)).toBe(0);
  });
});
