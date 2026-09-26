import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from './db/client.js';
import {
  cliente,
  cpfAleatorio,
  emailAleatorio,
  ENDERECO,
  entrar,
  novaOficina,
  SENHA,
  veiculo,
} from './testes/apoio.js';

// Clientes e veículos: cadastro, lista, filtros e importação por planilha.

describe('clientes e veículos', () => {
  it('valida documento, contato, endereço e placa', async () => {
    const { chamar } = await novaOficina('Oficina Validação');
    const cpf = await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '123.456.789-00' }));
    expect(cpf.statusCode).toBe(400);
    expect(cpf.json().campos.cpfCnpj).toBe('CPF inválido');
    expect(
      (await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '11.222.333/0001-81' }))).json().campos.cpfCnpj,
    ).toBe('Pessoa física: informe um CPF');
    const semEndereco = await chamar('POST', '/api/clientes', cliente({ enderecos: [] }));
    expect(semEndereco.statusCode).toBe(400);
    expect(semEndereco.json().campos.enderecos).toBe('Cadastre ao menos um endereço');
    expect((await chamar('POST', '/api/clientes', cliente({ whatsapp: '' }))).json().campos.whatsapp).toBeDefined();
    expect(
      (await chamar('POST', '/api/clientes', cliente({ enderecos: [{ ...ENDERECO, cep: '1' }] }))).json().campos[
        'enderecos.0.cep'
      ],
    ).toBe('CEP inválido');

    const criado = await chamar(
      'POST',
      '/api/clientes',
      cliente({ nome: 'João', cpfCnpj: '529.982.247-25', dataNascimento: '1990-05-01', sexo: 'masculino' }),
    );
    expect(criado.statusCode).toBe(201);
    const joao = criado.json();
    expect(joao).toMatchObject({
      cpfCnpj: '52998224725',
      telefone: '4832221000',
      whatsapp: '48999990000',
      dataNascimento: '1990-05-01',
      clienteDesde: '2024-01-10',
      ativo: true,
      pendencias: [],
      enderecos: [{ cep: '88015100', uf: 'SC', pais: 'Brasil', principal: true, faturamento: false }],
    });
    const dup = await chamar('POST', '/api/clientes', cliente({ cpfCnpj: '529.982.247-25' }));
    expect(dup.statusCode).toBe(409);

    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { placa: 'XX-1' }))).statusCode).toBe(400);
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '123' }))).statusCode).toBe(400);
    expect(
      (await chamar('POST', '/api/veiculos', veiculo(joao.id, { anoModelo: 2025 }))).json().campos.anoModelo,
    ).toBeDefined();
    const v = await chamar(
      'POST',
      '/api/veiculos',
      veiculo(joao.id, { placa: 'bra-2e19', chassi: '9bwzzz377vt004251', renavam: '63938648428', combustivel: 'flex' }),
    );
    expect(v.statusCode).toBe(201);
    expect(v.json()).toMatchObject({
      placa: 'BRA2E19',
      chassi: '9BWZZZ377VT004251',
      principal: true,
      status: 'ativo',
      ultimaVisita: null,
      pendencias: [],
    });
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '9BWZZZ377VT004251' }))).json().erro).toBe(
      'Já existe um veículo com este chassi',
    );
    // Chassi é opcional (vários veículos sem chassi não colidem no índice único).
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '' }))).json()).toMatchObject({
      chassi: null,
      principal: false,
      pendencias: [],
    });
    expect((await chamar('POST', '/api/veiculos', veiculo(joao.id, { chassi: '' }))).statusCode).toBe(201);

    const exclusao = await chamar('DELETE', `/api/clientes/${joao.id}`);
    expect(exclusao.statusCode).toBe(409);
    expect(exclusao.json().erro).toContain('tem veículos');
  });

  it('PJ: endereços com finalidades; edição regrava os endereços e mantém um principal', async () => {
    const { chamar } = await novaOficina('Oficina PJ');
    const cargos: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/cargos')).json();
    const cargo = (nome: string) => cargos.find((c) => c.nome === nome)!.id;
    const CARLOS = {
      nome: 'Carlos Gestor',
      telefone: '(48) 99888-7777',
      telefoneWhatsapp: true,
      cargoId: cargo('Gestor de frota'),
    };
    const pjDados = (d: object) => cliente({ tipo: 'PJ', responsaveis: [CARLOS], ...d });

    // Responsável é obrigatório na PJ; o primeiro vira principal.
    const semResponsavel = await chamar(
      'POST',
      '/api/clientes',
      cliente({ tipo: 'PJ', cpfCnpj: '11.444.777/0001-61' }),
    );
    expect(semResponsavel.json().campos.responsaveis).toBe('Cadastre ao menos um responsável pela empresa');
    expect(
      (
        await chamar(
          'POST',
          '/api/clientes',
          pjDados({ cpfCnpj: '11.444.777/0001-61', responsaveis: [{ ...CARLOS, cargoId: '' }] }),
        )
      ).json().campos['responsaveis.0.cargoId'],
    ).toBeDefined();

    const pj = (
      await chamar(
        'POST',
        '/api/clientes',
        pjDados({
          nome: 'Transportes Exemplo Ltda',
          cpfCnpj: '11.222.333/0001-81',
          rgIe: 'ISENTO',
          enderecos: [
            { ...ENDERECO, tipo: 'comercial', faturamento: true, cobranca: true },
            { ...ENDERECO, tipo: 'outro', logradouro: 'Rodovia SC-401', principal: true, entrega: true },
          ],
        }),
      )
    ).json();
    expect(pj.responsaveis).toEqual([
      {
        id: expect.any(String),
        nome: 'Carlos Gestor',
        telefone: '48998887777',
        telefoneWhatsapp: true,
        email: null,
        cargoId: cargo('Gestor de frota'),
        cargoNome: 'Gestor de frota',
        principal: true,
      },
    ]);
    expect(pj.pendencias).toEqual([]);
    expect(
      pj.enderecos.map(
        (e: { logradouro: string; principal: boolean; faturamento: boolean; entrega: boolean; cobranca: boolean }) => [
          e.logradouro,
          e.principal,
          e.faturamento,
          e.entrega,
          e.cobranca,
        ],
      ),
    ).toEqual([
      ['Rodovia SC-401', true, false, true, false],
      ['Rua Felipe Schmidt', false, true, false, true],
    ]);
    const dois = await chamar(
      'PUT',
      `/api/clientes/${pj.id}`,
      pjDados({
        cpfCnpj: '11222333000181',
        enderecos: [ENDERECO, { ...ENDERECO, principal: true }, { ...ENDERECO, principal: true }],
      }),
    );
    expect(dois.json().campos.enderecos).toBe('Marque apenas um endereço como principal');

    // CNPJ alfanumérico: gravado sem pontuação, em maiúsculas; a busca acha com ou sem máscara.
    const alfa = await chamar(
      'POST',
      '/api/clientes',
      pjDados({ nome: 'Nova Empresa', cpfCnpj: '12.abc.345/01de-35' }),
    );
    expect(alfa.json().cpfCnpj).toBe('12ABC34501DE35');
    expect(
      (await chamar('GET', '/api/clientes?q=12.ABC.345')).json().itens.map((c: { nome: string }) => c.nome),
    ).toEqual(['Nova Empresa']);
    expect((await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '12ABC34501DE35' }))).json().erro).toBe(
      'Já existe um cliente com este CPF/CNPJ',
    );
    expect((await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '12ABC34501DE36' }))).json().campos.cpfCnpj).toBe(
      'CNPJ inválido',
    );

    const editado = (
      await chamar(
        'PUT',
        `/api/clientes/${pj.id}`,
        pjDados({ nome: 'Transportes Exemplo', cpfCnpj: '11222333000181', ativo: false }),
      )
    ).json();
    expect(editado).toMatchObject({
      nome: 'Transportes Exemplo',
      ativo: false,
      enderecos: [{ logradouro: 'Rua Felipe Schmidt', principal: true }],
    });
    expect(editado.enderecos).toHaveLength(1);

    // Vários responsáveis, um principal; função desativada continua valendo para quem já a usava.
    const motorista = {
      nome: 'Dani Motorista',
      telefone: '(48) 3222-0000',
      email: 'Dani@Empresa.com',
      cargoId: cargo('Motorista'),
      principal: true,
    };
    const dupla = (
      await chamar(
        'PUT',
        `/api/clientes/${pj.id}`,
        pjDados({ cpfCnpj: '11222333000181', responsaveis: [CARLOS, motorista] }),
      )
    ).json();
    expect(
      dupla.responsaveis.map((r: { nome: string; principal: boolean; email: string | null }) => [
        r.nome,
        r.principal,
        r.email,
      ]),
    ).toEqual([
      ['Dani Motorista', true, 'dani@empresa.com'],
      ['Carlos Gestor', false, null],
    ]);
    const admin = { chamar };
    await admin.chamar('PUT', `/api/opcoes/cargos/${cargo('Motorista')}`, { nome: 'Motorista', ativa: false });
    expect(
      (
        await chamar(
          'PUT',
          `/api/clientes/${pj.id}`,
          pjDados({ cpfCnpj: '11222333000181', responsaveis: [CARLOS, motorista] }),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await chamar('POST', '/api/clientes', pjDados({ cpfCnpj: '11.444.777/0001-61', responsaveis: [motorista] })))
        .statusCode,
    ).toBe(400);
    expect(
      (await chamar('GET', '/api/opcoes/cargos')).json().find((c: { nome: string }) => c.nome === 'Motorista'),
    ).toMatchObject({ ativa: false, usos: 1 });

    // PF não guarda responsáveis.
    expect((await chamar('POST', '/api/clientes', cliente({ responsaveis: [CARLOS] }))).json().responsaveis).toEqual(
      [],
    );
  });

  it('listas de origem e relacionamento: editáveis pelo admin, só itens ativos na escolha', async () => {
    const admin = await novaOficina('Oficina Listas');
    const origens = (await admin.chamar('GET', '/api/opcoes/origens')).json();
    expect(origens.map((o: { nome: string }) => o.nome)).toEqual([
      'Campanha',
      'Concessionária',
      'Indicação',
      'Loja',
      'Site',
    ]);
    expect(
      (await admin.chamar('GET', '/api/opcoes/relacionamentos')).json().map((o: { nome: string }) => o.nome),
    ).toEqual(['Consumidor final', 'Empresa', 'Frota', 'Seguradora']);

    const whats = (await admin.chamar('POST', '/api/opcoes/origens', { nome: 'WhatsApp', ativa: true })).json();
    expect((await admin.chamar('POST', '/api/opcoes/origens', { nome: 'whatsapp', ativa: true })).json().erro).toBe(
      'Já existe um item com este nome',
    );
    const c = (await admin.chamar('POST', '/api/clientes', cliente({ origemId: whats.id }))).json();
    expect(c).toMatchObject({ origemId: whats.id, origemNome: 'WhatsApp' });

    // Desativado: some da escolha para clientes novos, mas quem já tinha mantém.
    const desativada = (
      await admin.chamar('PUT', `/api/opcoes/origens/${whats.id}`, { nome: 'WhatsApp', ativa: false })
    ).json();
    expect(desativada).toMatchObject({ ativa: false, usos: 1 });
    expect((await admin.chamar('POST', '/api/clientes', cliente({ origemId: whats.id }))).statusCode).toBe(400);
    expect(
      (await admin.chamar('PUT', `/api/clientes/${c.id}`, cliente({ cpfCnpj: c.cpfCnpj, origemId: whats.id })))
        .statusCode,
    ).toBe(200);

    // Outra oficina não usa os itens desta; só o admin altera as listas.
    const outra = await novaOficina('Outra Oficina Listas');
    expect((await outra.chamar('POST', '/api/clientes', cliente({ relacionamentoId: origens[0].id }))).statusCode).toBe(
      400,
    );
    const email = emailAleatorio();
    await admin.chamar('POST', '/api/usuarios', {
      nome: 'Atendente',
      email,
      funcoes: [await admin.funcao('Atendente')],
      senha: SENHA,
    });
    const atendente = await entrar(email);
    expect((await atendente.chamar('GET', '/api/opcoes/origens')).statusCode).toBe(200);
    expect((await atendente.chamar('POST', '/api/opcoes/origens', { nome: 'Rádio', ativa: true })).statusCode).toBe(
      403,
    );
  });

  it('veículo principal, sugestões de marca/modelo e transferência para outro cliente', async () => {
    const { chamar } = await novaOficina('Oficina Frota');
    const ana = (await chamar('POST', '/api/clientes', cliente({ nome: 'Ana' }))).json();
    const bia = (await chamar('POST', '/api/clientes', cliente({ nome: 'Bia' }))).json();
    // Placas fixas: a busca de clientes também procura os dígitos do texto no telefone e no WhatsApp, e uma placa
    // aleatória com dígitos contidos em (48) 3222-1000 ou (48) 99999-0000 (ex.: ABC1D00) traria também a Bia.
    const gol = (
      await chamar('POST', '/api/veiculos', veiculo(ana.id, { placa: 'GOL1A23', marca: 'Volkswagen', modelo: 'Gol' }))
    ).json();
    const polo = (
      await chamar(
        'POST',
        '/api/veiculos',
        veiculo(ana.id, { placa: 'POL4B56', marca: 'Volkswagen', modelo: 'Polo', principal: true }),
      )
    ).json();
    const principais = async (id: string) =>
      (await chamar('GET', `/api/veiculos?clienteId=${id}`))
        .json()
        .map((v: { modelo: string; principal: boolean }) => `${v.modelo}${v.principal ? '*' : ''}`);
    expect(await principais(ana.id)).toEqual(['Polo*', 'Gol']);

    // Desmarcar o principal passa a vez a outro veículo do cliente.
    await chamar('PUT', `/api/veiculos/${polo.id}`, {
      ...veiculo(ana.id, { placa: polo.placa, chassi: polo.chassi, marca: 'Volkswagen', modelo: 'Polo' }),
      principal: false,
    });
    expect(await principais(ana.id)).toEqual(['Gol*', 'Polo']);

    expect((await chamar('GET', '/api/veiculos/sugestoes?marca=volkswagen')).json()).toEqual({
      marcas: ['Volkswagen'],
      modelos: ['Gol', 'Polo'],
    });

    // Lista com os veículos de cada cliente; a busca encontra o dono pela placa (com ou sem hífen).
    const busca = (
      await chamar(
        'GET',
        `/api/clientes?q=${encodeURIComponent(`${gol.placa.slice(0, 3)}-${gol.placa.slice(3)}`.toLowerCase())}`,
      )
    ).json();
    expect(busca.itens.map((c: { nome: string }) => c.nome)).toEqual(['Ana']);
    expect(busca.itens[0]).toMatchObject({ totalVeiculos: 2, veiculos: [{ modelo: 'Gol' }, { modelo: 'Polo' }] });

    // Venda para a Bia: mesmo registro, novo dono, volta a ativo.
    await chamar('PUT', `/api/veiculos/${gol.id}`, {
      ...veiculo(ana.id, { placa: gol.placa, chassi: gol.chassi, marca: 'Volkswagen', modelo: 'Gol' }),
      principal: true,
      status: 'vendido',
    });
    const transferido = await chamar('POST', `/api/veiculos/${gol.id}/transferir`, { clienteId: bia.id });
    expect(transferido.json()).toMatchObject({ id: gol.id, clienteId: bia.id, status: 'ativo', principal: true });
    expect(await principais(ana.id)).toEqual(['Polo*']);
    expect((await chamar('POST', `/api/veiculos/${gol.id}/transferir`, { clienteId: bia.id })).statusCode).toBe(400);
  });

  it('cadastros antigos aparecem como incompletos', async () => {
    const admin = await novaOficina('Oficina Legado');
    const { oficina } = (await admin.chamar('GET', '/api/auth/sessao')).json();
    const [antigo] = await withTenant(oficina.id, (tx) =>
      tx.execute(sql`insert into clientes (nome) values ('Cliente Antigo') returning id`),
    );
    const [empresa] = await withTenant(oficina.id, (tx) =>
      tx.execute(sql`insert into clientes (nome, tipo) values ('Empresa Antiga', 'PJ') returning id`),
    );
    expect((await admin.chamar('GET', `/api/clientes/${empresa!.id}`)).json().pendencias).toEqual([
      'CPF/CNPJ',
      'telefone',
      'WhatsApp',
      'endereço',
      'responsável',
    ]);
    await withTenant(oficina.id, (tx) =>
      tx.execute(
        sql`insert into veiculos (cliente_id, placa, marca, modelo, principal) values (${antigo!.id}, 'OLD1A23', 'Fiat', 'Uno', true)`,
      ),
    );
    expect((await admin.chamar('GET', `/api/clientes/${antigo!.id}`)).json().pendencias).toEqual([
      'CPF/CNPJ',
      'telefone',
      'WhatsApp',
      'endereço',
    ]);
    expect((await admin.chamar('GET', `/api/veiculos?clienteId=${antigo!.id}`)).json()[0].pendencias).toEqual([
      'ano de fabricação',
      'ano modelo',
    ]);
    const alertas = (await admin.chamar('GET', '/api/painel'))
      .json()
      .alertas.map((a: { mensagem: string }) => a.mensagem);
    expect(alertas).toEqual([
      '2 cliente(s) com cadastro incompleto: complete antes de abrir O.S.',
      '1 veículo(s) com cadastro incompleto (ano de fabricação ou modelo): complete antes de abrir O.S.',
      '1 cliente(s) sem veículo cadastrado.',
    ]);
  });
});

