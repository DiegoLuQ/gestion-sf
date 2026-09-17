-- =====================================================================
--  Triggers de stock. Se crean DESPUÉS de cargar el historial para que la
--  migración no descuente dos veces el stock actual.
--  Si una salida deja el stock bajo cero, el CHECK chk_prod_stock la rechaza.
--  Ojo: MySQL no dispara triggers en borrados en cascada, por eso las FK
--  de sf_salida_productos usan RESTRICT y la aplicación borra las líneas
--  explícitamente antes de borrar un pedido.
-- =====================================================================

DELIMITER //

CREATE TRIGGER trg_salida_ai AFTER INSERT ON sf_salida_productos
FOR EACH ROW
BEGIN
  UPDATE sf_producto SET prod_cantidad = prod_cantidad - NEW.salip_cantidad
  WHERE id_producto = NEW.id_producto;
END//

CREATE TRIGGER trg_salida_au AFTER UPDATE ON sf_salida_productos
FOR EACH ROW
BEGIN
  UPDATE sf_producto SET prod_cantidad = prod_cantidad + OLD.salip_cantidad
  WHERE id_producto = OLD.id_producto;
  UPDATE sf_producto SET prod_cantidad = prod_cantidad - NEW.salip_cantidad
  WHERE id_producto = NEW.id_producto;
END//

CREATE TRIGGER trg_salida_ad AFTER DELETE ON sf_salida_productos
FOR EACH ROW
BEGIN
  UPDATE sf_producto SET prod_cantidad = prod_cantidad + OLD.salip_cantidad
  WHERE id_producto = OLD.id_producto;
END//

DELIMITER ;
