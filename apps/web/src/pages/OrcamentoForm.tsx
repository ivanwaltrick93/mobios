import { zodResolver } from '@hookform/resolvers/zod';
import {
  arredondarMinutos,
  arredondarQuantidade,
  calcularItem,
  descontoPorPercentual,
  formatarDataIso,
  formatarHoras,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarPlaca,
  formatarQuantidade,
  hojeIso,
  horasParaMinutos,
  mascaraHoras,
  mascaraMoeda,
  mascaraPercentual,
  mascaraQuantidade,
  moedaParaCentavos,
  orcamentoInputSchema,
  paraMilesimos,
  percentualParaNumero,
  quantidadeParaNumero,
  somarDias,
  somarItens,
  TIPOS_ITEM_PRECO,
  VALIDADE_MAXIMA_DIAS,
  VALIDADE_PADRAO_DIAS,
  type ClienteParaOrcamento,
  type ItemOrcamento,
  type ItemOrcamentoInput,
  type ItemVendavel,
  type Orcamento,
  type VeiculoParaOrcamento,
} from '@mobios/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { ClienteDoOrcamento, Totais } from '../components/Orcamento';
import {
  Alerta,
  AreaTexto,
  Aviso,
  Botao,
  BotaoLink,
  Cabecalho,
  Campo,
  Cartao,
  classesBotao,
  Input,
  Janela,
  Linha,
  LinhaVazia,
  Secao,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
} from '../components/ui';
import { api } from '../lib/api';
import { aplicarErrosDaApi } from '../lib/formulario';
import { useOrcamento, useTabelasOrcamento, useVendedoresOrcamento } from '../lib/orcamentos';
import { usePode } from '../lib/sessao';

const cabecalhoSchema = orcamentoInputSchema.omit({ itens: true, versao: true });
type Entrada = z.input<typeof cabecalhoSchema>;
type Saida = z.output<typeof cabecalhoSchema>;

// ---------- Cabeçalho (cliente, veículo, vendedor, tabela, validade, observações) ----------

/** Busca de cliente do orçamento (nome, CPF/CNPJ ou placa). Inativo ou incompleto aparece com o alerta. */
function BuscaClienteOrcamento({ aoEscolher }: { aoEscolher: (c: ClienteParaOrcamento) => void }) {
  const [busca, setBusca] = useState('');
  const pronto = busca.trim().length >= 2;
  const resultados = useQuery({
    queryKey: ['orcamentos', 'apoio', 'clientes', busca],
    queryFn: () =>
      api<ClienteParaOrcamento[]>(`/orcamentos/apoio/clientes?${new URLSearchParams({ q: busca.trim() })}`),
    enabled: pronto,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-suave" aria-hidden />
        <Input
          autoFocus
          className="pl-9"
          aria-label="Buscar cliente"
          placeholder="Nome, CPF/CNPJ ou placa (ao menos 2 letras)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {pronto && (
        <ul className="mt-2 divide-y divide-borda">
          {resultados.data?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-2 py-3 text-left hover:bg-superficie-alt"
                onClick={() => aoEscolher(c)}
              >
                <ClienteDoOrcamento cliente={c} />
              </button>
            </li>
          ))}
          {resultados.data?.length === 0 && <TextoSuave className="py-3">Nenhum cliente encontrado.</TextoSuave>}
        </ul>
      )}
    </div>
  );
}

