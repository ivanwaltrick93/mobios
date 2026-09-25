import { COLUNAS_IMPORTACAO_LINHAS_PRECO } from '@mobios/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ImportarCsv } from '../components/ImportarCsv';
import { LinhasDePreco } from '../components/LinhasDePreco';
import { NovoPreco } from '../components/NovoPreco';
import { Alerta, Botao, classesBotao, Select, Titulo, Vazio } from '../components/ui';
import { useTabelasPreco } from '../lib/materiais';
import { usePode } from '../lib/sessao';

const CHAVE_TABELA = 'mobios.listaPrecos.tabela';

/** Última tabela escolhida (conveniência do atendente; se o navegador bloquear, usa a primeira ativa). */
const lerTabelaSalva = () => {
  try {
    return localStorage.getItem(CHAVE_TABELA) ?? '';
  } catch {
    return '';
  }
};

/** Linhas de Preço (Política Comercial): consulta rápida no atendimento, uma tabela por vez, e importação. */
export function ListaPrecos() {
  const pode = usePode();
  const tabelas = useTabelasPreco(pode('precos'));
  const ativas = tabelas.data?.filter((t) => t.ativa) ?? [];
  const [tabelaId, setTabelaId] = useState(lerTabelaSalva);
  const tabela = ativas.find((t) => t.id === tabelaId) ?? ativas[0];
  const [painel, setPainel] = useState<'cadastro' | 'importacao' | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tabela) return;
    try {
      localStorage.setItem(CHAVE_TABELA, tabela.id);
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  }, [tabela]);

  if (!pode('precos')) return <Alerta>Você não tem permissão para acessar os preços.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          pode('precos', 'editar') &&
          tabela && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setPainel(painel === 'importacao' ? null : 'importacao')}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar planilha
              </Botao>
              <Botao onClick={() => setPainel(painel === 'cadastro' ? null : 'cadastro')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Cadastrar preço
              </Botao>
            </div>
          )
        }
      >
        Linhas de Preço
      </Titulo>

      {painel === 'cadastro' && tabela && (
        <NovoPreco
          tabela={tabela}
          tabelas={ativas}
          aoConcluir={(salvoEm) => {
            setPainel(null);
            // A lista passa a mostrar a tabela em que o preço foi salvo.
            if (salvoEm) setTabelaId(salvoEm);
          }}
        />
      )}
      {painel === 'importacao' && tabela && (
        <ImportarCsv
          titulo={`Importar linhas de preço — ${tabela.nome}`}
          colunas={COLUNAS_IMPORTACAO_LINHAS_PRECO}
          url={`/precos/importar?tabelaPrecoId=${tabela.id}`}
          nomeModelo="modelo-linhas-de-preco.csv"
          aoConcluir={() => {
            queryClient.invalidateQueries({ queryKey: ['linhas-preco'] });
            queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] });
            queryClient.invalidateQueries({ queryKey: ['precos'] });
          }}
          aoFechar={() => setPainel(null)}
        />
      )}

      {tabelas.data && ativas.length === 0 ? (
        <Vazio
          icone={<Tag />}
          titulo="Nenhuma tabela de preço ativa"
          acao={
            pode('precos', 'editar') && (
              <Link to="/tabelas-preco" className={classesBotao('primario')}>
                Cadastrar tabela de preço
              </Link>
            )
          }
        />
      ) : (
        tabela && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                aria-label="Tabela de preço"
                className="md:w-72"
                value={tabela.id}
                onChange={(e) => setTabelaId(e.target.value)}
              >
                {ativas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </Select>
            </div>
            <LinhasDePreco key={tabela.id} tabelaPrecoId={tabela.id} autoFocus />
          </>
        )
      )}
    </div>
  );
}
