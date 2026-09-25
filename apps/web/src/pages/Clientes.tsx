import {
  COLUNAS_IMPORTACAO_CLIENTES,
  formatarDataIso,
  formatarDocumento,
  formatarTelefone,
  type ClienteFiltro,
  type ClienteResumo,
  type OrdenacaoCliente,
} from '@mobios/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileUp, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { SeloAniversario, SeloPendencias } from '../components/Cliente';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Alerta,
  BarraFiltros,
  Botao,
  Cabecalho,
  CabecalhoPagina,
  Campo,
  Carregando,
  classesBotao,
  FiltroSelect,
  Input,
  Linha,
  MenuAcoes,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  Th,
  ThOrdenavel,
  Vazio,
  type Ordem,
} from '../components/ui';
import { api } from '../lib/api';
import { useOpcoes } from '../lib/cadastro';
import { usePode } from '../lib/sessao';

type Filtro = Required<Omit<ClienteFiltro, 'pagina' | 'porPagina' | 'ordenar' | 'direcao'>>;

const FILTRO_INICIAL: Filtro = {
  q: '',
  ativo: 'true',
  tipo: '',
  desde: '',
  ate: '',
  origemId: '',
  relacionamentoId: '',
  aniversario: '',
};

/** Filtros que ficam em "Mais filtros" (os demais aparecem na barra). */
const EM_MAIS: (keyof Filtro)[] = ['origemId', 'relacionamentoId', 'desde', 'ate', 'aniversario'];

/** Clientes em tabela, com busca, filtros (status, tipo e, em "Mais filtros", origem, relacionamento, período e
 * aniversário), ordenação por nome ou "cliente desde" e ações por linha. */