function CamposCabecalho({
  form,
  cliente,
  aoTrocarCliente,
  aoMudarTabela,
  vendedorAtualId,
}: {
  form: ReturnType<typeof useForm<Entrada, unknown, Saida>>;
  cliente: ClienteParaOrcamento | null;
  aoTrocarCliente: (c: ClienteParaOrcamento | null) => void;
  aoMudarTabela: (id: string) => void;
  vendedorAtualId?: string;
}) {
  const vendedores = useVendedoresOrcamento();
  const tabelas = useTabelasOrcamento();
  const veiculos = useQuery({
    queryKey: ['orcamentos', 'apoio', 'veiculos', cliente?.id],
    queryFn: () => api<VeiculoParaOrcamento[]>(`/orcamentos/apoio/clientes/${cliente!.id}/veiculos`),
    enabled: !!cliente,
  });
  const erros = form.formState.errors;
  const hoje = hojeIso();

  return (
    <div className="space-y-5">
      <Secao
        titulo="Cliente"
        acao={cliente && <BotaoLink onClick={() => aoTrocarCliente(null)}>Trocar cliente</BotaoLink>}
      >
        {cliente ? (
          <ClienteDoOrcamento cliente={cliente} />
        ) : (
          <>
            <BuscaClienteOrcamento aoEscolher={aoTrocarCliente} />
            {erros.clienteId && <span className="text-xs text-perigo">Escolha o cliente</span>}
          </>
        )}
        {cliente && (
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Veículo" dica="Opcional (ex.: venda de peça no balcão)" erro={erros.veiculoId}>
              <Select {...form.register('veiculoId')}>
                <option value="">Sem veículo</option>
                {veiculos.data?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatarPlaca(v.placa)} — {v.marca} {v.modelo}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
        )}
      </Secao>
      <Secao titulo="Venda">
        <div className="grid gap-4 md:grid-cols-3">
          <Campo rotulo="Vendedor *" erro={erros.vendedorId}>
            <Select {...form.register('vendedorId')}>
              <option value="">Escolha…</option>
              {vendedores.data
                ?.filter((v) => v.ativo || v.id === vendedorAtualId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}
                    {v.ativo ? '' : ' (inativo)'}
                  </option>
                ))}
            </Select>
          </Campo>
          <Campo rotulo="Tabela de preço *" erro={erros.tabelaPrecoId}>
            <Select value={String(form.watch('tabelaPrecoId') ?? '')} onChange={(e) => aoMudarTabela(e.target.value)}>
              {tabelas.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                  {t.padrao ? ' (padrão)' : ''}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            rotulo="Validade"
            dica={`Vazio = ${VALIDADE_PADRAO_DIAS} dias a partir da emissão; no máximo ${VALIDADE_MAXIMA_DIAS} dias`}
            erro={erros.validadeAte}
          >
            <Input
              type="date"
              min={hoje}
              max={somarDias(hoje, VALIDADE_MAXIMA_DIAS)}
              {...form.register('validadeAte')}
            />
          </Campo>
        </div>
        <Campo rotulo="Observações" erro={erros.observacoes}>
          <AreaTexto rows={2} maxLength={2000} {...form.register('observacoes')} />
        </Campo>
      </Secao>
    </div>
  );
}

const valoresDoOrcamento = (o?: Orcamento): Entrada => ({
  clienteId: o?.cliente.id ?? '',
  veiculoId: o?.veiculo?.id ?? '',
  vendedorId: o?.vendedor.id ?? '',
  tabelaPrecoId: o?.tabela.id ?? '',
  validadeAte: o?.validadeAte ?? '',
  observacoes: o?.observacoes ?? '',
});

