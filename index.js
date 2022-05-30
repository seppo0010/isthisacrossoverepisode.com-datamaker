import { execa } from 'execa'
import * as fs from 'fs'
import { parseSync } from 'subtitle'
import MiniSearch from 'minisearch'

const sourceDirectory = (process.env.DATAMAKER_SRC_DIR || 'data').replace(/\/+$/, '') + '/'
const targetDirectory = (process.env.DATAMAKER_TARGET_DIR || 'out').replace(/\/+$/, '') + '/'
fs.mkdirSync(targetDirectory)

const getSubtitleForFile = async (path) => {
  const proc = await execa('ffmpeg', ['-i', path, '-map', '0:s:0', '-f', 'srt', '-'])
  return parseSync(proc.stdout)
}

const saveStillImage = async (path, start, target) => {
  await execa('ffmpeg', ['-ss', Math.round(start / 1000), '-i', path, '-filter:v', 'scale=360:-1', '-frames:v', '1', '-q:v', '2', target])
};

(async () => {
  const files = fs.readdirSync(sourceDirectory)
  files.forEach(async (file) => {
    const path = sourceDirectory + file
    const subs = (await getSubtitleForFile(path)).filter((sub) => sub && sub.data && sub.data.start !== undefined)

    const miniSearch = new MiniSearch({ fields: ['text'], storeFields: ['text'] })
    miniSearch.addAll(subs.map((sub) => ({
      text: sub.data.text,
      id: sub.data.start
    })))
    fs.writeFileSync('out/index.json', JSON.stringify(miniSearch))

    for (const sub of subs) {
      const target = targetDirectory + sub.data.start + '.png'
      if (fs.existsSync(target)) continue
      await saveStillImage(path, sub.data.start, target)
      process.stderr.write(`created still image for second ${sub.data.start}\n`)
    }
  })
})()
