declare module "better-sqlite3" {
  interface Statement<T = unknown> {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
  }

  class Database {
    constructor(filename: string);
    exec(sql: string): this;
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }

  export default Database;
}
