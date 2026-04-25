declare module "better-sqlite3" {
  class Database {
    constructor(filename: string);

    exec(sql: string): this;
    close(): void;
  }

  export default Database;
}

