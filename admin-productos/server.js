const { createApp } = require("./src/app");
const { resolve } = require("node:path");
const { app, db } = createApp({
  database: process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH)
    : undefined,
  secureCookies: process.env.SECURE_COOKIES === "true",
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`Inventario disponible en http://${host}:${port}`),
);
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
