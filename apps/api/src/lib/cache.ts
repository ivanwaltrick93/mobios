import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { env } from '../env.js';

// Cache de leitura no Redis (docs/decisoes/0001-redis-cache-de-leitura.md). O PostgreSQL é a fonte da verdade:
// o cache só acelera leituras que toleram alguns segundos de atraso, e a API funciona sem ele. Nenhuma rota usa o
// cliente Redis direto: tudo passa por aqui (chaves, prazos, falhas e logs num lugar só).

/** Prazos em segundos, por dado em cache. Novo dado em cache: novo prazo aqui (e na tabela do ADR). */
export const PRAZOS_CACHE = {
  painel: env.CACHE_TTL_PAINEL_S,
} as const;

// Tempos curtos: um Redis lento não pode atrasar a resposta mais do que o Postgres levaria.
const TEMPO_CONEXAO_MS = 100;
const TEMPO_COMANDO_MS = 50;
// Falha do Redis vai para o log no máximo uma vez a cada 30 s (com o Redis fora, toda requisição falharia).
const INTERVALO_AVISO_MS = 30_000;

let cliente: Redis | null = null;
let ultimoAviso = 0;

function avisarFalha(log: FastifyBaseLogger, erro: unknown, operacao: string) {
  const agora = Date.now();
  if (agora - ultimoAviso < INTERVALO_AVISO_MS) return;
  ultimoAviso = agora;
  log.warn({ err: erro, cache: 'erro', operacao }, 'Cache indisponível: lendo direto do banco');
}

/**
 * Conecta ao Redis na subida da API (sem REDIS_URL, o cache fica desligado) e desconecta ao fechar. Sem fila de
 * comandos: com o Redis fora do ar, a leitura falha na hora e cai no Postgres; a reconexão segue em segundo plano.
 */
export function registrarCache(app: FastifyInstance) {
  if (!env.REDIS_URL) {
    app.log.info('Cache desligado (REDIS_URL vazio): leituras direto do banco');
    return;
  }
  const redis = new Redis(env.REDIS_URL, {
    connectTimeout: TEMPO_CONEXAO_MS,
    commandTimeout: TEMPO_COMANDO_MS,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: (tentativas) => Math.min(tentativas * 200, 5_000),
  });
  redis.on('error', (erro) => avisarFalha(app.log, erro, 'conexao'));
  cliente = redis;
  app.addHook('onClose', async () => {
    cliente = null;
    redis.disconnect();
  });
}

/** Chave de um dado da oficina: sempre com o tenant, que vem da sessão (nunca de parâmetro da requisição). */
export const chaveDaOficina = (tenantId: string, recurso: string, ...partes: string[]) =>
  ['mobios', env.NODE_ENV, 't', tenantId, recurso, ...partes].join(':');

/** Resumo curto e determinístico de um valor (ex.: o perfil de acesso), para compor a chave. */
export function resumoParaChave(valor: unknown): string {
  const ordenado = JSON.stringify(valor, (_chave, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
  return createHash('sha256').update(ordenado).digest('base64url').slice(0, 16);
}

/** Prazo com variação de ±10%: chaves gravadas juntas não expiram juntas. */
const comVariacao = (segundos: number) => Math.max(1, Math.round(segundos * (0.9 + Math.random() * 0.2)));

/**
 * Cache-aside: devolve o valor guardado ou, na falta (ou com o Redis indisponível), `carregar()` do banco e guarda
 * para as próximas leituras. Prazo 0 ou cache desligado: só carrega. Chame DEPOIS da autenticação e da checagem de
 * acesso, e fora do withTenant (não segure conexão do Postgres esperando o Redis). O valor precisa sobreviver a
 * JSON (sem Date nem Map).
 */
export async function obterOuCarregar<T>(
  chave: string,
  prazoSegundos: number,
  carregar: () => Promise<T>,
  log: FastifyBaseLogger,
): Promise<T> {
  const redis = cliente;
  if (!redis || prazoSegundos <= 0) return carregar();
  const inicio = performance.now();
  let guardado: string | null;
  try {
    guardado = await redis.get(chave);
  } catch (erro) {
    avisarFalha(log, erro, 'leitura');
    return carregar();
  }
  const ms = Math.round((performance.now() - inicio) * 10) / 10;
  if (guardado !== null) {
    log.debug({ cache: 'acerto', chave, ms }, 'Cache: acerto');
    return JSON.parse(guardado) as T;
  }
  log.debug({ cache: 'falta', chave, ms }, 'Cache: falta');
  const valor = await carregar();
  // Sem esperar a gravação: a resposta não depende dela, e uma falha só significa outra leitura do banco depois.
  redis
    .set(chave, JSON.stringify(valor), 'EX', comVariacao(prazoSegundos))
    .then(() => log.debug({ cache: 'gravado', chave }, 'Cache: gravado'))
    .catch((erro: unknown) => avisarFalha(log, erro, 'gravacao'));
  return valor;
}
