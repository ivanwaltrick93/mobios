import { describe, expect, it } from 'vitest';
import {
  mascaraCep,
  mascaraChassi,
  mascaraCnpj,
  mascaraCpf,
  mascaraEmail,
  mascaraKm,
  mascaraPlaca,
  mascaraTelefone,
} from './mascaras.js';

describe('máscaras', () => {
  it('CPF e CNPJ (inclusive alfanumérico), aos poucos e colados', () => {
    expect(mascaraCpf('5299')).toBe('529.9');
    expect(mascaraCpf('52998224725999')).toBe('529.982.247-25');
    expect(mascaraCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(mascaraCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(mascaraCnpj('12ABC34501DEXY')).toBe('12.ABC.345/01DE'); // DV só aceita números
  });

  it('telefone fixo e celular, CEP', () => {
    expect(mascaraTelefone('4832221000')).toBe('(48) 3222-1000');
    expect(mascaraTelefone('48999990000')).toBe('(48) 99999-0000');
    expect(mascaraTelefone('(48) 9')).toBe('(48) 9');
    expect(mascaraCep('88015100')).toBe('88015-100');
  });

  it('placa, chassi, km e e-mail', () => {
    expect(mascaraPlaca('abc1234')).toBe('ABC-1234');
    expect(mascaraPlaca('bra2e19')).toBe('BRA2E19');
    expect(mascaraChassi('9bw zzz377vt004251xx')).toBe('9BWZZZ377VT004251');
    expect(mascaraKm('125000')).toBe('125.000');
    expect(mascaraEmail(' Joao@Email.COM ')).toBe('joao@email.com');
  });
});
