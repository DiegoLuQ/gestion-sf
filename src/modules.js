/*
 * Definición de los módulos de la aplicación: uno por tabla.
 *
 * Cada módulo describe su tabla, sus campos y quién puede leer o escribir.
 * El motor CRUD (crud.js) y la interfaz (frontend/js/crud.js) se construyen a
 * partir de estas definiciones: agregar un campo aquí basta para que aparezca
 * en la tabla, en el formulario, en la validación y en la exportación.
 *
 * Tipos de campo: text, textarea, int, money, decimal, date, datetime, email,
 * rut, url, enum, fk, bool, password, image.
 * singleton: true indica una tabla de una sola fila (se edita, no se crea ni elimina).
 * noCreate: true impide crear registros desde la plataforma (llegan por otra vía, p. ej. el enlace de cotización).
 * hidden: true deja el módulo fuera del menú (se usa solo como detalle de otro).
 * En labelSql y en extras, {a} es el alias de la tabla.
 */

export const ADMIN = 'Administrador';
export const VENDEDOR = 'Vendedor';
export const CONSULTA = 'Consulta';
export const ALL_ROLES = [ADMIN, VENDEDOR, CONSULTA];
const EDITORS = [ADMIN, VENDEDOR];

const F = (name, label, type = 'text', opts = {}) => ({
  name, label, type, required: false, list: false, search: false, filter: false, readonly: false, full: false, ...opts,
});

// Columna calculada, solo lectura, visible en el listado.
const X = (name, label, sql, type = 'int', opts = {}) => ({ name, label, sql, type, ...opts });
// hideMd (en campos y columnas calculadas): la columna se oculta en tablets horizontales y
// notebooks (1024–1599 px) para que la tabla quepa sin desplazarse hacia el lado.

