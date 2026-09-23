import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ErroApi, api } from '../lib/api';
import { reduzirImagem, validarImagem } from '../lib/imagem';
import { chaveSessao } from '../lib/sessao';
import { Avatar } from './Avatar';
import { Alerta, Botao } from './ui';

/** Envio/troca/remoção da foto (opcional) de um usuário. Usado em "Meu perfil" e na edição da Equipe. */
export function FotoUsuario({
  usuarioId,
  nome,
  fotoVersao,
}: {
  usuarioId: string;
  nome: string;
  fotoVersao: string | null;
}) {
  const queryClient = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const atualizar = () => {
    queryClient.invalidateQueries({ queryKey: chaveSessao });
    queryClient.invalidateQueries({ queryKey: ['usuarios'] });
  };

  const enviar = useMutation({
    mutationFn: async (foto: File) => {
      const reduzida = await reduzirImagem(foto);
      const res = await fetch(`/api/fotos/usuario/${usuarioId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': reduzida.type },
        body: reduzida,
      });
      if (!res.ok)
        throw new ErroApi(res.status, (await res.json().catch(() => ({}))).erro ?? 'Não foi possível enviar a foto');
    },
    onSuccess: atualizar,
    onError: (e) => setErro(e.message),
  });
  const remover = useMutation({
    mutationFn: () => api(`/fotos/usuario/${usuarioId}`, { method: 'DELETE' }),
    onSuccess: atualizar,
    onError: (e) => setErro(e.message),
  });

  function escolher(foto: File | undefined) {
    setErro(null);
    if (!foto) return;
    const problema = validarImagem(foto);
    if (problema) return setErro(problema);
    enviar.mutate(foto);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar nome={nome} usuarioId={usuarioId} fotoVersao={fotoVersao} tamanho="lg" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={arquivo}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              escolher(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Botao
            type="button"
            variante="secundario"
            disabled={enviar.isPending}
            onClick={() => arquivo.current?.click()}
          >
            {enviar.isPending ? 'Enviando…' : fotoVersao ? 'Trocar foto' : 'Adicionar foto'}
          </Botao>
          {fotoVersao && (
            <Botao
              type="button"
              variante="secundario"
              disabled={remover.isPending}
              onClick={() => confirm('Remover a foto?') && remover.mutate()}
            >
              Remover
            </Botao>
          )}
        </div>
      </div>
      <p className="text-xs text-texto-suave">
        Opcional. PNG, JPEG ou WebP; a imagem é reduzida automaticamente antes do envio.
      </p>
      <Alerta>{erro}</Alerta>
    </div>
  );
}
