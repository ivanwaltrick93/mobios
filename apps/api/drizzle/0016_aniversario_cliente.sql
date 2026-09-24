-- Dias até o próximo aniversário (0 = hoje), a partir da data "hoje" informada pela API (dia de Brasília).
-- Quem nasceu em 29/02 é lembrado em 28/02 nos anos não bissextos. NULL sem data de nascimento (STRICT).
CREATE FUNCTION dias_ate_aniversario(nascimento date, hoje date) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT min(aniversario - hoje)
  FROM (
    SELECT make_date(
      ano,
      extract(month FROM nascimento)::int,
      least(
        extract(day FROM nascimento)::int,
        extract(day FROM make_date(ano, extract(month FROM nascimento)::int, 1) + interval '1 month - 1 day')::int
      )
    ) AS aniversario
    FROM (VALUES (extract(year FROM hoje)::int), (extract(year FROM hoje)::int + 1)) AS anos(ano)
  ) AS proximos
  WHERE aniversario >= hoje
$$;
