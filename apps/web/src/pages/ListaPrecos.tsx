import { Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AbasPrecos } from '../components/AbasPrecos';
import { ListaDePrecos } from '../components/ListaDePrecos';
import { Alerta, classesBotao, Select, TextoSuave, Titulo, Vazio } from '../components/ui';
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

/** Aba "Lista de preços" da Política Comercial: consulta rápida no atendimento, uma tabela por vez. */
export function ListaPrecos() {
  const pode = usePode();
  const tabelas = useTabelasPreco(pode('precos'));
  const ativas = tabelas.data?.filter((t) => t.ativa) ?? [];
  const [tabelaId, setTabelaId] = useState(lerTabelaSalva);
  const tabela = ativas.find((t) => t.id === tabelaId) ?? ativas[0];

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
      <Titulo>Política Comercial</Titulo>
      <AbasPrecos />

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
              {pode('estoque') && <TextoSuave className="text-xs">Disponível somado de todos os depósitos.</TextoSuave>}
            </div>
            <ListaDePrecos key={tabela.id} tabelaPrecoId={tabela.id} autoFocus />
          </>
        )
      )}
    </div>
  );
}
