// Errores de la API y traducción de errores de MySQL a mensajes para el usuario.

export class ApiError extends Error {
  constructor(message, status = 400, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const invalid = errors => new ApiError('Revisa los campos marcados.', 422, errors);

const FRIENDLY_CHECKS = {
  chk_prod_stock: 'Stock insuficiente: la cantidad supera el stock disponible del producto.',
  chk_salida_cantidad: 'La cantidad debe ser mayor que cero.',
};

export function dbError(err) {
  const msg = err.sqlMessage || err.message || '';
  switch (err.errno) {
    case 1451:
      return new ApiError('No se puede eliminar: hay otros registros que dependen de este. '
        + 'Puedes marcarlo como inactivo o descontinuado.', 409);
    case 1452:
      return new ApiError('Uno de los registros relacionados no existe.', 422);
    case 1062:
      return new ApiError(`Ya existe un registro con ese valor único${
        msg.includes('numero') ? ' (número de pedido).' : msg.includes('documento_pedido') ? ' (el pedido ya tiene documento).' : '.'}`, 409);
    case 3819: {
      const name = Object.keys(FRIENDLY_CHECKS).find(k => msg.includes(k));
      return new ApiError(name ? FRIENDLY_CHECKS[name] : 'Los datos no cumplen las reglas de la base de datos.', 422);
    }
    case 1264:
    case 1406:
      return new ApiError('Un valor es demasiado grande para el campo.', 422);
    default:
      return null;
  }
}