export const MODULES = {
  // ------------------------------------------------------------ Inventario
  productos: {
    table: 'sf_producto', pk: 'id_producto', title: 'Productos', singular: 'producto',
    icon: 'box', group: 'Inventario', gender: 'm',
    labelSql: "CONCAT({a}.prod_codigo, ' · ', {a}.prod_descripcion, ' · ', "
      + '(SELECT m.marca_nombre FROM sf_marca m WHERE m.id_marca = {a}.id_marca))',
    order: ['id_producto', 'desc'],
    fields: [
      F('prod_ruta_imagen', 'Imagen', 'image', { list: true, full: true }),
      F('prod_codigo', 'Código', 'text', { required: true, max: 30, list: true, search: true }),
      F('prod_codigo2', 'Código alternativo', 'text', { max: 30, search: true }),
      F('prod_descripcion', 'Descripción', 'text', { required: true, max: 255, list: true, search: true, full: true }),
      F('id_marca', 'Marca', 'fk', { ref: 'marcas', required: true, list: true, filter: true, hideMd: true }),
      // Fuera del listado para que la tabla quepa; sigue como filtro, en el formulario y en el detalle.
      F('id_subcategoria', 'Subcategoría', 'fk', { ref: 'subcategorias', required: true, filter: true }),
      F('id_proveedor', 'Proveedor', 'fk', { ref: 'proveedores', required: true, filter: true }),
      F('prod_cantidad', 'Stock', 'decimal', { required: true, min: 0, default: 0, list: true }),
      F('prod_stock_minimo', 'Stock mínimo', 'decimal', { min: 0, default: 0 }),
      F('prod_costo', 'Costo', 'money', { required: true, min: 0, list: true, hideMd: true }),
      F('prod_venta', 'Precio de venta', 'money', { required: true, min: 0, list: true }),
      F('prod_precio_interno', 'Precio interno', 'money', { min: 0 }),
      F('prod_transporte', 'Costo de transporte', 'money', { min: 0 }),
      F('prod_formato', 'Formato', 'text', { max: 30, help: 'Ej.: unidad, caja x12, litro' }),
      F('prod_ubicacion', 'Ubicación en bodega', 'text', { max: 20 }),
      F('prod_estado', 'Estado', 'enum', {
        options: ['Disponible', 'Descontinuado', 'Eliminado'], required: true, default: 'Disponible', list: true, filter: true,
      }),
      F('prod_fecha', 'Fecha de ingreso', 'date', { required: true, default: 'today' }),
    ],
    // Botones de la cabecera del listado que abren una herramienta propia (frontend/js/<tool>.js).
    pageActions: [{ label: 'Catálogo', icon: 'book', tool: 'catalogo', roles: [ADMIN] }],
    extras: [X('margen_pct', 'Margen %',
      'ROUND((CAST(t.prod_venta AS SIGNED) - CAST(t.prod_costo AS SIGNED)) / NULLIF(t.prod_venta, 0) * 100, 1)', 'decimal', { hideMd: true })],
  },
  categorias: {
    table: 'sf_categoria', pk: 'id_categoria', title: 'Categorías', singular: 'categoría',
    icon: 'folder', group: 'Inventario', gender: 'f',
    labelSql: '{a}.cat_nombre', order: ['cat_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('cat_nombre', 'Nombre', 'text', { required: true, max: 50, list: true, search: true }),
      F('cat_descripcion', 'Descripción', 'textarea', { max: 255, list: true, full: true }),
    ],
    extras: [X('subcategorias', 'Subcategorías',
      'SELECT COUNT(*) FROM sf_subcategoria x WHERE x.id_categoria = t.id_categoria')],
  },
  subcategorias: {
    table: 'sf_subcategoria', pk: 'id_subcategoria', title: 'Subcategorías', singular: 'subcategoría',
    icon: 'layers', group: 'Inventario', gender: 'f',
    labelSql: '{a}.subc_nombre', order: ['subc_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('subc_nombre', 'Nombre', 'text', { required: true, max: 50, list: true, search: true }),
      F('id_categoria', 'Categoría', 'fk', { ref: 'categorias', required: true, list: true, filter: true }),
    ],
    extras: [X('productos', 'Productos',
      'SELECT COUNT(*) FROM sf_producto x WHERE x.id_subcategoria = t.id_subcategoria')],
  },
  marcas: {
    table: 'sf_marca', pk: 'id_marca', title: 'Marcas', singular: 'marca',
    icon: 'tag', group: 'Inventario', gender: 'f',
    labelSql: '{a}.marca_nombre', order: ['marca_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('marca_nombre', 'Nombre', 'text', { required: true, max: 50, list: true, search: true }),
      F('marca_origen', 'Origen', 'text', { max: 50, list: true, search: true, help: 'País o fabricante' }),
    ],
    extras: [X('productos', 'Productos', 'SELECT COUNT(*) FROM sf_producto x WHERE x.id_marca = t.id_marca')],
  },
  proveedores: {
    table: 'sf_proveedor', pk: 'id_proveedor', title: 'Proveedores', singular: 'proveedor',
    icon: 'truck', group: 'Inventario', gender: 'm',
    labelSql: '{a}.prov_nombre', order: ['prov_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('prov_nombre', 'Nombre', 'text', { required: true, max: 100, list: true, search: true }),
      F('prov_rut', 'RUT', 'rut', { max: 12, list: true, search: true }),
      F('prov_telefono', 'Teléfono', 'text', { max: 20, list: true }),
      F('prov_email', 'Correo', 'email', { max: 100, list: true, search: true }),
      F('prov_pais', 'País', 'text', { required: true, max: 50, default: 'Chile' }),
      F('prov_ciudad', 'Ciudad', 'text', { max: 50, list: true, search: true }),
      F('prov_direccion', 'Dirección', 'text', { max: 150, full: true }),
      F('prov_descripcion', 'Descripción', 'textarea', { max: 255, full: true }),
      F('prov_activo', 'Activo', 'bool', { default: 1, list: true, filter: true }),
    ],
    extras: [X('productos', 'Productos',
      'SELECT COUNT(*) FROM sf_producto x WHERE x.id_proveedor = t.id_proveedor')],
  },

  // ------------------------------------------------------------ Ventas
  clientes: {
    table: 'sf_cliente', pk: 'id_cliente', title: 'Clientes', singular: 'cliente',
    icon: 'users', group: 'Ventas', gender: 'm',
    labelSql: "CONCAT_WS(' · ', {a}.cli_nombre, {a}.cli_rut)", order: ['cli_nombre', 'asc'],
    fields: [
      F('cli_nombre', 'Nombre o razón social', 'text', { required: true, max: 250, list: true, search: true, full: true }),
      F('cli_rut', 'RUT', 'rut', { max: 12, list: true, search: true }),
      F('cli_tipo_cliente', 'Tipo de cliente', 'enum', {
        options: ['Persona', 'Empresa'], required: true, default: 'Persona', list: true, filter: true, hideMd: true,
      }),
      F('cli_giro', 'Giro', 'text', { max: 250, full: true }),
      F('cli_direccion', 'Dirección', 'text', { max: 250, full: true }),
      F('cli_comuna', 'Comuna', 'text', { max: 50, list: true, search: true }),
      F('cli_ciudad', 'Ciudad', 'text', { max: 50 }),
      F('cli_telefono', 'Teléfono', 'text', { max: 20, list: true, hideMd: true }),
      F('cli_correo', 'Correo', 'email', { max: 100, search: true }),
    ],
    extras: [X('pedidos', 'Pedidos', 'SELECT COUNT(*) FROM sf_pedido x WHERE x.id_cliente = t.id_cliente')],
  },
  pedidos: {
    table: 'sf_pedido', pk: 'id_n_pedido', title: 'Pedidos', singular: 'pedido',
    icon: 'clipboard', group: 'Ventas', gender: 'm',
    labelSql: "CONCAT('N° ', {a}.nump_numero, ' · ', DATE_FORMAT({a}.nump_fecha, '%d-%m-%Y'))",
    order: ['nump_fecha', 'desc'], dateField: 'nump_fecha',
    fields: [
      // defaultFrom: el formulario propone el valor que entrega esa ruta (se puede cambiar).
      F('nump_numero', 'Número', 'text', {
        max: 11, list: true, search: true, defaultFrom: '/api/pedidos/siguiente-numero',
        help: 'Se propone el siguiente número disponible; puedes cambiarlo.',
      }),
      F('nump_fecha', 'Fecha', 'date', { required: true, default: 'today', list: true }),
      F('id_cliente', 'Cliente', 'fk', { ref: 'clientes', required: true, list: true, filter: true, search: true, full: true }),
      // defaultUserField: al crear, toma ese dato del usuario que inició sesión (su vendedor asociado).
      F('id_vendedor', 'Vendedor', 'fk', {
        ref: 'vendedores', filter: true, defaultUserField: 'id_vendedor',
        help: 'Por defecto, el vendedor asociado a tu usuario.',
      }),
      // hideOnCreate: no aparece al crear y siempre toma su valor por defecto; se cambia al editar.
      F('nump_estado', 'Estado', 'enum', {
        options: ['PENDIENTE', 'PAGADO', 'CHEQUE', 'ANULADO'], required: true, default: 'PENDIENTE', list: true, filter: true,
        hideOnCreate: true,
      }),
      F('nump_observacion', 'Observación', 'textarea', { max: 2000, full: true, placeholder: 'Opcional' }),
    ],
    extras: [
      X('items', 'Ítems', 'SELECT COUNT(*) FROM sf_salida_productos x WHERE x.id_n_pedido = t.id_n_pedido', 'int', { hideMd: true }),
      X('total', 'Total', 'SELECT COALESCE(SUM(x.salip_total), 0) FROM sf_salida_productos x WHERE x.id_n_pedido = t.id_n_pedido', 'money'),
      X('documento', 'Documento', "SELECT CONCAT(x.docu_tipo, ' ', x.docu_numero) FROM sf_pedido_terminado x WHERE x.id_n_pedido = t.id_n_pedido", 'text', { hideMd: true }),
    ],
    actions: [
      { label: 'Ver detalle', icon: 'list', module: 'salidas', filter: 'id_n_pedido' },
      { label: 'Documento', icon: 'file', module: 'documentos', filter: 'id_n_pedido' },
      { label: 'Nota de venta (PDF)', icon: 'pdf', download: '/api/pedidos/{id_n_pedido}/nota-venta.pdf' },
    ],
  },
  salidas: {
    table: 'sf_salida_productos', pk: 'id_salida_p', title: 'Salida de productos', singular: 'línea de salida',
    icon: 'outbox', group: 'Ventas', gender: 'f',
    labelSql: "CONCAT('Línea ', {a}.id_salida_p)", order: ['salip_fecha', 'desc'], dateField: 'salip_fecha',
    // Diseño del formulario:
    //  span: columnas que ocupa el campo en una grilla de 12 (6 = media fila).
    //  details: al elegir el registro, el formulario lo carga para las tarjetas, la etiqueta y `fill`.
    //  fill: copia valores del registro elegido a otros campos (editables).
    //  badge: etiqueta junto al nombre del campo con un dato del registro elegido.
    //  Campos formOnly (info, separator, calc) solo existen en el formulario: no se guardan ni se listan.
    fields: [
      F('id_n_pedido', 'Pedido', 'fk', { ref: 'pedidos', required: true, list: true, filter: true, search: true, span: 8, details: true }),
      F('salip_fecha', 'Fecha de salida', 'date', { required: true, default: 'today', list: true, span: 4 }),
      F('info_pedido', '', 'info', {
        formOnly: true, virtual: true, readonly: true, full: true, source: 'id_n_pedido',
        items: [
          { label: 'Cliente asignado', key: 'id_cliente__label', grow: true },
          { label: 'Fecha del pedido', key: 'nump_fecha', type: 'date', align: 'end' },
        ],
      }),
      F('separador_producto', '', 'separator', { formOnly: true, virtual: true, readonly: true, full: true }),
      F('id_producto', 'Producto', 'fk', {
        ref: 'productos', required: true, list: true, filter: true, search: true, full: true, details: true,
        fill: { salip_costo: 'prod_costo', salip_venta: 'prod_venta' },
        badge: { key: 'prod_cantidad', label: 'Stock', suffix: 'disp.', type: 'decimal', empty: 'Sin stock' },
      }),
      F('info_producto', '', 'info', {
        formOnly: true, virtual: true, readonly: true, full: true, source: 'id_producto',
        items: [
          { label: 'Marca', key: 'id_marca__label' },
          { label: 'Código / referencia', key: 'prod_codigo2' },
          { label: 'Compatibilidad', key: 'prod_descripcion', grow: true },
        ],
      }),
      // stockLimit: el formulario avisa en rojo y bloquea Guardar si la cantidad supera el stock del producto.
      // (La base de datos también lo impide: el stock nunca queda negativo.)
      F('salip_cantidad', 'Cantidad', 'decimal', {
        required: true, min: 0.01, list: true, span: 3, placeholder: '0', stockLimit: { source: 'id_producto', key: 'prod_cantidad' },
      }),
      F('salip_costo', 'Costo unitario', 'money', { min: 0, span: 3 }),
      F('salip_venta', 'Venta unitaria', 'money', { min: 0, list: true, span: 3, hideMd: true }),
      F('total_estimado', 'Total venta (est.)', 'calc', {
        formOnly: true, virtual: true, readonly: true, span: 3, multiply: ['salip_cantidad', 'salip_venta'],
      }),
      F('salip_total', 'Total', 'money', { readonly: true, list: true }),
    ],
    extras: [X('cliente', 'Cliente', 'SELECT c.cli_nombre FROM sf_pedido p JOIN sf_cliente c '
      + 'ON c.id_cliente = p.id_cliente WHERE p.id_n_pedido = t.id_n_pedido', 'text', { hideMd: true })],
  },
  documentos: {
    table: 'sf_pedido_terminado', pk: 'id_documento', title: 'Documentos de venta', singular: 'documento',
    icon: 'file', group: 'Ventas', gender: 'm',
    labelSql: "CONCAT({a}.docu_tipo, ' ', {a}.docu_numero)", order: ['docu_fecha', 'desc'], dateField: 'docu_fecha',
    fields: [
      F('docu_tipo', 'Tipo', 'enum', {
        options: ['FACTURA', 'BOLETA', 'NOTA DE VENTA', 'SIN DOCUMENTO'], required: true, default: 'FACTURA', list: true, filter: true,
      }),
      F('docu_numero', 'Número', 'text', { required: true, max: 20, list: true, search: true }),
      F('docu_fecha', 'Fecha', 'date', { required: true, default: 'today', list: true }),
      F('id_n_pedido', 'Pedido', 'fk', { ref: 'pedidos', required: true, list: true, filter: true, search: true }),
      F('id_vendedor', 'Vendedor', 'fk', { ref: 'vendedores', list: true, filter: true, placeholder: 'El del pedido', hideMd: true }),
      // Calculados por el sistema desde los productos del pedido: no se editan en el formulario.
      F('docu_costo', 'Costo total', 'money', { readonly: true }),
      F('docu_venta', 'Venta total', 'money', { readonly: true, list: true }),
    ],
    extras: [X('margen', 'Margen', 'CAST(t.docu_venta AS SIGNED) - CAST(t.docu_costo AS SIGNED)', 'money', { hideMd: true })],
    actions: [
      {
        label: 'Nota de venta (PDF)', icon: 'pdf', download: '/api/pedidos/{id_n_pedido}/nota-venta.pdf',
        showIf: { field: 'docu_tipo', equals: 'NOTA DE VENTA' },
      },
    ],
  },
  // Enlaces que se envían a un cliente para que arme su cotización en /cotizar/<token>.
  enlaces: {
    table: 'sf_cotizacion_enlace', pk: 'id_enlace', title: 'Enlaces de cotización', singular: 'enlace',
    icon: 'link', group: 'Ventas', gender: 'm', read: [ADMIN], write: [ADMIN],
    labelSql: '{a}.enl_nombre', order: ['id_enlace', 'desc'], fkMode: 'select',
    fields: [
      F('enl_nombre', 'Cliente o referencia', 'text', {
        required: true, max: 100, list: true, search: true, full: true, placeholder: 'Ej.: Taller Los Aromos',
        help: 'Solo lo ves tú, para reconocer el enlace. El cliente no lo ve.',
      }),
      // El token lo genera el servidor al crear el enlace.
      F('enl_token', 'Código del enlace', 'text', { readonly: true, hideOnCreate: true }),
      F('enl_activo', 'Activo', 'bool', { default: 1, list: true, filter: true, help: 'Desactívalo para que el enlace deje de funcionar.' }),
      F('enl_expira', 'Vence el', 'date', { list: true, help: 'Opcional. Desde el día siguiente el enlace deja de funcionar.' }),
      F('enl_nota', 'Nota interna', 'textarea', { max: 500, full: true, placeholder: 'Opcional' }),
    ],
    extras: [
      X('cotizaciones', 'Cotizaciones', 'SELECT COUNT(*) FROM sf_cotizacion x WHERE x.id_enlace = t.id_enlace'),
      X('ultima', 'Última recibida', 'SELECT MAX(x.creado_en) FROM sf_cotizacion x WHERE x.id_enlace = t.id_enlace', 'datetime', { hideMd: true }),
    ],
    actions: [
      { label: 'Copiar enlace', icon: 'copy', copy: '/cotizar/{enl_token}' },
      { label: 'Enviar por WhatsApp', icon: 'send', share: '/cotizar/{enl_token}' },
      { label: 'Cotizaciones', icon: 'list', module: 'cotizaciones', filter: 'id_enlace' },
    ],
  },
  // Solicitudes que llenan los clientes desde el enlace. No se crean desde la plataforma.
  cotizaciones: {
    table: 'sf_cotizacion', pk: 'id_cotizacion', title: 'Cotizaciones', singular: 'cotización',
    icon: 'inbox', group: 'Ventas', gender: 'f', read: [ADMIN], write: [ADMIN], noCreate: true,
    labelSql: "CONCAT('N° ', {a}.id_cotizacion, ' · ', {a}.cot_nombre)", order: ['id_cotizacion', 'desc'],
    fields: [
      F('id_cotizacion', 'N°', 'int', { readonly: true, list: true }),
      F('creado_en', 'Recibida', 'datetime', { readonly: true, list: true }),
      F('cot_nombre', 'Nombre', 'text', { required: true, max: 100, list: true, search: true }),
      F('cot_celular', 'Celular', 'text', { max: 20, list: true, search: true, hideMd: true }),
      F('cot_rut', 'RUT', 'rut', { max: 12, search: true, hideMd: true }),
      F('id_enlace', 'Enlace', 'fk', { ref: 'enlaces', readonly: true, filter: true, hideMd: true }),
      F('cot_estado', 'Estado', 'enum', {
        options: ['NUEVA', 'CONTACTADO', 'CERRADA', 'DESCARTADA'], required: true, default: 'NUEVA', list: true, filter: true,
      }),
      F('cot_comentario', 'Comentario del cliente', 'textarea', { readonly: true, full: true }),
      F('cot_nota', 'Nota interna', 'textarea', { max: 1000, full: true, placeholder: 'Opcional' }),
    ],
    extras: [
      X('items', 'Productos', 'SELECT COUNT(*) FROM sf_cotizacion_detalle x WHERE x.id_cotizacion = t.id_cotizacion', 'int', { hideMd: true }),
      X('total', 'Total', 'SELECT COALESCE(SUM(x.cotd_total), 0) FROM sf_cotizacion_detalle x WHERE x.id_cotizacion = t.id_cotizacion', 'money'),
    ],
    actions: [
      { label: 'Escribir por WhatsApp', icon: 'send', whatsapp: 'cot_celular', showIf: { field: 'cot_celular', notEmpty: true } },
      { label: 'Productos', icon: 'list', module: 'cotizacion_items', filter: 'id_cotizacion' },
    ],
  },
  // Productos de cada cotización. Solo se muestran dentro del detalle de la cotización.
  cotizacion_items: {
    table: 'sf_cotizacion_detalle', pk: 'id_detalle', title: 'Productos cotizados', singular: 'producto cotizado',
    icon: 'list', group: 'Ventas', gender: 'm', read: [ADMIN], write: [], hidden: true,
    labelSql: "CONCAT('Detalle ', {a}.id_detalle)", order: ['id_detalle', 'asc'],
    fields: [
      F('id_cotizacion', 'Cotización', 'fk', { ref: 'cotizaciones', required: true, filter: true }),
      F('id_producto', 'Producto', 'fk', { ref: 'productos', required: true, list: true }),
      F('cotd_cantidad', 'Cantidad', 'int', { required: true, min: 1, list: true }),
      F('cotd_precio', 'Precio unit.', 'money', { list: true, help: 'Precio de venta (con IVA) al momento de la solicitud.' }),
      F('cotd_total', 'Subtotal', 'money', { readonly: true, list: true }),
    ],
  },

  // ------------------------------------------------------------ Administración
  vendedores: {
    table: 'sf_vendedor', pk: 'id_vendedor', title: 'Vendedores', singular: 'vendedor',
    icon: 'badge', group: 'Administración', gender: 'm', write: [ADMIN],
    labelSql: '{a}.vend_nombre', order: ['vend_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('vend_nombre', 'Nombre', 'text', { required: true, max: 100, list: true, search: true }),
      F('vend_telefono', 'Teléfono', 'text', { max: 20, list: true }),
      F('vend_correo', 'Correo', 'email', { max: 100, list: true }),
      F('vend_fecha_ingreso', 'Fecha de ingreso', 'date', { required: true, default: 'today', list: true }),
      F('vend_activo', 'Activo', 'bool', { default: 1, list: true, filter: true }),
    ],
    extras: [X('documentos', 'Documentos',
      'SELECT COUNT(*) FROM sf_pedido_terminado x WHERE x.id_vendedor = t.id_vendedor')],
  },
  usuarios: {
    table: 'sf_usuario', pk: 'id_usuario', title: 'Usuarios', singular: 'usuario',
    icon: 'key', group: 'Administración', gender: 'm', read: [ADMIN], write: [ADMIN],
    labelSql: '{a}.usu_nombre', order: ['usu_nombre', 'asc'], fkMode: 'select',
    fields: [
      F('usu_nombre', 'Usuario', 'text', { required: true, max: 30, list: true, search: true }),
      F('password', 'Contraseña', 'password', {
        virtual: true, minLength: 8, help: 'Mínimo 8 caracteres. Al editar, déjala vacía para mantener la actual.',
      }),
      F('usu_permiso', 'Permiso', 'enum', { options: ALL_ROLES, required: true, default: CONSULTA, list: true, filter: true }),
      F('id_vendedor', 'Vendedor asociado', 'fk', { ref: 'vendedores', list: true }),
      F('usu_activo', 'Activo', 'bool', { default: 1, list: true, filter: true }),
      F('usu_ultimo_acceso', 'Último acceso', 'datetime', { readonly: true, list: true }),
    ],
  },
  // Registro único: se edita como formulario de configuración (sin crear ni eliminar).
  empresa: {
    table: 'sf_empresa', pk: 'id_empresa', title: 'Configuración de la empresa', singular: 'configuración',
    icon: 'building', group: 'Administración', gender: 'f', read: [ADMIN], write: [ADMIN], singleton: true,
    labelSql: '{a}.emp_nombre', order: ['id_empresa', 'asc'], fkMode: 'select',
    fields: [
      F('emp_nombre', 'Nombre', 'text', { required: true, max: 100, list: true, full: true }),
      F('emp_rut', 'RUT', 'rut', { max: 12, list: true }),
      F('emp_correo', 'Correo', 'email', { max: 100, list: true }),
      F('emp_whatsapp', 'WhatsApp', 'text', {
        max: 20, list: true, placeholder: '+56 9 1234 5678',
        help: 'Número para los botones de cotizar en la página web.',
      }),
      F('emp_horario', 'Horario de atención', 'text', { max: 150, list: true, placeholder: 'Lunes a viernes 9:00 a 18:00' }),
      F('emp_direccion', 'Dirección', 'text', { max: 150, list: true, full: true, placeholder: 'Calle 123, Iquique' }),
      F('emp_slogan', 'Slogan', 'text', { max: 150, list: true, full: true, help: 'Se muestra bajo el nombre en el menú, el inicio de sesión y la página web.' }),
      F('emp_web_precios', 'Mostrar precios en la web', 'bool', {
        default: false, list: true, full: true, help: 'Si está desactivado, el catálogo público invita a cotizar sin mostrar precios.',
      }),
      F('emp_url_img', 'URL del logo', 'url', {
        max: 500, list: true, full: true, placeholder: 'https://…/logo.png',
        help: 'Enlace público a una imagen (PNG, JPG, SVG o WEBP). Idealmente cuadrada.',
      }),
    ],
  },
};

