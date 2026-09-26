import {
  formatarCep,
  formatarDataIso,
  formatarDocumento,
  formatarMoeda,
  formatarNumeroOrcamento,
  formatarPlaca,
  formatarTelefone,
  type ContextoCliente,
} from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';
import { Iniciais } from './Avatar';
import { LinkWhatsApp } from './Cliente';
import { ClienteDoOrcamento, SeloSituacao } from './Orcamento';
import { BotaoVisualizar, Carregando, Dado, Gaveta, Secao, TextoSuave } from './ui';

// Contexto comercial do cliente no orçamento (docs/modulos/ORCAMENTOS.md §5): card e gaveta "Visualizar cliente".
// Crédito e última compra não existem no MobiOS: o card mostra o último orçamento aprovado pelo cliente.

const useContextoCliente = (clienteId: string) =>
  useQuery({
    queryKey: ['orcamentos', 'apoio', 'clientes', clienteId, 'contexto'],
    queryFn: () => api<ContextoCliente>(`/orcamentos/apoio/clientes/${clienteId}/contexto`),
  });

const identificacao = (c: ContextoCliente) =>
  [
    c.tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física',
    c.cpfCnpj && formatarDocumento(c.cpfCnpj),
    c.endereco && `${c.endereco.cidade}/${c.endereco.uf}`,
  ]
    .filter(Boolean)
    .join(' · ');

const ultimoAprovado = (c: ContextoCliente) =>
  c.ultimoAprovado
    ? `${new Date(c.ultimoAprovado.aprovadoEm).toLocaleDateString('pt-BR')} · ${formatarMoeda(c.ultimoAprovado.totalCentavos)}`
    : 'Nenhum ainda';

/**
 * Card do cliente escolhido: iniciais, nome com os alertas, identificação e o resumo comercial, com "Visualizar
 * cliente" (gaveta, sem sair do orçamento) e a ação de alterar (`acao`). Enquanto carrega, mostra só o nome.
 */
export function CardCliente({
  cliente,
  acao,
}: {
  cliente: { id: string; nome: string; ativo: boolean; pendencias: string[] };
  acao: ReactNode;
}) {
  const contexto = useContextoCliente(cliente.id);
  const [vendo, setVendo] = useState(false);
  const c = contexto.data;
  const contato = c && (c.whatsapp ?? c.telefone);
  return (
    <div className="rounded-md border border-borda">
      <div className="flex flex-wrap items-start gap-3 p-3">
        <Iniciais nome={cliente.nome} />
        <div className="min-w-0 flex-1">
          <ClienteDoOrcamento cliente={c ?? cliente} />
          {c && <p className="mt-0.5 text-xs text-texto-suave">{identificacao(c)}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <BotaoVisualizar titulo="Visualizar cliente" aoClicar={() => setVendo(true)} aberto={vendo} />
          {acao}
        </div>
      </div>
      {c && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-borda bg-superficie-alt px-3 py-2 sm:grid-cols-3">
          <Dado rotulo="Último orçamento aprovado">{ultimoAprovado(c)}</Dado>
          <Dado rotulo="Cliente desde">{formatarDataIso(c.clienteDesde)}</Dado>
          <Dado rotulo="Contato">{contato && formatarTelefone(contato)}</Dado>
        </dl>
      )}
      {contexto.isError && (
        <p className="border-t border-borda px-3 py-2 text-xs text-perigo">{contexto.error.message}</p>
      )}
      {vendo && <GavetaCliente clienteId={cliente.id} aoFechar={() => setVendo(false)} />}
    </div>
  );
}

/**
 * "Visualizar cliente": cadastro, contato, endereço, veículos, quantos orçamentos e os 5 últimos, numa gaveta
 * lateral. Pedidos de venda e O.S. aparecem como "disponível quando o módulo existir".
 */
