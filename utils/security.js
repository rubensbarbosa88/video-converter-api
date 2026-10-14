import rateLimit from 'express-rate-limit'

/**
 * Carrega a lista de origens/domínios permitidos.
 * Pode ser configurada via variável de ambiente ALLOWED_ORIGINS (separada por vírgula).
 */
export function getAllowedOrigins() {
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (envOrigins) {
    return envOrigins
      .split(',')
      .map(origin => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  }

  // Origens padrão para desenvolvimento local caso nenhuma variável tenha sido configurada
  return [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5500'
  ]
}

/**
 * Valida se uma determinada origem pertence à lista permitida
 * @param {string} origin Origem da requisição (ex: https://meusite.com)
 * @returns {boolean}
 */
export function isOriginAllowed(origin) {
  if (!origin) return false

  const normalized = origin.trim().replace(/\/$/, '').toLowerCase()
  const allowed = getAllowedOrigins().map(o => o.toLowerCase())

  return allowed.includes(normalized)
}

/**
 * Configuração de CORS restrito para o Express
 */
export const corsOptions = {
  origin: (origin, callback) => {
    // Requisições sem Origin (como cURL em dev, testes locais ou tarefas internas)
    if (!origin) {
      if (process.env.NODE_ENV === 'production' && process.env.REQUIRE_ORIGIN === 'true') {
        return callback(new Error('Origem não informada. Requisições diretas não autorizadas.'))
      }
      return callback(null, true)
    }

    if (isOriginAllowed(origin)) {
      return callback(null, true)
    }

    return callback(new Error(`Acesso negado: a origem "${origin}" não está autorizada pela política CORS.`))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400 // Cache do preflight OPTIONS no navegador por 24 horas
}

/**
 * Validador de handshake para o WebSocket Server (ws)
 */
export function verifyWebSocketOrigin(info, callback) {
  const origin = info.origin || info.req.headers.origin

  // Conexões locais ou sem cabeçalho Origin
  if (!origin) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[Security] Conexão WebSocket rejeitada: cabeçalho Origin ausente em ambiente de produção.')
      return callback(false, 403, 'Acesso WebSocket negado: cabeçalho Origin ausente.')
    }
    return callback(true)
  }

  if (isOriginAllowed(origin)) {
    return callback(true)
  }

  console.warn(`[Security] Conexão WebSocket bloqueada de origem não autorizada: ${origin}`)
  return callback(false, 403, 'Acesso WebSocket negado: Origem não autorizada.')
}

/**
 * Rate Limiter Global para qualquer endpoint da API
 * Previne ataques de força bruta, scraping ou negação de serviço geral
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Janela de 15 minutos
  max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '200', 10), // Até 200 requisições por IP a cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas requisições a partir deste endereço IP. Por favor, aguarde alguns minutos antes de tentar novamente.'
  }
})

/**
 * Rate Limiter Específico para Uploads de Vídeo
 * Como o upload e processamento de vídeo consomem muita CPU e I/O de disco,
 * este limite é mais rigoroso por IP
 */
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Janela de 15 minutos
  max: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX || '15', 10), // Máximo de 15 uploads por IP a cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Limite de uploads excedido para este IP. Aguarde alguns minutos antes de enviar outro vídeo.'
  }
})

/**
 * Rate Limiter para downloads de vídeos convertidos
 */
export const downloadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_DOWNLOAD_MAX || '40', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitos downloads solicitados recentemente. Por favor, aguarde alguns minutos.'
  }
})

