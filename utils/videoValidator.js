import ffmpeg from 'fluent-ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import { fileTypeFromFile } from 'file-type'
import path from 'path'

// Configura o caminho do binário ffprobe fornecido pelo instalador
ffmpeg.setFfprobePath(ffprobeInstaller.path)

/**
 * Extensões de vídeo expressamente permitidas
 */
export const ALLOWED_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm',
  '.mov',
  '.flv',
  '.wmv',
  '.3gp',
  '.ts',
  '.ogv',
  '.mpg',
  '.mpeg'
])

/**
 * Verifica se a extensão do arquivo consta na lista de permitidas
 * @param {string} filename Nome do arquivo original
 * @returns {boolean}
 */
export function isAllowedVideoExtension(filename) {
  if (!filename || typeof filename !== 'string') return false
  const ext = path.extname(filename).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext)
}

/**
 * Validação rigorosa em multicamadas para uploads de vídeo:
 * 1. Magic Bytes: inspeciona os primeiros bytes do arquivo para verificar o tipo MIME real
 * 2. Análise Estrutural (FFprobe): garante que o container não é forjado/corrompido e contém fluxo de vídeo
 * @param {string} filePath Caminho absoluto do arquivo no disco
 * @returns {Promise<{detectedType: object, metadata: object}>}
 */
export async function validateUploadedVideo(filePath) {
  // 1. Verificação de Magic Bytes (Assinatura binária real do arquivo)
  const detectedType = await fileTypeFromFile(filePath)
  if (!detectedType || !detectedType.mime || !detectedType.mime.startsWith('video/')) {
    const detectedInfo = detectedType ? `tipo detectado: ${detectedType.mime}` : 'formato não reconhecido como mídia'
    throw new Error(
      `Conteúdo do arquivo inválido (${detectedInfo}). Apenas arquivos de vídeo legítimos são aceitos.`
    )
  }

  // 2. Inspeção profunda de integridade estrutural e codecs com ffprobe
  return new Promise((resolve, reject) => {
    let finished = false
    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true
        reject(new Error('Tempo limite excedido ao validar integridade do vídeo.'))
      }
    }, 10000)

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)

      if (err) {
        return reject(
          new Error('Arquivo de vídeo corrompido, truncado ou forjado. Falha na leitura dos metadados.')
        )
      }

      if (!metadata || !Array.isArray(metadata.streams) || metadata.streams.length === 0) {
        return reject(
          new Error('Nenhum fluxo de mídia válido encontrado no arquivo.')
        )
      }

      const hasVideoStream = metadata.streams.some(stream => stream.codec_type === 'video')
      if (!hasVideoStream) {
        return reject(
          new Error('O arquivo enviado não possui nenhum fluxo de vídeo válido.')
        )
      }

      resolve({
        detectedType,
        metadata
      })
    })
  })
}

