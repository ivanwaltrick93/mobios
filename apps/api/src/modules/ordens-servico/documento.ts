import {
  ESTADOS_CHECKLIST,
  formatarDocumento,
  formatarHoras,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarNumeroOs,
  formatarPlaca,
  formatarQuantidade,
  formatarTelefone,
  NIVEIS_COMBUSTIVEL,
  SITUACOES_OS,
  type OrdemServico,
} from '@mobios/shared';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

// PDF da O.S. (OS-14; docs/modulos/ORDENS_SERVICO.md §12): layout de uma coluna, com a marca da oficina, blocos de
// cliente e veículo, itens, totais e o termo (autorização ou entrega) com as assinaturas. Função pura: recebe os dados
// prontos e devolve a definição do pdfmake.

export type DadosDocumentoOs = {
  os: OrdemServico;
  oficina: { nome: string; cnpj: string | null; logo?: string; cor: string };
  cliente: { documento: string | null; telefone: string | null; email: string | null; endereco: string | null };
  veiculo: { ano: string | null; cor: string | null; versao: string | null };
  geradoEm: Date;
};

const FUSO = 'America/Sao_Paulo';
const TEXTO = '#111827';
const SUAVE = '#6b7280';
const BORDA = '#e5e7eb';
const FUNDO = '#f9fafb';

