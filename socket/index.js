import { WebSocketServer } from 'ws';
import path from 'path'
import fs from 'fs'
import hbjs from 'handbrake-js'


class WebsocketConnection {
  init = server => {
    const getVideoConverted = this.#getVideoConverted
    const wss = new WebSocketServer({ server , path:"/getVideoConverted" });

    wss.on('connection', function connection(ws) {
      ws.on('message', function message(data) {
        ws.send('processing')
        getVideoConverted(ws)
      });
    });
  }
  
  async #getFileFromFolder () {
    try {
      const resp = await fs.promises.readdir(path.resolve('uploads'))
      return resp[0]
    } catch (err) {
      return err
    }
  }

  #getVideoConverted = async ws => {
    try {
      const file = await this.#getFileFromFolder()
      const filename = path.parse(file).name
      const filePath = path.resolve('uploads')

      hbjs.spawn({ input: `${filePath}/${file}`, output: `${filePath}/${filename}.avi` })
      .on('error', err => {
        ws.send(err)
      })
      .on('progress', progress => {
        console.log(progress.percentComplete)
        ws.send(Number(progress.percentComplete))
      })
    
    } catch (err) {
      ws.send(err.message)
    }
  }
}

export default new WebsocketConnection()