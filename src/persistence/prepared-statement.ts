import type { DatabaseSync, StatementSync } from 'node:sqlite';

const maximumStatements = 128;
const connections = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/** For synchronous get/all/run calls only: do not retain iterators or change statement options. */
export function preparedStatement(database: DatabaseSync, sql: string): Pick<StatementSync, 'get' | 'all' | 'run'> {
  let cache = connections.get(database);
  if (!cache) {
    cache = new Map();
    connections.set(database, cache);
  }
  let statement = cache.get(sql);
  if (statement) {
    cache.delete(sql);
  } else {
    statement = database.prepare(sql);
    if (cache.size >= maximumStatements) cache.delete(cache.keys().next().value!);
  }
  cache.set(sql, statement);
  return statement;
}