const GROUP_ORDER = ['Inventario', 'Ventas', 'Administración'];

for (const [key, mod] of Object.entries(MODULES)) {
  Object.assign(mod, {
    key,
    read: mod.read ?? ALL_ROLES,
    write: mod.write ?? EDITORS,
    extras: mod.extras ?? [],
    actions: mod.actions ?? [],
    fkMode: mod.fkMode ?? 'search',
    dateField: mod.dateField ?? null,
    fieldMap: Object.fromEntries(mod.fields.map(f => [f.name, f])),
  });
}

export const canRead = (mod, role) => mod.read.includes(role);
export const canWrite = (mod, role) => mod.write.includes(role);

// Metadatos que se envían al navegador (sin SQL). Los nombres de propiedades
// son los que ya usa el frontend.
export function publicMeta(role) {
  return Object.values(MODULES)
    .filter(mod => canRead(mod, role))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    .map(mod => ({
      key: mod.key, pk: mod.pk, title: mod.title, singular: mod.singular, gender: mod.gender,
      icon: mod.icon, group: mod.group, fk_mode: mod.fkMode, date_field: mod.dateField,
      order: mod.order, can_write: canWrite(mod, role), singleton: Boolean(mod.singleton),
      can_create: canWrite(mod, role) && !mod.singleton && !mod.noCreate, hidden: Boolean(mod.hidden),
      page_actions: (mod.pageActions ?? []).filter(a => !a.roles || a.roles.includes(role)).map(({ roles, ...a }) => a),
      fields: mod.fields.map(({ minLength, ...f }) => ({ ...f, virtual: Boolean(f.virtual), min_length: minLength })),
      extras: mod.extras.map(({ sql, ...e }) => e),
      // Acciones: navegar a otro módulo (module/filter), descargar (download), copiar o compartir un enlace
      // (copy/share, con {campo} de la fila) o escribir por WhatsApp al número de un campo (whatsapp).
      actions: mod.actions.filter(a => (a.module ? canRead(MODULES[a.module], role) : a.download ? canRead(MODULES.pedidos, role) : true)),
    }));
}
