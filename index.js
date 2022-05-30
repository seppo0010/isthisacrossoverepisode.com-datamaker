import { execa } from 'execa'
import * as fs from 'fs'
import { parseSync } from 'subtitle'
import MiniSearch from 'minisearch'
import striptags from 'striptags'
import episodeParser from 'episode-parser';

const sourceDirectory = (process.env.DATAMAKER_SRC_DIR || 'data').replace(/\/+$/, '') + '/'
const targetDirectory = (process.env.DATAMAKER_TARGET_DIR || 'out').replace(/\/+$/, '') + '/'
fs.mkdirSync(targetDirectory, { recursive: true })

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
    const episode = episodeParser(file)
    const episodePath = `${targetDirectory}${episode.season}x${(episode.episode + '').padStart(2, '0')}/`
    fs.mkdirSync(episodePath, { recursive: true })
    const subs = (await getSubtitleForFile(path)).filter((sub) => sub && sub.data && sub.data.start !== undefined)

    // minisearch configuration must match web's
    const miniSearch = new MiniSearch({ fields: ['text'], storeFields: ['html', 'season', 'episode', 'stillPath'] })
    miniSearch.addAll(subs.map((sub) => ({
      text: striptags(sub.data.text),
      html: sub.data.text,
      season: episode.season,
      episode: episode.episode,
      stillPath: `${episodePath.substr(targetDirectory.length)}${sub.data.start}.png`,
      id: sub.data.start
    })))
    fs.writeFileSync(targetDirectory + 'index.json', JSON.stringify(miniSearch))

    for (const sub of subs) {
      const target = `${episodePath}${sub.data.start}.png`
      if (fs.existsSync(target)) continue
      await saveStillImage(path, sub.data.start, target)
      process.stderr.write(`created still image for second ${sub.data.start}\n`)
    }
  })
})()
