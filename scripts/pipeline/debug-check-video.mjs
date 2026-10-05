#!/usr/bin/env node
// One-off diagnostic: prints a YouTube video's actual server-side
// snippet/status/processingDetails -- in particular snippet.thumbnails
// -- so a question like "did the custom thumbnail really get set?" can
// be answered against the real API response instead of Studio's UI,
// which can lag behind what's actually registered.
//
// Usage: node scripts/pipeline/debug-check-video.mjs --video-id <id>

import { loadEnv } from '../lib/env.mjs';
import { getVideo } from '../lib/youtube.mjs';

loadEnv();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--video-id') args.videoId = argv[++i];
  }
  return args;
}

async function main() {
  const { videoId } = parseArgs(process.argv.slice(2));
  if (!videoId) {
    console.error('Usage: node scripts/pipeline/debug-check-video.mjs --video-id <id>');
    process.exitCode = 1;
    return;
  }

  const video = await getVideo(videoId);
  console.log(JSON.stringify(video, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
