import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/prisma.js';
import { importCompliancePayload, type ImportMode, type ImportPayload } from './compliance-import.js';

type ImportArgs = {
  file: string;
  mode: ImportMode;
};

function parseArgs(argv: string[]): ImportArgs {
  let file = '';
  let mode: ImportMode = 'merge';

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--file') {
      file = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (current === '--replace') {
      mode = 'replace';
    }
  }

  if (!file) {
    throw new Error('Missing required --file argument.');
  }

  const resolveFrom = process.env.INIT_CWD ?? process.cwd();

  return {
    file: path.resolve(resolveFrom, file),
    mode
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.file, 'utf8');
  const payload = JSON.parse(raw) as ImportPayload;
  const result = await importCompliancePayload(payload, args.mode);

  console.log(
    JSON.stringify(
      {
        file: args.file,
        mode: args.mode,
        imported: result.imported
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
