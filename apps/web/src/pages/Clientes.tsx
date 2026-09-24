import {
  COLUNAS_IMPORTACAO_CLIENTES,
  formatarDataIso,
  formatarDocumento,
  type ClienteFiltro,
  type ClienteResumo,
} from '@mobios/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FileUp, Plus, Search, SlidersHorizontal, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { SeloAniversario, SeloPendencias } from '../components/Cliente';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Botao,
  BotaoLink,
  BotaoVisualizar,
  Cabecalho,
  Campo,
  CampoBusca,
  classesBotao,
  Input,
  Linha,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useOpcoes } from '../lib/cadastro';
import { usePode } from '../lib/sessao';

type Filtro = Required<Omit<ClienteFiltro, 'pagina' | 'porPagina'>>;

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

/** Clientes em tabela, com filtros (status, tipo, cliente desde, origem, relacionamento e aniversário). */
export function Clientes() {
  const podeEditar = usePode()('clientes', 'editar');
  const origens = useOpcoes('origens');
  const relacionamentos = useOpcoes('relacionamentos');
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [importando, setImportando] = useState(false);
  const queryClient = useQueryClient();
  const parametros = new URLSearchParams(
    Object.entries({ ...filtro, pagina: String(pagina), porPagina: String(POR_PAGINA) }).filter(([, v]) => v),
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
  const filtrado = JSON.stringify(filtro) !== JSON.stringify(FILTRO_INICIAL);
  // Os filtros começam recolhidos; o contador mostra quantos estão diferentes do padrão.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const filtrosAtivos = (Object.keys(FILTRO_INICIAL) as (keyof Filtro)[]).filter(
    (campo) => campo !== 'q' && filtro[campo] !== FILTRO_INICIAL[campo],
  ).length;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          podeEditar && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Link to="/clientes/novo" className={classesBotao('primario')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Novo cliente
              </Link>
            </div>
          )
        }
      >
        Clientes
      </Titulo>

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

      <div className="space-y-3">
        <CampoBusca
          rotulo="Buscar clientes"
          placeholder="Buscar por nome, placa, CPF/CNPJ ou telefone"
          valor={filtro.q}
          aoMudar={(valor) => mudar('q', valor)}
        />
        <button
          type="button"
          aria-expanded={filtrosAbertos}
          onClick={() => setFiltrosAbertos(!filtrosAbertos)}
          className="inline-flex items-center gap-2 text-sm font-medium text-primaria hover:underline"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          {filtrosAbertos ? 'Ocultar filtros' : 'Mostrar filtros'}
          {filtrosAtivos > 0 && <Selo tom="primario">{filtrosAtivos} alterado(s)</Selo>}
          <ChevronDown className={`size-4 transition ${filtrosAbertos ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {filtrosAbertos && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo rotulo="Status">
              <Select value={filtro.ativo} onChange={(e) => mudar('ativo', e.target.value)}>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
                <option value="">Ativos e inativos</option>
              </Select>
            </Campo>
            <Campo rotulo="Tipo">
              <Select value={filtro.tipo} onChange={(e) => mudar('tipo', e.target.value)}>
                <option value="">Pessoa física e jurídica</option>
                <option value="PF">Pessoa física</option>
                <option value="PJ">Pessoa jurídica</option>
              </Select>
            </Campo>
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
            {filtrado && (
              <div className="flex items-end pb-2">
                <BotaoLink
                  onClick={() => {
                    setFiltro(FILTRO_INICIAL);
                    setPagina(1);
                  }}
                >
                  Limpar filtros
                </BotaoLink>
              </div>
            )}
          </div>
        )}
      </div>

      {dados && dados.itens.length === 0 ? (
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
            <Th>Nome / Razão social</Th>
            <Th>Tipo</Th>
            <Th>CPF/CNPJ</Th>
            <Th>Cliente desde</Th>
            <Th className="text-right">Veículos</Th>
            <Th>Status</Th>
            <Th />
          </Cabecalho>
          <tbody>
            {dados?.itens.map((c) => (
              <LinhaCliente key={c.id} cliente={c} />
            ))}
          </tbody>
        </Tabela>
      )}

      {dados && <Paginacao pagina={pagina} total={dados.total} aoMudar={setPagina} carregando={clientes.isFetching} />}
    </div>
  );
}

function LinhaCliente({ cliente: c }: { cliente: ClienteResumo }) {
  return (
    <Linha className="hover:bg-superficie-alt">
      <Td className="min-w-56">
        <Link to={`/clientes/${c.id}`} className="font-medium text-texto hover:text-primaria">
          {c.nome}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1">
          <SeloAniversario dias={c.diasAteAniversario} />
          <SeloPendencias pendencias={c.pendencias} />
        </div>
      </Td>
      <Td suave>{c.tipo}</Td>
      <Td suave className="whitespace-nowrap">
        {formatarDocumento(c.cpfCnpj)}
      </Td>
      <Td suave className="whitespace-nowrap">
        {c.clienteDesde ? formatarDataIso(c.clienteDesde) : '—'}
      </Td>
      <Td suave className="text-right">
        {c.totalVeiculos}
      </Td>
      <Td>{c.ativo ? <Selo tom="sucesso">Ativo</Selo> : <Selo>Inativo</Selo>}</Td>
      <Td className="text-right">
        <BotaoVisualizar para={`/clientes/${c.id}`} />
      </Td>
    </Linha>
  );
}
