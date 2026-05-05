import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { prisma } from '../src/prisma.js';
import { listGoveeDevices, syncTemperatureAssetsWithGovee } from '../src/govee.js';

function parseArgs(argv: string[]) {
  let discover = false;
  let assetId = '';

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--discover') {
      discover = true;
      continue;
    }

    if (current === '--asset-id') {
      assetId = argv[index + 1] ?? '';
      index += 1;
    }
  }

  return { assetId, discover };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.discover) {
    const devices = await listGoveeDevices();
    console.log(JSON.stringify({ count: devices.length, devices }, null, 2));
    return;
  }

  const result = await syncTemperatureAssetsWithGovee({
    assetId: args.assetId || undefined
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
