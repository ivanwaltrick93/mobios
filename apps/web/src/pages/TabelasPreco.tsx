import { COLUNAS_IMPORTACAO_PRECOS, mascaraCodigo, MOEDAS, type TabelaPreco } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus, Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ImportarCsv } from '../components/ImportarCsv';
import {
  Alerta,
  Botao,
  BotaoLink,
  Cabecalho,
  Campo,
  Cartao,
  Input,
  Linha,
  Paginacao,
  POR_PAGINA,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useTabelasPreco } from '../lib/materiais';
import { usePode } from '../lib/sessao';

/**
 * Aba "Tabelas de preço" da Política Comercial: lista analítica das tabelas (Varejo, Oficina...),
 * importação de preços por planilha e acesso ao detalhe de cada tabela (onde se cadastram os preços).
 * As tabelas são poucas e a lista completa também alimenta os seletores, por isso a paginação é na tela.
 */
export function TabelasPreco() {
  const pode = usePode();
  const editar = pode('precos', 'editar');
  const tabelas = useTabelasPreco(pode('precos'));
  const [edicao, setEdicao] = useState<TabelaPreco | 'nova' | null>(null);
  const [importando, setImportando] = useState(false);
  const [pagina, setPagina] = useState(1);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ t, tipo }: { t: TabelaPreco; tipo: 'status' | 'excluir' | 'padrao' }) =>
      tipo === 'excluir'
        ? api(`/tabelas-preco/${t.id}`, { method: 'DELETE' })
        : tipo === 'padrao'
          ? api(`/tabelas-preco/${t.id}/padrao`, { method: 'PATCH' })
          : api(`/tabelas-preco/${t.id}/status`, { method: 'PATCH', body: { ativo: !t.ativa } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] }),
  });
  const todas = tabelas.data ?? [];
  const daPagina = todas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  if (!pode('precos')) return <Alerta>Você não tem permissão para acessar os preços.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo
        acao={
          editar &&
          !edicao && (
            <div className="flex flex-wrap gap-2">
              <Botao variante="secundario" onClick={() => setImportando(!importando)}>
                <FileUp className="mr-1.5 size-4" aria-hidden /> Importar preços
              </Botao>
              <Botao onClick={() => setEdicao('nova')}>
                <Plus className="mr-1.5 size-4" aria-hidden /> Nova tabela
              </Botao>
            </div>
          )
        }
      >
        Tabelas de Preço
      </Titulo>
      <TextoSuave>
        Abra uma tabela para ver e cadastrar os preços dela (com vigência ou padrão). Para muitos preços de uma vez, use
        a importação por planilha. A tabela padrão é a que o orçamento usa quando nenhuma outra é escolhida.
      </TextoSuave>

      {importando && (
        <ImportarCsv
          titulo="Importar preços"
          colunas={COLUNAS_IMPORTACAO_PRECOS}
          url="/precos/importar"
          nomeModelo="modelo-precos.csv"
          aoConcluir={() => {
            queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] });
            queryClient.invalidateQueries({ queryKey: ['linhas-preco'] });
            queryClient.invalidateQueries({ queryKey: ['precos'] });
          }}
          aoFechar={() => setImportando(false)}
        />
      )}
      {edicao === 'nova' && (
        <Cartao className="p-5">
          <EditorTabela aoConcluir={() => setEdicao(null)} />
        </Cartao>
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>

      {tabelas.data?.length === 0 && !edicao ? (
        <Vazio icone={<Tag />} titulo="Nenhuma tabela de preço cadastrada">
          Crie ao menos uma (ex.: Varejo) para começar a precificar os produtos.
        </Vazio>
      ) : (
        <Tabela>
          <Cabecalho>
            <Th>Código</Th>
            <Th>Nome</Th>
            <Th>Descrição</Th>
            <Th>Moeda</Th>
            <Th className="text-right">Produtos com preço hoje</Th>
            <Th>Status</Th>
            {editar && <Th />}
          </Cabecalho>
          <tbody>
            {daPagina.map((t) =>
              edicao !== 'nova' && edicao?.id === t.id ? (
                <tr key={t.id}>
                  <td colSpan={7} className="p-4">
                    <EditorTabela tabela={t} aoConcluir={() => setEdicao(null)} />
                  </td>
                </tr>
              ) : (
                <Linha key={t.id} className="hover:bg-superficie-alt">
                  <Td className="whitespace-nowrap font-mono text-xs font-semibold">{t.codigo}</Td>
                  <Td>
                    <Link to={`/tabelas-preco/${t.id}`} className="font-medium text-texto hover:text-primaria">
                      {t.nome}
                    </Link>
                  </Td>
                  <Td suave>{t.descricao ?? '—'}</Td>
                  <Td suave>{t.moeda}</Td>
                  <Td className="text-right font-semibold">{t.materiaisComPreco.toLocaleString('pt-BR')}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {t.ativa ? <Selo tom="sucesso">Ativa</Selo> : <Selo>Inativa</Selo>}
                      {t.padrao && <Selo tom="primario">Padrão</Selo>}
                    </span>
                  </Td>
                  {editar && (
                    <Td className="whitespace-nowrap text-right">
                      {!edicao && (
                        <span className="flex justify-end gap-3">
                          <BotaoLink onClick={() => setEdicao(t)}>Editar</BotaoLink>
                          {/* A padrão não é inativada nem excluída: antes, outra vira a padrão. */}
                          {!t.padrao && t.ativa && (
                            <BotaoLink onClick={() => acao.mutate({ t, tipo: 'padrao' })}>Tornar padrão</BotaoLink>
                          )}
                          {!t.padrao && (
                            <>
                              <BotaoLink onClick={() => acao.mutate({ t, tipo: 'status' })}>
                                {t.ativa ? 'Inativar' : 'Reativar'}
                              </BotaoLink>
                              <BotaoLink
                                perigo
                                onClick={() =>
                                  confirm(`Excluir a tabela ${t.nome}?`) && acao.mutate({ t, tipo: 'excluir' })
                                }
                              >
                                Excluir
                              </BotaoLink>
                            </>
                          )}
                        </span>
                      )}
                    </Td>
                  )}
                </Linha>
              ),
            )}
          </tbody>
        </Tabela>
      )}
      {tabelas.data && <Paginacao pagina={pagina} total={todas.length} aoMudar={setPagina} />}
    </div>
  );
}