const dataHora = (d: Date | null) =>
  d ? d.toLocaleString('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Par rótulo/valor (valor vazio vira "—"). */
const campo = (rotulo: string, valor: string | null | undefined): Content => ({
  stack: [
    { text: rotulo.toUpperCase(), fontSize: 6.5, color: SUAVE, characterSpacing: 0.4 },
    { text: valor || '—', fontSize: 9, margin: [0, 1, 0, 0] },
  ],
});

/** Caixa com título e conteúdo (fundo claro, borda fina). */
function caixa(titulo: string, conteudo: Content, cor: string, espacoAntes = 0): Content {
  return {
    margin: [0, espacoAntes, 0, 0],
    table: {
      widths: ['*'],
      body: [
        [{ text: titulo, bold: true, fontSize: 8.5, color: cor, margin: [2, 2, 2, 0] }],
        [{ stack: [conteudo], margin: [2, 0, 2, 3] }],
      ],
    },
    layout: {
      hLineWidth: (i: number, no: { table: { body: unknown[] } }) => (i === 0 || i === no.table.body.length ? 0.6 : 0),
      vLineWidth: () => 0.6,
      hLineColor: () => BORDA,
      vLineColor: () => BORDA,
      fillColor: () => FUNDO,
      paddingTop: () => 5,
      paddingBottom: () => 3,
    },
  };
}

/** Linhas de campos em colunas iguais. */
const grade = (campos: Content[], porLinha: number): Content => {
  const linhas: Content[] = [];
  for (let i = 0; i < campos.length; i += porLinha) {
    const trecho = campos.slice(i, i + porLinha);
    while (trecho.length < porLinha) trecho.push({ text: '' });
    linhas.push({ columns: trecho, columnGap: 10, margin: [0, i ? 5 : 0, 0, 0] });
  }
  return { stack: linhas };
};

type Item = OrdemServico['itens'][number];

const quantidadeDoItem = (i: Item) =>
  i.tempoMinutos != null ? `${formatarHoras(i.tempoMinutos)} h` : `${formatarQuantidade(i.quantidade!)} ${i.unidade}`;

/** Tabela de itens (serviços ou produtos), com o código embaixo da descrição e o desconto quando houver. */
function tabelaItens(titulo: string, itens: Item[], cor: string): Content[] {
  if (!itens.length) return [];
  const cabecalho: TableCell[] = ['Descrição', 'Qtd.', 'Unitário', 'Desconto', 'Total'].map((t, n) => ({
    text: t,
    bold: true,
    fontSize: 7.5,
    color: '#ffffff',
    fillColor: cor,
    alignment: n ? 'right' : 'left',
  }));
  const linhas: TableCell[][] = itens.map((i) => [
    {
      stack: [
        { text: i.descricao, fontSize: 8.5 },
        {
          text: [
            i.codigo ? `${i.tipo === 'material' ? 'SKU' : 'Código'} ${i.codigo}` : 'Avulso',
            i.aprovacao === 'pendente' ? ' · aguardando aprovação do cliente' : '',
          ].join(''),
          fontSize: 6.5,
          color: SUAVE,
        },
      ],
    },
    { text: quantidadeDoItem(i), fontSize: 8.5, alignment: 'right' },
    {
      text: `${formatarMoeda(i.precoTabelaCentavos)}${i.formaPreco === 'hora' ? '/h' : ''}`,
      fontSize: 8.5,
      alignment: 'right',
    },
    { text: i.descontoCentavos ? `−${formatarMoeda(i.descontoCentavos)}` : '—', fontSize: 8.5, alignment: 'right' },
    { text: formatarMoeda(i.totalCentavos), fontSize: 8.5, bold: true, alignment: 'right' },
  ]);
  return [
    { text: titulo, bold: true, fontSize: 10, margin: [0, 10, 0, 4] },
    {
      table: { headerRows: 1, widths: ['*', 55, 70, 60, 70], body: [cabecalho, ...linhas] },
      layout: {
        hLineWidth: (i: number) => (i <= 1 ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => BORDA,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
    },
  ];
}

/** Totais à direita: serviços, produtos, descontos e o total em destaque. */
function totais(os: OrdemServico, cor: string): Content {
  const linha = (rotulo: string, valor: string, destaque = false): TableCell[] => [
    { text: rotulo, fontSize: destaque ? 10 : 8.5, bold: destaque, color: destaque ? cor : SUAVE },
    { text: valor, fontSize: destaque ? 11 : 8.5, bold: destaque, alignment: 'right', color: destaque ? cor : TEXTO },
  ];
  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 200,
        table: {
          widths: ['*', 'auto'],
          body: [
            linha('Serviços', formatarMoeda(os.subtotalServicosCentavos)),
            linha('Produtos e peças', formatarMoeda(os.subtotalMateriaisCentavos)),
            linha('Descontos', os.descontoCentavos ? `−${formatarMoeda(os.descontoCentavos)}` : formatarMoeda(0)),
            linha('Total', formatarMoeda(os.totalCentavos), true),
          ],
        },
        layout: {
          hLineWidth: (i: number, no: { table: { body: unknown[] } }) => (i === no.table.body.length - 1 ? 1 : 0),
          vLineWidth: () => 0,
          hLineColor: () => cor,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
    margin: [0, 10, 0, 0],
    unbreakable: true,
  };
}

/** Checklist de entrada compacto: o que faltou ou veio avariado, combustível e avarias. */
function checklist(os: OrdemServico, cor: string): Content[] {
  if (!os.checklistEm) return [];
  const itens = os.checklist.map(
    (i) => `${i.item}: ${ESTADOS_CHECKLIST[i.estado].toLowerCase()}${i.observacao ? ` (${i.observacao})` : ''}`,
  );
  return [
    caixa(
      'Checklist de entrada',
      {
        stack: [
          { text: itens.join(' · ') || 'Sem itens.', fontSize: 8.5 },
          {
            columns: [
              campo('Combustível', os.combustivel ? NIVEIS_COMBUSTIVEL[os.combustivel] : null),
              campo('Avarias na entrada', os.avariasEntrada),
            ],
            columnGap: 10,
            margin: [0, 5, 0, 0],
          },
        ],
      },
      cor,
      8,
    ),
  ];
}

/** Termo (autorização do serviço ou entrega do veículo) e as linhas de assinatura. */
function termo(os: OrdemServico, cor: string): Content[] {
  const entregue = os.entregueEm != null;
  const texto = entregue
    ? `Declaro que recebi o veículo acima identificado, com os serviços descritos nesta ordem de serviço, em ${dataHora(os.entregueEm)}, com ${os.kmSaida?.toLocaleString('pt-BR')} km.`
    : 'Autorizo a execução dos serviços e o fornecimento das peças descritos nesta ordem de serviço, nos valores indicados.';
  const assinatura = (rotulo: string, nome: string | null): Content => ({
    stack: [
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.6, lineColor: TEXTO }] },
      { text: rotulo, fontSize: 8, margin: [0, 3, 0, 0] },
      { text: nome ?? ' ', fontSize: 7.5, color: SUAVE },
    ],
  });
  return [
    {
      stack: [
        { text: entregue ? 'Termo de entrega' : 'Autorização do cliente', bold: true, fontSize: 10, color: cor },
        { text: texto, fontSize: 8.5, margin: [0, 3, 0, 0] },
        ...(entregue && (os.recebidoPor || os.observacoesEntrega)
          ? [
              {
                columns: [
                  campo('Retirado por', os.recebidoPor),
                  campo('Observações da entrega', os.observacoesEntrega),
                ],
                columnGap: 10,
                margin: [0, 5, 0, 0] as [number, number, number, number],
              },
            ]
          : []),
        {
          columns: [assinatura('Cliente', os.recebidoPor ?? os.cliente.nome), assinatura('Oficina', os.entreguePor)],
          columnGap: 40,
          margin: [0, 34, 0, 0],
        },
      ],
      unbreakable: true,
      margin: [0, 18, 0, 0],
    },
  ];
}