/** Novo orçamento: primeiro o cabeçalho (cria o rascunho); os itens são incluídos em seguida, na edição. */
export function NovoOrcamento() {
  const pode = usePode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tabelas = useTabelasOrcamento(pode('orcamentos', 'editar'));
  const [cliente, setCliente] = useState<ClienteParaOrcamento | null>(null);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(cabecalhoSchema),
    defaultValues: valoresDoOrcamento(),
    mode: 'onTouched',
  });
  // A tabela padrão da oficina já vem escolhida.
  const padraoId = tabelas.data?.find((t) => t.padrao)?.id;
  useEffect(() => {
    if (padraoId && !form.getValues('tabelaPrecoId')) form.setValue('tabelaPrecoId', padraoId);
  }, [padraoId, form]);
  const criar = useMutation({
    mutationFn: (dados: Saida) => api<Orcamento>('/orcamentos', { method: 'POST', body: { ...dados, itens: [] } }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      navigate(`/orcamentos/${o.id}/editar`);
    },
  });
  const trocarCliente = (c: ClienteParaOrcamento | null) => {
    setCliente(c);
    form.setValue('clienteId', c?.id ?? '', { shouldValidate: !!c });
    form.setValue('veiculoId', '');
  };

  if (!pode('orcamentos', 'editar')) return <Alerta>Você não tem permissão para criar orçamentos.</Alerta>;
  if (tabelas.data?.length === 0)
    return (
      <Alerta>
        A oficina ainda não tem tabela de preço. Cadastre uma em Política Comercial → Tabelas de Preço para fazer
        orçamentos.
      </Alerta>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Titulo>Novo orçamento</Titulo>
      <Cartao>
        <form className="space-y-5" noValidate onSubmit={form.handleSubmit((d) => criar.mutate(d))}>
          <Alerta>{criar.isError && aplicarErrosDaApi(criar.error, form.setError)}</Alerta>
          <CamposCabecalho
            form={form}
            cliente={cliente}
            aoTrocarCliente={trocarCliente}
            aoMudarTabela={(id) => form.setValue('tabelaPrecoId', id)}
          />
          <div className="flex gap-2">
            <Botao type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Criar e incluir itens'}
            </Botao>
            <Botao type="button" variante="secundario" onClick={() => navigate(-1)}>
              Cancelar
            </Botao>
          </div>
        </form>
      </Cartao>
    </div>
  );
}

// ---------- Itens do rascunho ----------

/** Item na tela: quantidade, horas e negociação como texto (como a pessoa digita). */
type LinhaTela = {
  chave: string;
  id?: string;
  tipo: ItemOrcamento['tipo'];
  itemId: string;
  codigo: string;
  descricao: string;
  unidade: string;
  formaPreco: ItemOrcamento['formaPreco'];
  multiplo: number;
  fracionada: boolean;
  precoTabelaCentavos: number;
  quantidade: string;
  horas: string;
  modo: 'percentual' | 'preco';
  percentual: string;
  preco: string;
  nota?: string;
};

const linhaDoItem = (i: ItemOrcamento): LinhaTela => ({
  chave: i.id,
  id: i.id,
  tipo: i.tipo,
  itemId: (i.materialId ?? i.servicoId)!,
  codigo: i.codigo,
  descricao: i.descricao,
  unidade: i.unidade,
  formaPreco: i.formaPreco,
  multiplo: i.multiplo,
  fracionada: i.fracionada,
  precoTabelaCentavos: i.precoTabelaCentavos,
  quantidade: i.quantidade != null ? formatarQuantidade(i.quantidade) : '',
  horas: i.tempoMinutos != null ? formatarHoras(i.tempoMinutos) : '',
  modo: i.descontoPercentual == null && i.precoUnitarioCentavos < i.precoTabelaCentavos ? 'preco' : 'percentual',
  percentual: i.descontoPercentual ? String(i.descontoPercentual).replace('.', ',') : '',
  preco:
    i.descontoPercentual == null && i.precoUnitarioCentavos < i.precoTabelaCentavos
      ? mascaraMoeda(String(i.precoUnitarioCentavos))
      : '',
});

const linhaNova = (v: ItemVendavel): LinhaTela => ({
  chave: crypto.randomUUID(),
  tipo: v.tipo,
  itemId: v.id,
  codigo: v.codigo,
  descricao: v.descricao,
  unidade: v.unidade,
  formaPreco: v.formaPreco,
  multiplo: v.multiplo,
  fracionada: v.fracionada,
  precoTabelaCentavos: v.precoCentavos!,
  // Começa pela menor quantidade vendável: o múltiplo (caixa master) ou as horas do serviço.
  quantidade: v.formaPreco === 'hora' ? '' : formatarQuantidade(v.formaPreco ? 1 : v.multiplo),
  horas: v.formaPreco === 'hora' ? formatarHoras(v.multiplo) : '',
  modo: 'percentual',
  percentual: '',
  preco: '',
});

