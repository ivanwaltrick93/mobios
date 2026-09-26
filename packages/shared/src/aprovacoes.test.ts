import { describe, expect, it } from 'vitest';
import { dentroDaAlcada, formatarPercentual, percentualDeDesconto } from './aprovacoes.js';

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
