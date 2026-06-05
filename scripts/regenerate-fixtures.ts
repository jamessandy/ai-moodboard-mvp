import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { compileBoard } from '@/lib/assembler'
import { BoardDoc } from '@/lib/board'

const root = process.cwd()
const inputDir = path.join(root, 'fixtures', 'boards')
const outputDir = path.join(root, 'fixtures', 'compiled')

const mockPalette = ['#123456', '#abcdef', '#f97316']

async function main() {
  await mkdir(outputDir, { recursive: true })
  const files = (await readdir(inputDir)).filter((file) => file.endsWith('.json')).sort()

  for (const file of files) {
    const board = JSON.parse(await readFile(path.join(inputDir, file), 'utf8')) as BoardDoc
    const compiled = await compileBoard(board, {
      extractPalette: async () => mockPalette,
    })

    await writeFile(
      path.join(outputDir, file),
      `${JSON.stringify(
        {
          source: `fixtures/boards/${file}`,
          compiled,
        },
        null,
        2
      )}\n`
    )
  }
}

void main()
