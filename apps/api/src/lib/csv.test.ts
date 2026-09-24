import { describe, expect, it } from 'vitest';
import { CSV_LINHAS_MAXIMAS, gerarCsv, lerCsv, lerData, lerNumero } from './csv.js';

describe('gerarCsv', () => {
  const colunas = [
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'obs', titulo: 'Observações' },
  ];

  it('gera CSV para Excel pt-BR com BOM, ";" e CRLF', () => {
    const csv = gerarCsv(colunas, [{ nome: 'João', obs: 'ok' }]);
    expect(csv).toBe('﻿Nome;Observações\r\nJoão;ok\r\n');
  });

  it('escapa separador, aspas e quebras de linha', () => {
    const csv = gerarCsv(colunas, [{ nome: 'Silva; Filhos', obs: 'disse "oi"\nfim' }]);
    expect(csv).toContain('"Silva; Filhos";"disse ""oi""\nfim"');
  });

  it('neutraliza fórmulas (CSV injection)', () => {
    const csv = gerarCsv(colunas, [{ nome: '=HYPERLINK("http://x")', obs: '-2+3' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")";'-2+3`);
  });
});

describe('lerCsv', () => {
  it('lê o CSV do Excel pt-BR: BOM, ";", CRLF, aspas e cabeçalho sem acento/maiúsculas', () => {
    const texto = '﻿SKU;Preço;Obs\r\nfil-1;"150,00";"com ; e ""aspas"""\r\n\r\nfil-2;20;\r\n';
    expect(lerCsv(texto, ['sku', 'preco'])).toEqual([
      { numero: 2, valores: { sku: 'fil-1', preco: '150,00', obs: 'com ; e "aspas"' } },
      { numero: 4, valores: { sku: 'fil-2', preco: '20', obs: '' } },
    ]);
  });

  it('aceita "," como separador quando o cabeçalho não tem ";"', () => {
    expect(lerCsv('sku,preco\nA,1', ['sku'])).toEqual([{ numero: 2, valores: { sku: 'A', preco: '1' } }]);
  });

  it('recusa arquivo vazio, sem colunas obrigatórias ou sem dados', () => {
    expect(() => lerCsv('', ['sku'])).toThrow('vazio');
    expect(() => lerCsv('codigo;valor\nA;1', ['sku', 'preco'])).toThrow('ausentes no cabeçalho (1ª linha): sku, preco');
    expect(() => lerCsv('sku\n\n', ['sku'])).toThrow('não tem linhas de dados');
  });

  it('limita a quantidade de linhas', () => {
    const texto = `sku\n${'A\n'.repeat(CSV_LINHAS_MAXIMAS + 1)}`;
    expect(() => lerCsv(texto, ['sku'])).toThrow(`o máximo por importação é ${CSV_LINHAS_MAXIMAS}`);
  });
});

describe('lerNumero e lerData', () => {
  it('número com vírgula ou ponto decimal, sem milhar', () => {
    expect(lerNumero('150,50')).toBe(150.5);
    expect(lerNumero('20.5')).toBe(20.5);
    expect(lerNumero('7')).toBe(7);
    expect(lerNumero('1.234,56')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
    expect(lerNumero('')).toBeNull();
  });

  it('data dd/mm/aaaa ou aaaa-mm-dd; recusa datas inexistentes', () => {
    expect(lerData('5/3/2027')).toBe('2027-03-05');
    expect(lerData('2027-03-05')).toBe('2027-03-05');
    expect(lerData('31/02/2027')).toBeNull();
    expect(lerData('40/13/2027')).toBeNull();
    expect(lerData('03-05-2027')).toBeNull();
  });
});