function EditorTabela({ tabela, aoConcluir }: { tabela?: TabelaPreco; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const [dados, setDados] = useState({
    codigo: tabela?.codigo ?? '',
    nome: tabela?.nome ?? '',
    descricao: tabela?.descricao ?? '',
    moeda: tabela?.moeda ?? 'BRL',
  });
  const salvar = useMutation({
    mutationFn: () =>
      api(tabela ? `/tabelas-preco/${tabela.id}` : '/tabelas-preco', {
        method: tabela ? 'PUT' : 'POST',
        body: { ...dados, versao: tabela?.versao },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] });
      aoConcluir();
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    salvar.mutate();
  };
  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <Campo rotulo="Código *">
          <Input
            autoFocus
            placeholder="VAREJO"
            value={dados.codigo}
            onChange={(e) => setDados({ ...dados, codigo: mascaraCodigo(e.target.value) })}
          />
        </Campo>
        <div className="md:col-span-2">
          <Campo rotulo="Nome *">
            <Input value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          </Campo>
        </div>
        <Campo rotulo="Moeda">
          <Select value={dados.moeda} onChange={(e) => setDados({ ...dados, moeda: e.target.value as 'BRL' })}>
            {Object.entries(MOEDAS).map(([codigo, nome]) => (
              <option key={codigo} value={codigo}>
                {nome}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="md:col-span-4">
          <Campo rotulo="Descrição">
            <Input value={dados.descricao} onChange={(e) => setDados({ ...dados, descricao: e.target.value })} />
          </Campo>
        </div>
      </div>
      <Alerta>{salvar.isError && salvar.error.message}</Alerta>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvar.isPending}>
          {tabela ? 'Salvar' : 'Cadastrar tabela'}
        </Botao>
        <Botao type="button" variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
