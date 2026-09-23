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
import { AlertTriangle, ArrowLeft, CarFront, History, MapPin, MessageCircle, Pencil, Plus, Repeat, Star, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Iniciais } from '../components/Avatar';
import { BuscaCliente } from '../components/BuscaCliente';
import { LinkWhatsApp, SeloPendencias } from '../components/Cliente';
import { Placa } from '../components/Placa';
import { Abas, Alerta, BotaoLink, Cartao, classesBotao, Selo, TextoSuave, Vazio } from '../components/ui';
import { api, ErroApi } from '../lib/api';
import { usePode } from '../lib/sessao';

type Aba = 'resumo' | 'veiculos' | 'enderecos' | 'historico';
const ABAS: Aba[] = ['resumo', 'veiculos', 'enderecos', 'historico'];

const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-texto-suave">{rotulo}</dt>
    <dd className="text-sm text-texto">{children || '—'}</dd>
  </div>
);

const Bloco = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <Cartao className="p-5">
    <h3 className="mb-3 text-sm font-semibold text-texto">{titulo}</h3>
    <dl className="space-y-3">{children}</dl>
  </Cartao>
);

/** Perfil do cliente: cabeçalho com contato rápido e abas Resumo, Veículos, Endereços e Histórico. */
export function ClienteDetalhe() {
  const { id } = useParams() as { id: string };
  const [params, setParams] = useSearchParams();
  const aba = (ABAS as string[]).includes(params.get('aba') ?? '') ? (params.get('aba') as Aba) : 'resumo';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const podeEditar = usePode()('clientes', 'editar');
  const cliente = useQuery({ queryKey: ['clientes', id], queryFn: () => api<Cliente>(`/clientes/${id}`) });
  const veiculos = useQuery({ queryKey: ['veiculos', id], queryFn: () => api<Veiculo[]>(`/veiculos?clienteId=${id}`) });
  const excluir = useMutation({
    mutationFn: () => api(`/clientes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
      navigate('/clientes');
    },
  });

  if (cliente.isPending) return <TextoSuave>Carregando…</TextoSuave>;
  if (cliente.isError) return <Alerta>{cliente.error.message}</Alerta>;
  const c = cliente.data;
  const pf = c.tipo === 'PF';
  const trocarAba = (a: Aba) => setParams(a === 'resumo' ? {} : { aba: a }, { replace: true });

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-primaria hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Clientes
      </Link>

      <Cartao>
        <div className="flex flex-wrap items-center gap-5">
          <Iniciais nome={c.nome} tamanho="perfil" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="text-2xl font-semibold text-texto">{c.nome}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Selo tom="primario">{pf ? 'Pessoa física' : 'Pessoa jurídica'}</Selo>
              <Selo tom={c.ativo ? 'sucesso' : 'neutro'}>{c.ativo ? 'Ativo' : 'Inativo'}</Selo>
              <span className="text-sm text-texto-suave">
                {pf ? 'CPF' : 'CNPJ'} {formatarDocumento(c.cpfCnpj)} · cliente desde {formatarDataIso(c.clienteDesde)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.whatsapp && (
              <a href={`https://wa.me/55${c.whatsapp}`} target="_blank" rel="noopener noreferrer" className={classesBotao('secundario')}>
                <MessageCircle className="mr-1.5 size-4 text-sucesso" aria-hidden /> WhatsApp
              </a>
            )}
            {podeEditar && (
              <Link to={`/clientes/${id}/editar`} className={classesBotao('primario')}>
                <Pencil className="mr-1.5 size-4" aria-hidden /> Editar
              </Link>
            )}
          </div>
        </div>

        {c.pendencias.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md bg-alerta-suave px-4 py-3 text-sm text-alerta">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            <span className="flex-1">
              <strong>Cadastro incompleto.</strong> Falta: {c.pendencias.join(', ')}. Sem isso não será possível abrir O.S.
            </span>
            {podeEditar && (
              <Link to={`/clientes/${id}/editar`} className="font-medium underline">
                Completar agora
              </Link>
            )}
          </div>
        )}
      </Cartao>

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
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Bloco titulo="Contato">
              <Dado rotulo="WhatsApp">{c.whatsapp && <LinkWhatsApp numero={c.whatsapp} />}</Dado>
              <Dado rotulo="Telefone">{c.telefone && formatarTelefone(c.telefone)}</Dado>
              <Dado rotulo="E-mail">{c.email && <a href={`mailto:${c.email}`} className="text-primaria hover:underline">{c.email}</a>}</Dado>
            </Bloco>
            <Bloco titulo="Identificação">
              <Dado rotulo={pf ? 'RG' : 'Inscrição estadual'}>{c.rgIe}</Dado>
              {pf && <Dado rotulo="Data de nascimento">{c.dataNascimento && formatarDataIso(c.dataNascimento)}</Dado>}
              {pf && <Dado rotulo="Sexo">{c.sexo && SEXOS[c.sexo]}</Dado>}
            </Bloco>
            <Bloco titulo="Relacionamento">
              <Dado rotulo="Origem">{c.origemNome}</Dado>
              <Dado rotulo="Tipo de relacionamento">{c.relacionamentoNome}</Dado>
              <Dado rotulo="Endereço principal">{c.enderecos[0] && `${c.enderecos[0].cidade}/${c.enderecos[0].uf}`}</Dado>
            </Bloco>
          </div>
          {c.observacoes && (
            <Cartao className="p-5">
              <h3 className="mb-2 text-sm font-semibold">Observações</h3>
              <p className="whitespace-pre-line text-sm text-texto">{c.observacoes}</p>
            </Cartao>
          )}
          {podeEditar && (
            <div className="text-right">
              <BotaoLink perigo disabled={excluir.isPending} onClick={() => confirm(`Excluir o cliente ${c.nome}? Esta ação não pode ser desfeita.`) && excluir.mutate()}>
                <Trash2 className="mr-1 inline size-4" aria-hidden />
                Excluir cliente
              </BotaoLink>
            </div>
          )}
          {excluir.isError && (
            <Alerta>{excluir.error instanceof ErroApi && excluir.error.status === 409 ? 'Este cliente tem veículos. Remova-os ou transfira-os antes de excluir.' : excluir.error.message}</Alerta>
          )}
        </div>
      )}

      {aba === 'veiculos' && <Veiculos clienteId={id} veiculos={veiculos.data} podeEditar={podeEditar} />}

      {aba === 'enderecos' && (
        <div className="space-y-4">
          {c.enderecos.length === 0 ? (
            <Vazio icone={<MapPin />} titulo="Nenhum endereço cadastrado">
              Todo cliente precisa de ao menos um endereço para abrir O.S.
            </Vazio>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {c.enderecos.map((e) => (
                <ItemEndereco key={e.id} endereco={e} />
              ))}
            </ul>
          )}
          {podeEditar && (
            <Link to={`/clientes/${id}/editar?etapa=2`} className={classesBotao('secundario')}>
              <Pencil className="mr-1.5 size-4" aria-hidden /> {c.enderecos.length ? 'Editar endereços' : 'Cadastrar endereço'}
            </Link>
          )}
        </div>
      )}

      {aba === 'historico' && (
        <Vazio icone={<History />} titulo="Histórico de atendimentos">
          As ordens de serviço deste cliente aparecerão aqui quando o módulo de O.S. estiver disponível.
        </Vazio>
      )}
    </div>
  );
}

