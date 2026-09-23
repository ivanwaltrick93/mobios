import { describe, expect, it } from 'vitest';
import { formatarDocumento } from './formatos.js';
import {
  chassiValido,
  cnpjValido,
  cpfValido,
  normalizarPlaca,
  placaValida,
  renavamValido,
  telefoneValido,
} from './documentos.js';

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

  it('valida o CNPJ alfanumérico (Receita, jul/2026)', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true); // exemplo oficial da Receita
    expect(cnpjValido('12abc34501de35')).toBe(true);
    expect(cnpjValido('12.ABC.345/01DE-36')).toBe(false);
    expect(cnpjValido('12.ABC.345/01DE-3A')).toBe(false); // DV é sempre numérico
    expect(formatarDocumento('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('valida placas antiga e Mercosul', () => {
    expect(placaValida('abc-1234')).toBe(true);
    expect(placaValida('BRA2E19')).toBe(true);
    expect(placaValida('AB12345')).toBe(false);
    expect(normalizarPlaca('bra-2e19')).toBe('BRA2E19');
  });

  it('valida Renavam, chassi e telefone', () => {
    expect(renavamValido('63938648428')).toBe(true);
    expect(renavamValido('00123456780')).toBe(false);
    expect(renavamValido('12345678')).toBe(false);
    expect(chassiValido('9BW ZZZ377 VT004251')).toBe(true);
    expect(chassiValido('9BWZZZ377VT00425O')).toBe(false);
    expect(telefoneValido('(48) 99999-0000')).toBe(true);
    expect(telefoneValido('(01) 99999-0000')).toBe(false);
  });
});

describe('veiculoInputSchema', async () => {
  const { veiculoInputSchema } = await import('./schemas.js');
  const base = {
    clienteId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a',
    placa: 'BRA2E19',
    chassi: '9bwzzz377vt004251',
    marca: 'Fiat',
    modelo: 'Strada',
    anoFabricacao: '2020',
    anoModelo: '2021',
  };

  it('converte anos digitados, trata km e combustível vazios como null', () => {
    const r = veiculoInputSchema.parse({ ...base, kmAtual: '', combustivel: '', renavam: '' });
    expect(r).toMatchObject({
      anoFabricacao: 2020,
      anoModelo: 2021,
      kmAtual: null,
      combustivel: null,
      renavam: null,
      chassi: '9BWZZZ377VT004251',
      status: 'ativo',
    });
  });

  it('chassi opcional, mas válido se informado; ano modelo coerente com o de fabricação', () => {
    expect(veiculoInputSchema.parse({ ...base, chassi: '' }).chassi).toBeNull();
    expect(veiculoInputSchema.safeParse({ ...base, chassi: '9BWZZZ377VT00425I' }).success).toBe(false);
    expect(veiculoInputSchema.safeParse({ ...base, anoModelo: '2023' }).success).toBe(false);
    expect(veiculoInputSchema.safeParse({ ...base, anoFabricacao: '1800' }).success).toBe(false);
    expect(veiculoInputSchema.safeParse({ ...base, anoModelo: '' }).success).toBe(false);
  });

  it('valida o Renavam pelo dígito verificador', () => {
    expect(veiculoInputSchema.parse({ ...base, renavam: '639.386.484-28' }).renavam).toBe('63938648428');
    expect(veiculoInputSchema.safeParse({ ...base, renavam: '63938648420' }).success).toBe(false);
  });
});

