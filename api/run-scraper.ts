import { VercelRequest, VercelResponse } from '@vercel/node';
import { ejecutarTodo } from '../src/index';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // Seguridad básica: Solo permitir que el Cron de Vercel lo ejecute
  const authHeader = request.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return response.status(401).json({ error: 'No autorizado' });
  }

  try {
    console.log("Iniciando tarea programada de scraping...");

    // Llamamos a la lógica que Claude está programando
    const resultado = await ejecutarTodo();

    return response.status(200).json({
      success: true,
      message: "Scraping completado con éxito",
      data: resultado
    });
  } catch (error) {
    console.error("Error en el scraper:", error);
    return response.status(500).json({ error: "Fallo en la ejecución" });
  }
}
