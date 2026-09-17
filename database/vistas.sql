-- =====================================================================
--  Santiago Filtros · Vistas del panel de inicio
--
--  Crea (o reemplaza) las vistas v_ventas_mensuales y v_producto_stock_bajo.
--  Se puede ejecutar varias veces sin problema.
--
--  Uso en Hostinger: phpMyAdmin > selecciona la base > pestaña SQL > pega este archivo > Continuar.
--  Uso local:        npm run vistas
--
--  Sin DEFINER y con SQL SECURITY INVOKER: funciona con el usuario de la base de Hostinger,
--  que no tiene el privilegio SET USER (error #1227).
-- =====================================================================

-- Ventas por mes a partir de las líneas de salida (montos con IVA). No cuenta pedidos anulados.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_ventas_mensuales AS
SELECT DATE_FORMAT(s.salip_fecha, '%Y-%m')   AS mes,
       COUNT(DISTINCT s.id_n_pedido)         AS pedidos,
       SUM(s.salip_total)                    AS venta,
       SUM(s.salip_cantidad * s.salip_costo) AS costo
FROM sf_salida_productos s
JOIN sf_pedido p ON p.id_n_pedido = s.id_n_pedido
WHERE p.nump_estado <> 'ANULADO'
GROUP BY DATE_FORMAT(s.salip_fecha, '%Y-%m');

-- Productos disponibles con stock igual o menor a su stock mínimo.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_producto_stock_bajo AS
SELECT pr.id_producto, pr.prod_codigo, pr.prod_descripcion, m.marca_nombre,
       pr.prod_cantidad, pr.prod_stock_minimo
FROM sf_producto pr
JOIN sf_marca m ON m.id_marca = pr.id_marca
WHERE pr.prod_estado = 'Disponible'
  AND pr.prod_cantidad <= pr.prod_stock_minimo;
