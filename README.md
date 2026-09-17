# Santiago Filtros · Sistema de gestión

Aplicación web responsive para el inventario, los pedidos y las ventas de Santiago Filtros.
Todo el proyecto está en JavaScript: el frontend es HTML, CSS y JS sin compilar, y el
servidor es Node.js con Express sobre MySQL.

## Uso local

```bash
npm install
npm start          # http://localhost:3100 (puerto definido en .env)
```

Se ingresa con los usuarios del sistema anterior y sus mismas contraseñas, que ahora quedan cifradas.

## Subir a Hostinger

Hay dos formas de preparar la base. En ambas el servidor aplica al iniciar las migraciones que falten.

- **Opción A · usar la base de producción del sistema anterior.** Apunta `DATABASE_URL` a esa base.
  Al iniciar, la migración 001 la convierte a la estructura nueva, previo respaldo (ver "Migraciones").
- **Opción B · importar la base ya convertida.**
  1. En tu equipo ejecuta `npm run exportar`. Se genera `database/santiago_filtros_hostinger.sql`, sin `DEFINER` ni el nombre de la base local.
  2. En hPanel, en Bases de datos MySQL, crea una base y un usuario.
  3. En phpMyAdmin, abre la base nueva e importa el archivo.

Luego:

1. **Crear la app Node.js.** Sube el proyecto sin `node_modules`, `.env` ni el archivo .sql.
   - Versión de Node: 22.x (mínimo 20.9, requerido por la librería de imágenes).
   - Comando de inicio: `npm start`.
   - Archivo de entrada: `server.js`.
2. **Variables de entorno.** Cárgalas en el panel de la app:
   - `DATABASE_URL=mysql://USUARIO:CLAVE@localhost:3306/NOMBRE_BASE`
   - `SESSION_SECRET` con un texto largo y aleatorio.
   - `PORT` solo si Hostinger no la define por su cuenta.
   - Si la clave tiene símbolos como `@` o `#`, usa `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` en lugar de `DATABASE_URL`.
3. **Imágenes.** Las fotos de productos se guardan en `uploads/productos` y el logo convertido en `uploads/empresa`. Respalda `uploads/productos` antes de cada redespliegue.

`.env.example` muestra todas las variables.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia el servidor y lo reinicia al guardar cambios |
| `npm run migrar` | Aplica las migraciones pendientes, con respaldo previo |
| `npm run migrar:estado` | Muestra las migraciones aplicadas y las pendientes |
| `npm run imagenes:optimizar` | Convierte a WEBP optimizado las imágenes de productos que aún no lo son (con `-- --revisar` solo informa) |
| `npm run exportar` | Genera el .sql para importar en Hostinger (sin las tablas `respaldo_v1_*`) |

## Estructura

```
server.js               arranque: sesiones, API, páginas y manejo de errores
src/modules.js          definición de los 12 módulos (tablas, campos, permisos)
src/crud.js             motor CRUD genérico: listar, filtrar, crear, editar, borrar, exportar CSV
src/auth.js             login, logout y protección de la API
src/dashboard.js        datos del panel de inicio
src/imagenes.js         subida de imágenes de productos
src/empresa.js          configuración de la empresa y datos públicos de marca
src/sesiones.js         sesiones guardadas en MySQL (tabla sf_sesion)
src/migraciones.js      ejecutor de migraciones (tabla sf_migraciones, respaldo y bloqueo)
src/logo.js             logo de la empresa convertido a PNG para los PDF
src/db.js               pool de conexiones MySQL
src/errores.js          mensajes de error para el usuario
database/migraciones/   una migración por archivo: 001_…, 002_…, 003_…
database/schema.sql     estructura base v2 (la usa la migración 001)
database/triggers.sql   triggers que mantienen el stock (los usa la migración 001)
database/migrar.js      comando npm run migrar
database/exportar.js    comando npm run exportar
database/exportador.js  exportación completa a .sql (también la usan los respaldos)
database/respaldos/     respaldos automáticos antes de migrar (se guardan los últimos 10)
frontend/               index.html, login.html, css/, js/
```

