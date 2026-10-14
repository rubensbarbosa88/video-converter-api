import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { UPLOADS_DIR, scheduleFileDeletion, deleteFileImmediate } from '../../utils/fileCleanup.js'
import { isAllowedVideoExtension, validateUploadedVideo } from '../../utils/videoValidator.js'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')
    cb(null, `${uniqueSuffix}_${safeOriginalName}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!isAllowedVideoExtension(file.originalname)) {
      const ext = path.extname(file.originalname) || 'desconhecida'
      return cb(new Error(`Extensão "${ext}" não permitida. Apenas arquivos de vídeo são permitidos para upload.`))
    }

    if (file.mimetype && !file.mimetype.startsWith('video/') && file.mimetype !== 'application/octet-stream') {
      return cb(new Error('MIME type inválido. Apenas arquivos de vídeo são permitidos para upload.'))
    }

    cb(null, true)
  }
})

class ConvertController {
  postVideo = (req, res) => {
    upload.single('video')(req, res, async err => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            message: 'O arquivo excede o limite máximo permitido de 200MB.'
          })
        }
        return res.status(400).json({ message: err.message || 'Erro no upload do vídeo.' })
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado no campo "video".' })
      }

      const filePath = path.join(UPLOADS_DIR, req.file.filename)

      try {
        // Validação de segurança em multicamadas: Magic Bytes + FFprobe
        await validateUploadedVideo(filePath)

        // Agenda a exclusão do vídeo original em 30 minutos caso o usuário nunca o converta
        scheduleFileDeletion(filePath)

        return res.status(200).json({ video: req.file.filename })
      } catch (validationErr) {
        // Remove imediatamente o arquivo ilegítimo ou corrompido do servidor
        await deleteFileImmediate(filePath)

        return res.status(400).json({
          message: validationErr.message || 'Arquivo rejeitado pela validação de segurança.'
        })
      }
    })
  }

  getVideo = async (req, res) => {
    try {
      const rawFilename = req.params.video
      if (!rawFilename) {
        return res.status(400).json({ message: 'Nome do arquivo não informado.' })
      }

      // Previne ataques de path traversal
      const safeFilename = path.basename(rawFilename)
      const targetFilePath = path.join(UPLOADS_DIR, safeFilename)

      if (!fs.existsSync(targetFilePath)) {
        return res.status(404).json({ message: 'Vídeo não encontrado ou expirado.' })
      }

      return res.download(targetFilePath, safeFilename, err => {
        if (err && !res.headersSent) {
          res.status(500).json({ message: 'Erro ao transferir o arquivo.' })
        }
      })
    } catch (err) {
      console.error('Erro em getVideo:', err)
      return res.status(500).json({ message: err.message || 'Erro interno no servidor.' })
    }
  }
}

export default new ConvertController()