/** Preço negociado da linha (só material) e erro, se o preço digitado passar do de tabela. */
function precoDaLinha(l: LinhaTela): { unitario: number; percentual: number | null; erro?: string } {
  if (l.tipo === 'servico') return { unitario: l.precoTabelaCentavos, percentual: null };
  if (l.modo === 'percentual') {
    const p = percentualParaNumero(l.percentual);
    if (!p) return { unitario: l.precoTabelaCentavos, percentual: null };
    const centesimos = Math.round(p * 100);
    return {
      unitario: l.precoTabelaCentavos - descontoPorPercentual(l.precoTabelaCentavos, centesimos),
      percentual: p,
    };
  }
  const preco = moedaParaCentavos(l.preco);
  if (preco == null) return { unitario: l.precoTabelaCentavos, percentual: null };
  if (preco > l.precoTabelaCentavos) return { unitario: preco, percentual: null, erro: 'Acima do preço da tabela' };
  return { unitario: preco, percentual: null };
}

const quantidadeDaLinha = (l: LinhaTela) =>
  l.formaPreco === 'hora'
    ? { tempoMinutos: horasParaMinutos(l.horas) || 0 }
    : { quantidadeMilesimos: paraMilesimos(quantidadeParaNumero(l.quantidade) ?? 0) };

const calculoDaLinha = (l: LinhaTela) =>
  calcularItem(l.precoTabelaCentavos, precoDaLinha(l).unitario, quantidadeDaLinha(l));

/** O que a API recebe: o id do item gravado (mantém o preço guardado) e a negociação (só material). */
function itemParaApi(l: LinhaTela): ItemOrcamentoInput {
  const negociacao = precoDaLinha(l);
  return {
    id: l.id,
    tipo: l.tipo,
    ...(l.tipo === 'material' ? { materialId: l.itemId } : { servicoId: l.itemId }),
    ...(l.formaPreco === 'hora' ? { tempoMinutos: l.horas } : { quantidade: quantidadeParaNumero(l.quantidade) ?? 0 }),
    ...(l.tipo === 'material' &&
      (l.modo === 'percentual'
        ? { descontoPercentual: negociacao.percentual }
        : { precoUnitarioCentavos: moedaParaCentavos(l.preco) })),
  };
}

/** Arredonda ao sair do campo e explica por quê (a API faz o mesmo ao salvar). */
function arredondar(l: LinhaTela): LinhaTela {
  if (l.formaPreco === 'hora') {
    const minutos = horasParaMinutos(l.horas);
    if (!minutos) return l;
    const certo = arredondarMinutos(minutos, l.multiplo);
    return certo === minutos
      ? { ...l, nota: undefined }
      : {
          ...l,
          horas: formatarHoras(certo),
          nota: `Arredondado para ${formatarHoras(certo)} (múltiplo de ${formatarHoras(l.multiplo)})`,
        };
  }
  const q = quantidadeParaNumero(l.quantidade);
  if (!q) return l;
  const certo = arredondarQuantidade(q, l.multiplo, l.fracionada);
  if (certo === q) return { ...l, nota: undefined };
  return {
    ...l,
    quantidade: formatarQuantidade(certo),
    nota:
      l.multiplo > 1
        ? `Arredondado para ${formatarQuantidade(certo)} (múltiplo de venda ${l.multiplo})`
        : `Arredondado para ${formatarQuantidade(certo)} (só inteiro)`,
  };
}