export function Clientes() {
  const podeEditar = usePode()('clientes', 'editar');
  const origens = useOpcoes('origens');
  const relacionamentos = useOpcoes('relacionamentos');
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_INICIAL);
  const [ordem, setOrdem] = useState<Ordem<OrdenacaoCliente>>({ campo: 'nome', direcao: 'asc' });
  const [pagina, setPagina] = useState(1);
  const [importando, setImportando] = useState(false);
  const queryClient = useQueryClient();
  const parametros = new URLSearchParams(
    Object.entries({
      ...filtro,
      ordenar: ordem.campo,
      direcao: ordem.direcao,
      pagina: String(pagina),
      porPagina: String(POR_PAGINA),
    }).filter(([, v]) => v),
  );
  const clientes = useQuery({
    queryKey: ['clientes', parametros.toString()],
    queryFn: () => api<{ itens: ClienteResumo[]; total: number }>(`/clientes?${parametros}`),
    placeholderData: keepPreviousData,
  });
  const dados = clientes.data;
  const mudar = (campo: keyof Filtro, valor: string) => {
    setFiltro((f) => ({ ...f, [campo]: valor }));
    setPagina(1);
  };
  const ordenar = (nova: Ordem<OrdenacaoCliente>) => {
    setOrdem(nova);
    setPagina(1);
  };
  const filtrado = JSON.stringify(filtro) !== JSON.stringify(FILTRO_INICIAL);
  const ativosEmMais = EM_MAIS.filter((campo) => filtro[campo] !== FILTRO_INICIAL[campo]).length;

  return (
    <div className="space-y-3">
      <CabecalhoPagina
        titulo="Clientes"
        acoes={
          podeEditar && (
            <>
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Link to="/clientes/novo" className={classesBotao('primario')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Novo cliente
              </Link>
            </>
          )
        }
      />

      {importando && (
        <ImportarCsv
          titulo="Importar clientes"
          colunas={COLUNAS_IMPORTACAO_CLIENTES}
          url="/clientes/importar"
          nomeModelo="modelo-clientes.csv"
          aoConcluir={() => queryClient.invalidateQueries({ queryKey: ['clientes'] })}
          aoFechar={() => setImportando(false)}
        />
      )}

      <BarraFiltros
        busca={{
          rotulo: 'Buscar clientes',
          placeholder: 'Nome, placa, CPF/CNPJ ou telefone',
          valor: filtro.q,
          aoMudar: (valor) => mudar('q', valor),
        }}
        ativosEmMais={ativosEmMais}
        aoLimpar={
          filtrado
            ? () => {
                setFiltro(FILTRO_INICIAL);
                setPagina(1);
              }
            : undefined
        }
        total={dados?.total}
        mais={
          <>
            <Campo rotulo="Origem">
              <Select value={filtro.origemId} onChange={(e) => mudar('origemId', e.target.value)}>
                <option value="">Todas</option>
                {origens.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Tipo de relacionamento">
              <Select value={filtro.relacionamentoId} onChange={(e) => mudar('relacionamentoId', e.target.value)}>
                <option value="">Todos</option>
                {relacionamentos.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Cliente desde (de)">
              <Input type="date" value={filtro.desde} onChange={(e) => mudar('desde', e.target.value)} />
            </Campo>
            <Campo rotulo="Cliente desde (até)">
              <Input type="date" min={filtro.desde} value={filtro.ate} onChange={(e) => mudar('ate', e.target.value)} />
            </Campo>
            <Campo rotulo="Aniversário">
              <Select value={filtro.aniversario} onChange={(e) => mudar('aniversario', e.target.value)}>
                <option value="">Qualquer data</option>
                <option value="hoje">Aniversariantes de hoje</option>
                <option value="semana">Hoje e próximos 7 dias</option>
              </Select>
            </Campo>
          </>
        }
      >
        <FiltroSelect rotulo="Status" value={filtro.ativo} onChange={(e) => mudar('ativo', e.target.value)}>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
          <option value="">Todos</option>
        </FiltroSelect>
        <FiltroSelect rotulo="Tipo" value={filtro.tipo} onChange={(e) => mudar('tipo', e.target.value)}>
          <option value="">PF e PJ</option>
          <option value="PF">Pessoa física</option>
          <option value="PJ">Pessoa jurídica</option>
        </FiltroSelect>
      </BarraFiltros>

      {clientes.isError && <Alerta>{clientes.error.message}</Alerta>}
      {!dados ? (
        clientes.isPending && <Carregando />
      ) : dados.itens.length === 0 ? (
        filtrado ? (
          <Vazio icone={<Search />} titulo="Nenhum cliente encontrado">
            Confira a grafia, busque pela placa do carro ou limpe os filtros.
          </Vazio>
        ) : (
          <Vazio
            icone={<Users />}
            titulo="Nenhum cliente cadastrado ainda"
            acao={
              podeEditar && (
                <Link to="/clientes/novo" className={classesBotao('primario')}>
                  Cadastrar o primeiro cliente
                </Link>
              )
            }
          />
        )
      ) : (
        <Tabela>
          <Cabecalho>
            <ThOrdenavel campo="nome" ordem={ordem} aoOrdenar={ordenar}>
              Nome / Razão social
            </ThOrdenavel>
            <Th>Tipo</Th>
            <Th>CPF/CNPJ</Th>
            <Th>Contato</Th>
            <Th>Cidade</Th>
            <ThOrdenavel campo="clienteDesde" ordem={ordem} aoOrdenar={ordenar}>
              Cliente desde
            </ThOrdenavel>
            <Th className="text-right">Veículos</Th>
            <Th>Status</Th>
            <Th className="w-10" />
          </Cabecalho>
          <tbody>
            {dados.itens.map((c) => (
              <LinhaCliente key={c.id} cliente={c} podeEditar={podeEditar} />
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={clientes.isFetching} />}
    </div>
  );
}

function LinhaCliente({ cliente: c, podeEditar }: { cliente: ClienteResumo; podeEditar: boolean }) {
  const contato = c.whatsapp ?? c.telefone;
  return (
    <Linha className="hover:bg-superficie-alt">
      <Td className="min-w-56">
        <Link to={`/clientes/${c.id}`} className="font-medium text-texto hover:text-primaria">
          {c.nome}
        </Link>
        {(c.pendencias.length > 0 || (c.diasAteAniversario ?? 99) <= 7) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            <SeloAniversario dias={c.diasAteAniversario} />
            <SeloPendencias pendencias={c.pendencias} />
          </div>
        )}
      </Td>
      <Td suave>{c.tipo}</Td>
      <Td suave className="whitespace-nowrap tabular-nums">
        {formatarDocumento(c.cpfCnpj)}
      </Td>
      <Td suave className="whitespace-nowrap tabular-nums">
        {contato ? formatarTelefone(contato) : '—'}
      </Td>
      <Td suave className="whitespace-nowrap">
        {c.cidade ?? '—'}
      </Td>
      <Td suave className="whitespace-nowrap tabular-nums">
        {c.clienteDesde ? formatarDataIso(c.clienteDesde) : '—'}
      </Td>
      <Td className="text-right tabular-nums">{c.totalVeiculos}</Td>
      <Td>
        <Selo ponto tom={c.ativo ? 'sucesso' : 'neutro'}>
          {c.ativo ? 'Ativo' : 'Inativo'}
        </Selo>
      </Td>
      <Td className="text-right">
        <MenuAcoes
          acoes={[
            { rotulo: 'Visualizar', icone: Eye, para: `/clientes/${c.id}` },
            podeEditar && { rotulo: 'Editar', icone: Pencil, para: `/clientes/${c.id}/editar` },
            !!c.whatsapp && {
              rotulo: 'Abrir WhatsApp',
              icone: MessageCircle,
              para: `https://wa.me/55${c.whatsapp}`,
              externo: true,
            },
          ]}
        />
      </Td>
    </Linha>
  );
}
