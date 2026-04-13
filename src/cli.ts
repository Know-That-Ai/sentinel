#!/usr/bin/env node

const command = process.argv[2]
const args = process.argv.slice(3)

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined
}

async function main(): Promise<void> {
  switch (command) {
    case 'link':
      console.log('sentinel link: not yet implemented')
      break

    case 'unlink':
      console.log('sentinel unlink: not yet implemented')
      break

    case 'status':
      console.log('sentinel status: not yet implemented')
      break

    case 'flush': {
      const pr = parseFlag('--pr')
      console.log(`sentinel flush --pr ${pr ?? '?'}: not yet implemented`)
      break
    }

    case 'test-webhook': {
      const pr = parseFlag('--pr')
      const type = parseFlag('--type')
      console.log(`sentinel test-webhook --pr ${pr ?? '?'} --type ${type ?? '?'}: not yet implemented`)
      break
    }

    case 'uninstall':
      console.log('sentinel uninstall: not yet implemented')
      break

    default:
      console.log(`Usage: sentinel <link|unlink|status|flush|test-webhook|uninstall>`)
      console.log('')
      console.log('Commands:')
      console.log('  link                          Link current branch to its PR')
      console.log('  link --pr <n> --repo <o/r>    Explicit link')
      console.log('  unlink                        Detach current session')
      console.log('  status                        Show active links and PR health')
      console.log('  flush --pr <n>                Re-fetch and re-dispatch for a PR')
      console.log('  test-webhook --pr <n> --type <bugbot|codeql|ci|success>')
      console.log('  uninstall                     Remove Claude Code hook')
      process.exit(command ? 1 : 0)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