Para agregar un campo, agrégalo a la tabla en MySQL y a su módulo en `src/modules.js`.
Aparece solo en la tabla, el formulario, la validación y la exportación.

## Migraciones

Funciona como Alembic. Cada cambio de estructura es un archivo numerado en `database/migraciones/`.
La tabla `sf_migraciones` registra cuáles se aplicaron en cada base. Una base atrasada recibe solo lo que le falta, sin perder datos.

- **Cuándo corren:** al iniciar el servidor, salvo con `AUTO_MIGRAR=false`, o con `npm run migrar`.
- **Respaldo:** antes de aplicar cualquier migración se guarda un .sql completo en `database/respaldos/`, con datos y procedimientos.
- **Sin choques:** un bloqueo de MySQL impide que dos procesos migren la misma base a la vez.
- **Si una migración falla:** el servidor no inicia y muestra el error junto con la ruta del respaldo.

| Migración | Qué hace |
|---|---|
| 001_estructura_v2 | Convierte la base del sistema anterior a la estructura nueva. Una base que ya está en v2 queda igual, y una vacía recibe la estructura y un usuario `admin`. |
| 002_empresa | Crea `sf_empresa` y conserva la configuración si ya existe |
| 003_sesiones | Crea `sf_sesion` |

**Qué hace la 001 con la base del sistema anterior:**

- **Respaldo en la misma base:** renombra las tablas originales a `respaldo_v1_*`, que no se modifican.
- **Estructura y datos:** crea las tablas nuevas y copia los datos limpios: marcas unificadas, RUT normalizados, contraseñas cifradas, y pedidos y productos huérfanos recuperados.
- **Datos problemáticos:** corrige y reporta referencias rotas, duplicados, montos negativos, fechas inválidas y textos demasiado largos, en vez de detenerse.
- **Triggers y procedimientos:** crea los triggers de stock y recrea `Docs`, `Para Blance`, `Proc_Cliente`, `Proc_NotaPedido` y `Proc_NotaPedido_Cliente`, con las mismas columnas que antes.
- **Si se interrumpe:** al volver a correr, borra lo creado a medias y reintenta desde `respaldo_v1_*`.
- **Resultado:** queda registrado en `sf_migraciones`. Con la base local del 13 de septiembre, el resultado es idéntico a `santiago_filtros_v2`.

> **Importante:** después de convertir la base de producción, el sistema anterior ya no puede escribir en ella, porque sus tablas cambiaron.
> Hazlo solo cuando dejen de usarlo. Las tablas `respaldo_v1_*` se pueden borrar cuando todo esté verificado.

**Para agregar un cambio**, crea el siguiente archivo, por ejemplo `004_agrega_campo_x.js`, que exporte `descripcion` y `async up({ conn, log })`.
No modifiques una migración que ya se aplicó en producción.

## Módulos y permisos

| Grupo | Módulos |
|---|---|
| Inventario | Productos, Categorías, Subcategorías, Marcas, Proveedores |
| Ventas | Clientes, Pedidos, Salida de productos, Documentos de venta |
| Administración | Vendedores, Usuarios, Configuración de la empresa |

- **Administrador:** todo.
- **Vendedor:** crea y edita todo, salvo vendedores y usuarios.
- **Consulta:** solo lectura y sin acceso a usuarios.

## Configuración de la empresa

La tabla `sf_empresa` guarda una sola fila con nombre, RUT, correo, slogan y URL del logo.
Solo el Administrador la ve y la edita, desde Administración > Configuración de la empresa.
El nombre, el slogan y el logo se muestran en el menú superior, en el título de la pestaña y en el inicio de sesión.
El logo debe ser una URL pública que empiece con https:// o http://. Si no carga, se muestra el ícono por defecto.
Si la tabla no existe, el servidor la crea al iniciar con el nombre "Santiago Filtros".

## Nota de venta (PDF)

Cada pedido se puede descargar como nota de venta en PDF, con el formato de la nota impresa original.
El PDF incluye logo, cliente, fecha, RUT, número, detalle, totales y espacio para la firma del cliente.

