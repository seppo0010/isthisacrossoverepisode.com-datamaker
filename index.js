import { execa } from 'execa'
import * as fs from 'fs'
import { parseSync } from 'subtitle'

const directory = (process.env.DATAMAKER_DIR || 'data').replace(/\/+$/, '') + '/'

const getSubtitleForFile = async (path) => {
  const proc = await execa('ffmpeg', ['-i', path, '-map', '0:s:0', '-f', 'srt', '-'])
  return parseSync(proc.stdout)
};

(async () => {
  const files = fs.readdirSync(directory)
  files.forEach(async (file) => {
    const subs = await getSubtitleForFile(directory + file)
    subs.forEach((sub) => {
      console.log(sub)
    })
  })
})()
