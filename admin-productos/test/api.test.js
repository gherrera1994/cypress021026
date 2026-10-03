const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createApp } = require("../src/app");
const credentials = {
  nombre: "Admin de pruebas",
  usuario: "admin",
  password: "Pruebas-seguras-2026",
};
const product = {
  nombre: "Webcam",
  sku: "WEB-002",
  categoria: "Video",
  precio: 250.25,
  stock: 8,
};
async function fixture(t, options = {}) {
  const { app, db } = createApp({ database: ":memory:", ...options });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = "GET", body, cookie = "", extra = {}) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Inventario",
        Cookie: cookie,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    return {
      status: response.status,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  }
  async function setup() {
    const result = await request("/setup", "POST", credentials);
    assert.equal(result.status, 201);
    return result.cookie;
  }
  return { db, request, setup, base };
}
test("configuración única, contraseña protegida y cookies seguras", async (t) => {
  const { request, db, setup } = await fixture(t);
  assert.equal((await request("/setup")).data.required, true);
  const cookie = await setup();
  assert.equal((await request("/setup")).data.required, false);
  assert.equal((await request("/setup", "POST", credentials)).status, 409);
  assert.equal(
    (await request("/auth/me", "GET", undefined, cookie)).data.user.role,
    "admin",
  );
  assert.notEqual(
    db.prepare("SELECT password FROM users").get().password,
    credentials.password,
  );
  const login = await request("/auth/login", "POST", credentials);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(JSON.stringify(login.data).includes("password"), false);
});
test("rechaza acceso anónimo, credenciales incorrectas y solicitudes externas", async (t) => {
  const { request, setup } = await fixture(t);
  const cookie = await setup();
  for (const path of ["/products", "/users", "/activity"])
    assert.equal((await request(path)).status, 401);
  assert.equal(
    (
      await request("/auth/login", "POST", {
        ...credentials,
        password: "incorrecta",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/products", "POST", product, cookie, {
        "X-Requested-With": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/products", "POST", product, cookie, {
        Origin: "https://example.org",
      })
    ).status,
    403,
  );
});
test("CRUD, unicidad y control de cambios concurrentes", async (t) => {
  const { request, setup } = await fixture(t);
  const cookie = await setup();
  const created = await request("/products", "POST", product, cookie);
  assert.equal(created.status, 201);
  const p = created.data.product;
  assert.equal(
    (await request("/products", "POST", product, cookie)).status,
    409,
  );
  const update = await request(
    `/products/${p.id}`,
    "PUT",
    { ...p, stock: 4 },
    cookie,
  );
  assert.equal(update.status, 200);
  assert.equal(update.data.product.version, 2);
  assert.equal(
    (await request(`/products/${p.id}`, "PUT", p, cookie)).status,
    409,
  );
  assert.equal(
    (await request(`/products/${p.id}`, "DELETE", { version: 1 }, cookie))
      .status,
    409,
  );
  assert.equal(
    (await request(`/products/${p.id}`, "DELETE", { version: 2 }, cookie))
      .status,
    204,
  );
  assert.equal(
    (await request(`/products/${p.id}`, "PUT", p, cookie)).status,
    404,
  );
  assert.equal(
    (await request("/activity", "GET", undefined, cookie)).data.activity[0]
      .action,
    "Producto eliminado",
  );
});
test("el servidor valida tipos, límites y centavos sin depender del navegador", async (t) => {
  const { request, setup } = await fixture(t);
  const cookie = await setup();
  for (const changes of [
    { nombre: "" },
    { sku: "a b" },
    { categoria: "" },
    { precio: 0 },
    { precio: -2 },
    { precio: 1.234 },
    { precio: "12" },
    { precio: null },
    { precio: 10000001 },
    { stock: "" },
    { stock: -1 },
    { stock: 1.5 },
    { stock: 1000001 },
  ]) {
    assert.equal(
      (await request("/products", "POST", { ...product, ...changes }, cookie))
        .status,
      400,
      JSON.stringify(changes),
    );
  }
  assert.equal(
    (
      await request(
        "/products",
        "POST",
        { ...product, precio: 0.29, stock: 0 },
        cookie,
      )
    ).status,
    201,
  );
});
test("roles reales, desactivación y protección de la cuenta administradora", async (t) => {
  const { request, setup } = await fixture(t);
  const adminCookie = await setup();
  const user = { ...credentials, usuario: "editor", role: "editor" };
  const created = await request("/users", "POST", user, adminCookie);
  assert.equal(created.status, 201);
  const editorCookie = (await request("/auth/login", "POST", user)).cookie;
  assert.equal(
    (await request("/products", "POST", product, editorCookie)).status,
    201,
  );
  assert.equal(
    (await request("/users", "GET", undefined, editorCookie)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/users",
        "POST",
        { ...user, usuario: "intruso" },
        editorCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/users/1",
        "PATCH",
        { role: "editor", active: false },
        adminCookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        `/users/${created.data.user.id}`,
        "PATCH",
        { role: "editor", active: false },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/products", "GET", undefined, editorCookie)).status,
    401,
  );
  assert.equal((await request("/auth/login", "POST", user)).status, 401);
});
test("cambiar contraseña revoca otras sesiones y logout invalida el token", async (t) => {
  const { request, setup } = await fixture(t);
  const cookie = await setup();
  const other = (await request("/auth/login", "POST", credentials)).cookie;
  const change = await request(
    "/auth/password",
    "POST",
    { current: credentials.password, password: "Nueva-clave-segura-2026" },
    cookie,
  );
  assert.equal(change.status, 200);
  assert.equal(
    (await request("/auth/me", "GET", undefined, other)).status,
    401,
  );
  assert.equal((await request("/auth/login", "POST", credentials)).status, 401);
  assert.equal(
    (await request("/auth/logout", "POST", {}, change.cookie)).status,
    204,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, change.cookie)).status,
    401,
  );
});
test("las sesiones vencidas no permiten acceso", async (t) => {
  const { request, setup, db } = await fixture(t);
  const cookie = await setup();
  db.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1000);
  assert.equal(
    (await request("/products", "GET", undefined, cookie)).status,
    401,
  );
});
test("límite de intentos de acceso", async (t) => {
  const { request } = await fixture(t, { loginLimit: 2 });
  await request("/auth/login", "POST", credentials);
  await request("/auth/login", "POST", credentials);
  const result = await request("/auth/login", "POST", credentials);
  assert.equal(result.status, 429);
  assert.ok(Number(result.headers.get("retry-after")) > 0);
});
test("la configuración inicial es atómica con solicitudes simultáneas", async (t) => {
  const { request, db } = await fixture(t);
  const results = await Promise.all([
    request("/setup", "POST", credentials),
    request("/setup", "POST", { ...credentials, usuario: "otra" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 1);
});
test("productos persisten al volver a abrir SQLite sin reponer eliminados", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nexo-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, "test.sqlite");
  const first = createApp({ database });
  first.db.prepare("UPDATE products SET stock=77 WHERE sku='TEC-001'").run();
  first.db.exec("DELETE FROM products WHERE id=2");
  first.db.close();
  const second = createApp({ database });
  assert.equal(
    second.db.prepare("SELECT stock FROM products WHERE sku='TEC-001'").get()
      .stock,
    77,
  );
  assert.equal(
    second.db.prepare("SELECT count(*) AS n FROM products").get().n,
    3,
  );
  second.db.close();
});
