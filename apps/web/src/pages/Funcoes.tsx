import {
  MODULOS,
  nomesNivel,
  PARAMETRO_VENDEDOR,
  SEM_ACESSO,
  type Acessos,
  type Funcao,
  type FuncaoInput,
  type Nivel,
  type ParametroFuncao,
} from '@mobios/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import {
  Alerta,
  Botao,
  BotaoLink,
  Cabecalho,
  Campo,
  Cartao,
  Input,
  Linha,
  Select,
  Selo,
  Tabela,
  Td,
  TextoSuave,
  Th,
  Titulo,
} from '../components/ui';
import { api, ErroApi } from '../lib/api';
import { chaveSessao, useAdmin } from '../lib/sessao';
import { chaveFuncoes } from './Usuarios';

const tomNivel = (n: Nivel | null) => (n === 'editar' ? 'sucesso' : n === 'consultar' ? 'primario' : 'neutro');

const useParametros = () =>
  useQuery({ queryKey: [...chaveFuncoes, 'parametros'], queryFn: () => api<ParametroFuncao[]>('/funcoes/parametros') });

function CelulaNivel({ nivel }: { nivel: Nivel | null }) {
  return <Selo tom={tomNivel(nivel)}>{nomesNivel[nivel ?? 'nenhum']}</Selo>;
}

