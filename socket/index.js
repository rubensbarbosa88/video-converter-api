import { WebSocketServer } from 'ws';
import path from 'path'
import fs from 'fs'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'
ffmpeg.setFfmpegPath(ffmpegInstaller.path)


class WebsocketConnection {
  init = server => {
    const getVideoConverted = this.#getVideoConverted
    const wss = new WebSocketServer({ server , path:"/getVideoConverted" });

    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        const req = data.toString()
        ws.send(JSON.stringify('Processando'))
        getVideoConverted(ws, req)
      });
    });
  }

  #getVideoConverted = async (ws, req) => {
    try {
      const file = await this.#getFileFromFolder(req)
      const filename = path.parse(file).name
      const filePath = path.resolve('uploads')
      const videoPath = {
        input: `${filePath}/${file}`,
        output: `${filePath}/${filename}.avi`
      }

      let totalTime
      ffmpeg(videoPath.input)
        .output(videoPath.output)
        .on('start', () => { ws.send(JSON.stringify('Iniciando')) })
        .on('codecData', data => {
          totalTime = this.#timeToNumber(data.duration)
        })
        .on('progress', progress => {
          const time = this.#timeToNumber(progress.timemark)
          const percent = parseInt((time / totalTime) * 100)

          ws.send(progress.percent || percent)
        })
        .on('error', err => { throw err })
        .on('end', () => { ws.send(JSON.stringify({video: `${filename}.avi` })) })
        .run()

    } catch (err) {
      ws.send(JSON.stringify(err.message))
    }
  }

  async #getFileFromFolder (fileName) {
    try {
      const resp = await fs.promises.readdir(path.resolve('uploads'))
      const file = resp.find(item => item === fileName)

      return file
    } catch (err) {
      return err
    }
  }

  #timeToNumber (time) {
    return parseInt(time.replace(/:/g, ''))
  }
}

export default new WebsocketConnection()
