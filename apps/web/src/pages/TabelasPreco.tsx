import { mascaraCodigo, MOEDAS, type TabelaPreco } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AbasPrecos } from '../components/AbasPrecos';
import {
  Alerta,
  Botao,
  BotaoLink,
  Campo,
  Cartao,
  Input,
  Select,
  Selo,
  TextoSuave,
  Titulo,
  Vazio,
} from '../components/ui';
import { api } from '../lib/api';
import { useTabelasPreco } from '../lib/materiais';
import { usePode } from '../lib/sessao';

/** Tabelas de preço (Varejo, Oficina, Atacado...). Os preços por material ficam na aba Preços de cada material. */
export function TabelasPreco() {
  const pode = usePode();
  const editar = pode('precos', 'editar');
  const tabelas = useTabelasPreco(pode('precos'));
  const [edicao, setEdicao] = useState<TabelaPreco | 'nova' | null>(null);
  const queryClient = useQueryClient();
  const acao = useMutation({
    mutationFn: ({ t, tipo }: { t: TabelaPreco; tipo: 'status' | 'excluir' }) =>
      tipo === 'excluir'
        ? api(`/tabelas-preco/${t.id}`, { method: 'DELETE' })
        : api(`/tabelas-preco/${t.id}/status`, { method: 'PATCH', body: { ativo: !t.ativa } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tabelas-preco'] }),
  });

  if (!pode('precos')) return <Alerta>Você não tem permissão para acessar os preços.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo acao={editar && !edicao && <Botao onClick={() => setEdicao('nova')}>Nova tabela</Botao>}>
        Lista de preços
      </Titulo>
      <AbasPrecos />
      <TextoSuave>
        Cada material pode ter um preço por tabela, com vigências. Informe os preços na aba Preços de cada material.
      </TextoSuave>
      {edicao === 'nova' && (
        <Cartao>
          <EditorTabela aoConcluir={() => setEdicao(null)} />
        </Cartao>
      )}
      <Alerta>{acao.isError && acao.error.message}</Alerta>
      {tabelas.data?.length === 0 && !edicao ? (
        <Vazio icone={<Tag />} titulo="Nenhuma tabela de preço cadastrada">
          Crie ao menos uma (ex.: Varejo) para começar a precificar os materiais.
        </Vazio>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tabelas.data?.map((t) =>
            edicao !== 'nova' && edicao?.id === t.id ? (
              <Cartao key={t.id} className="p-5 md:col-span-2 xl:col-span-3">
                <EditorTabela tabela={t} aoConcluir={() => setEdicao(null)} />
              </Cartao>
            ) : (
              <Cartao key={t.id} className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-semibold text-texto-suave">{t.codigo}</span>
                    <h3 className="font-semibold text-texto">{t.nome}</h3>
                  </div>
                  <span className="flex gap-1">
                    <Selo>{t.moeda}</Selo>
                    {!t.ativa && <Selo>Inativa</Selo>}
                  </span>
                </div>
                {t.descricao && <TextoSuave>{t.descricao}</TextoSuave>}
                <p className="text-sm">
                  <span className="text-2xl font-semibold">{t.materiaisComPreco.toLocaleString('pt-BR')}</span>{' '}
                  <span className="text-texto-suave">material(is) com preço vigente hoje</span>
                </p>
                {editar && !edicao && (
                  <div className="mt-auto flex gap-4 border-t border-borda pt-3 text-sm">
                    <BotaoLink onClick={() => setEdicao(t)}>Editar</BotaoLink>
                    <BotaoLink onClick={() => acao.mutate({ t, tipo: 'status' })}>
                      {t.ativa ? 'Inativar' : 'Reativar'}
                    </BotaoLink>
                    <BotaoLink
                      perigo
                      className="ml-auto"
                      onClick={() => confirm(`Excluir a tabela ${t.nome}?`) && acao.mutate({ t, tipo: 'excluir' })}
                    >
                      Excluir
                    </BotaoLink>
                  </div>
                )}
              </Cartao>
            ),
          )}
        </div>
      )}
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
