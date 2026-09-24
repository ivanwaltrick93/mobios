import type { TabelaPreco } from '@mobios/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { LinhasDePreco } from '../components/LinhasDePreco';
import { NovoPreco } from '../components/NovoPreco';
import { Alerta, Botao, Selo, TextoSuave, Titulo } from '../components/ui';
import { api } from '../lib/api';
import { usePode } from '../lib/sessao';

/** Uma tabela de preço: as linhas de preço dela (paginadas) e o cadastro de preço digitando o SKU. */
export function TabelaPrecoDetalhe() {
  const { id = '' } = useParams();
  const pode = usePode();
  const [adicionando, setAdicionando] = useState(false);
  const tabela = useQuery({
    queryKey: ['tabelas-preco', id],
    queryFn: () => api<TabelaPreco>(`/tabelas-preco/${id}`),
    enabled: pode('precos'),
  });

  if (!pode('precos')) return <Alerta>Você não tem permissão para acessar os preços.</Alerta>;
  if (tabela.isError) return <Alerta>{tabela.error.message}</Alerta>;
  if (!tabela.data) return <TextoSuave>Carregando…</TextoSuave>;
  const t = tabela.data;
  const podeAdicionar = pode('precos', 'editar') && t.ativa;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          podeAdicionar &&
          !adicionando && (
            <Botao onClick={() => setAdicionando(true)}>
              <Plus className="mr-1.5 size-4" aria-hidden /> Adicionar preço
            </Botao>
          )
        }
      >
        {t.nome}
      </Titulo>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs font-semibold text-texto-suave">{t.codigo}</span>
        <Selo>{t.moeda}</Selo>
        {t.ativa ? <Selo tom="sucesso">Ativa</Selo> : <Selo>Inativa: não recebe preço novo</Selo>}
        {t.descricao && <TextoSuave>{t.descricao}</TextoSuave>}
      </div>

      {adicionando && <NovoPreco tabela={t} aoConcluir={() => setAdicionando(false)} />}

      <LinhasDePreco key={t.id} tabelaPrecoId={t.id} />
    </div>
  );
}
