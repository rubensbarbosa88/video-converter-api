import express from 'express'
import ConvertController from './ConvertController.js' 
const router = express.Router();

/* GET home page. */
router
    .get('/:video', ConvertController.getVideo)
    .post('/', ConvertController.postVideo)

export default router
