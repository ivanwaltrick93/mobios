import { describe, expect, it } from 'vitest';
import { gerarCsv } from './csv.js';

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