describe('clienteInputSchema', async () => {
  const { clienteInputSchema } = await import('./schemas.js');
  const endereco = {
    tipo: 'comercial',
    cep: '88015-100',
    logradouro: 'Rua Felipe Schmidt',
    numero: '100',
    bairro: 'Centro',
    cidade: 'Florianópolis',
    uf: 'sc',
  };
  const base = {
    tipo: 'PJ',
    nome: 'Transportes Exemplo Ltda',
    cpfCnpj: '11.222.333/0001-81',
    telefone: '(48) 3222-1000',
    whatsapp: '(48) 99999-0000',
    clienteDesde: '2024-01-10',
    enderecos: [endereco],
    responsaveis: [{ nome: 'Carlos', telefone: '(48) 99888-7777', cargoId: '4d3c1a2b-9f8e-4d7c-8b6a-5f4e3d2c1b0a' }],
  } as const;

  it('normaliza documento, telefones e endereço; o primeiro endereço vira principal', () => {
    const r = clienteInputSchema.parse({
      ...base,
      enderecos: [
        { ...endereco, faturamento: true },
        { ...endereco, tipo: 'outro' },
      ],
    });
    expect(clienteInputSchema.parse({ ...base, cpfCnpj: '12.abc.345/01de-35' }).cpfCnpj).toBe('12ABC34501DE35');
    expect(r).toMatchObject({
      cpfCnpj: '11222333000181',
      telefone: '4832221000',
      whatsapp: '48999990000',
      origemId: null,
      sexo: null,
    });
    expect(r.enderecos.map((e) => [e.principal, e.faturamento, e.cep, e.uf, e.pais])).toEqual([
      [true, true, '88015100', 'SC', 'Brasil'],
      [false, false, '88015100', 'SC', 'Brasil'],
    ]);
  });

  it('PJ exige responsável (o primeiro vira principal); PF descarta responsáveis', () => {
    expect(clienteInputSchema.safeParse({ ...base, responsaveis: [] }).success).toBe(false);
    expect(clienteInputSchema.parse(base).responsaveis[0]).toMatchObject({
      telefone: '48998887777',
      principal: true,
      telefoneWhatsapp: false,
      email: null,
    });
    expect(clienteInputSchema.parse({ ...base, tipo: 'PF', cpfCnpj: '529.982.247-25' }).responsaveis).toEqual([]);
  });

  it('exige endereço, WhatsApp e documento válido', () => {
    expect(clienteInputSchema.safeParse({ ...base, enderecos: [] }).success).toBe(false);
    expect(clienteInputSchema.safeParse({ ...base, whatsapp: '' }).success).toBe(false);
    expect(clienteInputSchema.safeParse({ ...base, telefone: '3222-1000' }).success).toBe(false);
    expect(clienteInputSchema.safeParse({ ...base, tipo: 'PF' }).success).toBe(false);
    expect(clienteInputSchema.safeParse({ ...base, enderecos: [{ ...endereco, cep: '123' }] }).success).toBe(false);
  });

  it('PF guarda nascimento e sexo; PJ descarta e não aceita finalidade em PF', () => {
    const pf = clienteInputSchema.parse({
      ...base,
      tipo: 'PF',
      cpfCnpj: '529.982.247-25',
      dataNascimento: '1990-05-01',
      sexo: 'feminino',
      enderecos: [{ ...endereco, cobranca: true }],
    });
    expect(pf).toMatchObject({ dataNascimento: '1990-05-01', sexo: 'feminino' });
    expect(pf.enderecos[0]!.cobranca).toBe(false);
    expect(clienteInputSchema.parse({ ...base, dataNascimento: '1990-05-01', sexo: 'feminino' })).toMatchObject({
      dataNascimento: null,
      sexo: null,
    });
  });

  it('aceita endereço no exterior sem regra de CEP/UF brasileiros', () => {
    const r = clienteInputSchema.parse({
      ...base,
      enderecos: [{ ...endereco, cep: 'K1A 0B1', uf: 'Ontario', pais: 'Canadá' }],
    });
    expect(r.enderecos[0]).toMatchObject({ cep: 'K1A 0B1', pais: 'Canadá' });
  });
});

describe('acessos', async () => {
  const { combinarAcessos, temAcesso, SEM_ACESSO, funcaoInputSchema } = await import('./acessos.js');

  it('combina funções pelo maior nível de cada módulo', () => {
    const a = combinarAcessos([
      { clientes: 'consultar', os: 'editar' },
      { clientes: 'editar', relatorios: 'consultar' },
    ]);
    expect(a).toEqual({ ...SEM_ACESSO, clientes: 'editar', os: 'editar', relatorios: 'consultar' });
    expect(combinarAcessos([])).toEqual(SEM_ACESSO);
  });

  it('editar inclui consultar', () => {
    const a = { ...SEM_ACESSO, clientes: 'editar' as const, os: 'consultar' as const };
    expect(temAcesso(a, 'clientes', 'consultar')).toBe(true);
    expect(temAcesso(a, 'os', 'editar')).toBe(false);
    expect(temAcesso(a, 'financeiro')).toBe(false);
  });

  it('recusa nível que o módulo não tem', () => {
    const r = funcaoInputSchema.safeParse({
      nome: 'Teste',
      ativa: true,
      acessos: { ...SEM_ACESSO, relatorios: 'editar' },
    });
    expect(r.success).toBe(false);
  });
});