/** Linha de edição (ou criação) de uma função: nome, descrição, status, parâmetros e nível por módulo. */
function EditorFuncao({ funcao, aoConcluir }: { funcao?: Funcao; aoConcluir: () => void }) {
  const queryClient = useQueryClient();
  const catalogo = useParametros();
  const [nome, setNome] = useState(funcao?.nome ?? '');
  const [descricao, setDescricao] = useState(funcao?.descricao ?? '');
  const [ativa, setAtiva] = useState(funcao?.ativa ?? true);
  const [acessos, setAcessos] = useState<Acessos>(funcao?.acessos ?? SEM_ACESSO);
  const [parametros, setParametros] = useState<string[]>(funcao?.parametros ?? []);
  const perdendoAcesso = !!funcao && funcao.ativa && !ativa && funcao.usuarios > 0;
  const perdendoVendedor =
    !!funcao &&
    funcao.parametros.includes(PARAMETRO_VENDEDOR) &&
    (!ativa || !parametros.includes(PARAMETRO_VENDEDOR)) &&
    funcao.usuarios > 0;

  const salvar = useMutation({
    mutationFn: (dados: FuncaoInput) =>
      api<Funcao>(funcao ? `/funcoes/${funcao.id}` : '/funcoes', { method: funcao ? 'PUT' : 'POST', body: dados }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chaveFuncoes });
      queryClient.invalidateQueries({ queryKey: ['usuarios'] });
      queryClient.invalidateQueries({ queryKey: chaveSessao });
      queryClient.invalidateQueries({ queryKey: ['vendedores'] }); // podem ter sido inativados
      aoConcluir();
    },
  });

  function enviar() {
    if (
      perdendoAcesso &&
      !confirm(
        `${funcao!.usuarios} usuário(s) perderão na hora o acesso que vem da função ${funcao!.nome}. Desativar mesmo assim?`,
      )
    )
      return;
    if (
      perdendoVendedor &&
      !confirm(
        'Os vendedores ligados a usuários que dependem desta função para ser vendedor serão inativados. Continuar?',
      )
    )
      return;
    salvar.mutate({ nome, descricao, ativa, acessos, parametros });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <Campo
            rotulo="Nome da função"
            erro={
              salvar.error instanceof ErroApi && salvar.error.campos?.nome
                ? { message: salvar.error.campos.nome }
                : undefined
            }
          >
            <Input value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Almoxarife" />
          </Campo>
        </div>
        <div className="min-w-64 flex-1">
          <Campo rotulo="Descrição">
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} />
          </Campo>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Função ativa
        </label>
      </div>

      {catalogo.data && catalogo.data.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-texto">Parâmetros</legend>
          {catalogo.data.map((p) => (
            <label key={p.codigo} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={parametros.includes(p.codigo)}
                onChange={(e) =>
                  setParametros((atuais) =>
                    e.target.checked ? [...atuais, p.codigo] : atuais.filter((c) => c !== p.codigo),
                  )
                }
              />
              <span>
                {p.nome} <span className="text-texto-suave">— {p.descricao}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MODULOS.map((m) => (
          <Campo key={m.id} rotulo={m.nome} dica={m.descricao}>
            <Select
              value={acessos[m.id] ?? ''}
              onChange={(e) => setAcessos((a) => ({ ...a, [m.id]: (e.target.value || null) as Nivel | null }))}
            >
              <option value="">{nomesNivel.nenhum}</option>
              {m.niveis.map((n) => (
                <option key={n} value={n}>
                  {nomesNivel[n]}
                </option>
              ))}
            </Select>
          </Campo>
        ))}
      </div>

      {perdendoAcesso && (
        <p className="flex items-center gap-2 text-sm text-alerta">
          <AlertTriangle className="size-4" aria-hidden /> Ao desativar, {funcao!.usuarios} usuário(s) perdem na hora o
          acesso que vem desta função.
        </p>
      )}
      <Alerta>{salvar.isError && (salvar.error instanceof ErroApi ? salvar.error.message : 'Erro ao salvar.')}</Alerta>
      <div className="flex gap-2">
        <Botao disabled={salvar.isPending} onClick={enviar}>
          {salvar.isPending ? 'Salvando…' : funcao ? 'Salvar função' : 'Criar função'}
        </Botao>
        <Botao variante="secundario" onClick={aoConcluir}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}

export function Funcoes() {
  const admin = useAdmin();
  const funcoes = useQuery({ queryKey: chaveFuncoes, queryFn: () => api<Funcao[]>('/funcoes'), enabled: admin });
  const catalogo = useParametros();
  const [editando, setEditando] = useState<string | 'nova' | null>(null);
  const queryClient = useQueryClient();
  const excluir = useMutation({
    mutationFn: (f: Funcao) => api(`/funcoes/${f.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveFuncoes }),
  });

  if (!admin) return <Alerta>Apenas o Administrador pode configurar funções e permissões.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Funções e permissões</Titulo>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <TextoSuave className="max-w-2xl">
          Defina o que cada função pode fazer em cada módulo. Um usuário pode ter várias funções e recebe o maior acesso
          de cada módulo. As mudanças valem na hora, inclusive para quem já está conectado. Usuários, funções e
          configurações são exclusivos do Administrador. Só é possível excluir uma função sem usuários; com usuários,
          desative-a.
        </TextoSuave>
        {editando !== 'nova' && <Botao onClick={() => setEditando('nova')}>Nova função</Botao>}
      </div>

      {editando === 'nova' && (
        <Cartao>
          <h2 className="mb-4 font-medium">Nova função</h2>
          <EditorFuncao aoConcluir={() => setEditando(null)} />
        </Cartao>
      )}

      {funcoes.isError && <Alerta>{funcoes.error.message}</Alerta>}
      <Alerta>{excluir.isError && excluir.error.message}</Alerta>

      <Tabela>
        <Cabecalho>
          <Th>Código</Th>
          <Th>Função</Th>
          {MODULOS.map((m) => (
            <Th key={m.id}>
              {m.nome}
              {!m.disponivel && (
                <span className="ml-1 align-middle">
                  <Selo>em breve</Selo>
                </span>
              )}
            </Th>
          ))}
          <Th>Usuários</Th>
          <Th />
        </Cabecalho>
        <tbody>
          {funcoes.data?.map((f) =>
            editando === f.id ? (
              <Linha key={f.id} className="bg-superficie-alt">
                <Td colSpan={MODULOS.length + 4} className="p-4">
                  <EditorFuncao funcao={f} aoConcluir={() => setEditando(null)} />
                </Td>
              </Linha>
            ) : (
              <Linha key={f.id} className={f.ativa ? '' : 'opacity-60'}>
                <Td className="font-mono text-xs font-semibold">{f.codigo}</Td>
                <Td className="min-w-40">
                  <span className="whitespace-nowrap font-medium">
                    {f.nome} {!f.ativa && <Selo>desativada</Selo>}
                  </span>
                  {f.descricao && <span className="block text-xs text-texto-suave">{f.descricao}</span>}
                  {f.parametros.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {f.parametros.map((codigo) => (
                        <Selo key={codigo} tom="primario">
                          {catalogo.data?.find((p) => p.codigo === codigo)?.nome ?? codigo}
                        </Selo>
                      ))}
                    </span>
                  )}
                </Td>
                {f.admin ? (
                  <Td colSpan={MODULOS.length} suave>
                    Acesso total a todos os módulos, usuários e configurações (fixo)
                  </Td>
                ) : (
                  MODULOS.map((m) => (
                    <Td key={m.id}>
                      <CelulaNivel nivel={f.acessos[m.id]} />
                    </Td>
                  ))
                )}
                <Td suave>{f.usuarios}</Td>
                <Td className="text-right whitespace-nowrap">
                  {!f.admin && (
                    <span className="flex justify-end gap-4">
                      <BotaoLink onClick={() => setEditando(f.id)}>Editar</BotaoLink>
                      {/* Com usuário ligado (ativo ou não), a função só pode ser desativada. */}
                      {f.usuarios === 0 && (
                        <BotaoLink
                          perigo
                          disabled={excluir.isPending}
                          onClick={() => confirm(`Excluir a função ${f.nome}?`) && excluir.mutate(f)}
                        >
                          Excluir
                        </BotaoLink>
                      )}
                    </span>
                  )}
                </Td>
              </Linha>
            ),
          )}
        </tbody>
      </Tabela>
    </div>
  );
}
