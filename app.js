import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import logger from 'morgan'

import { corsOptions, apiLimiter } from './utils/security.js'
import convertRouter from './routes/Convert/index.js'

const app = express()

// Habilita trust proxy para proxies reversos (como Render, Cloudflare, Heroku)
// Necessário para que o express-rate-limit identifique o IP real via X-Forwarded-For
app.set('trust proxy', 1)

// Cabeçalhos de segurança HTTP (desabilita X-Powered-By, protege contra MIME sniffing, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

// CORS restrito aos domínios autorizados
app.use(cors(corsOptions))

// Rate limiting global para proteção contra abusos
app.use(apiLimiter)

app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
// app.use(express.static(path.join(__dirname, 'public')));

app.use('/convert', convertRouter)

// Tratamento de rota não encontrada (404)
app.use((req, res) => {
  res.status(404).json({ message: 'Rota não encontrada' })
})

// Tratamento global de erros
app.use((err, req, res, next) => {
  // Trata erro de origem não autorizada pelo CORS
  if (err.message && err.message.includes('política CORS')) {
    return res.status(403).json({ message: err.message })
  }

  console.error('Unhandled express error:', err)
  res.status(err.status || 500).json({ message: err.message || 'Erro interno no servidor' })
})

export default app
