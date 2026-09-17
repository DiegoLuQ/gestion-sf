// 005 · WhatsApp de ventas para la página web (+56 9 8173 2415), solo si aún no hay uno configurado.
export const descripcion = 'WhatsApp de ventas en la configuración de la empresa';

export async function up({ conn }) {
  const [r] = await conn.query(
    "UPDATE sf_empresa SET emp_whatsapp = '+56 9 8173 2415' WHERE id_empresa = 1 AND (emp_whatsapp IS NULL OR emp_whatsapp = '')");
  return r.affectedRows ? 'WhatsApp de ventas configurado.' : 'Ya había un WhatsApp configurado: se conservó.';
}
