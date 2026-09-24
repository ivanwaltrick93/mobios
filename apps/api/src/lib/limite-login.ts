import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { loginTentativas } from '../db/schema.js';
import { ErroHttp } from './erros.js';

/**
 * Limite de tentativas de login (PLT-08), contado no banco para valer com várias réplicas da API.
 * Falhas contam por e-mail (protege uma conta) e por IP (protege contra testar muitos e-mails).
 * Ao atingir o limite dentro da janela, a chave fica bloqueada por um tempo; nunca para sempre.
 */
const JANELA_MINUTOS = 15;
const BLOQUEIO_MINUTOS = 15;
const LIMITE = { email: 5, ip: 20 } as const;

type Origem = { email: string; ip: string };

const hash = (texto: string) => createHash('sha256').update(texto).digest('hex');
const chaveEmail = (email: string) => hash(`email:${email.toLowerCase()}`);
const chaveIp = (ip: string) => hash(`ip:${ip}`);

/** Recusa (429) enquanto o e-mail ou o IP estiver bloqueado. Chamar antes de conferir a senha. */
export async function exigirLoginLiberado({ email, ip }: Origem) {
  const [bloqueio] = await db
    .select({ ate: loginTentativas.bloqueadoAte })
    .from(loginTentativas)
    .where(
      and(
        inArray(loginTentativas.chave, [chaveEmail(email), chaveIp(ip)]),
        gt(loginTentativas.bloqueadoAte, sql`now()`),
      ),
    )
    .orderBy(desc(loginTentativas.bloqueadoAte))
    .limit(1);
  if (!bloqueio?.ate) return;
  const minutos = Math.max(1, Math.ceil((bloqueio.ate.getTime() - Date.now()) / 60_000));
  throw new ErroHttp(429, `Muitas tentativas de login. Tente novamente em ${minutos} minuto(s).`);
}

/**
 * Conta uma falha para o e-mail e para o IP. Um único UPSERT por chave: seguro com requisições
 * simultâneas. Fora da janela, a contagem recomeça.
 */
export async function registrarFalhaDeLogin({ email, ip }: Origem) {
  const janela = sql`${JANELA_MINUTOS} * interval '1 minute'`;
  const bloqueio = sql`now() + ${BLOQUEIO_MINUTOS} * interval '1 minute'`;
  for (const [chave, limite] of [
    [chaveEmail(email), LIMITE.email],
    [chaveIp(ip), LIMITE.ip],
  ] as const) {
    await db.execute(sql`
      insert into login_tentativas as t (chave, falhas, janela_inicio, bloqueado_ate, atualizado_em)
      values (${chave}, 1, now(), case when 1 >= ${limite} then ${bloqueio} end, now())
      on conflict (chave) do update set
        falhas = case when t.janela_inicio > now() - ${janela} then t.falhas + 1 else 1 end,
        janela_inicio = case when t.janela_inicio > now() - ${janela} then t.janela_inicio else now() end,
        bloqueado_ate = case
          when (case when t.janela_inicio > now() - ${janela} then t.falhas + 1 else 1 end) >= ${limite}
            then ${bloqueio}
          else t.bloqueado_ate
        end,
        atualizado_em = now()`);
  }
  // Limpeza das chaves paradas há mais de um dia (sem tarefa agendada na API).
  await db.execute(sql`delete from login_tentativas where atualizado_em < now() - interval '1 day'`);
}

/** Login certo zera a contagem do e-mail. A do IP continua: acertar uma conta não libera testar outras. */
export async function limparFalhasDeLogin({ email }: Pick<Origem, 'email'>) {
  await db.delete(loginTentativas).where(eq(loginTentativas.chave, chaveEmail(email)));
}