describe('lista de clientes: filtros, aniversários e frota', () => {
  /** Data de nascimento de alguém que faz aniversário daqui a `dias` dias (30 anos atrás). */
  const nascimento = (dias: number) => {
    const hoje = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T00:00:00Z`);
    hoje.setUTCDate(hoje.getUTCDate() + dias);
    hoje.setUTCFullYear(hoje.getUTCFullYear() - 30);
    return hoje.toISOString().slice(0, 10);
  };

  it('filtra por status, tipo, período de "cliente desde", origem, relacionamento e aniversário', async () => {
    const { chamar } = await novaOficina('Oficina Filtros');
    const origens: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/origens')).json();
    const relacoes: { id: string; nome: string }[] = (await chamar('GET', '/api/opcoes/relacionamentos')).json();
    const [origem] = origens;
    const [relacao] = relacoes;
    const criar = async (dados: object) => (await chamar('POST', '/api/clientes', cliente(dados))).json();
    const ana = await criar({ nome: 'Ana Hoje', dataNascimento: nascimento(0), clienteDesde: '2020-05-01' });
    await criar({
      nome: 'Beto Semana',
      dataNascimento: nascimento(3),
      clienteDesde: '2023-01-15',
      origemId: origem!.id,
    });
    await criar({
      nome: 'Caio Longe',
      dataNascimento: nascimento(40),
      relacionamentoId: relacao!.id,
      clienteDesde: '2019-03-01',
      ativo: false,
    });

    const nomes = async (filtro: Record<string, string>) =>
      (await chamar('GET', `/api/clientes?${new URLSearchParams(filtro)}`))
        .json()
        .itens.map((c: { nome: string }) => c.nome);

    expect(await nomes({})).toEqual(['Ana Hoje', 'Beto Semana', 'Caio Longe']);
    expect(await nomes({ ativo: 'true' })).toEqual(['Ana Hoje', 'Beto Semana']);
    expect(await nomes({ ativo: 'false' })).toEqual(['Caio Longe']);
    expect(await nomes({ tipo: 'PJ' })).toEqual([]);
    expect(await nomes({ desde: '2021-01-01', ate: '2023-12-31' })).toEqual(['Beto Semana']);
    expect(await nomes({ desde: '2023-01-15' })).toEqual(['Beto Semana']);
    expect(await nomes({ origemId: origem!.id })).toEqual(['Beto Semana']);
    expect(await nomes({ relacionamentoId: relacao!.id })).toEqual(['Caio Longe']);
    expect(await nomes({ aniversario: 'hoje' })).toEqual(['Ana Hoje']);
    expect(await nomes({ aniversario: 'semana' })).toEqual(['Ana Hoje', 'Beto Semana']);
    expect((await chamar('GET', '/api/clientes?desde=2024-01-01&ate=2023-01-01')).statusCode).toBe(400);

    // Ordenação pela coluna: cliente desde (mais recente primeiro) e nome decrescente; coluna fora da lista, 400.
    expect(await nomes({ ativo: '', ordenar: 'clienteDesde', direcao: 'desc' })).toEqual([
      'Beto Semana',
      'Ana Hoje',
      'Caio Longe',
    ]);
    expect(await nomes({ ativo: '', ordenar: 'nome', direcao: 'desc' })).toEqual([
      'Caio Longe',
      'Beto Semana',
      'Ana Hoje',
    ]);
    expect((await chamar('GET', '/api/clientes?ordenar=cpfCnpj')).statusCode).toBe(400);

    const [primeiro] = (await chamar('GET', '/api/clientes?aniversario=semana')).json().itens;
    expect(primeiro).toMatchObject({ nome: 'Ana Hoje', diasAteAniversario: 0, cidade: 'Florianópolis/SC' });
    expect((await chamar('GET', `/api/clientes/${ana.id}`)).json().diasAteAniversario).toBe(0);

    // Página inicial: aniversariantes ativos de hoje e da semana, o de hoje primeiro.
    const painel = (await chamar('GET', '/api/painel')).json();
    expect(painel.aniversariantes.map((a: { nome: string; dias: number }) => [a.nome, a.dias])).toEqual([
      ['Ana Hoje', 0],
      ['Beto Semana', 3],
    ]);
  });

  it('lista geral de veículos com busca pela placa, marca ou dono, paginada', async () => {
    const { chamar } = await novaOficina('Oficina Frota');
    const dono = (await chamar('POST', '/api/clientes', cliente({ nome: 'Dona Frota' }))).json();
    await chamar('POST', '/api/veiculos', veiculo(dono.id, { placa: 'FRT1A23', marca: 'Toyota', modelo: 'Corolla' }));
    await chamar('POST', '/api/veiculos', veiculo(dono.id, { placa: 'FRT2B34', marca: 'Fiat', modelo: 'Uno' }));

    const lista = (await chamar('GET', '/api/veiculos/lista?porPagina=1')).json();
    expect(lista.total).toBe(2);
    expect(lista.itens).toEqual([expect.objectContaining({ placa: 'FRT1A23', clienteNome: 'Dona Frota' })]);
    expect((await chamar('GET', '/api/veiculos/lista?q=frt-2b')).json().itens[0].placa).toBe('FRT2B34');
    expect((await chamar('GET', '/api/veiculos/lista?q=toyota')).json().total).toBe(1);
    expect((await chamar('GET', '/api/veiculos/lista?q=dona')).json().total).toBe(2);
    expect((await chamar('GET', '/api/veiculos/lista?status=vendido')).json().total).toBe(0);
  });
});

describe('importação de clientes por planilha', () => {
  const planilha = (...linhas: string[]) => `\uFEFF${linhas.join('\r\n')}\r\n`;
  const CABECALHO =
    'tipo;nome;cpf_cnpj;telefone;whatsapp;origem;cep;logradouro;numero;bairro;cidade;uf;' +
    'responsavel_nome;responsavel_funcao;responsavel_telefone';
  const endereco = '88015-100;Rua Felipe Schmidt;100;Centro;Florianópolis;SC';

  it('cria PF e PJ pelas regras do cadastro e relata cada linha inválida com a coluna', async () => {
    const { chamar } = await novaOficina('Oficina Importa Clientes');
    const importar = (texto: string) => chamar('POST', '/api/clientes/importar', texto, { 'content-type': 'text/csv' });
    const origem: string = (await chamar('GET', '/api/opcoes/origens')).json()[0].nome;
    const funcao: string = (await chamar('GET', '/api/opcoes/cargos')).json()[0].nome;
    const cpf = cpfAleatorio();

    const resultado = (
      await importar(
        planilha(
          CABECALHO,
          `PF;Ana Importada;${cpf};(48) 3222-1000;(48) 99999-0000;${origem.toUpperCase()};${endereco};;;`,
          `pj;Auto Peças Ltda;11.222.333/0001-81;4832221000;48999990000;;${endereco};Carlos;${funcao};48999991111`,
          `PF;CPF Errado;111.111.111-11;4832221000;48999990000;;${endereco};;;`,
          `PJ;Sem Responsável;11.444.777/0001-61;4832221000;48999990000;;${endereco};;;`,
          `PF;Ana Repetida;${cpf};4832221000;48999990000;;${endereco};;;`,
          `PF;Origem Errada;${cpfAleatorio()};4832221000;48999990000;Rádio;${endereco};;;`,
          `PF;Sem CEP;${cpfAleatorio()};4832221000;48999990000;;;Rua A;1;Centro;Florianópolis;SC;;;`,
        ),
      )
    ).json();
    expect(resultado).toMatchObject({ linhas: 7, importadas: 2, ignoradas: 0 });
    expect(resultado.erros).toEqual([
      { linha: 4, mensagem: 'cpf_cnpj: CPF inválido' },
      { linha: 5, mensagem: 'responsavel_nome: Cadastre ao menos um responsável pela empresa' },
      { linha: 6, mensagem: `CPF/CNPJ ${cpf} repetido na planilha (já aparece na linha 2).` },
      { linha: 7, mensagem: 'origem: "Rádio" não está na lista (Configurações → Origem do cliente).' },
      { linha: 8, mensagem: 'cep: Informe o CEP' },
    ]);

    const [ana] = (await chamar('GET', `/api/clientes?q=${cpf}`)).json().itens;
    const detalhe = (await chamar('GET', `/api/clientes/${ana.id}`)).json();
    expect(detalhe).toMatchObject({
      nome: 'Ana Importada',
      origemNome: origem,
      enderecos: [{ cep: '88015100', principal: true, tipo: 'residencial' }],
    });
    const [pj] = (await chamar('GET', '/api/clientes?q=Auto Peças')).json().itens;
    expect((await chamar('GET', `/api/clientes/${pj.id}`)).json().responsaveis).toMatchObject([
      { nome: 'Carlos', cargoNome: funcao, principal: true },
    ]);
  });

  it('CPF/CNPJ já cadastrado atualiza o cliente sem perder os outros endereços nem as colunas ausentes', async () => {
    const { chamar } = await novaOficina('Oficina Atualiza Clientes');
    const cpf = cpfAleatorio();
    const segundo = { ...ENDERECO, logradouro: 'Rua Secundária', principal: false };
    await chamar(
      'POST',
      '/api/clientes',
      cliente({
        nome: 'Nome Antigo',
        cpfCnpj: cpf,
        email: 'antigo@teste.dev',
        enderecos: [{ ...ENDERECO, principal: true }, segundo],
      }),
    );

    const resultado = await chamar(
      'POST',
      '/api/clientes/importar',
      planilha(
        'tipo;nome;cpf_cnpj;telefone;whatsapp;cep;logradouro;numero;bairro;cidade;uf',
        `PF;Nome Novo;${cpf};4832221000;48999990000;01310-100;Avenida Paulista;1000;Bela Vista;São Paulo;SP`,
      ),
      { 'content-type': 'text/csv' },
    );
    expect(resultado.json()).toMatchObject({ importadas: 1, erros: [] });
    const [c] = (await chamar('GET', `/api/clientes?q=${cpf}`)).json().itens;
    const detalhe = (await chamar('GET', `/api/clientes/${c.id}`)).json();
    expect(detalhe.nome).toBe('Nome Novo');
    expect(detalhe.email).toBe('antigo@teste.dev'); // coluna ausente: mantém
    expect(
      detalhe.enderecos.map((e: { logradouro: string; principal: boolean }) => [e.logradouro, e.principal]),
    ).toEqual([
      ['Avenida Paulista', true],
      ['Rua Secundária', false],
    ]);
  });
});