/** Busca de material ou serviço com o preço de hoje na tabela. Sem preço: aparece, mas não entra. */
function BuscaItem({ tabelaPrecoId, aoEscolher }: { tabelaPrecoId: string; aoEscolher: (i: ItemVendavel) => void }) {
  const [busca, setBusca] = useState('');
  const pronto = busca.trim().length >= 2;
  const resultados = useQuery({
    queryKey: ['orcamentos', 'apoio', 'itens', tabelaPrecoId, busca],
    queryFn: () =>
      api<ItemVendavel[]>(`/orcamentos/apoio/itens?${new URLSearchParams({ q: busca.trim(), tabelaPrecoId })}`),
    enabled: pronto,
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-suave" aria-hidden />
        <Input
          className="pl-9"
          aria-label="Incluir material ou serviço"
          placeholder="Incluir material ou serviço: SKU, código ou descrição (ao menos 2 letras)"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      {pronto && (
        <ul className="mt-2 max-h-72 divide-y divide-borda overflow-y-auto rounded-md border border-borda">
          {resultados.data?.map((i) => (
            <li key={`${i.tipo}:${i.id}`}>
              <button
                type="button"
                disabled={i.precoCentavos == null}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-superficie-alt disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  aoEscolher(i);
                  setBusca('');
                }}
              >
                <span className="flex items-center gap-2">
                  <Selo tom={i.tipo === 'servico' ? 'primario' : 'neutro'}>{TIPOS_ITEM_PRECO[i.tipo]}</Selo>
                  <span className="font-mono text-xs">{i.codigo}</span>
                  {i.descricao}
                </span>
                <span className={i.precoCentavos == null ? 'text-xs text-perigo' : 'font-medium'}>
                  {i.precoCentavos == null
                    ? 'Sem preço nesta tabela: não pode ser vendido'
                    : `${formatarMoeda(i.precoCentavos)}${i.formaPreco === 'hora' ? '/hora' : ''}`}
                </span>
              </button>
            </li>
          ))}
          {resultados.data?.length === 0 && <TextoSuave className="px-3 py-2">Nada encontrado.</TextoSuave>}
        </ul>
      )}
    </div>
  );
}

