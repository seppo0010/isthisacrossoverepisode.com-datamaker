import { execa } from 'execa'
import * as fs from 'fs'
import { parseSync } from 'subtitle'
import path from 'path'
import MiniSearch from 'minisearch'
import striptags from 'striptags'
import episodeParser from 'episode-parser';
import walk from 'walk'
import OS from 'opensubtitles.com';
import OS_API from 'opensubtitles-api';
import fetch from 'node-fetch';

const sourceDirectory = (process.env.DATAMAKER_SRC_DIR || 'data').replace(/\/+$/, '') + '/'
const targetDirectory = (process.env.DATAMAKER_TARGET_DIR || 'out').replace(/\/+$/, '') + '/'
const imageExtension = process.env.IMAGE_EXTENSION || 'png'
const stillWidth = 720
const thumbnailWidth = 180
fs.mkdirSync(targetDirectory, { recursive: true })

const getSubtitleFromSrtFile = async (path) => {
  const srtPath = path.substring(0, path.length - 3) + 'srt'
  if (fs.existsSync(srtPath)) {
    return parseSync(fs.readFileSync(srtPath, 'utf-8'))
  }
}

const getSubtitleFromTrack = async (path) => {
  try {
    const proc = await execa('ffmpeg', ['-i', path, '-map', '0:s:0', '-f', 'srt', '-'])
    return parseSync(proc.stdout)
  } catch (e) {
    // this is probably ok, most videos do not have a subtitle track
    console.warn('failed to fetch subtitle for', path);
  }
}

let os;
let osLoggedIn = false;
let OpenSubtitles;
if (process.env.OSDB_API_KEY) {
  os = new OS({apikey: process.env.OSDB_API_KEY});
   OpenSubtitles = new OS_API({
      useragent: process.env.OSDB_USERAGENT,
      username:  process.env.OSDB_USERNAME,
      password:  process.env.OSDB_PASSWORD,
      ssl: true,
  })
}

const getSubtitleFromOpenSubtitle = async (path, episode) => {
  if (!process.env.OSDB_API_KEY || !process.env.OSDB_USERNAME || !process.env.OSDB_PASSWORD) return
  if (!osLoggedIn) {
    await os.login({
      username: process.env.OSDB_USERNAME,
      password: process.env.OSDB_PASSWORD,
    });
    osLoggedIn = true;
  }
  const { moviehash } = await OpenSubtitles.hash(path);
  try {
    const { data } = await os.subtitles({
      moviehash: moviehash,
      query: process.env.OSDB_QUERY,
      season_number: episode.season,
      episode_number: episode.episode,
      // sending `languages` here should work but it throws an error
    })
    const sub = data.filter((row) => row.attributes.language === process.env.OSDB_LANGUAGE)[0]
    if (!sub) return;
    const { link } = await os.download({
      file_id: sub.attributes.files[0].file_id,
    });
    const response = await fetch(link);
    const text = await response.text();
    // This is a bad side-effect... maybe it should be a configuration...
    fs.writeFileSync(path.substring(0, path.length - 3) + 'srt', text)

    return parseSync(text)
  } catch (e) {
    console.error('failed to fetch subtitle for', path, e)
  }
}

const getSubtitleForFile = async (path, episode) => {
  return await getSubtitleFromSrtFile(path) || await getSubtitleFromTrack(path) || await getSubtitleFromOpenSubtitle(path, episode);
}

const saveStillImage = async (path, start, target, width) => {
  await execa('ffmpeg', ['-ss', Math.round(start / 1000), '-i', path, '-filter:v', `scale=${width}:-1`, '-frames:v', '1', '-q:v', '2', target])
};

(async () => {
  const miniSearch = new MiniSearch({ fields: ['text'], storeFields: [
    'html', 'season', 'episode',
  ] })
  const processFile = async (filePath) => {
    process.stderr.write(`Processing file ${filePath}\n`)
    const episode = episodeParser(path.basename(filePath).replace(/_/, ' '))
    if (!episode) {
      process.stderr.write(`failed to parse episode for file at ${filePath}\n`)
      return;
    }
    const episodePath = `${targetDirectory}${episode.season}x${(episode.episode + '').padStart(2, '0')}/`
    fs.mkdirSync(episodePath, { recursive: true })
    const subs = (await getSubtitleForFile(filePath, episode) || [])
      .filter((sub) => sub && sub.data && sub.data.start !== undefined)

    process.stderr.write('adding subtitles to index\n')
    // minisearch configuration must match web's
    miniSearch.addAll(subs.map((sub) => ({
      text: striptags(sub.data.text),
      html: sub.data.text,
      season: episode.season,
      episode: episode.episode,
      id: sub.data.start
    })))

    for (const sub of subs) {
      const target = `${episodePath}${sub.data.start}_still.${imageExtension}`
      if (!fs.existsSync(target)) {
        process.stderr.write('creating still image\n')
        await saveStillImage(filePath, sub.data.start, target, stillWidth)
      }
      const thumbnail = `${episodePath}${sub.data.start}_thumbnail.${imageExtension}`
      if (!fs.existsSync(thumbnail)) {
        process.stderr.write('creating thumbnail image\n')
        await saveStillImage(filePath, sub.data.start, thumbnail, thumbnailWidth)
      }
      process.stderr.write(`created images for ${episode.season}x${(episode.episode + '').padStart(2, '0')} on second ${sub.data.start}\n`)
    }
  }
  const walker = walk.walk(sourceDirectory, {
    followLinks: true,
    listeners: {
      file: async (root, fileStats, next) => {
        if (fileStats.type !== 'file') return
        try {
          await processFile(path.join(root, fileStats.name))
        } catch (e) {
          console.warn(e)
        }
        next()
      },
    },
  })
  walker.on('end', () => {
    fs.writeFileSync(targetDirectory + 'index.json', JSON.stringify(miniSearch))
  })
})()
