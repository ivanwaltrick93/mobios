import { LOGO_TAMANHO_MAXIMO, LOGO_TIPOS, TEMA_PADRAO, temaInputSchema, type Tema } from '@mobios/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alerta, Botao, BotaoLink, Campo, Cartao, Input, Selo, TextoSuave, Titulo } from '../components/ui';
import { api, ErroApi } from '../lib/api';
import { chaveSessao, useSessao } from '../lib/sessao';
import { aplicarTema, urlLogo } from '../lib/tema';

const hexValido = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

function SeletorCor({ rotulo, dica, valor, padrao, aoMudar }: { rotulo: string; dica: string; valor: string | null; padrao: string; aoMudar: (v: string | null) => void }) {
  const [texto, setTexto] = useState(valor ?? padrao);
  useEffect(() => setTexto(valor ?? padrao), [valor, padrao]);

  return (
    <Campo rotulo={rotulo} dica={dica} erro={hexValido(texto) ? undefined : { message: 'Use o formato #RRGGBB' }}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={rotulo}
          className="h-10 w-14 cursor-pointer rounded-md border border-borda-forte bg-superficie p-1"
          value={valor ?? padrao}
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
        {valor && (
          <BotaoLink type="button" onClick={() => aoMudar(null)}>
            Restaurar padrão
          </BotaoLink>
        )}
      </div>
    </Campo>
  );
}

export function Configuracoes() {
  const sessao = useSessao();
  const queryClient = useQueryClient();
  const salvo = sessao.data?.oficina.tema ?? { corPrimaria: null, corMenu: null };
  const [tema, setTema] = useState<Tema>(salvo);
  const alterado = tema.corPrimaria !== salvo.corPrimaria || tema.corMenu !== salvo.corMenu;

  // Prévia ao vivo na interface inteira; ao sair sem salvar, volta ao tema salvo.
  useEffect(() => aplicarTema(tema), [tema]);
  useEffect(() => () => aplicarTema(queryClient.getQueryData<{ oficina: { tema: Tema } }>(chaveSessao)?.oficina.tema ?? salvo), []); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation({
    mutationFn: () => api<Tema>('/configuracoes/aparencia', { method: 'PUT', body: temaInputSchema.parse(tema) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaveSessao }),
  });

  if (sessao.data?.usuario.papel !== 'admin') return <Alerta>Apenas administradores podem alterar as configurações.</Alerta>;

  return (
    <div className="space-y-6">
      <Titulo>Configurações</Titulo>

      <LogoOficina versao={sessao.data.oficina.logoVersao} nome={sessao.data.oficina.nome} />

      <Cartao>
        <h2 className="text-lg font-medium">Aparência</h2>
        <TextoSuave className="mb-6">
          Cores da oficina, aplicadas a todos os usuários. A cor do texto se ajusta sozinha para manter a leitura.
        </TextoSuave>

        <div className="grid gap-6 md:grid-cols-2">
          <SeletorCor
            rotulo="Cor principal"
            dica="Botões, links, destaques e item ativo do menu."
            valor={tema.corPrimaria}
            padrao={TEMA_PADRAO.corPrimaria}
            aoMudar={(corPrimaria) => setTema((t) => ({ ...t, corPrimaria }))}
          />
          <SeletorCor
            rotulo="Cor do menu lateral"
            dica="Fundo do menu à esquerda."
            valor={tema.corMenu}
            padrao={TEMA_PADRAO.corMenu}
            aoMudar={(corMenu) => setTema((t) => ({ ...t, corMenu }))}
          />
        </div>

        <div className="mt-6 rounded-md border border-borda bg-fundo p-4">
          <TextoSuave className="mb-3 text-xs uppercase tracking-wide">Prévia</TextoSuave>
          <div className="flex flex-wrap items-center gap-3">
            <Botao type="button">Botão principal</Botao>
            <Botao type="button" variante="secundario">
              Secundário
            </Botao>
            <BotaoLink type="button">Link</BotaoLink>
            <Selo tom="primario">Destaque</Selo>
            <span className="rounded-md bg-menu px-3 py-2 text-sm text-menu-texto">Menu</span>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <Alerta>{salvar.isError && (salvar.error instanceof ErroApi ? salvar.error.message : 'Erro ao salvar.')}</Alerta>
          {salvar.isSuccess && !alterado && <p className="text-sm text-sucesso">Aparência salva.</p>}
          <div className="flex gap-2">
            <Botao disabled={!alterado || salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar aparência'}
            </Botao>
            <Botao variante="secundario" disabled={!alterado} onClick={() => setTema(salvo)}>
              Descartar
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
