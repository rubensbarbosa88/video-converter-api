import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import logger from 'morgan'

import convertRouter from './routes/Convert/index.js'

const app = express()

app.use(cors())
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
  console.error('Unhandled express error:', err)
  res.status(err.status || 500).json({ message: err.message || 'Erro interno no servidor' })
})

export default app
