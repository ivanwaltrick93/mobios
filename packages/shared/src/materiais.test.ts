import { describe, expect, it } from 'vitest';
import { gtinValido } from './documentos.js';
import { formatarCodigoServico, formatarHoras } from './formatos.js';
import { horasParaMinutos, mascaraHoras, mascaraMoeda, mascaraNcm, moedaParaCentavos } from './mascaras.js';
import { materialInputSchema, precoInputSchema, servicoInputSchema, situacaoPreco } from './materiais.js';

describe('materiais e preços', () => {
  it('valida código de barras GTIN', () => {
    expect(gtinValido('7891000315507')).toBe(true); // EAN-13
    expect(gtinValido('7891000315508')).toBe(false);
    expect(gtinValido('96385074')).toBe(true); // EAN-8
    expect(gtinValido('036000291452')).toBe(true); // UPC-A
    expect(gtinValido('789 1000315507')).toBe(false);
  });

  it('normaliza SKU, NCM e códigos; campos vazios viram null', () => {
    const base = {
      sku: ' fil-001 ',
      descricao: 'Filtro de óleo',
      tipoId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
      categoriaId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
      unidade: 'UN',
    };
    const m = materialInputSchema.parse({ ...base, ncm: '8421.23.00', codigoBarras: '', marcaId: '', origem: '' });
    expect(m).toMatchObject({
      sku: 'FIL-001',
      ncm: '84212300',
      codigoBarras: null,
      marcaId: null,
      origem: null,
      controlaEstoque: true,
      controlaLote: false,
      // Suprimento: vazio ou ausente assume os padrões.
      multiplo: 1,
      leadtimeDias: 30,
    });
    expect(materialInputSchema.parse({ ...base, multiplo: '', leadtimeDias: '' })).toMatchObject({
      multiplo: 1,
      leadtimeDias: 30,
    });
    expect(materialInputSchema.parse({ ...base, multiplo: '12', leadtimeDias: '0' })).toMatchObject({
      multiplo: 12,
      leadtimeDias: 0,
    });
    for (const invalido of [{ multiplo: '0' }, { multiplo: '1,5' }, { leadtimeDias: '-1' }, { leadtimeDias: 'x' }])
      expect(materialInputSchema.safeParse({ ...base, ...invalido }).success).toBe(false);
    expect(materialInputSchema.safeParse({ ...base, sku: 'FIL 001' }).success).toBe(false);
    expect(materialInputSchema.safeParse({ ...base, ncm: '123' }).success).toBe(false);
  });

  it('máscara de moeda e vigência', () => {
    expect(mascaraMoeda('123456')).toBe('1.234,56');
    expect(mascaraMoeda('5')).toBe('0,05');
    expect(moedaParaCentavos('1.234,56')).toBe(123456);
    expect(mascaraNcm('84212300')).toBe('8421.23.00');
    expect(
      precoInputSchema.safeParse({
        materialId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
        tabelaPrecoId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
        precoCentavos: 100,
        dataInicio: '2026-05-01',
        dataFim: '2026-04-30',
      }).success,
    ).toBe(false);
    expect(
      precoInputSchema.safeParse({
        materialId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
        tabelaPrecoId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
        precoCentavos: -1,
        dataInicio: '2026-05-01',
      }).success,
    ).toBe(false);
  });

  it('situação da vigência (fim inclusivo, fim vazio = aberta)', () => {
    const p = { dataInicio: '2026-01-01', dataFim: '2026-03-31', cancelado: false };
    expect(situacaoPreco(p, '2025-12-31')).toBe('futuro');
    expect(situacaoPreco(p, '2026-03-31')).toBe('vigente');
    expect(situacaoPreco(p, '2026-04-01')).toBe('encerrado');
    expect(situacaoPreco({ ...p, dataFim: null }, '2030-01-01')).toBe('vigente');
    expect(situacaoPreco({ ...p, cancelado: true }, '2026-02-01')).toBe('cancelado');
  });
});

