import { FotoUsuario } from '../components/FotoUsuario';
import { Cartao, Selo, TextoSuave, Titulo } from '../components/ui';
import { useSessao } from '../lib/sessao';

/** Dados do próprio usuário. A foto pode ser trocada aqui; o restante é mantido pelo Administrador. */
export function Perfil() {
  const { data } = useSessao();
  if (!data) return null;
  const { usuario } = data;
  return (
    <div className="space-y-6">
      <Titulo>Meu perfil</Titulo>
      <Cartao className="space-y-6 p-6">
        <FotoUsuario usuarioId={usuario.id} nome={usuario.nome} fotoVersao={usuario.fotoVersao} />
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-texto-suave">Nome</dt>
            <dd className="font-medium">{usuario.nome}</dd>
          </div>
          <div>
            <dt className="text-sm text-texto-suave">E-mail (login)</dt>
            <dd className="font-medium">{usuario.email}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="mb-1 text-sm text-texto-suave">Funções</dt>
            <dd className="flex flex-wrap gap-1">
              {usuario.funcoes.map((f) => (
                <Selo key={f.id} tom="primario">
                  {f.nome}
                </Selo>
              ))}
            </dd>
          </div>
        </dl>
        <TextoSuave>Para mudar nome, e-mail ou funções, fale com o Administrador.</TextoSuave>
      </Cartao>
    </div>
  );
}
