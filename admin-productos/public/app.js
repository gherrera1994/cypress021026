"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  setup: false,
  products: [],
  editing: null,
  deleting: null,
  page: 1,
  view: "catalogo",
  loading: false,
};
const money = (value) =>
  `Q${value.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const normalize = (s) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const show = (id, visible = true) => $(id).classList.toggle("oculto", !visible);
function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function button(text, className, action) {
  const element = node("button", text, className);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  show("toast");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show("toast", false), 4500);
}
function globalError(error) {
  $("global-error").textContent = error.message;
  show("global-error");
}
async function api(path, { method = "GET", body, quiet = false } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Inventario",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    $("connection-label").textContent = "Sin conexión";
    throw new Error(
      "No se pudo conectar. Comprueba que el servidor esté iniciado y vuelve a intentar.",
    );
  }
  $("connection-label").textContent = "Conectado";
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.user && !quiet) {
      resetSession();
      $("login-msg").textContent =
        "Tu sesión terminó. Vuelve a iniciar sesión.";
    }
    const error = new Error(data.error || "No se pudo completar la operación.");
    error.status = response.status;
    throw error;
  }
  return data;
}
async function busy(form, messageId, action) {
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  $(messageId).textContent = "";
  try {
    await action();
  } catch (error) {
    $(messageId).textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}
function setupUI(required) {
  state.setup = required;
  $("auth-title").textContent = required
    ? "Crea tu espacio de trabajo"
    : "Iniciar sesión";
  $("auth-description").textContent = required
    ? "Empieza creando tu cuenta administradora."
    : "Entra a tu espacio de trabajo.";
  $("btn-login").textContent = required
    ? "Crear cuenta y comenzar →"
    : "Entrar a mi inventario →";
  $("clave").autocomplete = required ? "new-password" : "current-password";
  show("setup-name", required);
  show("password-hint", required);
}
function resetSession() {
  state.user = null;
  state.products = [];
  state.editing = null;
  state.deleting = null;
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  document.querySelectorAll("form").forEach((f) => f.reset());
  $("search").value = "";
  $("filter-stock").value = "";
  $("filter-category").value = "";
  state.page = 1;
  $("tabla-productos").querySelector("tbody").replaceChildren();
  $("tabla-usuarios").querySelector("tbody").replaceChildren();
  $("activity-list").replaceChildren();
  show("global-error", false);
  show("admin", false);
  show("login");
  setupUI(false);
}
async function enter(user) {
  state.user = user;
  $("clave").value = "";
  $("profile-name").textContent = user.nombre;
  $("profile-role").textContent =
    user.role === "admin" ? "Administrador" : "Editor";
  $("avatar").textContent = user.nombre.slice(0, 2).toUpperCase();
  show("nav-users", user.role === "admin");
  show("login", false);
  show("admin");
  await switchView("catalogo");
}
async function loadProducts() {
  if (state.loading) return;
  state.loading = true;
  $("btn-refresh").disabled = true;
  try {
    const { products } = await api("/products");
    if (!state.user) return;
    state.products = products;
    render();
    show("global-error", false);
    $("last-sync").textContent =
      `Actualizado a las ${new Date().toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    if (state.user) globalError(error);
  } finally {
    state.loading = false;
    $("btn-refresh").disabled = false;
  }
}
function filteredProducts() {
  const query = normalize($("search").value.trim());
  const category = $("filter-category").value;
  const stock = $("filter-stock").value;
  const list = state.products.filter(
    (p) =>
      (!query || normalize(`${p.nombre} ${p.sku}`).includes(query)) &&
      (!category || p.categoria === category) &&
      (!stock ||
        (stock === "out"
          ? p.stock === 0
          : stock === "low"
            ? p.stock > 0 && p.stock <= 5
            : p.stock > 5)),
  );
  const compare = {
    new: (a, b) => b.id - a.id,
    name: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
    price: (a, b) => a.precio - b.precio,
    stock: (a, b) => a.stock - b.stock,
  };
  return list.sort(compare[$("sort").value]);
}
function render() {
  $("contador-productos").textContent = state.products.length;
  $("stat-units").textContent = state.products
    .reduce((total, p) => total + p.stock, 0)
    .toLocaleString("es-GT");
  $("stat-value").textContent = money(
    state.products.reduce(
      (total, p) => total + Math.round(p.precio * 100) * p.stock,
      0,
    ) / 100,
  );
  $("stat-low").textContent = state.products.filter((p) => p.stock <= 5).length;
  const selected = $("filter-category").value;
  const categories = [...new Set(state.products.map((p) => p.categoria))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  $("filter-category").replaceChildren(
    new Option("Todas las categorías", ""),
    ...categories.map((c) => new Option(c, c)),
  );
  $("filter-category").value = categories.includes(selected) ? selected : "";
  $("categories").replaceChildren(...categories.map((c) => new Option(c, c)));
  const list = filteredProducts();
  const pages = Math.max(1, Math.ceil(list.length / 8));
  state.page = Math.min(state.page, pages);
  const tbody = $("tabla-productos").querySelector("tbody");
  tbody.replaceChildren();
  list.slice((state.page - 1) * 8, state.page * 8).forEach((p) => {
    const tr = node("tr", "", "fila-producto");
    const nameCell = node("td");
    const box = node("div", "", "product-cell");
    const icon = node("span", "▦", "product-icon");
    icon.setAttribute("aria-hidden", "true");
    const names = node("div");
    const name = node("span", p.nombre, "product-name col-nombre");
    name.title = p.nombre;
    names.append(name, node("span", p.sku, "product-sku"));
    box.append(icon, names);
    nameCell.append(box);
    const category = node("td");
    category.append(node("span", p.categoria, "category-chip"));
    const stock = node("td", "", "stock-number");
    stock.append(
      node("span", p.stock.toLocaleString("es-GT")),
      node("small", "uds."),
    );
    const status = node("td");
    status.append(
      node(
        "span",
        p.stock === 0 ? "Agotado" : p.stock <= 5 ? "Stock bajo" : "Disponible",
        `badge ${p.stock === 0 ? "agotado" : p.stock <= 5 ? "low" : ""}`,
      ),
    );
    const actions = node("td");
    const group = node("div", "", "row-actions");
    const edit = button("Editar", "btn-editar", () => openProduct(p));
    edit.setAttribute("aria-label", `Editar ${p.nombre}`);
    const remove = button("Eliminar", "btn-eliminar", () => openDelete(p));
    remove.setAttribute("aria-label", `Eliminar ${p.nombre}`);
    const price = node("td", money(p.precio));
    category.dataset.label = "Categoría";
    price.dataset.label = "Precio";
    stock.dataset.label = "Existencias";
    status.dataset.label = "Estado";
    group.append(edit, remove);
    actions.append(group);
    tr.append(nameCell, category, price, stock, status, actions);
    tbody.append(tr);
  });
  show("empty-state", !list.length);
  const hasFilters = Boolean(
    $("search").value || $("filter-category").value || $("filter-stock").value,
  );
  $("empty-title").textContent = hasFilters
    ? "No encontramos coincidencias"
    : "Todavía no hay productos";
  $("empty-description").textContent = hasFilters
    ? "Prueba con otro nombre, código o filtro."
    : "Agrega el primero para empezar a organizar tu inventario.";
  $("btn-empty").textContent = hasFilters
    ? "Limpiar filtros"
    : "Agregar producto";
  $("results-count").textContent = list.length
    ? `Mostrando ${(state.page - 1) * 8 + 1}–${Math.min(state.page * 8, list.length)} de ${list.length} productos`
    : "0 productos";
  $("page-label").textContent = `${state.page} / ${pages}`;
  $("page-prev").disabled = state.page === 1;
  $("page-next").disabled = state.page === pages;
}
function openProduct(p = null) {
  state.editing = p ? { ...p } : null;
  $("product-form").reset();
  $("form-msg").textContent = "";
  $("product-title").textContent = p ? "Editar producto" : "Nuevo producto";
  $("btn-guardar").textContent = p ? "Actualizar producto" : "Agregar producto";
  if (p)
    for (const key of ["nombre", "sku", "categoria", "precio", "stock"])
      $(key).value = p[key];
  $("product-dialog").showModal();
  $("nombre").focus();
}
function openDelete(p) {
  state.deleting = { ...p };
  $("delete-description").textContent =
    `Vas a eliminar «${p.nombre}» (${p.sku}).`;
  $("delete-msg").textContent = "";
  $("delete-dialog").showModal();
}
async function switchView(view) {
  if (view === "usuarios" && state.user?.role !== "admin") return;
  state.view = view;
  show("global-error", false);
  for (const name of ["catalogo", "actividad", "usuarios"])
    show(`view-${name}`, name === view);
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("breadcrumb-view").textContent = {
    catalogo: "Inventario",
    actividad: "Actividad",
    usuarios: "Equipo",
  }[view];
  try {
    if (view === "catalogo") await loadProducts();
    else if (view === "actividad") await loadActivity();
    else await loadUsers();
  } catch (error) {
    if (state.user) globalError(error);
  }
}
async function loadActivity() {
  const { activity } = await api("/activity");
  const list = $("activity-list");
  list.replaceChildren();
  if (!activity.length) {
    list.append(
      node("p", "Aquí aparecerán las acciones de tu equipo.", "empty-state"),
    );
    return;
  }
  activity.forEach((item) => {
    const row = node("article", "", "activity-item");
    const body = node("div");
    body.append(
      node("h3", item.action),
      node("p", item.detail),
      node("small", `Por ${item.actor}`),
    );
    const time = node(
      "time",
      new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString(
        "es-GT",
        { dateStyle: "medium", timeStyle: "short" },
      ),
    );
    row.append(node("span", "↗", "activity-icon"), body, time);
    list.append(row);
  });
}
async function updateUser(user, changes) {
  try {
    await api(`/users/${user.id}`, {
      method: "PATCH",
      body: { role: user.role, active: user.active, ...changes },
    });
    await loadUsers();
    toast("Permisos actualizados. Se cerraron las sesiones de esa persona.");
  } catch (error) {
    globalError(error);
    await loadUsers().catch(() => {});
  }
}
async function loadUsers() {
  const { users } = await api("/users");
  const tbody = $("tabla-usuarios").querySelector("tbody");
  tbody.replaceChildren();
  users.forEach((user) => {
    const tr = node("tr");
    const name = node("td", user.nombre);
    const role = node("td");
    const select = node("select", "", "user-role-select");
    select.append(
      new Option("Editor", "editor"),
      new Option("Administrador", "admin"),
    );
    select.value = user.role;
    select.disabled = user.id === state.user.id;
    select.setAttribute("aria-label", `Rol de ${user.nombre}`);
    select.addEventListener("change", () =>
      updateUser(user, { role: select.value }),
    );
    role.append(select);
    const status = node("td");
    status.append(
      node(
        "span",
        user.active ? "Activo" : "Inactivo",
        `badge ${user.active ? "" : "inactive"}`,
      ),
    );
    const action = node("td");
    const change = button(
      user.active ? "Desactivar" : "Activar",
      "user-action",
      () => updateUser(user, { active: !user.active }),
    );
    change.disabled = user.id === state.user.id;
    action.append(
      user.id === state.user.id ? node("span", "Tu cuenta", "muted") : change,
    );
    tr.append(name, node("td", user.usuario), role, status, action);
    tbody.append(tr);
  });
}
function exportCSV() {
  const escape = (value) => {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    ["Código", "Nombre", "Categoría", "Precio (Q)", "Stock"],
    ...filteredProducts().map((p) => [
      p.sku,
      p.nombre,
      p.categoria,
      p.precio.toFixed(2),
      p.stock,
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF" + rows.map((r) => r.map(escape).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8;" },
    ),
  );
  const link = node("a");
  link.href = url;
  link.download = `inventario-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Catálogo exportado con los filtros actuales.");
}
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(event.currentTarget, "login-msg", async () => {
    const body = {
      usuario: $("usuario").value.trim(),
      password: $("clave").value,
      nombre: $("admin-nombre").value.trim(),
    };
    if (!body.usuario || !body.password)
      throw new Error("Completa tu usuario y contraseña.");
    const data = await api(state.setup ? "/setup" : "/auth/login", {
      method: "POST",
      body,
      quiet: true,
    });
    setupUI(false);
    await enter(data.user);
  });
});
$("product-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(event.currentTarget, "form-msg", async () => {
    const body = {
      nombre: $("nombre").value.trim(),
      sku: $("sku").value.trim(),
      categoria: $("categoria").value.trim(),
      precio: Number($("precio").value),
      stock: Number($("stock").value),
    };
    if (!body.nombre) throw new Error("El nombre es obligatorio.");
    if (!body.sku || !body.categoria)
      throw new Error("Completa el código y la categoría.");
    if (!$("precio").value || !Number.isFinite(body.precio) || body.precio <= 0)
      throw new Error("El precio debe ser mayor que 0.");
    if (!$("stock").value || !Number.isInteger(body.stock) || body.stock < 0)
      throw new Error(
        "El stock es obligatorio y debe ser un entero de 0 o más.",
      );
    const editing = state.editing;
    if (editing) body.version = editing.version;
    await api(editing ? `/products/${editing.id}` : "/products", {
      method: editing ? "PUT" : "POST",
      body,
    });
    $("product-dialog").close();
    state.editing = null;
    await loadProducts();
    toast(editing ? "Producto actualizado." : "Producto agregado.");
  });
});
$("btn-delete-confirm").addEventListener("click", async () => {
  const btn = $("btn-delete-confirm");
  if (btn.disabled || !state.deleting) return;
  btn.disabled = true;
  try {
    await api(`/products/${state.deleting.id}`, {
      method: "DELETE",
      body: { version: state.deleting.version },
    });
    $("delete-dialog").close();
    state.deleting = null;
    await loadProducts();
    toast("Producto eliminado.");
  } catch (error) {
    $("delete-msg").textContent = error.message;
  } finally {
    btn.disabled = false;
  }
});
$("user-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(event.currentTarget, "user-msg", async () => {
    await api("/users", {
      method: "POST",
      body: {
        nombre: $("user-name").value.trim(),
        usuario: $("user-username").value.trim(),
        password: $("user-password").value,
        role: $("user-role").value,
      },
    });
    $("user-dialog").close();
    $("user-form").reset();
    await loadUsers();
    toast("Usuario creado. Ya puede iniciar sesión.");
  });
});
$("password-form").addEventListener("submit", (event) => {
  event.preventDefault();
  busy(event.currentTarget, "password-msg", async () => {
    await api("/auth/password", {
      method: "POST",
      body: {
        current: $("current-password").value,
        password: $("new-password").value,
      },
    });
    $("password-dialog").close();
    $("password-form").reset();
    toast("Contraseña actualizada.");
  });
});
$("btn-logout").addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST", body: {} });
    resetSession();
  } catch (error) {
    globalError(error);
  }
});
$("btn-new").addEventListener("click", () => openProduct());
$("btn-empty").addEventListener("click", () => {
  if (
    $("search").value ||
    $("filter-category").value ||
    $("filter-stock").value
  ) {
    $("search").value = "";
    $("filter-category").value = "";
    $("filter-stock").value = "";
    render();
  } else openProduct();
});
$("btn-refresh").addEventListener("click", loadProducts);
$("btn-export").addEventListener("click", exportCSV);
$("btn-activity-refresh").addEventListener("click", () =>
  loadActivity().catch(globalError),
);
$("btn-user-new").addEventListener("click", () => {
  $("user-form").reset();
  $("user-msg").textContent = "";
  $("user-dialog").showModal();
});
$("btn-password").addEventListener("click", () => {
  $("password-form").reset();
  $("password-msg").textContent = "";
  $("password-dialog").showModal();
});
document
  .querySelectorAll("[data-close]")
  .forEach((b) =>
    b.addEventListener("click", () => $(b.dataset.close).close()),
  );
document
  .querySelectorAll("[data-view]")
  .forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view)),
  );
for (const id of ["search", "filter-category", "filter-stock", "sort"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    state.page = 1;
    render();
  });
$("page-prev").addEventListener("click", () => {
  state.page--;
  render();
});
$("page-next").addEventListener("click", () => {
  state.page++;
  render();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.user && state.view === "catalogo")
    loadProducts();
});
setInterval(() => {
  if (
    state.user &&
    state.view === "catalogo" &&
    !document.hidden &&
    !document.querySelector("dialog[open]")
  )
    loadProducts();
}, 30000);
(async () => {
  try {
    const setup = await api("/setup");
    setupUI(setup.required);
    if (!setup.required) {
      try {
        const { user } = await api("/auth/me", { quiet: true });
        await enter(user);
      } catch (error) {
        if (error.status !== 401) throw error;
        show("login");
      }
    } else show("login");
    show("boot", false);
  } catch (error) {
    $("boot").textContent = error.message;
    const retry = button("Volver a intentar", "secondary", () =>
      location.reload(),
    );
    $("boot").append(retry);
  }
})();