describe('estoque', async () => {
  const { mascaraQuantidade, quantidadeParaNumero } = await import('./mascaras.js');
  const { estoqueAjusteSchema } = await import('./estoque.js');
  it('máscara de quantidade inteira e fracionada', () => {
    expect(mascaraQuantidade('1234,5', false)).toBe('12.345');
    expect(mascaraQuantidade('1234,5678', true)).toBe('1.234,567');
    expect(quantidadeParaNumero('1.234,567')).toBe(1234.567);
    expect(quantidadeParaNumero('')).toBeNull();
  });
  it('ajuste exige motivo e não aceita negativo, 4 casas nem reservado maior que o disponível', () => {
    expect(estoqueAjusteSchema.safeParse({ disponivel: 1, reservado: 0, motivo: '' }).success).toBe(false);
    expect(estoqueAjusteSchema.safeParse({ disponivel: -1, reservado: 0, motivo: 'Inventário' }).success).toBe(false);
    expect(estoqueAjusteSchema.safeParse({ disponivel: 1.2345, reservado: 0, motivo: 'Inventário' }).success).toBe(
      false,
    );
    expect(estoqueAjusteSchema.safeParse({ disponivel: 1.5, reservado: 2, motivo: 'Inventário' }).success).toBe(false);
    expect(estoqueAjusteSchema.safeParse({ disponivel: 1.5, reservado: 1.5, motivo: 'Inventário' }).success).toBe(true);
  });
});

describe('serviços', () => {
  it('horas e minutos: máscara, conversão e exibição; código com 6 dígitos', () => {
    expect(mascaraHoras('130')).toBe('1:30');
    expect(mascaraHoras('1030')).toBe('10:30');
    expect(mascaraHoras('2')).toBe('2');
    expect(horasParaMinutos('1:30')).toBe(90);
    expect(horasParaMinutos('2')).toBe(120);
    expect(horasParaMinutos('0:45')).toBe(45);
    expect(horasParaMinutos('1:75')).toBeNaN();
    expect(horasParaMinutos('abc')).toBeNaN();
    expect(formatarHoras(90)).toBe('1:30');
    expect(formatarHoras(5)).toBe('0:05');
    expect(formatarCodigoServico(12)).toBe('000012');
    expect(formatarCodigoServico(1234567)).toBe('1234567');
  });
  it('valor-hora exige horas; preço fechado não; vazios viram null', () => {
    expect(servicoInputSchema.parse({ nome: 'Troca de óleo', tempoMinutos: '', garantiaDias: '' })).toMatchObject({
      formaPreco: 'fechado',
      tempoMinutos: null,
      garantiaDias: null,
      descricao: null,
    });
    expect(servicoInputSchema.safeParse({ nome: 'Hora', formaPreco: 'hora' }).success).toBe(false);
    expect(servicoInputSchema.parse({ nome: 'Hora', formaPreco: 'hora', tempoMinutos: '1:00' }).tempoMinutos).toBe(60);
    expect(servicoInputSchema.parse({ nome: 'Hora', formaPreco: 'hora', tempoMinutos: 60 }).tempoMinutos).toBe(60);
    expect(servicoInputSchema.safeParse({ nome: 'X', garantiaKm: '-1' }).success).toBe(false);
  });
  it('preço: um item só (material ou serviço)', () => {
    const base = {
      tabelaPrecoId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
      precoCentavos: 100,
      dataInicio: '2030-01-01',
    };
    expect(precoInputSchema.safeParse({ ...base, servicoCodigo: '000007' }).data?.servicoCodigo).toBe(7);
    expect(precoInputSchema.safeParse({ ...base }).success).toBe(false);
    expect(precoInputSchema.safeParse({ ...base, sku: 'A', servicoCodigo: 1 }).success).toBe(false);
  });
});
