import { LOGO_TAMANHO_MAXIMO, LOGO_TIPOS, TEMA_VAZIO, temaInputSchema, type CampoTema, type Tema } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alerta, Botao, BotaoLink, Campo, Cartao, Input, Selo, TextoSuave, Titulo } from '../components/ui';
import { api, ErroApi } from '../lib/api';
import { chaveSessao, useSessao } from '../lib/sessao';
import { aplicarTema, contraste, CONTRASTE_MINIMO, resolverTema, urlLogo } from '../lib/tema';

const hexValido = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

type SeletorProps = {
  rotulo: string;
  dica: string;
  valor: string | null;
  /** Cor em uso quando o campo está vazio (padrão ou contraste automático). */
  efetivo: string;
  rotuloVazio: string;
  aoMudar: (v: string | null) => void;
};

function SeletorCor({ rotulo, dica, valor, efetivo, rotuloVazio, aoMudar }: SeletorProps) {
  const [texto, setTexto] = useState(valor ?? efetivo);
  useEffect(() => setTexto(valor ?? efetivo), [valor, efetivo]);

  return (
    <Campo rotulo={rotulo} dica={dica} erro={hexValido(texto) ? undefined : { message: 'Use o formato #RRGGBB' }}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={rotulo}
          className="h-10 w-14 cursor-pointer rounded-md border border-borda-forte bg-superficie p-1"
          value={valor ?? efetivo}
          onChange={(e) => aoMudar(e.target.value)}
        />
        <Input
          className="w-32 font-mono uppercase"
          value={texto}
          maxLength={7}
          onChange={(e) => {
            setTexto(e.target.value);
            if (hexValido(e.target.value)) aoMudar(e.target.value.toLowerCase());
          }}
        />
        {valor ? (
          <BotaoLink type="button" onClick={() => aoMudar(null)}>
            Voltar para {rotuloVazio.toLowerCase()}
          </BotaoLink>
        ) : (
          <Selo>{rotuloVazio}</Selo>
        )}
      </div>
    </Campo>
  );
}

type Grupo = { titulo: string; descricao: string; campos: { campo: CampoTema; rotulo: string; dica: string; texto?: boolean }[] };

const grupos: Grupo[] = [
  {
    titulo: 'Cores gerais',
    descricao: 'Destaques da interface e menu lateral.',
    campos: [
      { campo: 'corPrimaria', rotulo: 'Cor principal', dica: 'Links, destaques, ícones e item ativo do menu.' },
      { campo: 'corMenu', rotulo: 'Fundo do menu lateral', dica: 'O texto do menu se ajusta sozinho.' },
    ],
  },
  {
    titulo: 'Botão principal',
    descricao: 'Ações de confirmação: Salvar, Entrar, Cadastrar, Enviar.',
    campos: [
      { campo: 'corBotaoPrimario', rotulo: 'Fundo', dica: 'Padrão: a cor principal.' },
      { campo: 'corBotaoPrimarioTexto', rotulo: 'Texto', dica: 'Cor da escrita do botão.', texto: true },
    ],
  },
  {
    titulo: 'Botão secundário',
    descricao: 'Ações de saída: Cancelar, Voltar, Descartar.',
    campos: [
      { campo: 'corBotaoSecundario', rotulo: 'Fundo', dica: 'A borda acompanha a cor do texto.' },
      { campo: 'corBotaoSecundarioTexto', rotulo: 'Texto', dica: 'Cor da escrita do botão.', texto: true },
    ],
  },
];

/** Combinações que ficaram com pouco contraste (WCAG AA), para avisar antes de salvar. */
function avisosDeContraste(cores: ReturnType<typeof resolverTema>): string[] {
  const avisos: string[] = [];
  const baixo = (a: string, b: string) => contraste(a, b) < CONTRASTE_MINIMO;
  if (baixo(cores['--cor-botao-primario'], cores['--cor-botao-primario-texto'])) avisos.push('O texto do botão principal está difícil de ler sobre o fundo escolhido.');
  if (baixo(cores['--cor-botao-secundario'], cores['--cor-botao-secundario-texto'])) avisos.push('O texto do botão secundário está difícil de ler sobre o fundo escolhido.');
  if (contraste(cores['--cor-primaria'], '#ffffff') < 3) avisos.push('A cor principal está clara demais: links e destaques podem sumir sobre o fundo branco.');
  return avisos;
}

