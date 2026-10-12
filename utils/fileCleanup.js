import fs from 'fs'
import path from 'path'

export const UPLOADS_DIR = path.resolve('uploads')
export const DEFAULT_FILE_TTL_MS = 30 * 60 * 1000 // 30 minutos

// Garante que a pasta uploads existe
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

/**
 * Exclui um arquivo imediatamente com tratamento de erro seguro.
 * @param {string} filePath Caminho do arquivo a ser deletado
 */
export async function deleteFileImmediate(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath)
      console.info(`[Cleanup] Arquivo original excluído após conclusão: ${path.basename(filePath)}`)
    }
  } catch (err) {
    console.error(`[Cleanup] Falha ao excluir arquivo imediatamente ${filePath}:`, err.message)
  }
}

/**
 * Agenda a exclusão de um arquivo específico após o tempo definido (default: 30 minutos).
 * @param {string} filePath Caminho do arquivo a ser deletado
 * @param {number} delayMs Tempo em milissegundos até a exclusão
 */
export function scheduleFileDeletion(filePath, delayMs = DEFAULT_FILE_TTL_MS) {
  setTimeout(async () => {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath)
        console.info(`[Auto-cleanup] Arquivo excluído após expirar (${delayMs / 60000} min): ${path.basename(filePath)}`)
      }
    } catch (err) {
      console.error(`[Auto-cleanup] Falha ao excluir ${filePath}:`, err.message)
    }
  }, delayMs).unref()
}

/**
 * Varre o diretório de uploads e remove qualquer arquivo com mtime superior ao maxAgeMs.
 * @param {number} maxAgeMs Idade máxima do arquivo em milissegundos
 */
export async function cleanExpiredFiles(maxAgeMs = DEFAULT_FILE_TTL_MS) {
  try {
    const files = await fs.promises.readdir(UPLOADS_DIR)
    const now = Date.now()

    for (const file of files) {
      if (file === '.gitkeep') continue

      const filePath = path.join(UPLOADS_DIR, file)
      try {
        const stats = await fs.promises.stat(filePath)
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath)
          console.info(`[Auto-cleanup] Arquivo expirado removido da pasta uploads: ${file}`)
        }
      } catch (err) {
        console.error(`[Auto-cleanup] Erro ao verificar arquivo ${file}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[Auto-cleanup] Erro ao varrer pasta de uploads:', err.message)
  }
}

/**
 * Inicia uma rotina em background que limpa arquivos expirados periodicamente.
 * @param {number} intervalMs Intervalo de verificação em milissegundos (default: 1 minuto)
 */
export function startPeriodicCleanup(intervalMs = 60 * 1000) {
  // Executa uma limpeza inicial na subida do servidor
  cleanExpiredFiles()

  const intervalId = setInterval(() => {
    cleanExpiredFiles()
  }, intervalMs)

  intervalId.unref()
  return intervalId
}