- **Dónde se descarga:**
  - En Pedidos, con el ícono de PDF de cada fila o con el botón "Nota de venta (PDF)" del detalle.
  - En Documentos de venta, en los documentos de tipo NOTA DE VENTA.
- **Precios:** los precios del sistema incluyen IVA, así que la nota los muestra netos. El precio unitario y el total de cada línea se dividen por 1,19.
- **Totales:**
  - TOTAL NETO es la suma de los totales netos de cada línea.
  - TOTAL A PAGAR es la suma de cantidad por precio con IVA, o sea, lo que paga el cliente.
  - I.V.A. 19% es la diferencia entre ambos, y puede variar en uno o dos pesos por redondeo.
- **Logo:** es el mismo de la configuración de la empresa y puede ser PNG, JPG, WEBP, SVG o GIF. El servidor lo descarga una vez, lo convierte a PNG y lo guarda en `uploads/empresa/`, así cada PDF sale rápido aunque el sitio del logo sea lento. Se prepara al iniciar el servidor y al guardar la configuración. Si no se puede descargar, la nota usa el logo por defecto y se reintenta al minuto.
- **Pedidos sin productos:** no generan nota de venta.
- **Pedidos largos:** la tabla continúa en páginas nuevas y cada página queda numerada.
- **Ruta de la API:** `GET /api/pedidos/:id/nota-venta.pdf`. Con `?ver=1` se abre en el navegador en lugar de descargarse.

## Imágenes de productos

Al agregar o editar un producto se acepta una imagen JPG, PNG o WEBP de hasta 10 MB, y siempre se guarda como WEBP optimizado:

- **Tamaño:** máximo 1200 px por lado, sin agrandar las imágenes más chicas.
- **Calidad:** 80, sin metadatos (GPS, cámara) y con la orientación de las fotos de celular corregida.
- **Transparencia:** los PNG con fondo transparente la conservan.
- **Archivo anterior:** al reemplazar o quitar la imagen, se borra del disco.
- **Recorte 1:1:** al elegir una imagen se abre una ventana para encuadrarla en un cuadrado (arrastrar y zoom, también táctil). "Usar imagen completa" la deja entera, centrada con bordes blancos. Con "Recortar" se vuelve a encuadrar la imagen ya guardada sin subirla de nuevo. El navegador envía solo las coordenadas y el servidor recorta el original, respetando la orientación de las fotos de celular. Usa Cropper.js 1.6.2 (MIT), incluido en `frontend/vendor/cropperjs`.
- **Resultado:** una foto de celular de 3 a 5 MB suele quedar en 100 a 250 KB. El aviso al guardar muestra el peso antes y después.

## Reglas de negocio

- Cada línea de salida descuenta stock; editarla o borrarla lo ajusta. Si no hay stock suficiente, se rechaza.
- Al borrar un pedido se borran sus líneas y el stock vuelve. Un pedido con documento no se puede borrar.
- **Nuevo pedido:**
  - El formulario propone el siguiente número disponible, que se puede cambiar. Si se deja vacío, se asigna solo, y un número repetido se rechaza.
  - El vendedor por defecto es el asociado al usuario que inició sesión; se configura en Usuarios, en "Vendedor asociado".
  - Todo pedido nuevo nace PENDIENTE. El estado solo se cambia al editarlo.
  - La observación es opcional.
- Una línea sin precios toma el costo y la venta del producto.
- El costo total y la venta total de un documento de venta no se escriben a mano: salen de los productos del pedido, igual que la nota de venta. Se calculan al crear el documento o al cambiarlo de pedido, y se actualizan solos cuando se agrega, edita o borra un producto del pedido. Editar solo el tipo, número o fecha no los modifica, así se conservan los montos de documentos antiguos.
- Nada que tenga registros relacionados se puede borrar. Para eso están los estados Descontinuado o Inactivo.
- Los RUT se validan con su dígito verificador.
- Tras 5 intentos fallidos de login, ese usuario queda bloqueado 5 minutos.