function TabelaItens({
  linhas,
  aoMudar,
  aoRemover,
}: {
  linhas: LinhaTela[];
  aoMudar: (chave: string, mudanca: (l: LinhaTela) => LinhaTela) => void;
  aoRemover: (chave: string) => void;
}) {
  return (
    <Tabela>
      <Cabecalho>
        <Th>Item</Th>
        <Th>Quantidade</Th>
        <Th className="text-right">Preço de tabela</Th>
        <Th>Negociação</Th>
        <Th className="text-right">Total</Th>
        <Th />
      </Cabecalho>
      <tbody>
        {linhas.length === 0 && <LinhaVazia colunas={6}>Nenhum item. Use a busca acima para incluir.</LinhaVazia>}
        {linhas.map((l) => {
          const negociacao = precoDaLinha(l);
          const calculo = calculoDaLinha(l);
          const mudar = (mudanca: Partial<LinhaTela>) => aoMudar(l.chave, (x) => ({ ...x, ...mudanca }));
          return (
            <Linha key={l.chave}>
              <Td>
                <div className="font-mono text-xs text-texto-suave">{l.codigo}</div>
                <div className="font-medium">{l.descricao}</div>
              </Td>
              <Td className="min-w-32">
                {l.formaPreco === 'hora' ? (
                  <Input
                    aria-label={`Horas de ${l.descricao}`}
                    inputMode="numeric"
                    placeholder="0:00"
                    value={l.horas}
                    onChange={(e) => mudar({ horas: mascaraHoras(e.target.value), nota: undefined })}
                    onBlur={() => aoMudar(l.chave, arredondar)}
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input
                      aria-label={`Quantidade de ${l.descricao}`}
                      inputMode="decimal"
                      value={l.quantidade}
                      onChange={(e) =>
                        mudar({ quantidade: mascaraQuantidade(e.target.value, l.fracionada), nota: undefined })
                      }
                      onBlur={() => aoMudar(l.chave, arredondar)}
                    />
                    <span className="text-xs text-texto-suave">{l.unidade}</span>
                  </div>
                )}
                {l.nota && <span className="mt-1 block text-xs text-alerta">{l.nota}</span>}
              </Td>
              <Td className="whitespace-nowrap text-right">
                {formatarMoeda(l.precoTabelaCentavos)}
                {l.formaPreco === 'hora' ? '/hora' : ''}
              </Td>
              <Td className="min-w-52">
                {l.tipo === 'servico' ? (
                  <TextoSuave className="text-xs">Serviço não tem negociação</TextoSuave>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <Select
                      aria-label={`Forma de negociação de ${l.descricao}`}
                      className="w-24"
                      value={l.modo}
                      onChange={(e) => mudar({ modo: e.target.value as LinhaTela['modo'], percentual: '', preco: '' })}
                    >
                      <option value="percentual">%</option>
                      <option value="preco">R$</option>
                    </Select>
                    <div>
                      {l.modo === 'percentual' ? (
                        <Input
                          aria-label={`Desconto em % de ${l.descricao}`}
                          inputMode="decimal"
                          placeholder="0"
                          value={l.percentual}
                          onChange={(e) => mudar({ percentual: mascaraPercentual(e.target.value) })}
                        />
                      ) : (
                        <Input
                          aria-label={`Preço negociado de ${l.descricao}`}
                          inputMode="numeric"
                          placeholder={mascaraMoeda(String(l.precoTabelaCentavos))}
                          value={l.preco}
                          onChange={(e) => mudar({ preco: mascaraMoeda(e.target.value) })}
                        />
                      )}
                      {negociacao.erro ? (
                        <span className="mt-1 block text-xs text-perigo">{negociacao.erro}</span>
                      ) : (
                        negociacao.unitario < l.precoTabelaCentavos && (
                          <span className="mt-1 block text-xs text-texto-suave">
                            Sai por {formatarMoeda(negociacao.unitario)}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </Td>
              <Td className="whitespace-nowrap text-right font-semibold">
                {calculo.descontoCentavos > 0 && (
                  <s className="block text-xs font-normal text-texto-suave">{formatarMoeda(calculo.brutoCentavos)}</s>
                )}
                {formatarMoeda(calculo.totalCentavos)}
              </Td>
              <Td className="text-right">
                <button
                  type="button"
                  title="Remover item"
                  aria-label={`Remover ${l.descricao}`}
                  className="rounded-md p-1.5 text-texto-suave hover:bg-superficie-alt hover:text-perigo"
                  onClick={() => aoRemover(l.chave)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </Td>
            </Linha>
          );
        })}
      </tbody>
    </Tabela>
  );
}

// ---------- Edição do rascunho ----------

/** Edição do rascunho: cabeçalho e itens. Trocar a tabela com itens pede confirmação e recalcula na hora. */
function EdicaoRascunho({ orcamento, aoSalvar }: { orcamento: Orcamento; aoSalvar: (o: Orcamento) => void }) {
  const [cliente, setCliente] = useState<ClienteParaOrcamento | null>({ cpfCnpj: null, ...orcamento.cliente });
  const [linhas, setLinhas] = useState<LinhaTela[]>(orcamento.itens.map(linhaDoItem));
  const [tabelaPendente, setTabelaPendente] = useState<string | null>(null);
  const form = useForm<Entrada, unknown, Saida>({
    resolver: zodResolver(cabecalhoSchema),
    defaultValues: valoresDoOrcamento(orcamento),
    mode: 'onTouched',
  });
  const salvar = useMutation({
    mutationFn: (dados: Saida) =>
      api<Orcamento>(`/orcamentos/${orcamento.id}`, {
        method: 'PUT',
        body: { ...dados, itens: linhas.map(itemParaApi), versao: orcamento.versao },
      }),
    onSuccess: aoSalvar,
  });
  const tabelaPrecoId = String(form.watch('tabelaPrecoId') ?? '');
  const totais = somarItens(linhas.map(calculoDaLinha));
  const temErro = linhas.some((l) => precoDaLinha(l).erro);
  const enviar = form.handleSubmit((d) => salvar.mutate(d));

  const trocarCliente = (c: ClienteParaOrcamento | null) => {
    setCliente(c);
    form.setValue('clienteId', c?.id ?? '', { shouldValidate: !!c });
    form.setValue('veiculoId', '');
  };
  const mudarTabela = (id: string) => {
    if (linhas.length) setTabelaPendente(id);
    else form.setValue('tabelaPrecoId', id);
  };
  const confirmarTabela = () => {
    form.setValue('tabelaPrecoId', tabelaPendente!);
    setTabelaPendente(null);
    void enviar();
  };

  return (
    <form className="space-y-6" noValidate onSubmit={enviar}>
      <Cartao>
        <Alerta>{salvar.isError && aplicarErrosDaApi(salvar.error, form.setError)}</Alerta>
        <CamposCabecalho
          form={form}
          cliente={cliente}
          aoTrocarCliente={trocarCliente}
          aoMudarTabela={mudarTabela}
          vendedorAtualId={orcamento.vendedor.id}
        />
      </Cartao>

      <Cartao>
        <Secao titulo="Itens">
          <BuscaItem
            tabelaPrecoId={tabelaPrecoId}
            aoEscolher={(i) => setLinhas((atuais) => [...atuais, linhaNova(i)])}
          />
          <TabelaItens
            linhas={linhas}
            aoMudar={(chave, mudanca) => setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? mudanca(l) : l)))}
            aoRemover={(chave) => setLinhas((atuais) => atuais.filter((l) => l.chave !== chave))}
          />
          <Totais subtotal={totais.subtotalCentavos} desconto={totais.descontoCentavos} total={totais.totalCentavos} />
        </Secao>
      </Cartao>

      <div className="flex flex-wrap gap-2">
        <Botao type="submit" disabled={salvar.isPending || temErro}>
          {salvar.isPending ? 'Salvando…' : 'Salvar rascunho'}
        </Botao>
        <Link to={`/orcamentos/${orcamento.id}`} className={classesBotao('secundario')}>
          Voltar ao orçamento
        </Link>
      </div>

      {tabelaPendente && (
        <Janela titulo="Trocar a tabela de preço" aoFechar={() => setTabelaPendente(null)}>
          <div className="space-y-4">
            <TextoSuave>
              Os preços de todos os itens serão recalculados pela nova tabela, voltando ao preço cheio (a negociação é
              desfeita). Itens sem preço nela serão removidos do orçamento. O rascunho é salvo em seguida.
            </TextoSuave>
            <div className="flex gap-2">
              <Botao type="button" onClick={confirmarTabela}>
                Recalcular e salvar
              </Botao>
              <Botao type="button" variante="secundario" onClick={() => setTabelaPendente(null)}>
                Manter a tabela atual
              </Botao>
            </div>
          </div>
        </Janela>
      )}
    </form>
  );
}

export function EditarOrcamento() {
  const { id } = useParams() as { id: string };
  const pode = usePode();
  const queryClient = useQueryClient();
  const { orcamento, recalculando, erroRecalculo, avisos, setAvisos } = useOrcamento(id);

  if (!pode('orcamentos', 'editar')) return <Alerta>Você não tem permissão para alterar orçamentos.</Alerta>;
  if (orcamento.isError) return <Alerta>{orcamento.error.message}</Alerta>;
  if (erroRecalculo) return <Alerta>{erroRecalculo.message}</Alerta>;
  const o = orcamento.data;
  if (!o || recalculando || (o.status === 'rascunho' && o.precosEm < hojeIso()))
    return <TextoSuave>Carregando…</TextoSuave>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Titulo>
        {formatarNumeroOrcamento(o.numero)} · Versão {o.versaoOrcamento}
      </Titulo>
      {o.status !== 'rascunho' ? (
        <Alerta>
          Só o rascunho pode ser alterado. Para mudar um orçamento emitido, gere uma nova versão no detalhe.
        </Alerta>
      ) : (
        <>
          <Aviso>
            {avisos.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5">
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </Aviso>
          <TextoSuave className="text-xs">Preços de {formatarDataIso(o.precosEm)}.</TextoSuave>
          <EdicaoRascunho
            // Remonta com os dados da API a cada gravação (itens com os ids e preços oficiais).
            key={o.versao}
            orcamento={o}
            aoSalvar={(salvo) => {
              queryClient.setQueryData(['orcamentos', id], salvo);
              queryClient.invalidateQueries({ queryKey: ['orcamentos', 'lista'] });
              setAvisos(salvo.avisos.length ? salvo.avisos : ['Rascunho salvo.']);
            }}
          />
        </>
      )}
    </div>
  );
}