export function documentoDaOs({ os, oficina, cliente, veiculo, geradoEm }: DadosDocumentoOs): TDocumentDefinitions {
  const cor = oficina.cor;
  const numero = formatarNumeroOs(os.numero);
  const marca: Content = oficina.logo
    ? { image: oficina.logo, fit: [140, 48] }
    : { text: oficina.nome, fontSize: 14, bold: true, color: cor };
  const textoLivre = (titulo: string, valor: string | null): Content[] =>
    valor ? [caixa(titulo, { text: valor, fontSize: 8.5 }, cor, 8)] : [];

  return {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 46],
    info: { title: `${numero} — ${os.cliente.nome}`, author: oficina.nome, creator: 'MobiOS' },
    defaultStyle: { fontSize: 9, color: TEXTO, lineHeight: 1.2 },
    footer: (pagina: number, total: number) => ({
      columns: [
        { text: `${numero} · ${oficina.nome}`, fontSize: 7, color: SUAVE },
        {
          text: `Gerado em ${dataHora(geradoEm)} · Página ${pagina} de ${total}`,
          fontSize: 7,
          color: SUAVE,
          alignment: 'right',
        },
      ],
      margin: [36, 14, 36, 0],
    }),
    content: [
      {
        columns: [
          {
            width: '*',
            stack: [
              marca,
              ...(oficina.logo
                ? [
                    {
                      text: oficina.nome,
                      fontSize: 8.5,
                      bold: true,
                      margin: [0, 4, 0, 0] as [number, number, number, number],
                    },
                  ]
                : []),
              ...(oficina.cnpj
                ? [{ text: `CNPJ ${formatarDocumento(oficina.cnpj)}`, fontSize: 7.5, color: SUAVE }]
                : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              {
                text: 'ORDEM DE SERVIÇO',
                fontSize: 7.5,
                bold: true,
                color: cor,
                characterSpacing: 1,
                alignment: 'right',
              },
              { text: numero, fontSize: 18, bold: true, alignment: 'right' },
              { text: SITUACOES_OS[os.situacao], fontSize: 8.5, color: SUAVE, alignment: 'right' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'rect', x: 0, y: 8, w: 523, h: 2, color: cor }], margin: [0, 0, 0, 10] },
      {
        columns: [
          caixa(
            'Cliente',
            grade(
              [
                campo('Nome', os.cliente.nome),
                campo('CPF/CNPJ', cliente.documento ? formatarDocumento(cliente.documento) : null),
                campo('Telefone', cliente.telefone ? formatarTelefone(cliente.telefone) : null),
                campo('E-mail', cliente.email),
              ],
              2,
            ),
            cor,
          ),
          caixa(
            'Veículo',
            grade(
              [
                campo('Placa', formatarPlaca(os.veiculo.placa)),
                campo(
                  'Marca / modelo',
                  [os.veiculo.marca, os.veiculo.modelo, veiculo.versao].filter(Boolean).join(' '),
                ),
                campo('Ano', veiculo.ano),
                campo('Cor', veiculo.cor),
              ],
              2,
            ),
            cor,
          ),
        ],
        columnGap: 10,
      },
      ...(cliente.endereco
        ? [
            {
              text: cliente.endereco,
              fontSize: 7.5,
              color: SUAVE,
              margin: [2, 3, 0, 0] as [number, number, number, number],
            },
          ]
        : []),
      caixa(
        'Atendimento',
        grade(
          [
            campo('Abertura', dataHora(os.abertaEm)),
            campo('Previsão de entrega', dataHora(os.previsaoEntrega)),
            campo('Km de entrada', os.kmEntrada.toLocaleString('pt-BR')),
            campo('Km de saída', os.kmSaida?.toLocaleString('pt-BR') ?? null),
            campo('Vendedor', os.vendedor?.nome),
            campo('Mecânicos', os.mecanicosVinculados.map((m) => m.nome).join(', ')),
            campo('Orçamento de origem', os.orcamento ? formatarNumeroOrcamento(os.orcamento.numero) : null),
            campo('Concluída', dataHora(os.concluidaEm)),
          ],
          4,
        ),
        cor,
        8,
      ),
      ...textoLivre('Relato do cliente', os.relatoCliente),
      ...checklist(os, cor),
      ...textoLivre('Diagnóstico', os.diagnostico),
      ...tabelaItens(
        'Serviços',
        os.itens.filter((i) => i.tipo === 'servico'),
        cor,
      ),
      ...tabelaItens(
        'Produtos e peças',
        os.itens.filter((i) => i.tipo === 'material'),
        cor,
      ),
      ...(os.itens.length
        ? [totais(os, cor)]
        : [{ text: 'Nenhum item.', color: SUAVE, margin: [0, 12, 0, 0] as [number, number, number, number] }]),
      ...textoLivre('Observações', os.observacoes),
      ...termo(os, cor),
    ],
  };
}
