const credentials = {
  nombre: "Gabriel · Pruebas",
  usuario: "admin",
  password: "Pruebas-seguras-2026",
};
const headers = { "X-Requested-With": "Inventario" };
function prepare() {
  cy.request({ method: "POST", url: "/api/setup", headers, body: credentials });
  cy.visit("/");
  cy.get(".fila-producto").should("have.length", 4);
}
function fillProduct(name = "Webcam HD", sku = "WEB-001") {
  cy.get("#nombre").type(name, { parseSpecialCharSequences: false });
  cy.get("#sku").type(sku);
  cy.get("#categoria").type("Video");
  cy.get("#precio").type("250.50");
  cy.get("#stock").type("8");
}
describe("Nexo · inventario compartido", () => {
  beforeEach(() => cy.task("resetDatabase"));
  it("crea el administrador inicial y muestra el catálogo", () => {
    cy.visit("/");
    cy.get("#auth-title").should("contain", "Crea tu espacio");
    cy.screenshot("01-configuracion", { capture: "viewport" });
    cy.get("#admin-nombre").type(credentials.nombre);
    cy.get("#usuario").type(credentials.usuario);
    cy.get("#clave").type(credentials.password);
    cy.get("#btn-login").click();
    cy.get("#admin").should("be.visible");
    cy.get(".fila-producto").should("have.length", 4);
    cy.get("#stat-units").should("have.text", "40");
    cy.get("#stat-value").should("contain", "8,000.00");
    cy.screenshot("02-inventario-escritorio", { capture: "viewport" });
  });
  it("permite cerrar sesión, rechaza contraseña incorrecta y vuelve a entrar", () => {
    prepare();
    cy.get("#btn-logout").click();
    cy.get("#login").should("be.visible");
    cy.get("#usuario").type("admin");
    cy.get("#clave").type("incorrecta");
    cy.get("#btn-login").click();
    cy.get("#login-msg").should("contain", "incorrectos");
    cy.get("#clave").clear().type(credentials.password);
    cy.get("#btn-login").click();
    cy.get("#admin").should("be.visible");
    cy.reload();
    cy.get("#admin").should("be.visible");
  });
  it("crea, persiste y edita un producto", () => {
    prepare();
    cy.get("#btn-new").click();
    fillProduct();
    cy.get("#btn-guardar").click();
    cy.get(".fila-producto").should("have.length", 5);
    cy.reload();
    cy.contains(".fila-producto", "Webcam HD").find(".btn-editar").click();
    cy.get("#nombre").clear().type("Webcam Pro");
    cy.get("#stock").clear().type("3");
    cy.get("#btn-guardar").click();
    cy.contains(".fila-producto", "Webcam Pro").should("contain", "Stock bajo");
  });
  it("valida nombre, precio y stock vacío antes de guardar", () => {
    prepare();
    cy.get("#btn-new").click();
    cy.get("#btn-guardar").click();
    cy.get("#form-msg").should("contain", "nombre");
    fillProduct();
    cy.get("#precio").clear().type("0");
    cy.get("#btn-guardar").click();
    cy.get("#form-msg").should("contain", "precio");
    cy.get("#precio").clear().type("20");
    cy.get("#stock").clear();
    cy.get("#btn-guardar").click();
    cy.get("#form-msg").should("contain", "stock");
    cy.get(".fila-producto").should("have.length", 4);
    cy.screenshot("03-validacion-producto", { capture: "viewport" });
  });
  it("exige confirmación para eliminar y registra la actividad", () => {
    prepare();
    cy.contains(".fila-producto", "Teclado").find(".btn-eliminar").click();
    cy.get("#delete-dialog").should("be.visible");
    cy.get("#delete-dialog [data-close]").click();
    cy.get(".fila-producto").should("have.length", 4);
    cy.contains(".fila-producto", "Teclado").find(".btn-eliminar").click();
    cy.get("#btn-delete-confirm").click();
    cy.get(".fila-producto").should("have.length", 3);
    cy.get('[data-view="actividad"]').click();
    cy.get("#activity-list")
      .should("contain", "Producto eliminado")
      .and("contain", "Teclado");
    cy.screenshot("04-actividad", { capture: "viewport" });
  });
  it("busca sin distinguir tildes, filtra y muestra estados vacíos", () => {
    prepare();
    cy.get("#search").type("audifonos");
    cy.get(".fila-producto").should("have.length", 1).and("contain", "Agotado");
    cy.get("#search").clear();
    cy.get("#filter-stock").select("low");
    cy.get(".fila-producto").should("have.length", 1).and("contain", "Monitor");
    cy.get("#filter-stock").select("");
    cy.get("#filter-category").select("Periféricos");
    cy.get(".fila-producto").should("have.length", 2);
    cy.get("#search").type("inexistente");
    cy.get("#empty-title").should("contain", "No encontramos");
    cy.get("#btn-empty").click();
    cy.get(".fila-producto").should("have.length", 4);
  });
  it("renderiza nombres como texto y evita inyección de HTML", () => {
    prepare();
    cy.get("#btn-new").click();
    fillProduct("<img src=x onerror=alert(1)>", "SAFE-001");
    cy.get("#btn-guardar").click();
    cy.contains(".col-nombre", "<img src=x onerror=alert(1)>").should(
      "be.visible",
    );
    cy.get("#tabla-productos img").should("not.exist");
  });
  it("no sobrescribe un producto modificado por otra sesión", () => {
    prepare();
    cy.contains(".fila-producto", "Teclado").find(".btn-editar").click();
    cy.request("/api/products").then(({ body }) => {
      const p = body.products.find((p) => p.sku === "TEC-001");
      cy.request({
        method: "PUT",
        url: `/api/products/${p.id}`,
        headers,
        body: { ...p, stock: 99 },
      });
    });
    cy.get("#nombre").clear().type("Cambio antiguo");
    cy.get("#btn-guardar").click();
    cy.get("#form-msg").should("contain", "Otra persona");
    cy.get("#product-dialog .close-button").click();
    cy.get("#btn-refresh").click();
    cy.contains(".fila-producto", "Teclado").should("contain", "99");
  });
  it("crea usuarios reales y aplica permisos de editor", () => {
    prepare();
    cy.get('[data-view="usuarios"]').click();
    cy.get("#btn-user-new").click();
    cy.get("#user-name").type("María López");
    cy.get("#user-username").type("maria");
    cy.get("#user-password").type(credentials.password);
    cy.get('#user-form [type="submit"]').click();
    cy.get("#tabla-usuarios").should("contain", "María López");
    cy.screenshot("05-equipo", { capture: "viewport" });
    cy.get("#btn-logout").click();
    cy.get("#usuario").type("maria");
    cy.get("#clave").type(credentials.password);
    cy.get("#btn-login").click();
    cy.get("#admin").should("be.visible");
    cy.get("#nav-users").should("not.be.visible");
    cy.request({ url: "/api/users", failOnStatusCode: false })
      .its("status")
      .should("eq", 403);
  });
  it("cambia contraseña y requiere la nueva para entrar", () => {
    prepare();
    cy.get("#btn-password").click();
    cy.get("#current-password").type(credentials.password);
    cy.get("#new-password").type("Otra-clave-segura-2026");
    cy.get('#password-form [type="submit"]').click();
    cy.get("#password-dialog").should("not.be.visible");
    cy.get("#btn-logout").click();
    cy.get("#usuario").type("admin");
    cy.get("#clave").type("Otra-clave-segura-2026");
    cy.get("#btn-login").click();
    cy.get("#admin").should("be.visible");
  });
  it("exporta el catálogo como CSV", () => {
    prepare();
    cy.get("#btn-export").click();
    const filename = `cypress/downloads/inventario-${new Date().toISOString().slice(0, 10)}.csv`;
    cy.readFile(filename)
      .should("contain", "TEC-001")
      .and("contain", "Teclado");
  });
  it("permite navegar y agregar productos en móvil sin desbordar la página", () => {
    cy.viewport(390, 844);
    prepare();
    cy.get("#btn-new").click();
    fillProduct();
    cy.get("#btn-guardar").click();
    cy.get(".fila-producto").should("have.length", 5);
    cy.document().then((doc) =>
      expect(doc.documentElement.scrollWidth).to.be.at.most(390),
    );
    cy.get("#toast", { timeout: 6000 }).should("not.be.visible");
    cy.screenshot("06-inventario-movil", { capture: "fullPage" });
    cy.get('[data-view="actividad"]').click();
    cy.get("#activity-list").should("contain", "Webcam HD");
  });
  it("informa errores de conexión sin perder lo escrito", () => {
    prepare();
    cy.get("#btn-new").click();
    fillProduct();
    cy.intercept("POST", "/api/products", { forceNetworkError: true }).as(
      "offline",
    );
    cy.get("#btn-guardar").click();
    cy.get("#form-msg").should("contain", "No se pudo conectar");
    cy.get("#nombre").should("have.value", "Webcam HD");
    cy.get("#btn-guardar").should("not.be.disabled");
  });
  it("pagina más de ocho productos y ordena el catálogo", () => {
    prepare();
    for (let i = 0; i < 6; i++)
      cy.request({
        method: "POST",
        url: "/api/products",
        headers,
        body: {
          nombre: `Producto ${i}`,
          sku: `TEST-${i}`,
          categoria: "Pruebas",
          precio: 10 + i,
          stock: i,
        },
      });
    cy.get("#btn-refresh").click();
    cy.get("#contador-productos").should("have.text", "10");
    cy.get(".fila-producto").should("have.length", 8);
    cy.get("#page-next").click();
    cy.get(".fila-producto").should("have.length", 2);
    cy.get("#page-label").should("have.text", "2 / 2");
    cy.get("#sort").select("price");
    cy.get(".fila-producto").first().should("contain", "Producto 0");
  });
});
