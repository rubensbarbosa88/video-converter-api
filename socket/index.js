import { WebSocketServer } from 'ws'
import path from 'path'
import fs from 'fs'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import ffmpeg from 'fluent-ffmpeg'
import { UPLOADS_DIR, scheduleFileDeletion, deleteFileImmediate } from '../utils/fileCleanup.js'
import { verifyWebSocketOrigin } from '../utils/security.js'

ffmpeg.setFfmpegPath(ffmpegInstaller.path)
ffmpeg.setFfprobePath(ffprobeInstaller.path)

class WebsocketConnection {
  init(server) {
    const wss = new WebSocketServer({
      server,
      path: '/getVideoConverted',
      verifyClient: verifyWebSocketOrigin
    })

    wss.on('connection', ws => {
      ws.on('message', data => {
        const rawReq = data.toString()
        this.#sendSafe(ws, 'Recebendo vídeo')
        this.#getVideoConverted(ws, rawReq)
      })

      ws.on('error', err => {
        console.error('WebSocket client error:', err.message)
      })
    })
  }

  async #getVideoConverted(ws, rawReq) {
    let targetOutputFilePath = null

    try {
      let requestedFile = ''
      let targetFormat = 'mp4' // Formato padrão caso não seja especificado

      // 1. Extração do nome do vídeo e do formato de destino desejado pelo front
      try {
        const parsed = JSON.parse(rawReq)
        if (parsed && typeof parsed === 'object') {
          requestedFile = parsed.video || parsed.fileName || parsed.file || ''
          targetFormat = parsed.format || parsed.targetFormat || parsed.outputFormat || parsed.type || parsed.ext || targetFormat
        }
      } catch {
        // Se o front enviar string pura, suporta formato "arquivo.mp4" ou "arquivo.mp4;avi" / "arquivo.mp4:avi"
        if (typeof rawReq === 'string') {
          const parts = rawReq.trim().split(/[;:]/)
          requestedFile = parts[0]
          if (parts.length > 1 && parts[1]) {
            targetFormat = parts[1].trim()
          }
        }
      }

      // Normalização e sanitização da extensão de saída
      targetFormat = String(targetFormat).replace(/^\./, '').toLowerCase().trim()
      const allowedFormats = ['mp4', 'avi', 'mkv', 'webm', 'mov', 'flv', 'wmv', 'mp3', 'gif']
      if (!allowedFormats.includes(targetFormat)) {
        targetFormat = 'mp4'
      }

      const file = this.#getFileFromFolder(requestedFile)
      const parsedFile = path.parse(file)
      const filename = parsedFile.name
      const outputFilename = `${filename}.${targetFormat}`

      const videoPath = {
        input: path.join(UPLOADS_DIR, file),
        output: path.join(UPLOADS_DIR, outputFilename)
      }
      targetOutputFilePath = videoPath.output

      let totalSeconds = 0

      ffmpeg(videoPath.input)
        .inputOptions([
          '-protocol_whitelist', 'file,crypto,data'
        ])
        .output(videoPath.output)
        .on('start', () => {
          this.#sendSafe(ws, `Processando conversão para ${targetFormat.toUpperCase()}`)
        })
        .on('codecData', data => {
          if (data?.duration) {
            totalSeconds = this.#timeToSeconds(data.duration)
          }
        })
        .on('progress', progress => {
          let percent = progress.percent

          // Fallback caso o ffmpeg não informe o percentual diretamente
          if ((percent === undefined || percent === null || isNaN(percent) || percent < 0) && totalSeconds > 0 && progress.timemark) {
            const currentSeconds = this.#timeToSeconds(progress.timemark)
            percent = Math.min(100, Math.round((currentSeconds / totalSeconds) * 100))
          } else {
            percent = Math.min(100, Math.max(0, Math.round(percent || 0)))
          }

          this.#sendSafe(ws, percent, 'progress')
        })
        .on('error', err => {
          console.error('Erro durante o processamento do FFmpeg:', err.message)
          this.#sendSafe(ws, err.message || 'Erro na conversão do vídeo', 'error')

          // Remove arquivo parcial corrompido se foi criado
          if (targetOutputFilePath && fs.existsSync(targetOutputFilePath)) {
            fs.unlink(targetOutputFilePath, () => {})
          }
        })
        .on('end', () => {
          this.#sendSafe(ws, 100, 'progress')
          this.#sendSafe(ws, outputFilename, 'data')

          // O arquivo original enviado já não é mais necessário: exclui na hora para economizar disco
          deleteFileImmediate(videoPath.input)

          // O vídeo convertido fica disponível por 30 minutos para download
          scheduleFileDeletion(videoPath.output)
        })
        .run()

    } catch (err) {
      console.error('Erro na solicitação de conversão:', err.message)
      this.#sendSafe(ws, err.message, 'error')
    }
  }

  #getFileFromFolder(fileName) {
    if (!fileName) {
      throw new Error('Nome do arquivo de vídeo não foi informado.')
    }

    const safeFilename = path.basename(fileName)
    const filePath = path.resolve('uploads', safeFilename)

    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo "${safeFilename}" não foi encontrado para conversão.`)
    }

    return safeFilename
  }

  #timeToSeconds(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return 0
    const parts = timeStr.trim().split(':')
    if (parts.length < 3) return 0
    const hours = parseFloat(parts[0]) || 0
    const minutes = parseFloat(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    return (hours * 3600) + (minutes * 60) + seconds
  }

  #response(message, type = 'message') {
    return JSON.stringify({
      type,
      message
    })
  }

  #sendSafe(ws, message, type = 'message') {
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(this.#response(message, type))
    }
  }
}

export default new WebsocketConnection()
