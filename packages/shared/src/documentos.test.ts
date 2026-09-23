import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, normalizarPlaca, placaValida } from './documentos.js';

describe('documentos', () => {
  it('valida CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('valida CNPJ', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
  });

  it('valida placas antiga e Mercosul', () => {
    expect(placaValida('abc-1234')).toBe(true);
    expect(placaValida('BRA2E19')).toBe(true);
    expect(placaValida('AB12345')).toBe(false);
    expect(normalizarPlaca('bra-2e19')).toBe('BRA2E19');
  });
});

describe('veiculoInputSchema', async () => {
  const { veiculoInputSchema } = await import('./schemas.js');
  const base = { clienteId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a', placa: 'BRA2E19', marca: 'Fiat', modelo: 'Strada' };

  it('trata ano e km vazios como null', () => {
    const r = veiculoInputSchema.parse({ ...base, ano: '', kmAtual: '' });
    expect(r.ano).toBeNull();
    expect(r.kmAtual).toBeNull();
  });

  it('converte ano digitado e rejeita ano absurdo', () => {
    expect(veiculoInputSchema.parse({ ...base, ano: '2020' }).ano).toBe(2020);
    expect(veiculoInputSchema.safeParse({ ...base, ano: '1800' }).success).toBe(false);
  });
});
