-- Estatística por consulta (docs/performance/DATABASE.md §Observabilidade). O servidor precisa carregar a
-- biblioteca (shared_preload_libraries = pg_stat_statements, no docker-compose.yml); sem ela a extensão é criada,
-- mas a view não pode ser lida.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
