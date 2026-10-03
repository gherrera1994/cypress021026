# Demo original · Administración de productos

Copia de la interfaz, lógica, CSV y siete pruebas originales del repositorio. Se mantiene separada de Nexo, que continúa en `../admin-productos`.

```sh
npm start
```

Abre **http://localhost:3001**.

- Usuario: **admin**
- Contraseña: **1234**
- Permite agregar, editar y eliminar productos.
- Carga cuatro productos iniciales del CSV y guarda cambios en `localStorage`.
- No tiene usuarios reales ni base de datos: el acceso es de demostración.
- Conserva el comportamiento y las limitaciones del código original.

El servidor estático usa Node.js 24 y no requiere instalar dependencias para iniciar. Solo sirve archivos públicos; no modifica Nexo ni su base de datos. Al estar en otro puerto, la demo tiene su propio almacenamiento del navegador.

## Pruebas originales

Con la demo encendida en otra terminal:

```sh
npm ci
npm run cypress:run
```

También puedes usar `npm run cypress:open` para ver las pruebas. Se actualizó únicamente la versión de Cypress y la dirección de ejecución; los siete casos originales se conservaron.

Las pruebas limpian el almacenamiento de su navegador de pruebas para recargar los cuatro productos de ejemplo. El video se guarda en `cypress/videos/admin.cy.js.mp4`.

Si tu terminal define `ELECTRON_RUN_AS_NODE=1`, elimina esa variable de esa terminal antes de ejecutar Cypress:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## Ambas versiones

| Versión | Carpeta | Dirección |
| --- | --- | --- |
| Nexo con backend y SQLite | `admin-productos` | http://localhost:3000 |
| Demo original | `admin-productos-demo` | http://localhost:3001 |
