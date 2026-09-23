import { formatarDocumento, type ClienteResumo } from '@mobios/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Iniciais } from '../components/Avatar';
import { LinkWhatsApp, SeloPendencias } from '../components/Cliente';
import { Placa } from '../components/Placa';
import { Botao, CampoBusca, Cartao, classesBotao, Selo, TextoSuave, Titulo, Vazio } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';

const POR_PAGINA = 24;

/** Clientes em cartões: quem é, como falar com ele e quais carros tem. */
export function Clientes() {
  const [busca, setBusca] = useState('');
  const [quantidade, setQuantidade] = useState(POR_PAGINA);
  const podeEditar = usePode()('clientes', 'editar');
  const clientes = useQuery({
    queryKey: ['clientes', busca, quantidade],
    queryFn: () =>
      api<{ itens: ClienteResumo[]; total: number }>(
        `/clientes?${new URLSearchParams({ q: busca, porPagina: String(Math.min(quantidade, 100)) })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const dados = clientes.data;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          podeEditar && (
            <Link to="/clientes/novo" className={classesBotao('primario')}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Novo cliente
            </Link>
          )
        }
      >
        Clientes
      </Titulo>

      <CampoBusca
        rotulo="Buscar clientes"
        placeholder="Buscar por nome, placa, CPF/CNPJ ou telefone"
        valor={busca}
        aoMudar={(valor) => {
          setBusca(valor);
          setQuantidade(POR_PAGINA);
        }}
      />

      {dados && dados.itens.length === 0 ? (
        busca ? (
          <Vazio icone={<Search />} titulo="Nenhum cliente encontrado">
            Confira a grafia ou busque pela placa do carro.
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dados?.itens.map((c) => (
            <CartaoCliente key={c.id} cliente={c} />
          ))}
        </div>
      )}

      {dados && dados.total > 0 && (
        <div className="flex flex-col items-center gap-3">
          <TextoSuave className="text-xs">
            Mostrando {dados.itens.length} de {dados.total} cliente(s)
          </TextoSuave>
          {dados.total > dados.itens.length && quantidade < 100 && (
            <Botao
              variante="secundario"
              disabled={clientes.isFetching}
              onClick={() => setQuantidade((q) => q + POR_PAGINA)}
            >
              Mostrar mais
            </Botao>
          )}
          {dados.total > dados.itens.length && quantidade >= 100 && (
            <TextoSuave className="text-xs">Refine a busca para ver os demais.</TextoSuave>
          )}
        </div>
      )}
    </div>
  );
}

function CartaoCliente({ cliente: c }: { cliente: ClienteResumo }) {
  const restantes = c.totalVeiculos - c.veiculos.length;
  return (
    <Cartao className="relative flex flex-col gap-4 p-5 transition hover:border-borda-forte hover:shadow-md">
      <div className="flex items-start gap-3">
        <Iniciais nome={c.nome} />
        <div className="min-w-0 flex-1">
          {/* O link cobre o cartão inteiro; o WhatsApp fica por cima (relative z-10). */}
          <Link
            to={`/clientes/${c.id}`}
            className="block truncate font-semibold text-texto after:absolute after:inset-0 after:rounded-lg hover:text-primaria"
          >
            {c.nome}
          </Link>
          <p className="truncate text-xs text-texto-suave">
            {c.tipo === 'PF' ? 'CPF' : 'CNPJ'} {formatarDocumento(c.cpfCnpj)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {!c.ativo && <Selo>Inativo</Selo>}
          <SeloPendencias pendencias={c.pendencias} />
        </div>
      </div>

      {c.whatsapp ? (
        <LinkWhatsApp numero={c.whatsapp} className="relative z-10 self-start" />
      ) : (
        <span className="text-sm text-texto-suave">Sem WhatsApp</span>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-borda pt-4">
        {c.veiculos.length === 0 && <span className="text-sm text-texto-suave">Nenhum veículo</span>}
        {c.veiculos.map((v) => (
          <span
            key={v.id}
            className={`flex items-center gap-2 ${v.status === 'ativo' ? '' : 'opacity-50'}`}
            title={`${v.marca} ${v.modelo}`}
          >
            <Placa placa={v.placa} tamanho="sm" />
            {c.veiculos.length === 1 && <span className="text-sm text-texto">{v.modelo}</span>}
          </span>
        ))}
        {restantes > 0 && <span className="text-xs text-texto-suave">+{restantes}</span>}
      </div>
    </Cartao>
  );
}
