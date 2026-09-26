import { describe, expect, it } from 'vitest';
import { formatarNumeroOs, osAtrasada } from './ordensServico.js';

describe('O.S.: número e atraso', () => {
  it('número com 6 dígitos', () => {
    expect(formatarNumeroOs(123)).toBe('OS-000123');
  });

  it('atrasada: em aberto com a previsão vencida; sem previsão, concluída ou cancelada, não', () => {
    const agora = new Date('2026-09-26T12:00:00-03:00');
    expect(osAtrasada('em_execucao', '2026-09-26T11:59:00-03:00', agora)).toBe(true);
    expect(osAtrasada('em_execucao', '2026-09-26T12:00:00-03:00', agora)).toBe(false);
    expect(osAtrasada('aberta', null, agora)).toBe(false);
    expect(osAtrasada('concluida', '2026-09-01T10:00:00-03:00', agora)).toBe(false);
    expect(osAtrasada('cancelada', '2026-09-01T10:00:00-03:00', agora)).toBe(false);
  });
});
