const { DatabaseSync, backup } = require("node:sqlite");
const { mkdirSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");
async function main() {
  const source = process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH)
    : join(__dirname, "../data/inventario.sqlite");
  if (!existsSync(source))
    throw new Error(
      "Primero inicia la aplicación para crear la base de datos.",
    );
  const directory = join(__dirname, "../backups");
  mkdirSync(directory, { recursive: true });
  const target = join(
    directory,
    `inventario-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
  );
  const db = new DatabaseSync(source);
  try {
    await backup(db, target);
    console.log(`Respaldo creado: ${target}`);
  } finally {
    db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
