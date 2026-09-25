import {
  COMBUSTIVEIS,
  FINALIDADES_PJ,
  formatarCep,
  formatarDataIso,
  formatarDocumento,
  formatarPlaca,
  formatarTelefone,
  SEXOS,
  STATUS_VEICULO,
  TIPOS_ENDERECO,
  type Cliente,
  type Endereco,
  type Veiculo,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cake, CarFront, History, MapPin, Pencil, Plus, Repeat, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Iniciais } from '../components/Avatar';
import { BuscaCliente } from '../components/BuscaCliente';
import { LinkWhatsApp, SeloAniversario, SeloPendencias } from '../components/Cliente';
import { Placa } from '../components/Placa';
import {
  Abas,
  Alerta,
  BarraFerramentas,
  BotaoLink,
  Bloco,
  CabecalhoObjeto,
  Cabecalho,
  Carregando,
  Cartao,
  classesBotao,
  Confirmacao,
  Dado,
  Linha,
  MenuAcoes,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  useNotificar,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { useTrilha } from '../lib/trilha';

type Aba = 'resumo' | 'veiculos' | 'enderecos' | 'historico';
const ABAS: Aba[] = ['resumo', 'veiculos', 'enderecos', 'historico'];

/** Perfil do cliente (Object Page): cabeçalho com os dados principais e abas Resumo, Veículos, Endereços e Histórico. */
export function ClienteDetalhe() {
  const { id } = useParams() as { id: string };
  const [params, setParams] = useSearchParams();
  const aba = (ABAS as string[]).includes(params.get('aba') ?? '') ? (params.get('aba') as Aba) : 'resumo';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notificar = useNotificar();
  const podeEditar = usePode()('clientes', 'editar');
  const [excluindo, setExcluindo] = useState(false);
  const cliente = useQuery({ queryKey: ['clientes', id], queryFn: () => api<Cliente>(`/clientes/${id}`) });
  const veiculos = useQuery({ queryKey: ['veiculos', id], queryFn: () => api<Veiculo[]>(`/veiculos?clienteId=${id}`) });
  useTrilha(cliente.data?.nome);
  const excluir = useMutation({
    mutationFn: () => api(`/clientes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      notificar('Cliente excluído.');
      navigate('/clientes');
    },
  });

  if (cliente.isPending) return <Carregando />;
  if (cliente.isError) return <Alerta>{cliente.error.message}</Alerta>;
  const c = cliente.data;
  const pf = c.tipo === 'PF';
  const trocarAba = (a: Aba) => setParams(a === 'resumo' ? {} : { aba: a }, { replace: true });
  const principal = c.enderecos[0];

  return (
    <div className="space-y-3">
      <CabecalhoObjeto
        icone={<Iniciais nome={c.nome} tamanho="md" />}
        titulo={c.nome}
        selos={
          <>
            <Selo tom="primario">{pf ? 'Pessoa física' : 'Pessoa jurídica'}</Selo>
            <Selo ponto tom={c.ativo ? 'sucesso' : 'neutro'}>
              {c.ativo ? 'Ativo' : 'Inativo'}
            </Selo>
            <SeloAniversario dias={c.diasAteAniversario} />
          </>
        }
        atributos={[
          { rotulo: pf ? 'CPF' : 'CNPJ', valor: formatarDocumento(c.cpfCnpj) },
          { rotulo: 'WhatsApp', valor: c.whatsapp && <LinkWhatsApp numero={c.whatsapp} /> },
          { rotulo: 'Telefone', valor: c.telefone && formatarTelefone(c.telefone) },
          { rotulo: 'Cidade', valor: principal && `${principal.cidade}/${principal.uf}` },
          { rotulo: 'Cliente desde', valor: formatarDataIso(c.clienteDesde) },
        ]}
        acoes={
          podeEditar && (
            <>
              <Link to={`/clientes/${id}/editar`} className={classesBotao('primario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden /> Editar
              </Link>
              <MenuAcoes
                acoes={[
                  { rotulo: 'Adicionar veículo', icone: Plus, para: `/veiculos/novo?clienteId=${id}` },
                  { rotulo: 'Excluir cliente', icone: Trash2, perigo: true, aoClicar: () => setExcluindo(true) },
                ]}
              />
            </>
          )
        }
      >
        {c.diasAteAniversario === 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-primaria-suave px-3 py-2 text-sm text-primaria">
            <Cake className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">
              <strong>Hoje é aniversário de {c.nome.split(' ')[0]}!</strong> Uma mensagem de parabéns deixa o
              atendimento mais pessoal.
            </span>
            {c.whatsapp && <LinkWhatsApp numero={c.whatsapp} />}
          </div>
        )}
        {c.pendencias.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-alerta-suave px-3 py-2 text-sm text-alerta">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">
              <strong>Cadastro incompleto.</strong> Falta: {c.pendencias.join(', ')}. Sem isso não será possível abrir
              O.S.
            </span>
            {podeEditar && (
              <Link to={`/clientes/${id}/editar`} className="font-medium underline">
                Completar agora
              </Link>
            )}
          </div>
        )}
      </CabecalhoObjeto>

      <Abas
        abas={[
          { id: 'resumo', rotulo: 'Resumo' },
          { id: 'veiculos', rotulo: 'Veículos', contagem: veiculos.data?.length },
          { id: 'enderecos', rotulo: 'Endereços', contagem: c.enderecos.length },
          { id: 'historico', rotulo: 'Histórico' },
        ]}
        atual={aba}
        aoTrocar={trocarAba}
      />

      {aba === 'resumo' && (
        <div className="grid gap-3 lg:grid-cols-3">
          <Bloco titulo="Contato">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo="WhatsApp">{c.whatsapp && <LinkWhatsApp numero={c.whatsapp} />}</Dado>
              <Dado rotulo="Telefone">{c.telefone && formatarTelefone(c.telefone)}</Dado>
              <div className="col-span-2">
                <Dado rotulo="E-mail">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="text-primaria hover:underline">
                      {c.email}
                    </a>
                  )}
                </Dado>
              </div>
            </dl>
          </Bloco>
          <Bloco titulo="Identificação">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo={pf ? 'CPF' : 'CNPJ'}>{formatarDocumento(c.cpfCnpj)}</Dado>
              <Dado rotulo={pf ? 'RG' : 'Inscrição estadual'}>{c.rgIe}</Dado>
              {pf && <Dado rotulo="Data de nascimento">{c.dataNascimento && formatarDataIso(c.dataNascimento)}</Dado>}
              {pf && <Dado rotulo="Sexo">{c.sexo && SEXOS[c.sexo]}</Dado>}
            </dl>
          </Bloco>
          <Bloco titulo="Relacionamento">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo="Origem">{c.origemNome}</Dado>
              <Dado rotulo="Tipo de relacionamento">{c.relacionamentoNome}</Dado>
              <Dado rotulo="Cliente desde">{formatarDataIso(c.clienteDesde)}</Dado>
              <Dado rotulo="Endereço principal">{principal && `${principal.cidade}/${principal.uf}`}</Dado>
            </dl>
          </Bloco>
          {!pf && (
            <Bloco
              titulo="Responsáveis pela empresa"
              className="lg:col-span-3"
              acao={
                podeEditar && (
                  <Link
                    to={`/clientes/${id}/editar?etapa=responsaveis`}
                    className="text-xs text-primaria hover:underline"
                  >
                    {c.responsaveis.length ? 'Editar' : 'Cadastrar responsável'}
                  </Link>
                )
              }
            >
              {c.responsaveis.length === 0 ? (
                <TextoSuave>Nenhum responsável cadastrado.</TextoSuave>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {c.responsaveis.map((r) => (
                    <li key={r.id} className="flex gap-3 rounded-md border border-borda p-3">
                      <Iniciais nome={r.nome} tamanho="sm" />
                      <div className="min-w-0 space-y-0.5 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-texto">{r.nome}</span>
                          {r.principal && <Selo tom="primario">Principal</Selo>}
                        </div>
                        <div className="text-xs text-texto-suave">{r.cargoNome}</div>
                        {r.telefoneWhatsapp ? (
                          <LinkWhatsApp numero={r.telefone} />
                        ) : (
                          <div>{formatarTelefone(r.telefone)}</div>
                        )}
                        {r.email && (
                          <a href={`mailto:${r.email}`} className="block truncate text-primaria hover:underline">
                            {r.email}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Bloco>
          )}
          {c.observacoes && (
            <Bloco titulo="Observações" className="lg:col-span-3">
              <p className="whitespace-pre-line text-sm text-texto">{c.observacoes}</p>
            </Bloco>
          )}
        </div>
      )}

      {aba === 'veiculos' && <Veiculos clienteId={id} veiculos={veiculos.data} podeEditar={podeEditar} />}

      {aba === 'enderecos' && (
        <div className="space-y-3">
          {podeEditar && (
            <BarraFerramentas>
              <Link to={`/clientes/${id}/editar?etapa=endereco`} className={classesBotao('secundario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden />{' '}
                {c.enderecos.length ? 'Editar endereços' : 'Cadastrar endereço'}
              </Link>
            </BarraFerramentas>
          )}
          {c.enderecos.length === 0 ? (
            <Vazio icone={<MapPin />} titulo="Nenhum endereço cadastrado">
              Todo cliente precisa de ao menos um endereço para abrir O.S.
            </Vazio>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {c.enderecos.map((e) => (
                <ItemEndereco key={e.id} endereco={e} />
              ))}
            </ul>
          )}
        </div>
      )}

      {aba === 'historico' && (
        <Vazio icone={<History />} titulo="Histórico de atendimentos">
          As ordens de serviço deste cliente aparecerão aqui quando o módulo de O.S. estiver disponível.
        </Vazio>
      )}

      {excluindo && (
        <Confirmacao
          titulo="Excluir cliente"
          mensagem={`Excluir o cliente ${c.nome}? Esta ação não pode ser desfeita.`}
          rotuloConfirmar="Excluir cliente"
          perigo
          carregando={excluir.isPending}
          erro={excluir.isError && excluir.error.message}
          aoConfirmar={() => excluir.mutate()}
          aoFechar={() => setExcluindo(false)}
        />
      )}
    </div>
  );
}

function ItemEndereco({ endereco: e }: { endereco: Endereco }) {
  const finalidades = (Object.keys(FINALIDADES_PJ) as (keyof typeof FINALIDADES_PJ)[])
    .filter((f) => e[f])
    .map((f) => FINALIDADES_PJ[f]);
  return (
    <li>
      <div className="flex h-full gap-3 rounded-md border border-borda bg-superficie p-3 shadow-sm">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primaria-suave text-primaria">
          <MapPin className="size-4" aria-hidden />
        </span>
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap gap-1">
            <Selo>{TIPOS_ENDERECO[e.tipo]}</Selo>
            {e.principal && <Selo tom="primario">Principal</Selo>}
            {finalidades.map((f) => (
              <Selo key={f}>{f}</Selo>
            ))}
          </div>
          <p className="font-medium text-texto">
            {e.logradouro}, {e.numero}
            {e.complemento && ` - ${e.complemento}`}
          </p>
          <p className="text-texto-suave">
            {e.bairro} · {e.cidade}/{e.uf}
          </p>
          <p className="text-texto-suave">
            CEP {formatarCep(e.cep)}
            {e.pais !== 'Brasil' && ` · ${e.pais}`}
          </p>
        </div>
      </div>
    </li>
  );
}

function Veiculos({
  clienteId,
  veiculos,
  podeEditar,
}: {
  clienteId: string;
  veiculos?: Veiculo[];
  podeEditar: boolean;
}) {
  const queryClient = useQueryClient();
  const notificar = useNotificar();
  const [transferindo, setTransferindo] = useState<Veiculo | null>(null);
  const [removendo, setRemovendo] = useState<Veiculo | null>(null);
  const remover = useMutation({
    mutationFn: (id: string) => api(`/veiculos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      setRemovendo(null);
      notificar('Veículo removido.');
    },
  });
  const novo = `/veiculos/novo?clienteId=${clienteId}`;

  if (!veiculos) return <Carregando />;
  if (veiculos.length === 0) {
    return (
      <Vazio
        icone={<CarFront />}
        titulo="Nenhum veículo cadastrado"
        acao={
          podeEditar && (
            <Link to={novo} className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar veículo
            </Link>
          )
        }
      >
        Cadastre o carro do cliente para abrir ordens de serviço.
      </Vazio>
    );
  }

  return (
    <div className="space-y-3">
      {podeEditar && (
        <BarraFerramentas>
          <Link to={novo} className={classesBotao('secundario')}>
            <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar veículo
          </Link>
        </BarraFerramentas>
      )}
      {transferindo && (
        <Cartao>
          <Transferir veiculo={transferindo} aoConcluir={() => setTransferindo(null)} />
        </Cartao>
      )}
      <Tabela>
        <Cabecalho>
          <Th>Placa</Th>
          <Th>Veículo</Th>
          <Th>Ano</Th>
          <Th>Cor</Th>
          <Th>Combustível</Th>
          <Th className="text-right">Km atual</Th>
          <Th>Chassi / Renavam</Th>
          <Th>Última visita</Th>
          <Th>Situação</Th>
          <Th className="w-10" />
        </Cabecalho>
        <tbody>
          {veiculos.map((v) => (
            <Linha key={v.id} className="hover:bg-superficie-alt">
              <Td>
                <Placa placa={v.placa} />
              </Td>
              <Td className="min-w-44">
                <span className="font-medium">
                  {v.marca} {v.modelo}
                </span>
                {v.versao && <span className="text-texto-suave"> {v.versao}</span>}
              </Td>
              <Td suave className="whitespace-nowrap tabular-nums">
                {v.anoFabricacao ? `${v.anoFabricacao}/${v.anoModelo ?? '—'}` : '—'}
              </Td>
              <Td suave>{v.cor ?? '—'}</Td>
              <Td suave>{v.combustivel ? COMBUSTIVEIS[v.combustivel] : '—'}</Td>
              <Td suave className="text-right tabular-nums">
                {v.kmAtual != null ? v.kmAtual.toLocaleString('pt-BR') : '—'}
              </Td>
              <Td suave className="text-xs">
                {v.chassi ?? '—'}
                {v.renavam && <div>{v.renavam}</div>}
              </Td>
              <Td suave className="whitespace-nowrap tabular-nums">
                {v.ultimaVisita ? formatarDataIso(v.ultimaVisita) : '—'}
              </Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {v.principal && (
                    <Selo tom="primario">
                      <Star className="size-3" aria-hidden /> Principal
                    </Selo>
                  )}
                  {v.status !== 'ativo' && <Selo>{STATUS_VEICULO[v.status]}</Selo>}
                  <SeloPendencias pendencias={v.pendencias} />
                </span>
              </Td>
              <Td className="text-right">
                {podeEditar && (
                  <MenuAcoes
                    acoes={[
                      {
                        rotulo: v.pendencias.length ? 'Completar cadastro' : 'Editar',
                        icone: Pencil,
                        para: `/veiculos/${v.id}/editar`,
                      },
                      { rotulo: 'Transferir', icone: Repeat, aoClicar: () => setTransferindo(v) },
                      { rotulo: 'Remover', icone: Trash2, perigo: true, aoClicar: () => setRemovendo(v) },
                    ]}
                  />
                )}
              </Td>
            </Linha>
          ))}
        </tbody>
      </Tabela>
      {removendo && (
        <Confirmacao
          titulo="Remover veículo"
          mensagem={`Remover o veículo ${formatarPlaca(removendo.placa)}?`}
          rotuloConfirmar="Remover"
          perigo
          carregando={remover.isPending}
          erro={remover.isError && remover.error.message}
          aoConfirmar={() => remover.mutate(removendo.id)}
          aoFechar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
}

/** Venda para outro cliente da oficina: o veículo muda de dono levando o histórico. */
function Transferir({ veiculo, aoConcluir }: { veiculo: Veiculo; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [comprador, setComprador] = useState<{ id: string; nome: string } | null>(null);
  const transferir = useMutation({
    mutationFn: (clienteId: string) =>
      api<Veiculo>(`/veiculos/${veiculo.id}/transferir`, { method: 'POST', body: { clienteId } }),
    onSuccess: (v) => {
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      aoConcluir();
      navigate(`/clientes/${v.clienteId}?aba=veiculos`);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Placa placa={veiculo.placa} />
          <h3 className="font-medium">Transferir para outro cliente</h3>
        </div>
        <BotaoLink onClick={aoConcluir}>Cancelar</BotaoLink>
      </div>
      <TextoSuave>
        O veículo passa para o novo proprietário com o mesmo cadastro e volta a ficar ativo. As O.S. já feitas continuam
        no histórico do dono anterior.
      </TextoSuave>
      <Alerta>{transferir.isError && transferir.error.message}</Alerta>
      {transferir.isPending ? (
        <TextoSuave>Transferindo…</TextoSuave>
      ) : (
        <BuscaCliente ignorar={veiculo.clienteId} aoEscolher={(c) => setComprador(c)} />
      )}
      {comprador && (
        <Confirmacao
          titulo="Transferir veículo"
          mensagem={`Transferir ${formatarPlaca(veiculo.placa)} para ${comprador.nome}?`}
          rotuloConfirmar="Transferir"
          carregando={transferir.isPending}
          aoConfirmar={() => transferir.mutate(comprador.id)}
          aoFechar={() => setComprador(null)}
        />
      )}
      <TextoSuave className="text-xs">
        Comprador ainda não é cliente?{' '}
        <Link to="/clientes/novo" className="text-primaria hover:underline">
          Cadastre-o primeiro
        </Link>
        .
      </TextoSuave>
    </div>
  );
}
