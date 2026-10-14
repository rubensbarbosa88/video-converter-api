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
  #isConverting = false
  #queue = []

  init(server) {
    const wss = new WebSocketServer({
      server,
      path: '/getVideoConverted',
      verifyClient: verifyWebSocketOrigin
    })

    wss.on('connection', ws => {
      ws.on('message', data => {
        const rawReq = data.toString()
        this.#enqueue(ws, rawReq)
      })

      ws.on('error', err => {
        console.error('WebSocket client error:', err.message)
      })
    })
  }

  #enqueue(ws, rawReq) {
    if (this.#isConverting) {
      this.#queue.push({ ws, rawReq })
      const position = this.#queue.length
      this.#sendSafe(
        ws,
        `Servidor processando outra conversão. Seu vídeo está na fila (posição ${position}) e iniciará automaticamente.`,
        'message'
      )
      return
    }

    this.#startNext(ws, rawReq)
  }

  async #startNext(ws, rawReq) {
    this.#isConverting = true
    this.#sendSafe(ws, 'Recebendo vídeo')

    try {
      await this.#getVideoConverted(ws, rawReq)
    } catch (err) {
      console.error('Erro na solicitação de conversão:', err.message)
      this.#sendSafe(ws, err.message || 'Erro inesperado na conversão.', 'error')
    } finally {
      this.#isConverting = false

      // Força a coleta de lixo no V8 para desalocar buffers de vídeo imediatamente
      if (global.gc) {
        global.gc()
      }

      this.#processQueue()
    }
  }

  #processQueue() {
    while (this.#queue.length > 0) {
      const next = this.#queue.shift()
      if (next.ws && next.ws.readyState === next.ws.OPEN) {
        this.#startNext(next.ws, next.rawReq)
        return
      }
    }
  }

  #getVideoConverted(ws, rawReq) {
    return new Promise((resolve, reject) => {
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

        // Configuração de opções otimizadas para ambientes restritos a 512MB de RAM
        const ffmpegThreads = process.env.FFMPEG_THREADS || '1'
        const outputOptions = [
          `-threads ${ffmpegThreads}`,
          '-max_muxing_queue_size 1024'
        ]

        // Presets rápidos reduzem drasticamente o consumo de memória RAM de buffer e aliviam a CPU
        if (['mp4', 'mkv', 'mov'].includes(targetFormat)) {
          outputOptions.push('-preset veryfast')
        } else if (targetFormat === 'webm') {
          outputOptions.push('-deadline realtime', '-cpu-used 4')
        }

        const command = ffmpeg(videoPath.input)
          .inputOptions([
            '-protocol_whitelist', 'file,crypto,data'
          ])
          .outputOptions(outputOptions)
          .output(videoPath.output)

        // Se o cliente fechar o navegador/aba durante a conversão, aborta o FFmpeg para liberar CPU e RAM
        const onWsClose = () => {
          try {
            console.info('[WebSocket] Cliente desconectado. Abortando processo FFmpeg para liberar recursos...')
            command.kill('SIGKILL')
          } catch {}
          if (targetOutputFilePath && fs.existsSync(targetOutputFilePath)) {
            fs.unlink(targetOutputFilePath, () => {})
          }
        }

        ws.once('close', onWsClose)

        command
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
            ws.removeListener('close', onWsClose)
            console.error('Erro durante o processamento do FFmpeg:', err.message)
            this.#sendSafe(ws, err.message || 'Erro na conversão do vídeo', 'error')

            // Remove arquivo parcial corrompido se foi criado
            if (targetOutputFilePath && fs.existsSync(targetOutputFilePath)) {
              fs.unlink(targetOutputFilePath, () => {})
            }
            resolve()
          })
          .on('end', () => {
            ws.removeListener('close', onWsClose)
            this.#sendSafe(ws, 100, 'progress')
            this.#sendSafe(ws, outputFilename, 'data')

            // O arquivo original enviado já não é mais necessário: exclui na hora para economizar disco
            deleteFileImmediate(videoPath.input)

            // O vídeo convertido fica disponível para download
            scheduleFileDeletion(videoPath.output)
            resolve()
          })
          .run()

      } catch (err) {
        if (targetOutputFilePath && fs.existsSync(targetOutputFilePath)) {
          fs.unlink(targetOutputFilePath, () => {})
        }
        reject(err)
      }
    })
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
