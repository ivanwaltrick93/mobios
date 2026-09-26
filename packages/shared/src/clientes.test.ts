import { describe, expect, it } from 'vitest';
import { janelaDeAniversarios } from './clientes.js';

describe('janela de aniversários', () => {
  it('lista o MMDD de cada dia de hoje até o fim da janela, com a distância em dias', () => {
    expect(janelaDeAniversarios('2026-09-26', 7)).toEqual([
      { mmdd: 926, dias: 0 },
      { mmdd: 927, dias: 1 },
      { mmdd: 928, dias: 2 },
      { mmdd: 929, dias: 3 },
      { mmdd: 930, dias: 4 },
      { mmdd: 1001, dias: 5 },
      { mmdd: 1002, dias: 6 },
      { mmdd: 1003, dias: 7 },
    ]);
  });

  it('atravessa a virada do ano', () => {
    expect(janelaDeAniversarios('2026-12-30', 3).map((j) => j.mmdd)).toEqual([1230, 1231, 101, 102]);
  });

  it('só hoje: janela de zero dias', () => {
    expect(janelaDeAniversarios('2026-05-10', 0)).toEqual([{ mmdd: 510, dias: 0 }]);
  });

  it('ano não bissexto: quem nasceu em 29/02 é lembrado em 28/02', () => {
    const janela = janelaDeAniversarios('2027-02-25', 7);
    expect(janela).toContainEqual({ mmdd: 229, dias: 3 });
    expect(janela).toContainEqual({ mmdd: 228, dias: 3 });
  });

  it('ano bissexto: 29/02 tem o próprio dia', () => {
    const janela = janelaDeAniversarios('2028-02-25', 7);
    expect(janela.filter((j) => j.mmdd === 229)).toEqual([{ mmdd: 229, dias: 4 }]);
  });

  it('ano não bissexto sem 28/02 na janela: 29/02 fica de fora', () => {
    expect(janelaDeAniversarios('2027-03-01', 7).some((j) => j.mmdd === 229)).toBe(false);
  });
});
