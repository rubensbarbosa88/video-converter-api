import express from 'express'
import ConvertController from './ConvertController.js'
import { uploadLimiter, downloadLimiter } from '../../utils/security.js'

const router = express.Router()

/* Rotas de conversão com rate limits específicos */
router
  .get('/:video', downloadLimiter, ConvertController.getVideo)
  .post('/', uploadLimiter, ConvertController.postVideo)

export default router
