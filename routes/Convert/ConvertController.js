import multer from 'multer'
import fs from 'fs'
import path, { resolve } from 'path'
import { rejects } from 'assert'
// import hbjs from 'handbrake-js'

class ConvertController {
  #uploadVideo (req, res) {
    return new Promise((resolve, reject) => {
      const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'uploads/'),
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}${Math.round(Math.random() * 1E9)}`
          cb(null, `${uniqueSuffix}_${file.originalname}`) 
        }
      })
  
      const upload = multer({ storage }).single('video')
  
      upload(req, res, err => { 
        if (err) reject(err)
        resolve(req.file)
      })
    })
  }

  postVideo = async (req, res) => {
    try {
      const response = await this.#uploadVideo(req, res)
      
      res.json({ video: response.filename })
    } catch (err) {
      res.status(400).json({ message: err})
    }
  }

  getVideo = async (req, res) => {
    try {
      const files = await fs.promises.readdir(path.resolve('uploads'))
      const video = files[req.params.video]
      
      console.log('PARAMS >>>', req.params)
      console.log(video)
      res.download(video)
    } catch (err) {
      return err
    }
  }
}

export default new ConvertController()
