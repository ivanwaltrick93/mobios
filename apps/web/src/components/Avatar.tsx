const tamanhos = { sm: 'size-8 text-xs', md: 'size-10 text-sm', perfil: 'size-16 text-xl', lg: 'size-24 text-2xl' } as const;

export const urlFotoUsuario = (usuarioId: string, versao: string) => `/api/fotos/usuario/${usuarioId}?v=${versao}`;

/** Iniciais do primeiro e do último nome ("Maria da Silva" → "MS"). */
export function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Foto do usuário em círculo; sem foto, as iniciais na cor principal do tema. */
export function Avatar({ nome, usuarioId, fotoVersao, tamanho = 'md' }: { nome: string; usuarioId: string; fotoVersao: string | null; tamanho?: keyof typeof tamanhos }) {
  const classe = `${tamanhos[tamanho]} shrink-0 rounded-full`;
  return fotoVersao ? (
    <img src={urlFotoUsuario(usuarioId, fotoVersao)} alt={`Foto de ${nome}`} className={`${classe} object-cover`} />
  ) : (
    <span aria-hidden className={`${classe} inline-flex items-center justify-center bg-primaria-suave font-semibold text-primaria`}>
      {iniciais(nome)}
    </span>
  );
}

/** Iniciais em círculo, para quem não tem foto no sistema (ex.: clientes). */
export const Iniciais = ({ nome, tamanho = 'md' }: { nome: string; tamanho?: keyof typeof tamanhos }) => (
  <span aria-hidden className={`${tamanhos[tamanho]} inline-flex shrink-0 items-center justify-center rounded-full bg-primaria-suave font-semibold text-primaria`}>
    {iniciais(nome)}
  </span>
);
