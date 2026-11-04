// Reads an offline SQLite (.db) backup in the browser and turns it into the
// same archive the server's /backup/import accepts, so a desktop database can
// be loaded into a hosted copy without the server ever touching a file.
export async function dbFileToArchive(file) {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js/dist/sql-wasm.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let db;
  try {
    db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const names = db
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]
      ?.values.flat();
    if (!names?.includes('products')) throw new Error('missing products');
    const tables = {};
    for (const name of names) {
      const res = db.exec(`SELECT * FROM "${name}"`)[0];
      tables[name] = res ? res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]]))) : [];
    }
    return { app: 'Aqua Home Appliance Business Manager', tables };
  } catch {
    throw new Error('That file is not an Aqua Home Appliance database. Pick the .db backup downloaded from the desktop app.');
  } finally {
    db?.close();
  }
}
