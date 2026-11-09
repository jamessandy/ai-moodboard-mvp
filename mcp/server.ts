import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { buildMoodblendyToolPayload } from '../lib/mcp.js'

const server = new McpServer({
  name: 'moodblendy',
  version: '1.0.0',
})

server.tool(
  'moodblendy.create_board',
  'Create a structured Moodblendy board request that ChatGPT can hand to the app.',
  {
    brief: z.string().optional(),
    style: z.string().optional(),
    colors: z.array(z.string()).optional(),
    references: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional(),
  },
  async ({ brief, style, colors, references, notes }) => {
    const payload = buildMoodblendyToolPayload({ brief, style, colors, references, notes })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