function GavetaCliente({ clienteId, aoFechar }: { clienteId: string; aoFechar: () => void }) {
  const pode = usePode();
  const contexto = useContextoCliente(clienteId);
  const c = contexto.data;
  return (
    <Gaveta titulo="Visualizar cliente" aoFechar={aoFechar}>
      {contexto.isError && <TextoSuave>{contexto.error.message}</TextoSuave>}
      {!c ? (
        !contexto.isError && <Carregando />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Iniciais nome={c.nome} tamanho="perfil" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-lg">
                <ClienteDoOrcamento cliente={c} />
              </div>
              <p className="text-xs text-texto-suave">{identificacao(c)}</p>
              {pode('clientes') && (
                <Link to={`/clientes/${c.id}`} className="text-xs text-primaria hover:underline">
                  Abrir cadastro completo
                </Link>
              )}
            </div>
          </div>

          <Secao titulo="Identificação">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo={c.tipo === 'PJ' ? 'CNPJ' : 'CPF'}>{c.cpfCnpj && formatarDocumento(c.cpfCnpj)}</Dado>
              <Dado rotulo={c.tipo === 'PJ' ? 'Inscrição estadual' : 'RG'}>{c.rgIe}</Dado>
              <Dado rotulo="Cliente desde">{formatarDataIso(c.clienteDesde)}</Dado>
              <Dado rotulo="Último orçamento aprovado">{ultimoAprovado(c)}</Dado>
            </dl>
          </Secao>

          <Secao titulo="Contato">
            <dl className="grid grid-cols-2 gap-3">
              <Dado rotulo="Telefone">{c.telefone && formatarTelefone(c.telefone)}</Dado>
              <Dado rotulo="WhatsApp">
                {c.whatsapp && (
                  <span className="inline-flex items-center gap-1.5">
                    {formatarTelefone(c.whatsapp)} <LinkWhatsApp numero={c.whatsapp} />
                  </span>
                )}
              </Dado>
              <div className="col-span-2">
                <Dado rotulo="E-mail">{c.email}</Dado>
              </div>
            </dl>
          </Secao>

          <Secao titulo="Endereço principal">
            {c.endereco ? (
              <p className="text-sm">
                {c.endereco.logradouro}, {c.endereco.numero}
                {c.endereco.complemento && ` — ${c.endereco.complemento}`}
                <br />
                {c.endereco.bairro} · {c.endereco.cidade}/{c.endereco.uf} · CEP {formatarCep(c.endereco.cep)}
              </p>
            ) : (
              <TextoSuave>Sem endereço cadastrado.</TextoSuave>
            )}
          </Secao>

          <Secao titulo={`Veículos (${c.veiculos.length})`}>
            {c.veiculos.length ? (
              <ul className="space-y-1 text-sm">
                {c.veiculos.map((v) => (
                  <li key={v.id}>
                    <span className="font-mono font-semibold">{formatarPlaca(v.placa)}</span>
                    <span className="text-texto-suave">
                      {' '}
                      — {v.marca} {v.modelo}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <TextoSuave>Nenhum veículo cadastrado.</TextoSuave>
            )}
          </Secao>

          <Secao titulo={`Orçamentos (${c.totalOrcamentos})`}>
            {c.orcamentos.length ? (
              <ul className="divide-y divide-borda text-sm">
                {c.orcamentos.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <Link to={`/orcamentos/${o.id}`} className="font-mono text-xs font-semibold hover:text-primaria">
                      {formatarNumeroOrcamento(o.numero)} v{o.versaoOrcamento}
                    </Link>
                    <span className="text-xs text-texto-suave">{new Date(o.criadoEm).toLocaleDateString('pt-BR')}</span>
                    <SeloSituacao situacao={o.situacao} />
                    <span className="ml-auto font-medium tabular-nums">{formatarMoeda(o.totalCentavos)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <TextoSuave>Nenhum orçamento ainda.</TextoSuave>
            )}
          </Secao>

          {/* Pedidos de venda e O.S. ainda não existem no MobiOS: sem dados simulados, só o aviso. */}
          <Secao titulo="Pedidos de venda">
            <TextoSuave>Disponível quando o módulo de pedidos de venda existir.</TextoSuave>
          </Secao>
          <Secao titulo="Ordens de serviço">
            <TextoSuave>Disponível quando o módulo de ordens de serviço existir.</TextoSuave>
          </Secao>
        </div>
      )}
    </Gaveta>
  );
}
