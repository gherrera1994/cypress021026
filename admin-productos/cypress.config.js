const { defineConfig } = require("cypress");
const { createApp } = require("./src/app");
module.exports = defineConfig({
  viewportWidth: 1440,
  viewportHeight: 1000,
  video: true,
  e2e: {
    async setupNodeEvents(on, config) {
      // This server and reset task exist only inside Cypress, never on the real app.
      const { app, db } = createApp({ database: ":memory:", loginLimit: 1000 });
      const seeds = db.prepare("SELECT * FROM products ORDER BY id").all();
      const server = await new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => resolve(server));
        server.on("error", reject);
      });
      config.baseUrl = `http://127.0.0.1:${server.address().port}`;
      on("before:browser:launch", (browser, launchOptions) => {
        if (browser.name === "electron") {
          launchOptions.preferences.width = 1600;
          launchOptions.preferences.height = 1100;
        }
        return launchOptions;
      });
      on("task", {
        resetDatabase() {
          db.exec(
            "DELETE FROM sessions; DELETE FROM users; DELETE FROM activity; DELETE FROM products;",
          );
          const insert = db.prepare(
            "INSERT INTO products(id,nombre,sku,categoria,cents,stock) VALUES (?,?,?,?,?,?)",
          );
          seeds.forEach((p) =>
            insert.run(p.id, p.nombre, p.sku, p.categoria, p.cents, p.stock),
          );
          return null;
        },
      });
      on("after:run", () => {
        if (!config.isInteractive)
          return new Promise((resolve) =>
            server.close(() => {
              db.close();
              resolve();
            }),
          );
      });
      return config;
    },
  },
});
