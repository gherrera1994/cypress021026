# Nexo · Inventario compartido

Aplicación para administrar productos y existencias, con cuentas reales y datos compartidos entre usuarios conectados al mismo servidor. Interfaz en español y precios en quetzales.

## Inicio

Requiere **Node.js 24 o posterior** y npm.

```sh
npm ci
npm start
```

Abre **http://localhost:3000**. En el primer acceso, escribe tu nombre, un usuario de 3 a 40 caracteres y una contraseña de 12 a 128 caracteres. Esa cuenta será administradora. La configuración inicial se cierra automáticamente una vez creada.

No hay contraseña predeterminada. Las antiguas credenciales de demostración `admin / 1234` dejaron de existir. Los datos de la versión anterior que estaban en `localStorage` no se borran ni se importan automáticamente.

Se incluyen cuatro productos de ejemplo: teclado, mouse, monitor y audífonos. Se insertan una sola vez, incluso si luego vacías el catálogo. Puedes modificarlos o eliminarlos desde la interfaz.

## Recorrido por la aplicación

1. **Inventario:** indicadores de productos, unidades, valor total y productos por reponer; alta, edición y eliminación con confirmación.
2. **Consulta:** búsqueda por nombre/código sin distinguir tildes, categoría, estado, ordenación y páginas de ocho productos. Los indicadores siempre representan el catálogo completo.
3. **Exportar CSV:** descarga todos los productos que coinciden con los filtros, incluyendo las otras páginas. Los textos que podrían interpretarse como fórmulas de hoja de cálculo se neutralizan.
4. **Actividad:** últimas 100 acciones, usuario responsable y fecha local.
5. **Equipo:** creación de usuarios, cambio de rol, activación y desactivación. Los cambios de permisos cierran las sesiones de la persona afectada. No puedes desactivar ni cambiar el rol de tu propia cuenta.
6. **Mi contraseña:** cambia tu contraseña y cierra tus otras sesiones.

Los administradores gestionan productos y usuarios. Los editores gestionan productos y consultan actividad. Estos permisos se verifican también en el servidor.

El catálogo se consulta al entrar, al pulsar **Actualizar**, al volver a la pestaña y cada 30 segundos mientras esté visible y sin formularios abiertos. Si alguien modifica un producto que estás editando, se muestra un conflicto: cierra el formulario, actualiza el catálogo y vuelve a editar. No se sobrescribe silenciosamente el trabajo de otra persona.

**Estados:** agotado = 0 unidades; stock bajo = 1–5; disponible = más de 5. El indicador “Por reponer” incluye stock bajo y agotado. El valor del inventario es precio de catálogo × existencias; no es una valoración contable de costos.

## Almacenamiento y seguridad

- Base en `data/inventario.sqlite`, con archivos auxiliares WAL administrados por SQLite. Se crea automáticamente y está excluida de Git.
- Contraseñas derivadas con scrypt y sal aleatoria; nunca se devuelven por API.
- Sesiones de ocho horas almacenadas en SQLite. El navegador recibe una cookie HttpOnly y SameSite=Strict; los tokens se guardan como hash en la base.
- API autenticada, consultas SQL parametrizadas, precios almacenados en centavos, validación en servidor y versiones de producto para detectar conflictos.
- Protección de solicitudes de escritura mediante JSON, encabezado propio y comprobación de origen. Helmet configura las cabeceras de seguridad.
- Límite de 15 solicitudes por dirección IP cada 15 minutos en acceso, configuración inicial y cambio de contraseña. Este contador es local al proceso y se reinicia con el servidor.
- No se exponen endpoints de reinicio de datos para las pruebas.

## Configuración

| Variable         | Valor predeterminado                         | Uso                         |
| ---------------- | -------------------------------------------- | --------------------------- |
| `PORT`           | `3000`                                       | Puerto HTTP                 |
| `HOST`           | `127.0.0.1`                                  | Interfaz de escucha         |
| `DATABASE_PATH`  | `data/inventario.sqlite` dentro del proyecto | Archivo SQLite              |
| `SECURE_COOKIES` | `false`                                      | Usar `true` detrás de HTTPS |

Las variables se leen del entorno. No se carga `.env` automáticamente.

Por defecto está disponible solo en esta computadora. Para usarla desde otros equipos de una red de confianza, crea primero la cuenta administradora y después inicia el servidor con `HOST=0.0.0.0`; los otros equipos deben abrir la dirección IP de esta computadora y el puerto configurado. El firewall debe permitir ese acceso.

Para publicar en Internet necesitas un servidor con almacenamiento persistente, HTTPS y `SECURE_COOKIES=true`; completa la configuración inicial antes de abrir el servicio al público. No se ha desplegado en Internet. La aplicación está diseñada para una instancia de servidor con SQLite; no incluye correo de recuperación, múltiples organizaciones, facturación ni sincronización con otros sistemas.

Ejemplo PowerShell para otro puerto:

```powershell
$env:PORT = '3001'
npm start
```

## Respaldo

```sh
npm run backup
```

Genera una copia consistente en `backups/` incluso con el servidor encendido. Incluye productos, usuarios, hashes de contraseñas, sesiones y actividad; trátala como información privada. El CSV es una exportación del catálogo, no un respaldo completo.

Para restaurar: detén el servidor, conserva una copia de la carpeta `data`, reemplázala por una carpeta con el respaldo renombrado a `inventario.sqlite` y vuelve a iniciar. No mezcles el archivo restaurado con archivos `-wal` o `-shm` de otra base. Si usas `DATABASE_PATH`, restaura en esa ubicación.

## Pruebas y evidencias

```sh
npm test                 # Integración de API con node:test
npm run cypress:run      # Flujos completos de navegador, capturas y video
npm run cypress:open     # Ver las pruebas en la interfaz de Cypress
npm run test:all         # Ambas suites
```

Las pruebas usan bases independientes en memoria o directorios temporales, nunca `data/inventario.sqlite`. Cypress levanta su propio servidor en un puerto libre y lo cierra al terminar. Las credenciales incluidas en las pruebas solo pertenecen a ese entorno aislado.

Las capturas se generan en `cypress/screenshots/admin.cy.js/` y el video en `cypress/videos/admin.cy.js.mp4`. Incluyen configuración inicial, catálogo de escritorio, validación, actividad, equipo y móvil.

Si ejecutas Cypress desde un entorno que define `ELECTRON_RUN_AS_NODE=1`, quita esa variable solo de la terminal de pruebas antes de iniciarlo:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run cypress:run
```

El workflow de GitHub está en `../.github/workflows/cypress.yml`: instala dependencias con el lockfile, ejecuta API y Cypress y conserva las evidencias. La ejecución remota requiere enviar los cambios al repositorio.

## Archivos principales

```text
server.js                 Inicio del servidor
src/app.js                API, autenticación, permisos y validación
src/database.js           Esquema SQLite y datos iniciales
public/                   Interfaz web sin framework
scripts/backup.js         Respaldo consistente de SQLite
test/api.test.js          Pruebas de integración
cypress/e2e/admin.cy.js   Pruebas de navegador
```

Referencias técnicas: [SQLite de Node.js](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [seguridad de Express](https://expressjs.com/en/advanced/best-practice-security/), [configuración de Cypress](https://docs.cypress.io/api/node-events/configuration-api).
