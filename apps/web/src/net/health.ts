/**
 * Клиент и сервер живут на разных доменах и в бою (§1 ТЗ: статика на Vercel, сервер на Fly.io),
 * поэтому адрес сервера задаётся переменной окружения, а не прокси в дев-сервере.
 * Так CORS отлаживается с первого дня, а не в день выкладки.
 */
export const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

/** Ответ сервера приходит из сети, поэтому проверяется, а не приводится к типу на веру. */
function isHealthy(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/health`, { credentials: 'include' });
    if (!response.ok) return false;
    return isHealthy(await response.json());
  } catch {
    return false;
  }
}