function ItemEndereco({ endereco: e }: { endereco: Endereco }) {
  const finalidades = (Object.keys(FINALIDADES_PJ) as (keyof typeof FINALIDADES_PJ)[]).filter((f) => e[f]).map((f) => FINALIDADES_PJ[f]);
  return (
    <li>
      <Cartao className="flex gap-4 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primaria-suave text-primaria">
          <MapPin className="size-5" aria-hidden />
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
      </Cartao>
    </li>
  );
}

function Veiculos({ clienteId, veiculos, podeEditar }: { clienteId: string; veiculos?: Veiculo[]; podeEditar: boolean }) {
  const queryClient = useQueryClient();
  const [transferindo, setTransferindo] = useState<string | null>(null);
  const remover = useMutation({
    mutationFn: (id: string) => api(`/veiculos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['veiculos'] });
      queryClient.invalidateQueries({ queryKey: ['clientes'] });
      queryClient.invalidateQueries({ queryKey: ['painel'] });
    },
  });
  const novo = `/veiculos/novo?clienteId=${clienteId}`;

  if (!veiculos) return <TextoSuave>Carregando…</TextoSuave>;
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
    <div className="space-y-4">
      <Alerta>{remover.isError && remover.error.message}</Alerta>
      <div className="grid gap-4 md:grid-cols-2">
        {veiculos.map((v) =>
          transferindo === v.id ? (
            <Cartao key={v.id} className="p-5 md:col-span-2">
              <Transferir veiculo={v} aoConcluir={() => setTransferindo(null)} />
            </Cartao>
          ) : (
            <Cartao key={v.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Placa placa={v.placa} tamanho="lg" />
                  <p className="font-semibold text-texto">
                    {v.marca} {v.modelo}
                    {v.versao && <span className="font-normal text-texto-suave"> {v.versao}</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {v.principal && (
                    <Selo tom="primario">
                      <Star className="mr-0.5 inline size-3" aria-hidden /> Principal
                    </Selo>
                  )}
                  {v.status !== 'ativo' && <Selo>{STATUS_VEICULO[v.status]}</Selo>}
                  <SeloPendencias pendencias={v.pendencias} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Dado rotulo="Ano">{v.anoFabricacao && `${v.anoFabricacao}/${v.anoModelo ?? '—'}`}</Dado>
                <Dado rotulo="Cor">{v.cor}</Dado>
                <Dado rotulo="Combustível">{v.combustivel && COMBUSTIVEIS[v.combustivel]}</Dado>
                <Dado rotulo="Km atual">{v.kmAtual != null && v.kmAtual.toLocaleString('pt-BR')}</Dado>
              </dl>
              <p className="text-xs text-texto-suave">
                {v.chassi ? `Chassi ${v.chassi}` : 'Sem chassi informado'}
                {v.renavam && ` · Renavam ${v.renavam}`} · Última visita: {v.ultimaVisita ? formatarDataIso(v.ultimaVisita) : '—'}
              </p>
              {podeEditar && (
                <div className="mt-auto flex flex-wrap gap-4 border-t border-borda pt-3">
                  <Link to={`/veiculos/${v.id}/editar`} className="inline-flex items-center gap-1 text-sm text-primaria hover:underline">
                    <Pencil className="size-4" aria-hidden /> {v.pendencias.length ? 'Completar' : 'Editar'}
                  </Link>
                  <BotaoLink onClick={() => setTransferindo(v.id)} className="inline-flex items-center gap-1">
                    <Repeat className="size-4" aria-hidden /> Transferir
                  </BotaoLink>
                  <BotaoLink perigo className="ml-auto inline-flex items-center gap-1" onClick={() => confirm(`Remover o veículo ${formatarPlaca(v.placa)}?`) && remover.mutate(v.id)}>
                    <Trash2 className="size-4" aria-hidden /> Remover
                  </BotaoLink>
                </div>
              )}
            </Cartao>
          ),
        )}
        {podeEditar && (
          <Link
            to={novo}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-borda-forte text-texto-suave transition hover:border-primaria hover:text-primaria"
          >
            <Plus className="size-6" aria-hidden />
            <span className="text-sm font-medium">Adicionar veículo</span>
          </Link>
        )}
      </div>
    </div>
  );
}

/** Venda para outro cliente da oficina: o veículo muda de dono levando o histórico. */
function Transferir({ veiculo, aoConcluir }: { veiculo: Veiculo; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const transferir = useMutation({
    mutationFn: (clienteId: string) => api<Veiculo>(`/veiculos/${veiculo.id}/transferir`, { method: 'POST', body: { clienteId } }),
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
      <TextoSuave>O veículo passa para o novo proprietário com o mesmo cadastro e volta a ficar ativo. As O.S. já feitas continuam no histórico do dono anterior.</TextoSuave>
      <Alerta>{transferir.isError && transferir.error.message}</Alerta>
      {transferir.isPending ? (
        <TextoSuave>Transferindo…</TextoSuave>
      ) : (
        <BuscaCliente ignorar={veiculo.clienteId} aoEscolher={(c) => confirm(`Transferir ${formatarPlaca(veiculo.placa)} para ${c.nome}?`) && transferir.mutate(c.id)} />
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