export function Configuracoes() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const salvo = sessao.data?.oficina.tema ?? TEMA_VAZIO;
  const [tema, setTema] = useState<Tema>(salvo);
  const alterado = JSON.stringify(tema) !== JSON.stringify(salvo);
  const efetivo = resolverTema(tema);
  const avisos = avisosDeContraste(efetivo);

  // Prévia ao vivo na interface inteira; ao sair sem salvar, volta ao tema salvo.
  useEffect(() => aplicarTema(tema), [tema]);
  useEffect(() => () => aplicarTema(queryClient.getQueryData<{ oficina: { tema: Tema } }>(chaveSessao)?.oficina.tema ?? salvo), []); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation({
    mutationFn: () => api<Tema>('/configuracoes/aparencia', { method: 'PUT', body: temaInputSchema.parse(tema) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveSessao }),
  });

  if (sessao.data?.usuario.papel !== 'admin') return <Alerta>Apenas administradores podem alterar as configurações.</Alerta>;
  const { oficina } = sessao.data;

  // Cor que o campo usa quando está vazio: padrão do style guide ou contraste automático.
  const tokenDoCampo: Record<CampoTema, keyof typeof efetivo> = {
    corPrimaria: '--cor-primaria',
    corMenu: '--cor-menu',
    corBotaoPrimario: '--cor-botao-primario',
    corBotaoPrimarioTexto: '--cor-botao-primario-texto',
    corBotaoSecundario: '--cor-botao-secundario',
    corBotaoSecundarioTexto: '--cor-botao-secundario-texto',
  };

  return (
    <div className="space-y-6">
      <Titulo>Configurações</Titulo>

      <LogoOficina versao={oficina.logoVersao} nome={oficina.nome} />

      <Cartao>
        <h2 className="text-lg font-medium">Aparência</h2>
        <TextoSuave className="mb-6">
          Style guide da oficina, aplicado a toda a equipe e também à tela de login. As mudanças aparecem na hora como prévia e só valem para todos depois de salvar.
        </TextoSuave>

        <div className="space-y-8">
          {grupos.map((g) => (
            <fieldset key={g.titulo}>
              <legend className="font-medium">{g.titulo}</legend>
              <TextoSuave className="mb-4">{g.descricao}</TextoSuave>
              <div className="grid gap-6 md:grid-cols-2">
                {g.campos.map(({ campo, rotulo, dica, texto }) => (
                  <SeletorCor
                    key={campo}
                    rotulo={rotulo}
                    dica={dica}
                    valor={tema[campo]}
                    efetivo={efetivo[tokenDoCampo[campo]]}
                    rotuloVazio={texto ? 'Automático' : 'Padrão'}
                    aoMudar={(valor) => setTema((t) => ({ ...t, [campo]: valor }))}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-8 grid gap-4 rounded-md border border-borda bg-fundo p-4 md:grid-cols-2">
          <div>
            <TextoSuave className="mb-3 text-xs uppercase tracking-wide">Prévia da interface</TextoSuave>
            <div className="flex flex-wrap items-center gap-3">
              <Botao type="button">Salvar</Botao>
              <Botao type="button" variante="secundario">
                Cancelar
              </Botao>
              <BotaoLink type="button">Link</BotaoLink>
              <Selo tom="primario">Destaque</Selo>
              <span className="rounded-md bg-menu px-3 py-2 text-sm text-menu-texto">Menu</span>
            </div>
          </div>
          <div>
            <TextoSuave className="mb-3 text-xs uppercase tracking-wide">Prévia do login</TextoSuave>
            <div className="mx-auto max-w-56 rounded-lg border border-borda bg-superficie p-4 text-center shadow-sm">
              {oficina.logoVersao ? (
                <img src={urlLogo(oficina.logoVersao)} alt="" className="mx-auto mb-1 max-h-10 object-contain" />
              ) : (
                <div className="font-bold text-primaria">MobiOS</div>
              )}
              <div className="mb-3 text-xs text-texto-suave">{oficina.nome}</div>
              <div className="mb-2 h-6 rounded border border-borda-forte" />
              <div className="rounded bg-botao-primario py-1 text-xs font-medium text-botao-primario-texto">Entrar</div>
            </div>
          </div>
        </div>

        {avisos.length > 0 && (
          <ul className="mt-4 space-y-1">
            {avisos.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm text-alerta">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> {a}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 space-y-3">
          <Alerta>{salvar.isError && (salvar.error instanceof ErroApi ? salvar.error.message : 'Erro ao salvar.')}</Alerta>
          {salvar.isSuccess && !alterado && <p className="text-sm text-sucesso">Aparência salva.</p>}
          <div className="flex flex-wrap gap-2">
            <Botao disabled={!alterado || salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar aparência'}
            </Botao>
            <Botao variante="secundario" disabled={!alterado} onClick={() => setTema(salvo)}>
              Descartar alterações
            </Botao>
            <Botao variante="secundario" onClick={() => setTema(TEMA_VAZIO)}>
              Restaurar style guide padrão
            </Botao>
          </div>
        </div>
      </Cartao>
    </div>
  );
}

function LogoOficina({ versao, nome }: { versao: string | null; nome: string }) {
  const queryClient = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useMutation({
    mutationFn: async (logo: File) => {
      const res = await fetch('/api/configuracoes/logo', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': logo.type }, body: logo });
      if (!res.ok) throw new ErroApi(res.status, (await res.json().catch(() => ({}))).erro ?? 'Não foi possível enviar o logo');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveSessao }),
    onError: (e) => setErro(e.message),
  });
  const remover = useMutation({
    mutationFn: () => api('/configuracoes/logo', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveSessao }),
    onError: (e) => setErro(e.message),
  });

  function escolher(logo: File | undefined) {
    setErro(null);
    if (!logo) return;
    // Checagem rápida no navegador; a API valida de novo pelos bytes do arquivo.
    if (!(LOGO_TIPOS as readonly string[]).includes(logo.type)) return setErro('Formato não suportado. Use PNG, JPEG ou WebP.');
    if (logo.size > LOGO_TAMANHO_MAXIMO) return setErro('Arquivo grande demais. O limite é 1 MB.');
    enviar.mutate(logo);
  }

  return (
    <Cartao>
      <h2 className="text-lg font-medium">Logo da oficina</h2>
      <TextoSuave className="mb-6">Aparece no menu lateral para toda a equipe. PNG, JPEG ou WebP, até 1 MB. Fundo transparente fica melhor.</TextoSuave>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex h-24 w-48 items-center justify-center rounded-md border border-dashed border-borda-forte bg-menu p-3">
          {versao ? (
            <img src={urlLogo(versao)} alt={`Logo de ${nome}`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-sm text-menu-texto opacity-75">Sem logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={arquivo} type="file" accept={LOGO_TIPOS.join(',')} className="hidden" onChange={(e) => (escolher(e.target.files?.[0]), (e.target.value = ''))} />
          <Botao disabled={enviar.isPending} onClick={() => arquivo.current?.click()}>
            {enviar.isPending ? 'Enviando…' : versao ? 'Trocar logo' : 'Enviar logo'}
          </Botao>
          {versao && (
            <Botao variante="secundario" disabled={remover.isPending} onClick={() => confirm('Remover o logo da oficina?') && remover.mutate()}>
              Remover
            </Botao>
          )}
        </div>
      </div>
      <div className="mt-4">
        <Alerta>{erro}</Alerta>
      </div>
    </Cartao>
  );
}
