const express = require("express");
const helmet = require("helmet");
const {
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} = require("node:crypto");
const { promisify } = require("node:util");
const { join } = require("node:path");
const { openDatabase } = require("./database");
const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const SESSION_MS = 8 * 60 * 60 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt, 64)).toString("hex")}`;
}
async function checkPassword(password, encoded) {
  const [salt, hash] = encoded.split(":");
  const candidate = await derive(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}
function passwordInput(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw fail(400, "La contraseña debe tener entre 12 y 128 caracteres.");
  return value;
}
function textInput(value, label, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw fail(400, `${label}: completa entre 1 y ${max} caracteres.`);
  return value.trim();
}
function userInput(body) {
  const nombre = textInput(body.nombre, "Nombre", 80);
  const usuario = textInput(body.usuario, "Usuario", 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario))
    throw fail(
      400,
      "El usuario debe tener de 3 a 40 letras, números, puntos, guiones o guiones bajos.",
    );
  return { nombre, usuario };
}
function productInput(body) {
  const nombre = textInput(body.nombre, "Nombre");
  const sku = textInput(body.sku, "Código", 30).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(sku))
    throw fail(400, "El código solo admite letras, números y guiones.");
  const categoria = textInput(body.categoria, "Categoría", 50);
  if (
    typeof body.precio !== "number" ||
    !Number.isFinite(body.precio) ||
    body.precio <= 0 ||
    body.precio > 10000000 ||
    Math.abs(body.precio * 100 - Math.round(body.precio * 100)) > 0.00001
  )
    throw fail(
      400,
      "El precio debe ser mayor que 0, con un máximo de dos decimales y Q10,000,000.",
    );
  if (
    !Number.isSafeInteger(body.stock) ||
    body.stock < 0 ||
    body.stock > 1000000
  )
    throw fail(400, "El stock debe ser un entero de 0 a 1,000,000.");
  return {
    nombre,
    sku,
    categoria,
    cents: Math.round(body.precio * 100),
    stock: body.stock,
  };
}
const safeUser = (u) => ({
  id: u.id,
  nombre: u.nombre,
  usuario: u.usuario,
  role: u.role,
  active: Boolean(u.active),
});
const product = (p) => ({
  id: p.id,
  nombre: p.nombre,
  sku: p.sku,
  categoria: p.categoria,
  precio: p.cents / 100,
  stock: p.stock,
  version: p.version,
  updated_at: p.updated_at,
});

function createApp({
  database = join(__dirname, "../data/inventario.sqlite"),
  secureCookies = false,
  loginLimit = 15,
} = {}) {
  const db = openDatabase(database);
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      strictTransportSecurity: secureCookies ? undefined : false,
      contentSecurityPolicy: {
        directives: { "upgrade-insecure-requests": secureCookies ? [] : null },
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      if (
        req.get("X-Requested-With") !== "Inventario" ||
        !req.is("application/json")
      )
        return res.status(403).json({ error: "Solicitud no autorizada." });
      if (req.get("sec-fetch-site") === "cross-site")
        return res.status(403).json({ error: "Origen no autorizado." });
      if (req.get("origin")) {
        try {
          if (new URL(req.get("origin")).host !== req.get("host"))
            throw new Error();
        } catch {
          return res.status(403).json({ error: "Origen no autorizado." });
        }
      }
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  const log = (actor, action, detail) =>
    db
      .prepare("INSERT INTO activity(actor,action,detail) VALUES (?,?,?)")
      .run(actor, action, detail);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookies,
    path: "/",
    maxAge: SESSION_MS,
  };
  const tokenFrom = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("inventario_session="))
      ?.slice(19) || "";
  function session(req, res, user) {
    db.prepare("DELETE FROM sessions WHERE expires <= ? OR token = ?").run(
      Date.now(),
      digest(tokenFrom(req)),
    );
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      digest(token),
      user.id,
      Date.now() + SESSION_MS,
    );
    res.cookie("inventario_session", token, cookieOptions);
    return safeUser(user);
  }
  function auth(req, res, next) {
    const user = db
      .prepare(
        "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.active=1",
      )
      .get(digest(tokenFrom(req)), Date.now());
    if (!user)
      return res.status(401).json({ error: "Inicia sesión para continuar." });
    req.user = user;
    next();
  }
  function admin(req, res, next) {
    if (req.user.role !== "admin")
      return res
        .status(403)
        .json({ error: "Esta acción requiere un administrador." });
    next();
  }
  const attempts = new Map();
  function limit(req, res, next) {
    const now = Date.now();
    for (const [key, item] of attempts)
      if (item.until <= now) attempts.delete(key);
    const key = req.ip;
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    item.count++;
    attempts.set(key, item);
    if (item.count > loginLimit) {
      res.set("Retry-After", String(Math.ceil((item.until - now) / 1000)));
      return res.status(429).json({
        error: "Demasiados intentos. Intenta de nuevo en 15 minutos.",
      });
    }
    next();
  }
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/setup", (req, res) =>
    res.json({ required: !db.prepare("SELECT id FROM users LIMIT 1").get() }),
  );
  app.post("/api/setup", limit, async (req, res) => {
    if (db.prepare("SELECT id FROM users LIMIT 1").get())
      throw fail(409, "El administrador inicial ya fue creado.");
    const { nombre, usuario } = userInput(req.body);
    const password = await hashPassword(passwordInput(req.body.password));
    // The guard and insert are in the same transaction, including concurrent setup requests.
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        throw fail(409, "El administrador inicial ya fue creado.");
      const result = db
        .prepare(
          "INSERT INTO users(nombre,usuario,password,role) VALUES (?,?,?,'admin')",
        )
        .run(nombre, usuario, password);
      log(usuario, "Configuración", "Creó la cuenta administradora inicial");
      db.exec("COMMIT");
      res.status(201).json({
        user: session(
          req,
          res,
          db
            .prepare("SELECT * FROM users WHERE id=?")
            .get(result.lastInsertRowid),
        ),
      });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  });
  app.post("/api/auth/login", limit, async (req, res) => {
    const usuario =
      typeof req.body.usuario === "string"
        ? req.body.usuario.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (password.length > 128) throw fail(400, "Credenciales no válidas.");
    const user = db.prepare("SELECT * FROM users WHERE usuario=?").get(usuario);
    const fallback = `${"0".repeat(32)}:${"0".repeat(128)}`;
    const valid = await checkPassword(password, user?.password || fallback);
    if (!valid || !user?.active)
      throw fail(401, "Usuario o contraseña incorrectos.");
    res.json({ user: session(req, res, user) });
  });
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(
      digest(tokenFrom(req)),
    );
    res.clearCookie("inventario_session", {
      ...cookieOptions,
      maxAge: undefined,
    });
    res.status(204).end();
  });
  app.get("/api/auth/me", auth, (req, res) =>
    res.json({ user: safeUser(req.user) }),
  );
  app.post("/api/auth/password", auth, limit, async (req, res) => {
    if (
      typeof req.body.current !== "string" ||
      req.body.current.length > 128 ||
      !(await checkPassword(req.body.current, req.user.password))
    )
      throw fail(400, "La contraseña actual es incorrecta.");
    const password = await hashPassword(passwordInput(req.body.password));
    db.prepare("UPDATE users SET password=? WHERE id=?").run(
      password,
      req.user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
    log(req.user.usuario, "Seguridad", "Actualizó su contraseña");
    res.json({ user: session(req, res, req.user) });
  });
  app.get("/api/products", auth, (req, res) =>
    res.json({
      products: db
        .prepare("SELECT * FROM products ORDER BY id DESC")
        .all()
        .map(product),
    }),
  );
  app.post("/api/products", auth, (req, res) => {
    const p = productInput(req.body);
    const result = db
      .prepare(
        "INSERT INTO products(nombre,sku,categoria,cents,stock) VALUES (?,?,?,?,?)",
      )
      .run(p.nombre, p.sku, p.categoria, p.cents, p.stock);
    log(req.user.usuario, "Producto creado", p.nombre);
    res.status(201).json({
      product: product(
        db
          .prepare("SELECT * FROM products WHERE id=?")
          .get(result.lastInsertRowid),
      ),
    });
  });
  app.put("/api/products/:id", auth, (req, res) => {
    const p = productInput(req.body);
    const existing = db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(req.params.id);
    if (!existing)
      throw fail(404, "El producto ya no existe. Actualiza el catálogo.");
    if (req.body.version !== existing.version)
      throw fail(
        409,
        "Otra persona modificó este producto. Actualiza el catálogo y vuelve a editarlo.",
      );
    db.prepare(
      "UPDATE products SET nombre=?,sku=?,categoria=?,cents=?,stock=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(p.nombre, p.sku, p.categoria, p.cents, p.stock, existing.id);
    log(req.user.usuario, "Producto actualizado", p.nombre);
    res.json({
      product: product(
        db.prepare("SELECT * FROM products WHERE id=?").get(existing.id),
      ),
    });
  });
  app.delete("/api/products/:id", auth, (req, res) => {
    const p = db
      .prepare("SELECT * FROM products WHERE id=?")
      .get(req.params.id);
    if (!p) throw fail(404, "El producto ya no existe.");
    if (req.body.version !== p.version)
      throw fail(
        409,
        "El producto cambió. Actualiza el catálogo antes de eliminarlo.",
      );
    db.prepare("DELETE FROM products WHERE id=?").run(p.id);
    log(req.user.usuario, "Producto eliminado", p.nombre);
    res.status(204).end();
  });
  app.get("/api/activity", auth, (req, res) =>
    res.json({
      activity: db
        .prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 100")
        .all(),
    }),
  );
  app.get("/api/users", auth, admin, (req, res) =>
    res.json({
      users: db.prepare("SELECT * FROM users ORDER BY id").all().map(safeUser),
    }),
  );
  app.post("/api/users", auth, admin, async (req, res) => {
    const u = userInput(req.body);
    if (!["admin", "editor"].includes(req.body.role))
      throw fail(400, "Selecciona un rol válido.");
    const hash = await hashPassword(passwordInput(req.body.password));
    const result = db
      .prepare(
        "INSERT INTO users(nombre,usuario,password,role) VALUES (?,?,?,?)",
      )
      .run(u.nombre, u.usuario, hash, req.body.role);
    log(req.user.usuario, "Usuario creado", u.usuario);
    res.status(201).json({
      user: safeUser(
        db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(result.lastInsertRowid),
      ),
    });
  });
  app.patch("/api/users/:id", auth, admin, (req, res) => {
    const user = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(req.params.id);
    if (!user) throw fail(404, "El usuario no existe.");
    if (user.id === req.user.id)
      throw fail(400, "No puedes cambiar el rol o estado de tu propia cuenta.");
    if (
      !["admin", "editor"].includes(req.body.role) ||
      typeof req.body.active !== "boolean"
    )
      throw fail(400, "Rol o estado inválido.");
    db.prepare("UPDATE users SET role=?,active=? WHERE id=?").run(
      req.body.role,
      Number(req.body.active),
      user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    log(req.user.usuario, "Usuario actualizado", user.usuario);
    res.json({
      user: safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(user.id)),
    });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "La ruta no existe." }),
  );
  app.use(
    express.static(join(__dirname, "../public"), { etag: false, maxAge: 0 }),
  );
  app.use((error, req, res, next) => {
    if (
      error.code?.startsWith("ERR_SQLITE") &&
      error.message.includes("UNIQUE")
    )
      return res.status(409).json({
        error: "Ese código de producto o nombre de usuario ya existe.",
      });
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({
      error:
        status >= 500
          ? "No se pudo completar la operación. Intenta de nuevo."
          : status === 400 && error.type === "entity.parse.failed"
            ? "El formato de la solicitud no es válido."
            : error.message,
    });
  });
  return { app, db };
}
module.exports = { createApp };
